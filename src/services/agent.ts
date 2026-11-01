import type { PmsId, Script } from "@/lib/types";
import { buildKeystrokePlan, getPmsProfile, type KeystrokeStep } from "@/lib/pms";
import { buildHelperPayloads, type HelperPayload } from "@/lib/payload";

/**
 * Client for the local desktop helper (`helper/kroll_tray_helper.py`).
 *
 * The helper is a Flask process bound to 127.0.0.1:48120 that replays verified
 * prescriptions as keystrokes into the focused Pharmacy Management System.
 *
 *   GET  /health   -> liveness probe used by the header status indicator
 *   POST /autofill -> one call per medication, using the payload contract below
 *
 * When the helper is not installed the client degrades to a simulated run so
 * technicians can still validate intake data.
 */

export type HelperStatus = "connected" | "offline" | "checking";

export interface HelperInfo {
  version?: string;
  targetSystems?: string[];
  keystrokesAvailable?: boolean;
  checkedAt?: string;
  error?: string;
}

export interface PushOutcome {
  ok: boolean;
  mode: "helper" | "simulated";
  message: string;
  steps: KeystrokeStep[];
  requests: HelperPayload[];
}

const HEALTH_TIMEOUT_MS = 2500;
const POST_TIMEOUT_MS = 20000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normaliseBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class LocalHelperClient {
  status: HelperStatus = "checking";
  private listeners = new Set<(status: HelperStatus) => void>();

  subscribe(listener: (status: HelperStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setStatus(status: HelperStatus) {
    if (this.status === status) return;
    this.status = status;
    this.listeners.forEach((listener) => listener(status));
  }

  /** Probe `GET /health`. Never throws — an unreachable helper is "offline". */
  async check(baseUrl: string): Promise<HelperInfo> {
    try {
      const response = await fetchWithTimeout(
        `${normaliseBase(baseUrl)}/health`,
        { method: "GET", headers: { Accept: "application/json" } },
        HEALTH_TIMEOUT_MS,
      );
      if (!response.ok) throw new Error(`helper responded ${response.status}`);
      const body = (await response.json()) as {
        status?: string;
        version?: string;
        target_systems?: string[];
        keystrokes_available?: boolean;
      };
      this.setStatus("connected");
      return {
        version: body.version,
        targetSystems: body.target_systems,
        keystrokesAvailable: body.keystrokes_available,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.setStatus("offline");
      return {
        checkedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Streams the prescription into the target PMS. `onStep` fires as each field
   * is committed so the UI can render a live keystroke trace in step with the
   * driver running on the workstation.
   */
  async pushScript(
    script: Script,
    pmsId: PmsId,
    helperUrl: string,
    onStep: (step: KeystrokeStep, index: number, total: number) => void,
    helperToken = "",
  ): Promise<PushOutcome> {
    const profile = getPmsProfile(pmsId);
    const steps = buildKeystrokePlan(script, profile);
    const requests = buildHelperPayloads(script, pmsId);
    const base = normaliseBase(helperUrl);
    const reachable = this.status === "connected";

    const postPromise: Promise<string | null> = reachable
      ? this.postAll(base, requests, helperToken)
      : Promise.resolve(null);

    await delay(160);
    for (let index = 0; index < steps.length; index += 1) {
      onStep(steps[index], index, steps.length);
      await delay(reachable ? 170 : 190);
    }

    const error = await postPromise;

    if (!reachable) {
      return {
        ok: true,
        mode: "simulated",
        message: `Helper offline at ${base} — keystrokes simulated locally.`,
        steps,
        requests,
      };
    }

    if (error) {
      return { ok: false, mode: "helper", message: error, steps, requests };
    }

    return {
      ok: true,
      mode: "helper",
      message: `${requests.length} prescription line(s) typed into ${profile.name}.`,
      steps,
      requests,
    };
  }

  /** POST one `/autofill` call per medication. Returns an error message or null. */
  private async postAll(
    base: string,
    requests: HelperPayload[],
    helperToken: string,
  ): Promise<string | null> {
    for (const payload of requests) {
      try {
        const response = await fetchWithTimeout(
          `${base}/autofill`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(helperToken ? { "x-helper-token": helperToken } : {}),
            },
            body: JSON.stringify(payload),
          },
          POST_TIMEOUT_MS,
        );

        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        if (!response.ok) {
          // 4xx = helper reachable but refused (wrong window, bad data, bad token).
          if (response.status >= 500) this.setStatus("offline");
          return body?.message ?? `Helper returned HTTP ${response.status}`;
        }
      } catch (error) {
        this.setStatus("offline");
        return error instanceof Error && error.name === "AbortError"
          ? "Autofill timed out — is the PMS window responsive?"
          : `Could not reach the helper at ${base}.`;
      }
    }
    return null;
  }
}

export const HELPER_PORT = 48120;
export const DEFAULT_HELPER_URL = `http://localhost:${HELPER_PORT}`;

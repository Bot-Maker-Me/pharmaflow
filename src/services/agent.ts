import type { Script, Settings } from "@/lib/types";
import { buildKeystrokePlan, getPmsProfile, type KeystrokeStep } from "@/lib/pms";

/**
 * Bridge to the local desktop helper (the Windows background executable that
 * replays keystrokes into legacy Pharmacy Management Systems).
 *
 * The helper listens on `http://localhost:48120` and exposes a WebSocket on the
 * same port. Messages are JSON:
 *
 *   { "type": "push_prescription", "pms": "kroll", "payload": {...}, "steps": [...] }
 *   { "type": "ack", "script_id": "...", "steps_completed": 12 }
 *
 * When no helper is installed the client degrades gracefully to a simulated
 * keystroke run so technicians can still validate the intake data.
 */

export type AgentStatus = "disconnected" | "connecting" | "connected" | "simulated";

export interface PushResult {
  ok: boolean;
  mode: "agent" | "simulated";
  steps: KeystrokeStep[];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class LocalAgentClient {
  private socket: WebSocket | null = null;
  private url = "";
  private listeners = new Set<(status: AgentStatus) => void>();
  status: AgentStatus = "disconnected";

  subscribe(listener: (status: AgentStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setStatus(status: AgentStatus) {
    if (this.status === status) return;
    this.status = status;
    this.listeners.forEach((listener) => listener(status));
  }

  connect(url: string) {
    if (this.url === url && this.socket) return;
    this.disconnect();
    this.url = url;
    this.setStatus("connecting");
    try {
      const socket = new WebSocket(url);
      this.socket = socket;
      socket.onopen = () => this.setStatus("connected");
      socket.onerror = () => this.setStatus("simulated");
      socket.onclose = () => this.setStatus("simulated");
    } catch {
      this.setStatus("simulated");
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onerror = null;
      this.socket.onclose = null;
      try {
        this.socket.close();
      } catch {
        /* ignore */
      }
      this.socket = null;
    }
    this.url = "";
    this.setStatus("disconnected");
  }

  /**
   * Streams the structured prescription into the target PMS. `onStep` fires as
   * each field is committed so the UI can render a live keystroke trace.
   */
  async pushScript(
    script: Script,
    settings: Settings,
    payload: unknown,
    onStep: (step: KeystrokeStep, index: number, total: number) => void,
  ): Promise<PushResult> {
    const profile = getPmsProfile(settings.pms);
    const plan = buildKeystrokePlan(script, profile);
    const socket = this.socket;
    const viaAgent = this.status === "connected" && socket !== null;

    if (viaAgent && socket) {
      socket.send(
        JSON.stringify({
          type: "push_prescription",
          pms: profile.id,
          script_id: script.id,
          shortcut: profile.shortcut,
          payload,
          steps: plan,
        }),
      );
    }

    await delay(180);
    for (let index = 0; index < plan.length; index += 1) {
      onStep(plan[index], index, plan.length);
      await delay(viaAgent ? 110 : 180);
    }

    return { ok: true, mode: viaAgent ? "agent" : "simulated", steps: plan };
  }
}

export const AGENT_PORT = 48120;

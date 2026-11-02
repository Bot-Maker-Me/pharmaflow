/**
 * /api/sync-queue
 *
 *   POST  (x-api-key)  receives payloads from local flow.py agents
 *                      - normal payload   -> upsert into agent_sync_queue
 *                      - {type:"heartbeat"} -> insert into agent_events
 *   GET   (x-api-key)  lists recent rows so the dashboard / you can verify sync
 *                      ?status=received&limit=50
 *
 * Auth: x-api-key must match AGENT_API_KEY (compared in constant time).
 * Storage: Supabase REST with the service-role key (server-side only).
 * Idempotent: unique (store_id, pending_rx_id) + ignore-duplicates, so agent retries
 * and several PCs polling the same Kroll DB can never create duplicate rows.
 */

import { timingSafeEqual } from "node:crypto";

const MAX_BODY_BYTES = 64 * 1024;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  // No CORS headers on purpose: the caller is a desktop agent, not a browser.
  res.end(status === 204 ? undefined : JSON.stringify(body));
}

function keyMatches(provided, expected) {
  if (typeof provided !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function str(value) {
  return value != null ? String(value) : null;
}

function supabaseConfig() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}

function sbHeaders(key, extra = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function isIsoDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

async function handleShadowResult(body, cfg, res) {
  const storeId = String(body.store_id || "default").slice(0, 64);
  const id = Number(body.pending_rx_id);
  if (!Number.isSafeInteger(id) || id < 0) return send(res, 400, { error: "pending_rx_id is required" });
  if (!cfg) return send(res, 202, { ok: true, stored: false });
  const patch = {
    actual: body.actual && typeof body.actual === "object" ? body.actual : null,
    field_match: body.field_match && typeof body.field_match === "object" ? body.field_match : null,
    compared_at: new Date().toISOString(),
  };
  const resp = await fetch(
    `${cfg.url}/rest/v1/agent_sync_queue?store_id=eq.${encodeURIComponent(storeId)}&pending_rx_id=eq.${id}`,
    { method: "PATCH", headers: sbHeaders(cfg.key, { Prefer: "return=representation" }), body: JSON.stringify(patch) },
  );
  if (!resp.ok) return send(res, 500, { error: "Failed to store comparison" });
  const rows = await resp.json();
  return send(res, rows.length ? 200 : 404, { ok: rows.length > 0, updated: rows.length });
}

async function handleHeartbeat(body, cfg, res) {
  const agent = body.agent || {};
  if (!cfg) return send(res, 202, { ok: true, stored: false });
  const resp = await fetch(`${cfg.url}/rest/v1/agent_events`, {
    method: "POST",
    headers: sbHeaders(cfg.key, { Prefer: "return=minimal" }),
    body: JSON.stringify({
      hostname: str(agent.hostname),
      agent_version: str(agent.version),
      event_type: "heartbeat",
      message: str(body.mode),
      meta: {
        store_id: String(body.store_id || "default").slice(0, 64),
        mode: str(body.mode),
        incomplete: Number.isSafeInteger(body.incomplete) ? body.incomplete : null,
      },
    }),
  });
  if (!resp.ok) return send(res, 500, { error: "Failed to store heartbeat" });
  return send(res, 201, { ok: true, stored: true });
}

export default async function handler(req, res) {
  const expectedKey = process.env.AGENT_API_KEY;
  if (!expectedKey || expectedKey.length < 24) {
    return send(res, 500, { error: "AGENT_API_KEY is not configured (min 24 chars)" });
  }
  if (!keyMatches(req.headers["x-api-key"], expectedKey)) {
    return send(res, 401, { error: "Unauthorized" });
  }

  const cfg = supabaseConfig();

  // ---------------------------------------------------------------- GET
  if (req.method === "GET") {
    if (!cfg) return send(res, 503, { error: "Supabase not configured" });
    const url = new URL(req.url, "http://x");
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 1), 200);
    const status = url.searchParams.get("status");
    const allowed = ["received", "processing", "done", "error"];
    const filter = status && allowed.includes(status) ? `&status=eq.${status}` : "";
    const resp = await fetch(
      `${cfg.url}/rest/v1/agent_sync_queue?select=id,store_id,pending_rx_id,drug_id,qty,status,agent_hostname,agent_mode,received_at` +
        `&order=received_at.desc&limit=${limit}${filter}`,
      { headers: sbHeaders(cfg.key) },
    );
    const data = await resp.json().catch(() => null);
    if (!resp.ok) return send(res, 500, { error: "Query failed" });
    return send(res, 200, { ok: true, count: data.length, rows: data });
  }

  if (req.method !== "POST") {
    return send(res, 405, { error: "Method not allowed" });
  }

  // ---------------------------------------------------------------- POST
  let body = req.body;
  if (typeof body === "string") {
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) return send(res, 413, { error: "Payload too large" });
    try {
      body = JSON.parse(body);
    } catch {
      return send(res, 400, { error: "Invalid JSON" });
    }
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return send(res, 400, { error: "Missing body" });
  }

  try {
    if (body.type === "heartbeat") return await handleHeartbeat(body, cfg, res);
    if (body.type === "shadow_result") return await handleShadowResult(body, cfg, res);

    const pending = body.pending_rx || {};
    const patient = body.patient || {};
    const doctor = body.doctor || {};
    const agent = body.agent || {};

    const pendingRxId = Number(pending.pending_rx_id);
    if (!Number.isSafeInteger(pendingRxId) || pendingRxId < 0) {
      return send(res, 400, { error: "pending_rx.pending_rx_id is required and must be an integer" });
    }
    if (!agent.hostname) {
      return send(res, 400, { error: "agent.hostname is required" });
    }

    const storeId = String(body.store_id || "default").slice(0, 64);

    const row = {
      store_id: storeId,
      pending_rx_id: pendingRxId,
      pat_id: pending.pat_id ?? null,
      doc_id: pending.doc_id ?? null,
      drug_id: str(pending.drug_id),
      qty: str(pending.qty),
      refills: str(pending.refills),
      sig_text: pending.sig_text ?? null,
      date_created: isIsoDate(pending.date_created) ? pending.date_created : null,
      patient_first: patient.first_name ?? null,
      patient_last: patient.last_name ?? null,
      patient_dob: isIsoDate(patient.dob) ? String(patient.dob).slice(0, 10) : null,
      patient_address: patient.address ?? null,
      primary_plan_id: str(patient.primary_plan_id),
      doctor_first: doctor.first_name ?? null,
      doctor_last: doctor.last_name ?? null,
      doctor_licence: doctor.licence ?? null,
      agent_version: str(agent.version),
      agent_hostname: str(agent.hostname),
      agent_mode: str(body.mode),
      decision: body.decision?.action === "AUTO" || body.decision?.action === "EXCEPTION" ? body.decision.action : null,
      decision_issues: Array.isArray(body.decision?.issues) ? body.decision.issues.map(String).slice(0, 20) : null,
      planned: body.decision?.planned && typeof body.decision.planned === "object" ? body.decision.planned : null,
      raw_payload: body,
      status: "received",
    };

    if (!cfg) {
      console.log("[sync-queue] no Supabase config — accepted only", { pending_rx_id: row.pending_rx_id });
      return send(res, 202, { ok: true, stored: false, message: "Accepted (Supabase not configured)" });
    }

    const resp = await fetch(`${cfg.url}/rest/v1/agent_sync_queue?on_conflict=store_id,pending_rx_id`, {
      method: "POST",
      headers: sbHeaders(cfg.key, { Prefer: "resolution=ignore-duplicates,return=representation" }),
      body: JSON.stringify(row),
    });
    const text = await resp.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!resp.ok) {
      // Log status + Supabase error code only — never the payload (PHI).
      console.error("[sync-queue] supabase error", resp.status, data?.code || "");
      return send(res, 500, { error: "Failed to store payload" });
    }

    const stored = Array.isArray(data) && data.length > 0;
    return send(res, stored ? 201 : 200, {
      ok: true,
      stored,
      duplicate: !stored,
      id: stored ? data[0].id : null,
      pending_rx_id: pendingRxId,
    });
  } catch (err) {
    console.error("[sync-queue] unexpected", err?.message || err);
    return send(res, 500, { error: "Internal error" });
  }
}

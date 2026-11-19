/**
 * /api/learn
 *
 * POST  (x-access-token | x-api-key)  record field corrections
 *       Sources: verification UI, or agent SHADOW compare (source=shadow_staff)
 * GET   return top learned mappings for client-side apply + few-shot hints
 *
 * Auth: EXTRACT_ACCESS_TOKEN or AGENT_API_KEY
 * Storage: Supabase service role. Missing Supabase → accept + return empty (no crash).
 */

import { timingSafeEqual } from "node:crypto";

import { bumpMapping, inferMappings, insertFeedback, str } from "../server/learning.js";

const MAX_CORRECTIONS = 40;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function keyMatches(provided, expected) {
  if (typeof provided !== "string" || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
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

export default async function handler(req, res) {
  const token = process.env.EXTRACT_ACCESS_TOKEN || process.env.AGENT_API_KEY;
  if (!token || token.length < 16) return send(res, 503, { error: "Learning API not configured" });
  if (!keyMatches(req.headers["x-access-token"] || req.headers["x-api-key"], token)) {
    return send(res, 401, { error: "Unauthorized" });
  }

  const cfg = supabaseConfig();

  if (req.method === "GET") {
    const url = new URL(req.url, "http://x");
    const storeId = str(url.searchParams.get("store_id") || "default", 64) || "default";
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "80", 10) || 80, 1), 200);
    if (!cfg) return send(res, 200, { ok: true, mappings: [], feedback: [], stored: false });

    const mapResp = await fetch(
      `${cfg.url}/rest/v1/learned_mappings?store_id=eq.${encodeURIComponent(storeId)}&select=kind,source_key,target_value,hit_count,last_seen_at&order=hit_count.desc&limit=${limit}`,
      { headers: sbHeaders(cfg.key) },
    );
    const mappings = mapResp.ok ? await mapResp.json() : [];

    const fbResp = await fetch(
      `${cfg.url}/rest/v1/extraction_feedback?store_id=eq.${encodeURIComponent(storeId)}&select=field_path,original_value,corrected_value,context,created_at&order=created_at.desc&limit=30`,
      { headers: sbHeaders(cfg.key) },
    );
    const feedback = fbResp.ok ? await fbResp.json() : [];

    return send(res, 200, { ok: true, mappings, feedback, stored: true });
  }

  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return send(res, 400, { error: "Invalid JSON" });
    }
  }
  if (!body || typeof body !== "object") return send(res, 400, { error: "Missing body" });

  const storeId = str(body.store_id || "default", 64) || "default";
  const scriptId = str(body.script_id, 80);
  const documentName = str(body.document_name, 200);
  const source = str(body.source || "verify_ui", 40);
  const corrections = Array.isArray(body.corrections) ? body.corrections.slice(0, MAX_CORRECTIONS) : [];
  if (!corrections.length) return send(res, 400, { error: "corrections array required" });

  const rows = corrections
    .map((c) => ({
      store_id: storeId,
      script_id: scriptId || null,
      document_name: documentName || null,
      field_path: str(c.field_path, 120),
      original_value: str(c.original_value, 400),
      corrected_value: str(c.corrected_value, 400),
      source,
      pending_rx_id: c.pending_rx_id != null && Number.isSafeInteger(Number(c.pending_rx_id)) ? Number(c.pending_rx_id) : null,
      context: {
        ...(c.context && typeof c.context === "object" ? c.context : {}),
        source,
      },
    }))
    .filter((r) => r.field_path && r.corrected_value && r.original_value !== r.corrected_value);

  if (!rows.length) return send(res, 200, { ok: true, saved: 0, message: "No real changes" });

  if (!cfg) {
    return send(res, 202, { ok: true, saved: rows.length, stored: false, message: "Accepted (Supabase not configured)" });
  }

  const headers = sbHeaders(cfg.key);
  const stored = await insertFeedback(cfg, headers, rows);
  if (!stored) {
    console.error("[learn] feedback insert failed");
    return send(res, 500, { error: "Failed to store feedback" });
  }

  const mappings = inferMappings(storeId, rows);
  let bumped = 0;
  for (const m of mappings) {
    try {
      if (await bumpMapping(cfg, headers, m)) bumped += 1;
    } catch (err) {
      console.error("[learn] mapping bump", err?.message || err);
    }
  }

  return send(res, 201, { ok: true, saved: rows.length, mappings: bumped, stored: true, source });
}

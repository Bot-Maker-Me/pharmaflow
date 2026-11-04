/**
 * /api/learn
 *
 * POST  (x-access-token)  record field corrections after a tech verifies a script
 * GET   (x-access-token)  return top learned mappings for client-side apply + few-shot hints
 *
 * Auth: EXTRACT_ACCESS_TOKEN (same as /api/extract) so the browser can call it.
 * Storage: Supabase service role. Missing Supabase → accept + return empty (no crash).
 */

import { timingSafeEqual } from "node:crypto";

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

function str(v, max = 500) {
  if (v == null) return "";
  return String(v).slice(0, max);
}

function inferMappings(storeId, corrections) {
  const out = [];
  for (const c of corrections) {
    const path = str(c.field_path, 120);
    const original = str(c.original_value, 400);
    const corrected = str(c.corrected_value, 400);
    if (!path || !corrected || original === corrected) continue;

    if (path.endsWith(".din") && /^\d{7,8}$/.test(corrected.replace(/\D/g, ""))) {
      const din = corrected.replace(/\D/g, "").slice(-8).padStart(8, "0");
      const ctx = c.context && typeof c.context === "object" ? c.context : {};
      if (ctx.drug_name) {
        out.push({ store_id: storeId, kind: "din_to_drug", source_key: din, target_value: str(ctx.drug_name, 200) });
      }
      if (ctx.strength) {
        out.push({ store_id: storeId, kind: "din_to_strength", source_key: din, target_value: str(ctx.strength, 80) });
      }
    }

    if ((path.endsWith(".drug_name") || path.endsWith(".strength") || path.endsWith(".sig")) && original) {
      out.push({
        store_id: storeId,
        kind: "text_replace",
        source_key: `${path}::${original}`.slice(0, 240),
        target_value: corrected,
      });
    }

    if (path.includes("health_card") && corrected) {
      out.push({
        store_id: storeId,
        kind: "health_card_example",
        source_key: str(c.context?.patient_name || "pattern", 80),
        target_value: corrected,
      });
    }
  }
  return out;
}

async function upsertMappings(cfg, mappings) {
  if (!mappings.length) return;
  // Prefer RPC-less: fetch existing hit_count then patch. Simple approach: post with ignore + separate increment via raw SQL not available.
  // Use Prefer resolution=merge-duplicates if unique constraint — PostgREST upsert.
  await fetch(`${cfg.url}/rest/v1/learned_mappings?on_conflict=store_id,kind,source_key`, {
    method: "POST",
    headers: sbHeaders(cfg.key, {
      Prefer: "resolution=merge-duplicates,return=minimal",
    }),
    body: JSON.stringify(
      mappings.map((m) => ({
        ...m,
        hit_count: 1,
        last_seen_at: new Date().toISOString(),
      })),
    ),
  });

  // Increment hit_count for repeats (best-effort)
  for (const m of mappings) {
    const q = new URLSearchParams({
      store_id: `eq.${m.store_id}`,
      kind: `eq.${m.kind}`,
      source_key: `eq.${m.source_key}`,
      select: "id,hit_count",
    });
    const get = await fetch(`${cfg.url}/rest/v1/learned_mappings?${q}`, { headers: sbHeaders(cfg.key) });
    if (!get.ok) continue;
    const rows = await get.json();
    if (!rows[0]) continue;
    await fetch(`${cfg.url}/rest/v1/learned_mappings?id=eq.${rows[0].id}`, {
      method: "PATCH",
      headers: sbHeaders(cfg.key, { Prefer: "return=minimal" }),
      body: JSON.stringify({
        hit_count: (rows[0].hit_count || 1) + 1,
        target_value: m.target_value,
        last_seen_at: new Date().toISOString(),
      }),
    });
  }
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
      context: c.context && typeof c.context === "object" ? c.context : {},
    }))
    .filter((r) => r.field_path && r.corrected_value && r.original_value !== r.corrected_value);

  if (!rows.length) return send(res, 200, { ok: true, saved: 0, message: "No real changes" });

  if (!cfg) {
    return send(res, 202, { ok: true, saved: rows.length, stored: false, message: "Accepted (Supabase not configured)" });
  }

  const resp = await fetch(`${cfg.url}/rest/v1/extraction_feedback`, {
    method: "POST",
    headers: sbHeaders(cfg.key, { Prefer: "return=minimal" }),
    body: JSON.stringify(rows),
  });

  if (!resp.ok) {
    console.error("[learn] feedback insert failed", resp.status);
    return send(res, 500, { error: "Failed to store feedback" });
  }

  const mappings = inferMappings(storeId, rows);
  try {
    await upsertMappings(cfg, mappings);
  } catch (err) {
    console.error("[learn] mapping upsert", err?.message || err);
  }

  return send(res, 201, { ok: true, saved: rows.length, mappings: mappings.length, stored: true });
}

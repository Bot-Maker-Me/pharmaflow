/**
 * /api/live — data for the in-app "Live" dashboard (no patient names are ever returned).
 *
 *   GET  (x-access-token)   -> { stats: live_stats(), rows: latest rows (ids, decision, planned, compare result) }
 *   POST (x-access-token)   { action: "start_shadow_week" }  -> sets live_since = now()
 *                           (rows received before it are "backlog" and excluded from rates / reports)
 *
 * Auth: x-access-token = APP_ACCESS_TOKEN (falls back to EXTRACT_ACCESS_TOKEN), constant-time compare.
 */

import { timingSafeEqual } from "node:crypto";

const ROW_COLUMNS =
  "id,store_id,pending_rx_id,drug_id,qty,decision,decision_issues,planned,actual,field_match,status,date_created,received_at,compared_at";

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function tokenOk(provided, expected) {
  if (typeof provided !== "string" || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  const expected = process.env.APP_ACCESS_TOKEN || process.env.EXTRACT_ACCESS_TOKEN;
  if (!expected || expected.length < 16) {
    return send(res, 503, { error: "APP_ACCESS_TOKEN (or EXTRACT_ACCESS_TOKEN) is not configured" });
  }
  if (!tokenOk(req.headers["x-access-token"], expected)) return send(res, 401, { error: "Unauthorized" });

  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return send(res, 503, { error: "Supabase is not configured" });
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

  try {
    if (req.method === "GET") {
      const q = new URL(req.url, "http://x").searchParams;
      const limit = Math.min(Math.max(parseInt(q.get("limit") || "40", 10) || 40, 1), 100);
      const [statsResp, rowsResp, hbResp] = await Promise.all([
        fetch(`${url}/rest/v1/rpc/live_stats`, { method: "POST", headers, body: "{}" }),
        fetch(`${url}/rest/v1/agent_sync_queue?select=${ROW_COLUMNS}&order=id.desc&limit=${limit}`, { headers }),
        fetch(`${url}/rest/v1/agent_events?select=agent_version&event_type=eq.heartbeat&order=created_at.desc&limit=1`, { headers }),
      ]);
      if (!statsResp.ok || !rowsResp.ok) return send(res, 500, { error: "Query failed" });
      const stats = await statsResp.json();
      const hb = hbResp.ok ? await hbResp.json() : [];
      if (stats?.heartbeat && hb?.[0]) stats.heartbeat.version = hb[0].agent_version;
      return send(res, 200, { ok: true, stats, rows: await rowsResp.json() });
    }

    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch {
          return send(res, 400, { error: "Invalid JSON" });
        }
      }
      if (body?.action !== "start_shadow_week") return send(res, 400, { error: "Unknown action" });
      const now = new Date().toISOString();
      const resp = await fetch(`${url}/rest/v1/shadow_report_settings?on_conflict=key`, {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ key: "live_since", value: now }),
      });
      if (!resp.ok) return send(res, 500, { error: "Could not start shadow week" });
      return send(res, 200, { ok: true, live_since: now });
    }

    return send(res, 405, { error: "Method not allowed" });
  } catch (err) {
    console.error("[live] unexpected", err?.message || err);
    return send(res, 500, { error: "Internal error" });
  }
}

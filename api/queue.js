/**
 * /api/queue — the pharmacy inbox of prescriptions synced from Kroll by flow.py.
 *
 *   GET   ?status=received|processing|done|error&limit=50   list rows (contains PHI)
 *   PATCH { id, status, error_message? }                    move a row through the workflow
 *
 * Auth: header x-access-token = APP_ACCESS_TOKEN (falls back to EXTRACT_ACCESS_TOKEN).
 * Rows are only ever read/updated with the Supabase service-role key on the server.
 */

import { timingSafeEqual } from "node:crypto";

const STATUSES = ["received", "processing", "done", "error"];
const COLUMNS =
  "id,store_id,pending_rx_id,drug_id,qty,refills,sig_text,date_created," +
  "patient_first,patient_last,patient_dob,primary_plan_id,doctor_first,doctor_last,doctor_licence," +
  "status,error_message,received_at,processed_at";

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
  if (!tokenOk(req.headers["x-access-token"], expected)) {
    return send(res, 401, { error: "Unauthorized" });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return send(res, 503, { error: "Supabase is not configured" });
  const base = `${url.replace(/\/$/, "")}/rest/v1/agent_sync_queue`;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

  try {
    if (req.method === "GET") {
      const q = new URL(req.url, "http://x").searchParams;
      const status = q.get("status") || "received";
      if (!STATUSES.includes(status)) return send(res, 400, { error: "Invalid status" });
      const limit = Math.min(Math.max(parseInt(q.get("limit") || "50", 10) || 50, 1), 200);
      const resp = await fetch(
        `${base}?select=${COLUMNS}&status=eq.${status}&order=received_at.desc&limit=${limit}`,
        { headers },
      );
      if (!resp.ok) return send(res, 500, { error: "Query failed" });
      const rows = await resp.json();
      return send(res, 200, { ok: true, count: rows.length, rows });
    }

    if (req.method === "PATCH") {
      let body = req.body;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch {
          return send(res, 400, { error: "Invalid JSON" });
        }
      }
      const id = Number(body?.id);
      if (!Number.isSafeInteger(id) || id <= 0) return send(res, 400, { error: "id is required" });
      if (!STATUSES.includes(body?.status)) return send(res, 400, { error: "Invalid status" });

      const patch = {
        status: body.status,
        error_message: body.status === "error" ? String(body.error_message || "").slice(0, 300) : null,
        processed_at: body.status === "done" || body.status === "error" ? new Date().toISOString() : null,
      };
      const resp = await fetch(`${base}?id=eq.${id}`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify(patch),
      });
      if (!resp.ok) return send(res, 500, { error: "Update failed" });
      const rows = await resp.json();
      if (!rows.length) return send(res, 404, { error: "Not found" });
      return send(res, 200, { ok: true, id, status: rows[0].status });
    }

    return send(res, 405, { error: "Method not allowed" });
  } catch (err) {
    console.error("[queue] unexpected", err?.message || err);
    return send(res, 500, { error: "Internal error" });
  }
}

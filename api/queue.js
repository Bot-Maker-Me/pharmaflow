/**
 * /api/queue — prescriptions synced from Kroll by flow.py (+ OCR when ScriptImage present).
 */

import { timingSafeEqual } from "node:crypto";

const STATUSES = ["received", "processing", "done", "error"];
const COLUMNS =
  "id,store_id,pending_rx_id,drug_id,qty,refills,sig_text,date_created," +
  "patient_first,patient_last,patient_dob,primary_plan_id,doctor_first,doctor_last,doctor_licence," +
  "status,error_message,received_at,processed_at,planned,page_image_url," +
  "ocr_din,ocr_drug_name,ocr_strength,ocr_health_card";

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

/** Replace stored private image paths with signed links that expire in 1 hour (bucket rx-images is private). */
async function signImages(rows, supabaseUrl, key) {
  await Promise.all(
    rows.map(async (row) => {
      const stored = row.page_image_url;
      if (typeof stored !== "string" || !stored.startsWith("private:")) return;
      try {
        const resp = await fetch(
          `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/sign/rx-images/${stored.slice(8)}`,
          {
            method: "POST",
            headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({ expiresIn: 3600 }),
          },
        );
        const data = resp.ok ? await resp.json() : null;
        row.page_image_url = data?.signedURL ? `${supabaseUrl.replace(/\/$/, "")}/storage/v1${data.signedURL}` : null;
      } catch {
        row.page_image_url = null;
      }
    }),
  );
  return rows;
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
      if (q.get("kind") === "faxes") {
        // Prescriptions the agent read from Kroll's Inbound Docs (OCR), newest first, with a signed link to the fax image.
        const fr = await fetch(
          `${url.replace(/\/$/, "")}/rest/v1/inbound_faxes?select=mail_id,received_label,from_label,doc_type,summary,ocr,page_image_url,created_at&is_prescription=eq.true&order=created_at.desc&limit=40`,
          { headers },
        );
        if (!fr.ok) return send(res, 500, { error: "Query failed" });
        const faxes = await signImages(await fr.json(), url, key);
        return send(res, 200, { ok: true, count: faxes.length, rows: faxes });
      }
      const status = q.get("status") || "received";
      if (!STATUSES.includes(status)) return send(res, 400, { error: "Invalid status" });
      const limit = Math.min(Math.max(parseInt(q.get("limit") || "50", 10) || 50, 1), 200);
      const resp = await fetch(
        `${base}?select=${COLUMNS}&status=eq.${status}&order=received_at.desc&limit=${limit}`,
        { headers },
      );
      if (!resp.ok) {
        // Fallback without OCR columns if migration not applied yet
        const basic =
          "id,store_id,pending_rx_id,drug_id,qty,refills,sig_text,date_created," +
          "patient_first,patient_last,patient_dob,primary_plan_id,doctor_first,doctor_last,doctor_licence," +
          "status,error_message,received_at,processed_at,planned";
        const resp2 = await fetch(
          `${base}?select=${basic}&status=eq.${status}&order=received_at.desc&limit=${limit}`,
          { headers },
        );
        if (!resp2.ok) return send(res, 500, { error: "Query failed" });
        const rows2 = await resp2.json();
        return send(res, 200, { ok: true, count: rows2.length, rows: rows2 });
      }
      const rows = await signImages(await resp.json(), url, key);
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

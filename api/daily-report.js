/**
 * POST /api/daily-report   { report_id }
 * Called by Supabase (pg_net) right after the nightly report is generated.
 * Reads that report with the service-role key and e-mails it through Resend.
 *
 * Env: REPORT_SECRET (>=16 chars, same as shadow_report_settings.webhook_secret),
 *      RESEND_API_KEY, REPORT_EMAIL_TO (comma separated), REPORT_EMAIL_FROM,
 *      SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * The report text contains Kroll ids and field names only (no patient names).
 */

import { timingSafeEqual } from "node:crypto";

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function same(a, b) {
  if (typeof a !== "string" || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });

  const secret = process.env.REPORT_SECRET;
  if (!secret || secret.length < 16) return send(res, 503, { error: "REPORT_SECRET not configured" });
  if (!same(req.headers["x-report-secret"], secret)) return send(res, 401, { error: "Unauthorized" });

  const { RESEND_API_KEY, REPORT_EMAIL_TO, REPORT_EMAIL_FROM, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!RESEND_API_KEY || !REPORT_EMAIL_TO || !REPORT_EMAIL_FROM || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return send(res, 503, { error: "E-mail or Supabase settings are missing" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return send(res, 400, { error: "Invalid JSON" });
    }
  }
  const id = Number(body?.report_id);
  if (!Number.isSafeInteger(id) || id <= 0) return send(res, 400, { error: "report_id is required" });

  const sb = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
  const base = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/shadow_reports`;

  try {
    const got = await fetch(`${base}?id=eq.${id}&select=id,store_id,report_date,body`, { headers: sb });
    const rows = got.ok ? await got.json() : [];
    if (!rows.length) return send(res, 404, { error: "Report not found" });
    const report = rows[0];

    const mail = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: REPORT_EMAIL_FROM,
        to: REPORT_EMAIL_TO.split(",").map((s) => s.trim()).filter(Boolean),
        subject: `PharmFlow shadow report - ${report.store_id} - ${report.report_date}`,
        text: report.body,
      }),
    });
    if (!mail.ok) {
      console.error("[daily-report] resend error", mail.status);
      return send(res, 502, { error: "E-mail provider rejected the message" });
    }

    await fetch(`${base}?id=eq.${id}`, {
      method: "PATCH",
      headers: sb,
      body: JSON.stringify({ emailed_at: new Date().toISOString() }),
    });
    return send(res, 200, { ok: true });
  } catch (err) {
    console.error("[daily-report] unexpected", err?.message || err);
    return send(res, 500, { error: "Internal error" });
  }
}

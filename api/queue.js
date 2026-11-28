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

const PHARMACY_TZ = process.env.PHARMACY_TZ || "America/Toronto";

/** Offset (ms) of a time zone from UTC at a given instant. */
function tzOffsetMs(tz, date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date);
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+v.year, +v.month - 1, +v.day, +v.hour % 24, +v.minute, +v.second);
  return asUtc - date.getTime();
}

/** Start (as a UTC instant) of the pharmacy's day / Monday-week / month containing `now`. */
function periodStarts(now = new Date(), tz = PHARMACY_TZ) {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);      // YYYY-MM-DD
  const midnight = (dateStr) => {
    const guess = new Date(`${dateStr}T00:00:00Z`);
    return new Date(guess.getTime() - tzOffsetMs(tz, guess));
  };
  const [y, m, d] = ymd.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();                       // 0 = Sunday
  const monday = new Date(Date.UTC(y, m - 1, d - ((weekday + 6) % 7))).toISOString().slice(0, 10);
  return { day: midnight(ymd), week: midnight(monday), month: midnight(`${y}-${String(m).padStart(2, "0")}-01`) };
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
      if (q.get("kind") === "fax_stats") {
        // Counts for the Intake page: prescription faxes received and faxes pushed to Kroll, today / this week / this month.
        const starts = periodStarts();
        const base2 = `${url.replace(/\/$/, "")}/rest/v1/inbound_faxes`;
        const monthIso = encodeURIComponent(starts.month.toISOString());
        const [recv, pushed, waiting] = await Promise.all([
          fetch(`${base2}?select=created_at&is_prescription=eq.true&created_at=gte.${monthIso}&limit=5000`, { headers }),
          fetch(`${base2}?select=pushed_at&status=eq.pushed&pushed_at=gte.${monthIso}&limit=5000`, { headers }),
          fetch(`${base2}?select=mail_id&status=eq.new&or=(kroll_state.is.null,kroll_state.eq.pending)&limit=500`, { headers }),
        ]);
        if (!recv.ok || !pushed.ok) return send(res, 500, { error: "Query failed" });
        const count = (rows, col) => ({
          today: rows.filter((r) => Date.parse(r[col]) >= starts.day.getTime()).length,
          week: rows.filter((r) => Date.parse(r[col]) >= starts.week.getTime()).length,
          month: rows.length,
        });
        return send(res, 200, {
          ok: true,
          timezone: PHARMACY_TZ,
          received: count(await recv.json(), "created_at"),
          cleared: count(await pushed.json(), "pushed_at"),
          waiting: waiting.ok ? (await waiting.json()).length : null,
        });
      }
      if (q.get("kind") === "faxes") {
        // Prescriptions the agent read from Kroll's Inbound Docs (OCR), newest first, with a signed link to the fax image.
        // ?status=new (default) | pushed | dismissed
        const fstatus = ["new", "pushed", "dismissed"].includes(q.get("status")) ? q.get("status") : "new";
        const fr = await fetch(
          `${url.replace(/\/$/, "")}/rest/v1/inbound_faxes?select=mail_id,store_id,received_label,from_label,doc_type,is_prescription,summary,ocr,page_image_url,status,pushed_at,learn_result,created_at&status=eq.${fstatus}${fstatus === "new" ? "&or=(kroll_state.is.null,kroll_state.eq.pending)" : "&is_prescription=eq.true"}&order=created_at.desc&limit=300`,
          { headers },
        );
        if (!fr.ok) return send(res, 500, { error: "Query failed" });
        // Newest FAX first: sort by the time Kroll shows on the fax (YYYY-MM-DD HH:MM:SS sorts as text), not by the time
        // the agent uploaded it (a backlog upload would otherwise put old faxes on top).
        const all = (await fr.json()).sort((a, b) => {
          const ka = a.received_label || "", kb = b.received_label || "";
          return ka === kb ? Date.parse(b.created_at) - Date.parse(a.created_at) : ka < kb ? 1 : -1;
        });
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: PHARMACY_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
        const wanted = q.get("day") === "today" ? all.filter((r) => (r.received_label || "").startsWith(today)) : all;
        const faxes = await signImages(wanted.slice(0, 60), url, key);
        const todayCount = all.filter((r) => (r.received_label || "").startsWith(today)).length;
        return send(res, 200, { ok: true, count: faxes.length, total: all.length, today_count: todayCount, today, rows: faxes });
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
      if (body?.kind === "fax") {
        // { kind:"fax", store_id, mail_id, action:"pushed"|"dismiss"|"reopen", pushed:{...what was typed into Kroll} }
        const mailId = Number(body.mail_id);
        if (!Number.isSafeInteger(mailId) || mailId <= 0) return send(res, 400, { error: "mail_id is required" });
        const patch =
          body.action === "pushed"
            ? { status: "pushed", pushed_at: new Date().toISOString(), pushed: body.pushed && typeof body.pushed === "object" ? body.pushed : null, learned_at: null }
            : body.action === "dismiss"
              ? { status: "dismissed" }
              : body.action === "reopen"
                ? { status: "new", pushed_at: null, pushed: null, learned_at: null }
                : null;
        if (!patch) return send(res, 400, { error: "Unknown action" });
        const store = String(body.store_id || "default").slice(0, 64);
        const fr = await fetch(
          `${url.replace(/\/$/, "")}/rest/v1/inbound_faxes?store_id=eq.${encodeURIComponent(store)}&mail_id=eq.${mailId}`,
          { method: "PATCH", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify(patch) },
        );
        if (!fr.ok) return send(res, 500, { error: "Update failed" });
        const rows = await fr.json();
        return rows.length ? send(res, 200, { ok: true, mail_id: mailId, status: rows[0].status }) : send(res, 404, { error: "Not found" });
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

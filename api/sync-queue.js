/**
 * POST /api/sync-queue
 * Receives payloads from local flow.py agents.
 * Auth: x-api-key must match AGENT_API_KEY.
 * Writes to Supabase via REST (no @supabase/supabase-js package required).
 */

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return json(res, 204, {});
  }

  if (req.method !== "POST") {
    return json(res, 405, { error: "Method not allowed" });
  }

  const expectedKey = process.env.AGENT_API_KEY;
  if (!expectedKey) {
    return json(res, 500, { error: "AGENT_API_KEY not configured on server" });
  }

  const provided = req.headers["x-api-key"];
  if (!provided || provided !== expectedKey) {
    return json(res, 401, { error: "Unauthorized" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return json(res, 400, { error: "Invalid JSON" });
    }
  }

  if (!body || typeof body !== "object") {
    return json(res, 400, { error: "Missing body" });
  }

  const pending = body.pending_rx || {};
  const patient = body.patient || {};
  const doctor = body.doctor || {};
  const agent = body.agent || {};

  const row = {
    pending_rx_id: pending.pending_rx_id ?? null,
    pat_id: pending.pat_id ?? null,
    doc_id: pending.doc_id ?? null,
    drug_id: pending.drug_id != null ? String(pending.drug_id) : null,
    qty: pending.qty != null ? String(pending.qty) : null,
    refills: pending.refills != null ? String(pending.refills) : null,
    sig_text: pending.sig_text ?? null,
    date_created: pending.date_created ?? null,
    patient_first: patient.first_name ?? null,
    patient_last: patient.last_name ?? null,
    patient_dob: patient.dob ?? null,
    patient_address: patient.address ?? null,
    primary_plan_id:
      patient.primary_plan_id != null ? String(patient.primary_plan_id) : null,
    doctor_first: doctor.first_name ?? null,
    doctor_last: doctor.last_name ?? null,
    doctor_licence: doctor.licence ?? null,
    agent_version: agent.version ?? null,
    agent_hostname: agent.hostname ?? null,
    agent_mode: body.mode ?? null,
    raw_payload: body,
    status: "received",
  };

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.log("[sync-queue] no Supabase config — accepted only", {
      pending_rx_id: row.pending_rx_id,
      hostname: row.agent_hostname,
    });
    return json(res, 202, {
      ok: true,
      stored: false,
      message: "Accepted (Supabase not configured)",
      pending_rx_id: row.pending_rx_id,
    });
  }

  try {
    const endpoint = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/agent_sync_queue`;
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(row),
    });

    const text = await resp.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!resp.ok) {
      console.error("[sync-queue] supabase error", resp.status, data);
      return json(res, 500, {
        error: typeof data === "object" && data?.message ? data.message : String(data),
      });
    }

    const id = Array.isArray(data) ? data[0]?.id : data?.id;
    return json(res, 201, {
      ok: true,
      stored: true,
      id: id ?? null,
      pending_rx_id: row.pending_rx_id,
    });
  } catch (err) {
    console.error("[sync-queue] unexpected", err);
    return json(res, 500, { error: String(err?.message || err) });
  }
}

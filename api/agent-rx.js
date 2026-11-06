import { timingSafeEqual } from "node:crypto";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";

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

function parseDataUrl(url) {
  const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(url || "");
  if (!match) return null;
  return { media_type: match[1] === "image/jpg" ? "image/jpeg" : match[1], data: match[2] };
}

function extractJson(text) {
  const cleaned = String(text || "").replace(/^```(?:json)?\s*|\s*```$/gim, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON in model output");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function normaliseDin(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length === 8) return digits;
  if (digits.length === 7) return digits.padStart(8, "0");
  return digits.length > 8 ? digits.slice(-8) : digits;
}

function supabaseConfig() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}

function sbHeaders(key, extra = {}) {
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...extra };
}

const OCR_PROMPT = `Extract Canadian pharmacy fax to JSON only. Return {"scripts":[{ "patient":{"full_name":"","dob":"YYYY-MM-DD","health_card_num":"","confidence":0.0},"prescriber":{"name":"","license_number":"","confidence":0.0},"medications":[{"drug_name":"","din":"","strength":"","quantity":0,"refills":0,"sig":"","is_compound":false,"confidence":0.0}],"overall_confidence":0.0 }]}. DIN is 8 digits. Empty if unreadable. No markdown.`;

async function runOcr(dataUrl) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: "ANTHROPIC_API_KEY not set", scripts: [] };
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return { error: "invalid image data URL", scripts: [] };
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: parsed.media_type, data: parsed.data } },
          { type: "text", text: OCR_PROMPT },
        ],
      }],
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    return { error: `Anthropic ${resp.status}: ${t.slice(0, 200)}`, scripts: [] };
  }
  const data = await resp.json();
  const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  try {
    const parsedJson = extractJson(text);
    return { scripts: Array.isArray(parsedJson.scripts) ? parsedJson.scripts : [], raw: text };
  } catch (e) {
    return { error: String(e.message || e), scripts: [] };
  }
}

function mergeSqlAndOcr(body, ocrScript) {
  const pending = body.pending_rx || {};
  const patient = body.patient || {};
  const doctor = body.doctor || {};
  const ocrPatient = ocrScript?.patient || {};
  const ocrPrescriber = ocrScript?.prescriber || {};
  const ocrMed = (ocrScript?.medications && ocrScript.medications[0]) || {};
  const sqlName = [patient.first_name, patient.last_name].filter(Boolean).join(" ").trim();
  const sqlDoc = [doctor.first_name, doctor.last_name].filter(Boolean).join(" ").trim();
  return {
    patient: {
      full_name: ocrPatient.full_name || sqlName || "",
      dob: ocrPatient.dob || (patient.dob ? String(patient.dob).slice(0, 10) : "") || "",
      health_card_num: ocrPatient.health_card_num || "",
      confidence: ocrPatient.confidence ?? 0.7,
    },
    prescriber: {
      name: ocrPrescriber.name || sqlDoc || "",
      license_number: ocrPrescriber.license_number || doctor.licence || "",
      confidence: ocrPrescriber.confidence ?? 0.7,
    },
    medications: [{
      drug_name: ocrMed.drug_name || (pending.drug_id ? `Kroll drug ${pending.drug_id}` : ""),
      din: normaliseDin(ocrMed.din) || "",
      strength: ocrMed.strength || "",
      quantity: Number(ocrMed.quantity) || Number(pending.qty) || 0,
      refills: Number(ocrMed.refills) || Number(pending.refills) || 0,
      sig: ocrMed.sig || pending.sig_text || "",
      is_compound: Boolean(ocrMed.is_compound),
      confidence: ocrMed.confidence ?? 0.7,
    }],
    overall_confidence: ocrScript?.overall_confidence ?? 0.75,
    source: "sql+ocr",
  };
}

async function uploadImage(cfg, storeId, pendingRxId, dataUrl) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  const path = `${storeId}/${pendingRxId}.jpg`;
  const bin = Buffer.from(parsed.data, "base64");
  const resp = await fetch(`${cfg.url}/storage/v1/object/rx-images/${path}`, {
    method: "POST",
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      "Content-Type": parsed.media_type,
      "x-upsert": "true",
    },
    body: bin,
  });
  if (!resp.ok) {
    const t = await resp.text();
    console.warn("[agent-rx] storage upload failed", resp.status, t.slice(0, 180));
    return null;
  }
  return `${cfg.url}/storage/v1/object/public/rx-images/${path}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  const expected = process.env.AGENT_API_KEY;
  if (!expected || expected.length < 16) return send(res, 503, { error: "AGENT_API_KEY not configured" });
  if (!keyMatches(req.headers["x-api-key"], expected)) return send(res, 401, { error: "Unauthorized" });
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return send(res, 400, { error: "Invalid JSON" }); }
  }
  if (!body || typeof body !== "object") return send(res, 400, { error: "Body required" });
  const pending = body.pending_rx || {};
  const pendingRxId = Number(pending.pending_rx_id);
  if (!Number.isSafeInteger(pendingRxId) || pendingRxId < 0) {
    return send(res, 400, { error: "pending_rx.pending_rx_id required" });
  }
  const storeId = String(body.store_id || "default").slice(0, 64);
  const pageImages = Array.isArray(body.page_images) ? body.page_images.filter(Boolean) : [];
  const patient = body.patient || {};
  const doctor = body.doctor || {};
  const agent = body.agent || {};
  let ocr = { scripts: [], error: null };
  let pageImageUrl = null;
  const cfg = supabaseConfig();
  if (pageImages[0]) {
    ocr = await runOcr(pageImages[0]);
    if (cfg) pageImageUrl = await uploadImage(cfg, storeId, pendingRxId, pageImages[0]);
  }
  const merged = mergeSqlAndOcr(body, ocr.scripts[0]);
  const row = {
    store_id: storeId,
    pending_rx_id: pendingRxId,
    pat_id: pending.pat_id ?? null,
    doc_id: pending.doc_id ?? null,
    drug_id: pending.drug_id != null ? String(pending.drug_id) : null,
    qty: pending.qty != null ? String(pending.qty) : null,
    refills: pending.refills != null ? String(pending.refills) : null,
    sig_text: pending.sig_text ?? null,
    date_created: pending.date_created || null,
    patient_first: patient.first_name ?? null,
    patient_last: patient.last_name ?? null,
    patient_dob: patient.dob ? String(patient.dob).slice(0, 10) : null,
    patient_address: patient.address ?? null,
    primary_plan_id: patient.primary_plan_id != null ? String(patient.primary_plan_id) : null,
    doctor_first: doctor.first_name ?? null,
    doctor_last: doctor.last_name ?? null,
    doctor_licence: doctor.licence ?? null,
    agent_version: agent.version != null ? String(agent.version) : null,
    agent_hostname: agent.hostname != null ? String(agent.hostname) : null,
    agent_mode: body.mode != null ? String(body.mode) : null,
    decision: body.decision?.action === "AUTO" || body.decision?.action === "EXCEPTION" ? body.decision.action : null,
    decision_issues: Array.isArray(body.decision?.issues) ? body.decision.issues.map(String).slice(0, 20) : null,
    planned: {
      ...(body.decision?.planned && typeof body.decision.planned === "object" ? body.decision.planned : {}),
      ocr_merged: merged,
      ocr_error: ocr.error || null,
    },
    page_image_url: pageImageUrl,
    ocr_din: merged.medications[0]?.din || null,
    ocr_drug_name: merged.medications[0]?.drug_name || null,
    ocr_strength: merged.medications[0]?.strength || null,
    ocr_health_card: merged.patient?.health_card_num || null,
    raw_payload: { ...body, page_images: pageImages.length ? ["[omitted]"] : [] },
    status: "received",
  };
  if (!cfg) {
    return send(res, 202, { ok: true, stored: false, ocr: Boolean(ocr.scripts[0]), ocr_error: ocr.error || null, merged });
  }
  const resp = await fetch(`${cfg.url}/rest/v1/agent_sync_queue?on_conflict=store_id,pending_rx_id`, {
    method: "POST",
    headers: sbHeaders(cfg.key, { Prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify(row),
  });
  if (!resp.ok) {
    const text = await resp.text();
    console.error("[agent-rx] supabase", resp.status, text.slice(0, 300));
    delete row.page_image_url;
    delete row.ocr_din;
    delete row.ocr_drug_name;
    delete row.ocr_strength;
    delete row.ocr_health_card;
    const resp2 = await fetch(`${cfg.url}/rest/v1/agent_sync_queue?on_conflict=store_id,pending_rx_id`, {
      method: "POST",
      headers: sbHeaders(cfg.key, { Prefer: "resolution=merge-duplicates,return=representation" }),
      body: JSON.stringify(row),
    });
    if (!resp2.ok) {
      const t2 = await resp2.text();
      return send(res, 502, { error: "Supabase write failed", detail: t2.slice(0, 200), ocr_error: ocr.error });
    }
  }
  return send(res, 200, {
    ok: true,
    stored: true,
    pending_rx_id: pendingRxId,
    ocr: Boolean(ocr.scripts[0]),
    ocr_error: ocr.error || null,
    page_image_url: pageImageUrl,
    merged,
  });
}

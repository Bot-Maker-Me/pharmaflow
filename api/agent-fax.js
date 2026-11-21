/**
 * POST /api/agent-fax   (x-api-key = AGENT_API_KEY)
 * The Kroll agent sends a fax that just arrived in Kroll's "Inbound Docs" (before staff made a pending Rx).
 * body: { store_id, mail_id, received, from, page_images:[dataUrl], agent:{version,hostname} }
 * One Anthropic call decides "is this a prescription?" and extracts the fields; the result is stored in
 * inbound_faxes (one row per store + mail_id). Non-prescriptions (ads, reports) are stored as "other".
 */
import { extractJson, keyMatches, parseDataUrl, sbHeaders, supabaseConfig, uploadPrivateImage } from "../server/agent-common.js";
import { applySigLearning, bumpMapping, inferMappings, insertFeedback } from "../server/learning.js";
import { sigFixIsSafe } from "../server/sig-safe.js";

const MODEL = process.env.EXTRACT_MODEL || process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

const FAX_PROMPT = `You read one fax received by a Canadian pharmacy. Return JSON only (no markdown):
{"doc_type":"prescription|refill_request|transfer|other","is_prescription":false,"summary":"max 12 words on what kind of fax this is, never any person names","scripts":[{"patient":{"full_name":"","dob":"YYYY-MM-DD","health_card_num":"","confidence":0.0},"prescriber":{"name":"","license_number":"","confidence":0.0},"medications":[{"drug_name":"","din":"","strength":"","quantity":0,"refills":0,"sig":"","is_compound":false,"confidence":0.0}],"overall_confidence":0.0}]}
is_prescription is true only for a new prescription or a refill/renewal authorization for a patient. Advertisements, flyers, reports, cover sheets, lab results and anything without a prescription are doc_type "other" with scripts []. DIN is 8 digits. Empty strings when unreadable.`;

async function readFax(dataUrl) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: "ANTHROPIC_API_KEY not set" };
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return { error: "invalid image data URL" };
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
          { type: "text", text: FAX_PROMPT },
        ],
      }],
    }),
  });
  if (!resp.ok) return { error: `Anthropic ${resp.status}: ${(await resp.text()).slice(0, 200)}` };
  const data = await resp.json();
  const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  try {
    return { result: extractJson(text) };
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

/** Sig fixes staff made before (same sig text -> same correction, 2+ times). */
async function loadSigMappings(cfg, storeId) {
  try {
    const q = new URLSearchParams({
      store_id: `eq.${storeId}`,
      kind: "eq.text_replace",
      source_key: "like.*sig::*",
      hit_count: "gte.2",
      select: "kind,source_key,target_value,hit_count",
      limit: "300",
    });
    const resp = await fetch(`${cfg.url}/rest/v1/learned_mappings?${q}`, { headers: sbHeaders(cfg.key) });
    return resp.ok ? await resp.json() : [];
  } catch {
    return [];
  }
}

/** Apply a learned sig fix only if it is a wording / note change; otherwise leave the sig and add a hint. */
function applyLearnedSig(script, mappings) {
  const med = script?.medications?.[0];
  if (!med || !med.sig) return script;
  const fix = applySigLearning(med.sig, mappings);
  if (!fix.applied) return script;
  if (sigFixIsSafe(fix.applied.from, fix.applied.to)) {
    med.sig_raw = med.sig;
    med.sig = fix.sig;
    med.sig_learned = fix.applied;
  } else {
    med.sig_hint = fix.applied;
  }
  return script;
}

/** GET ?pending_learn=1&store_id=  -> faxes pushed to Kroll that the agent has not yet compared with Kroll's final Rx. */
async function listPendingLearn(req, res, cfg) {
  const q = new URL(req.url, "http://x").searchParams;
  const storeId = String(q.get("store_id") || "default").slice(0, 64);
  if (!cfg) return send(res, 200, { ok: true, items: [] });
  const params = new URLSearchParams({
    store_id: `eq.${storeId}`,
    status: "eq.pushed",
    learned_at: "is.null",
    select: "mail_id,pushed,pushed_at,ocr",
    order: "pushed_at.asc",
    limit: "30",
  });
  const resp = await fetch(`${cfg.url}/rest/v1/inbound_faxes?${params}`, { headers: sbHeaders(cfg.key) });
  return send(res, resp.ok ? 200 : 502, { ok: resp.ok, items: resp.ok ? await resp.json() : [] });
}

/**
 * POST { type:"fax_result", store_id, mail_id, found, final:{sig,qty,refills}, give_up }
 * The agent looked in Kroll for the Rx staff finished from a pushed fax. When the final sig differs from the
 * fax's own sig, store the correction so the next fax with that sig is fixed (wording only) or hinted.
 */
async function handleFaxResult(body, res, cfg) {
  const mailId = Number(body.mail_id);
  if (!Number.isSafeInteger(mailId) || !cfg) return send(res, 400, { error: "mail_id required" });
  const storeId = String(body.store_id || "default").slice(0, 64);
  const filter = `store_id=eq.${encodeURIComponent(storeId)}&mail_id=eq.${mailId}`;
  const cur = await fetch(`${cfg.url}/rest/v1/inbound_faxes?${filter}&select=pushed,ocr`, { headers: sbHeaders(cfg.key) });
  const row = cur.ok ? (await cur.json())[0] : null;
  if (!row) return send(res, 404, { error: "fax not found" });
  const med = row.ocr?.scripts?.[0]?.medications?.[0] || {};
  const original = String(med.sig_raw || med.sig || "").trim();
  const final = String(body.final?.sig || "").trim();
  const result = { found: Boolean(body.found), final_sig: final || null, learned: false, safe: null };
  if (body.found && original && final && original.replace(/\s+/g, " ").toUpperCase() !== final.replace(/\s+/g, " ").toUpperCase()) {
    const headers = sbHeaders(cfg.key);
    const rows = [{
      store_id: storeId, field_path: "medications[0].sig", original_value: original.slice(0, 400), corrected_value: final.slice(0, 400),
      source: "fax_staff", pending_rx_id: null,
      context: { source: "fax_staff", mail_id: mailId, drug_name: med.drug_name || null },
    }];
    if (await insertFeedback(cfg, headers, rows)) {
      for (const m of inferMappings(storeId, rows)) await bumpMapping(cfg, headers, m);
      result.learned = true;
      result.safe = sigFixIsSafe(original, final);
    }
  }
  const upd = await fetch(`${cfg.url}/rest/v1/inbound_faxes?${filter}`, {
    method: "PATCH",
    headers: sbHeaders(cfg.key, { Prefer: "return=minimal" }),
    body: JSON.stringify({ learned_at: new Date().toISOString(), learn_result: result }),
  });
  return send(res, upd.ok ? 200 : 502, { ok: upd.ok, ...result });
}

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const expected = process.env.AGENT_API_KEY;
  if (!expected || expected.length < 16) return send(res, 503, { error: "AGENT_API_KEY not configured" });
  if (!keyMatches(req.headers["x-api-key"], expected)) return send(res, 401, { error: "Unauthorized" });
  if (req.method === "GET") return listPendingLearn(req, res, supabaseConfig());
  if (req.method !== "POST") return send(res, 405, { error: "GET or POST only" });
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return send(res, 400, { error: "Invalid JSON" }); }
  }
  if (body?.type === "fax_result") return handleFaxResult(body, res, supabaseConfig());
  const mailId = Number(body?.mail_id);
  if (!Number.isSafeInteger(mailId) || mailId <= 0) return send(res, 400, { error: "mail_id required" });
  const image = Array.isArray(body.page_images) ? body.page_images.find(Boolean) : null;
  if (!image) return send(res, 400, { error: "page_images[0] required" });
  const storeId = String(body.store_id || "default").slice(0, 64);

  const { result, error } = await readFax(image);
  if (error) return send(res, 200, { ok: false, ocr_error: error });   // 200 so the agent retries a few times, no spool

  const scripts = Array.isArray(result.scripts) ? result.scripts : [];
  const isRx = result.is_prescription === true && scripts.length > 0;
  const cfg = supabaseConfig();
  if (isRx && cfg) applyLearnedSig(scripts[0], await loadSigMappings(cfg, storeId));
  if (!cfg) return send(res, 202, { ok: true, stored: false, doc_type: result.doc_type || "other", is_prescription: isRx });
  const imageUrl = isRx ? await uploadPrivateImage(cfg, `${storeId}/fax-${mailId}.jpg`, image) : null;   // keep images only for prescriptions
  const row = {
    store_id: storeId,
    mail_id: mailId,
    received_label: body.received ? String(body.received).slice(0, 40) : null,
    from_label: body.from ? String(body.from).slice(0, 80) : null,
    doc_type: ["prescription", "refill_request", "transfer", "other"].includes(result.doc_type) ? result.doc_type : "other",
    is_prescription: isRx,
    // The Live page shows no patient names: drop summaries that mention a patient/person title.
    summary: result.summary && !/\b(patient|mr|mrs|ms|miss|dr)\b\.?/i.test(String(result.summary)) ? String(result.summary).slice(0, 160) : null,
    ocr: isRx ? { scripts } : null,
    page_image_url: imageUrl,
  };
  const resp = await fetch(`${cfg.url}/rest/v1/inbound_faxes?on_conflict=store_id,mail_id`, {
    method: "POST",
    headers: sbHeaders(cfg.key, { Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify(row),
  });
  if (!resp.ok) {
    console.error("[agent-fax] supabase", resp.status, (await resp.text()).slice(0, 300));
    return send(res, 502, { error: "Supabase write failed" });
  }
  return send(res, 200, { ok: true, stored: true, mail_id: mailId, doc_type: row.doc_type, is_prescription: isRx, summary: row.summary });
}

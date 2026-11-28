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
{"doc_type":"prescription|refill_request|transfer|other","is_prescription":false,"summary":"max 12 words on what kind of fax this is, never any person names","scripts":[{"patient":{"full_name":"","dob":"YYYY-MM-DD","address":"street, city, postal code as printed","health_card_num":"","confidence":0.0},"prescriber":{"name":"","license_number":"","address":"clinic street, city, postal code from the letterhead","phone":"","fax":"","confidence":0.0},"medications":[{"drug_name":"","din":"","strength":"","quantity":0,"refills":0,"sig":"","is_compound":false,"confidence":0.0}],"overall_confidence":0.0}]}
is_prescription is true only for a new prescription or a refill/renewal authorization for a patient. Advertisements, flyers, reports, cover sheets, lab results and anything without a prescription are doc_type "other" with scripts []. DIN is 8 digits. Empty strings when unreadable. Phone and fax are the prescriber clinic's own numbers from the letterhead or stamp, never the fax machine header line at the very top of the page. If the patient has no date of birth on the fax leave dob empty.`;

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

/** GET ?recent=N&store_id=  -> OCR of the newest N prescription faxes (agent-only: used by `flow.py --match-test`). */
async function listRecentScripts(req, res, cfg) {
  const q = new URL(req.url, "http://x").searchParams;
  const storeId = String(q.get("store_id") || "default").slice(0, 64);
  const n = Math.min(30, Math.max(1, Number(q.get("recent")) || 10));
  if (!cfg) return send(res, 200, { ok: true, items: [] });
  const params = new URLSearchParams({
    store_id: `eq.${storeId}`,
    is_prescription: "eq.true",
    select: "mail_id,ocr",
    order: "mail_id.desc",
    limit: String(n),
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

/**
 * Faxes read before the address / phone fields existed: read ONE of them again from the stored page image, add the
 * missing fields (nothing already read is overwritten) and clear the Kroll lookups so the agent redoes them with the address.
 */
async function rereadOne(cfg, storeId) {
  try {
    const q = new URLSearchParams({
      store_id: `eq.${storeId}`, is_prescription: "eq.true", status: "eq.new", "ocr->scripts->0->patient->>address": "is.null",
      page_image_url: "like.private:*", select: "mail_id,ocr,page_image_url", order: "mail_id.desc", limit: "1",
    });
    const r = await fetch(`${cfg.url}/rest/v1/inbound_faxes?${q}`, { headers: sbHeaders(cfg.key) });
    if (!r.ok) return;
    const row = (await r.json())[0];
    if (!row?.ocr?.scripts?.[0]) return;
    const path = String(row.page_image_url).replace(/^private:/, "");
    const img = await fetch(`${cfg.url}/storage/v1/object/rx-images/${path}`, { headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` } });
    let again = null;
    if (img.ok) {
      const dataUrl = `data:${img.headers.get("content-type") || "image/jpeg"};base64,${Buffer.from(await img.arrayBuffer()).toString("base64")}`;
      const { result, error } = await readFax(dataUrl);
      if (error) return;                       // try again on the next poll
      again = result?.scripts?.[0] || null;
    }
    const sc = row.ocr.scripts[0];
    sc.patient = { ...(sc.patient || {}), address: String(again?.patient?.address || ""), dob: sc.patient?.dob || String(again?.patient?.dob || "") };
    sc.prescriber = { ...(sc.prescriber || {}), address: String(again?.prescriber?.address || ""), phone: String(again?.prescriber?.phone || ""),
      fax: String(again?.prescriber?.fax || ""), license_number: sc.prescriber?.license_number || String(again?.prescriber?.license_number || "") };
    await fetch(`${cfg.url}/rest/v1/inbound_faxes?store_id=eq.${encodeURIComponent(storeId)}&mail_id=eq.${row.mail_id}`, {
      method: "PATCH", headers: sbHeaders(cfg.key, { Prefer: "return=minimal" }),
      body: JSON.stringify({ ocr: row.ocr, kroll_patient: null, kroll_enrich: null }),
    });
  } catch (e) {
    console.warn("[agent-fax] reread failed", String(e?.message || e).slice(0, 120));
  }
}

/** GET ?unresolved=N&store_id= -> new prescription faxes whose Kroll patient was not looked up yet (agent-only). */
async function listUnresolved(req, res, cfg) {
  const q = new URL(req.url, "http://x").searchParams;
  const storeId = String(q.get("store_id") || "default").slice(0, 64);
  const n = Math.min(20, Math.max(1, Number(q.get("unresolved")) || 10));
  if (!cfg) return send(res, 200, { ok: true, items: [] });
  await rereadOne(cfg, storeId);
  const params = new URLSearchParams({
    store_id: `eq.${storeId}`, is_prescription: "eq.true", status: "eq.new", kroll_enrich: "is.null",
    select: "mail_id,ocr", order: "mail_id.desc", limit: String(n),
  });
  const resp = await fetch(`${cfg.url}/rest/v1/inbound_faxes?${params}`, { headers: sbHeaders(cfg.key) });
  return send(res, resp.ok ? 200 : 502, { ok: resp.ok, items: resp.ok ? await resp.json() : [] });
}

/** POST { type:"kroll_patient", store_id, mail_id, kroll_patient:{status,pat_id,first,last,score,n_dob,dob_swapped} } */
async function handleKrollPatient(body, res, cfg) {
  const mailId = Number(body.mail_id);
  if (!Number.isSafeInteger(mailId) || !cfg) return send(res, 400, { error: "mail_id required" });
  const kp = body.kroll_patient || {};
  const clean = {
    status: ["exact", "corrected", "ambiguous", "none"].includes(kp.status) ? kp.status : "none",
    pat_id: Number.isSafeInteger(Number(kp.pat_id)) ? Number(kp.pat_id) : null,
    first: String(kp.first || "").slice(0, 60), last: String(kp.last || "").slice(0, 60),
    dob: /^\d{4}-\d{2}-\d{2}$/.test(String(kp.dob || "")) ? String(kp.dob) : "", matched_by: ["dob", "name", "address", "name+address"].includes(kp.matched_by) ? kp.matched_by : "", score: Number(kp.score) || 0, n_dob: Number(kp.n_dob) || 0, dob_swapped: Boolean(kp.dob_swapped), tie_broken: Boolean(kp.tie_broken),
    candidates: (Array.isArray(kp.candidates) ? kp.candidates : []).slice(0, 3).map((c) => ({ first: String(c.first || "").slice(0, 60), last: String(c.last || "").slice(0, 60), score: Number(c.score) || 0 })),
  };
  const storeId = String(body.store_id || "default").slice(0, 64);
  const upd = await fetch(`${cfg.url}/rest/v1/inbound_faxes?store_id=eq.${encodeURIComponent(storeId)}&mail_id=eq.${mailId}`, {
    method: "PATCH", headers: sbHeaders(cfg.key, { Prefer: "return=minimal" }), body: JSON.stringify({ kroll_patient: clean }),
  });
  return send(res, upd.ok ? 200 : 502, { ok: upd.ok });
}

/** POST { type:"kroll_enrich", store_id, mail_id, kroll_enrich:{doctor,drug,last_rx,fills} } - what Kroll knows about the fax. */
async function handleKrollEnrich(body, res, cfg) {
  const mailId = Number(body.mail_id);
  if (!Number.isSafeInteger(mailId) || !cfg) return send(res, 400, { error: "mail_id required" });
  const e = body.kroll_enrich && typeof body.kroll_enrich === "object" ? body.kroll_enrich : {};
  const str = (v, n = 80) => String(v ?? "").slice(0, n);
  const d = e.doctor || {};
  const cands = (Array.isArray(e.drug?.candidates) ? e.drug.candidates : []).slice(0, 5).map((c) => ({
    din: str(c.din, 12), name: str(c.name, 80), uses: Number(c.uses) || 0, in_history: Boolean(c.in_history),
  }));
  const cleanDrug = (dr) => ({
    candidates: (Array.isArray(dr?.candidates) ? dr.candidates : []).slice(0, 5).map((c) => ({ din: str(c.din, 12), name: str(c.name, 80), uses: Number(c.uses) || 0, in_history: Boolean(c.in_history), exact: c.exact !== false })),
    pick: dr?.pick ? str(dr.pick, 12) : null, reason: str(dr?.reason, 120), replaces: str(dr?.replaces, 12),
  });
  const cleanLast = (l) => (l ? { din: str(l.din, 12), sig: str(l.sig, 300), qty: l.qty ?? null, refills: l.refills ?? null, filled: str(l.filled, 10) } : null);
  const clean = {
    meds: (Array.isArray(e.meds) ? e.meds : []).slice(0, 12).map((m) => ({ drug: cleanDrug(m?.drug), last_rx: cleanLast(m?.last_rx), din_fill: m?.din_fill ? str(m.din_fill, 12) : "" })),
    doctor: { status: ["found", "by_name", "by_address", "several", "none"].includes(d.status) ? d.status : "none", first: str(d.first, 40), last: str(d.last, 40),
              licence: str(d.licence, 20), name_ok: d.name_ok === true ? true : d.name_ok === false ? false : null },
    drug: cleanDrug(e.drug),
    last_rx: e.last_rx ? { din: str(e.last_rx.din, 12), sig: str(e.last_rx.sig, 300), qty: e.last_rx.qty ?? null, refills: e.last_rx.refills ?? null, filled: str(e.last_rx.filled, 10) } : null,
    fills: { ...(e.fills?.licence ? { licence: str(e.fills.licence, 20) } : {}), ...(e.fills?.din ? { din: str(e.fills.din, 12) } : {}), ...(e.fills?.doctor_name ? { doctor_name: str(e.fills.doctor_name, 80) } : {}) },
  };
  const storeId = String(body.store_id || "default").slice(0, 64);
  const upd = await fetch(`${cfg.url}/rest/v1/inbound_faxes?store_id=eq.${encodeURIComponent(storeId)}&mail_id=eq.${mailId}`, {
    method: "PATCH", headers: sbHeaders(cfg.key, { Prefer: "return=minimal" }), body: JSON.stringify({ kroll_enrich: clean }),
  });
  return send(res, upd.ok ? 200 : 502, { ok: upd.ok });
}

/**
 * The agent reports which inbound faxes are still PENDING in Kroll (unread and not deleted for the recipient).
 * Faxes in the list become 'pending'; faxes received since `since_label` (Kroll server time) that are not in it
 * became 'processed'. Display only: the fax status (new / pushed / dismissed) is never touched here.
 */
async function handleKrollPending(body, res, cfg) {
  if (!cfg) return send(res, 503, { error: "Database not configured" });
  const storeId = String(body.store_id || "default").slice(0, 64);
  const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0).slice(0, 2000);
  const since = String(body.since_label || "");
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(since)) return send(res, 400, { error: "since_label required (YYYY-MM-DD HH:MM:SS)" });
  const base = `${cfg.url}/rest/v1/inbound_faxes?store_id=eq.${encodeURIComponent(storeId)}`;
  const hdr = sbHeaders(cfg.key, { Prefer: "return=minimal" });
  const patch = (q, state) => fetch(`${base}&${q}`, { method: "PATCH", headers: hdr, body: JSON.stringify({ kroll_state: state }) });
  const list = ids.join(",");
  const calls = [];
  if (ids.length) calls.push(patch(`mail_id=in.(${list})`, "pending"));
  calls.push(patch(`received_label=lt.${encodeURIComponent(since)}${ids.length ? `&mail_id=not.in.(${list})` : ""}&or=(kroll_state.is.null,kroll_state.eq.pending)`, "processed"));
  calls.push(patch(`received_label=gte.${encodeURIComponent(since)}${ids.length ? `&mail_id=not.in.(${list})` : ""}&or=(kroll_state.is.null,kroll_state.eq.pending)`, "processed"));
  const results = await Promise.all(calls);
  return send(res, results.every((r) => r.ok) ? 200 : 502, { ok: results.every((r) => r.ok), pending: ids.length });
}

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const expected = process.env.AGENT_API_KEY;
  if (!expected || expected.length < 16) return send(res, 503, { error: "AGENT_API_KEY not configured" });
  if (!keyMatches(req.headers["x-api-key"], expected)) return send(res, 401, { error: "Unauthorized" });
  if (req.method === "GET") {
    const q = new URL(req.url, "http://x").searchParams;
    if (q.get("unresolved")) return listUnresolved(req, res, supabaseConfig());
    return q.get("recent") ? listRecentScripts(req, res, supabaseConfig()) : listPendingLearn(req, res, supabaseConfig());
  }
  if (req.method !== "POST") return send(res, 405, { error: "GET or POST only" });
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return send(res, 400, { error: "Invalid JSON" }); }
  }
  if (body?.type === "kroll_enrich") return handleKrollEnrich(body, res, supabaseConfig());
  if (body?.type === "kroll_patient") return handleKrollPatient(body, res, supabaseConfig());
  if (body?.type === "kroll_pending") return handleKrollPending(body, res, supabaseConfig());
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

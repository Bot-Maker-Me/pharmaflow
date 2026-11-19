/**
 * Shared learning rules for /api/learn, /api/extract, /api/sync-queue and /api/agent-rx.
 *
 * Safety model (pharmacy): a single correction must never silently rewrite a clinical value.
 *   AUTO-APPLIED : DIN -> drug name / strength (a DIN identifies the product), and patient /
 *                  prescriber name spellings once confirmed MIN_HITS_REWRITE times.
 *   FLAG ONLY    : drug name, strength, quantity, refills, sig, DIN text. The client shows
 *                  "staff previously changed X to Y" so a human confirms; nothing is rewritten.
 *   NEVER STORED AS A RULE: DOB and health-card numbers (PHI, and one patient's fix is not
 *                  another's). They stay in extraction_feedback only.
 */

export const MIN_HITS_REWRITE = 2;

export const AUTO_REWRITE_PATHS = ["patient.full_name", "prescriber.name", "prescriber.license_number"];
export const FLAG_ONLY_PATHS = ["drug_name", "strength", "sig", "quantity", "refills", "din"];

export function str(v, max = 500) {
  if (v == null) return "";
  return String(v).slice(0, max);
}

export function normText(v) {
  return String(v ?? "").trim().replace(/\s+/g, " ");
}

export function normDin(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length === 8) return digits;
  if (digits.length === 7) return digits.padStart(8, "0");
  return digits.length > 8 ? digits.slice(-8) : digits;
}

/** "medications[0].qty" / ".quantity" -> "quantity"; "patient.full_name" stays. */
export function canonicalPath(path) {
  const p = String(path || "");
  const med = /^medications\[\d+\]\.(\w+)$/.exec(p);
  if (med) return med[1] === "qty" ? "quantity" : med[1];
  return p;
}

export function isAutoRewritePath(path) {
  return AUTO_REWRITE_PATHS.includes(canonicalPath(path));
}

export function isFlagOnlyPath(path) {
  return FLAG_ONLY_PATHS.includes(canonicalPath(path));
}

/**
 * Turn correction rows into reusable mappings.
 * rows: {field_path, original_value, corrected_value, context}
 */
export function inferMappings(storeId, rows) {
  const out = [];
  for (const c of rows) {
    const path = str(c.field_path, 120);
    const original = str(c.original_value, 400);
    const corrected = str(c.corrected_value, 400);
    if (!path || !corrected || original === corrected) continue;
    const ctx = c.context && typeof c.context === "object" ? c.context : {};

    if (path.endsWith(".din") && /^\d{7,8}$/.test(corrected.replace(/\D/g, ""))) {
      const din = normDin(corrected);
      if (ctx.drug_name) {
        out.push({ store_id: storeId, kind: "din_to_drug", source_key: din, target_value: str(ctx.drug_name, 200) });
      }
      if (ctx.strength) {
        out.push({ store_id: storeId, kind: "din_to_strength", source_key: din, target_value: str(ctx.strength, 80) });
      }
    }

    if (original && (isAutoRewritePath(path) || isFlagOnlyPath(path))) {
      out.push({
        store_id: storeId,
        kind: "text_replace",
        source_key: `${path}::${original}`.slice(0, 240),
        target_value: corrected,
      });
    }
  }
  return out;
}

/** Atomic hit-count upsert. Falls back to read-modify-write if the SQL function is not installed. */
export async function bumpMapping(cfg, headers, m) {
  const rpc = await fetch(`${cfg.url}/rest/v1/rpc/bump_learned_mapping`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      p_store_id: m.store_id,
      p_kind: m.kind,
      p_source_key: m.source_key,
      p_target_value: m.target_value,
    }),
  });
  if (rpc.ok) return true;

  // Legacy path (migration 20261119 not applied yet).
  const q = new URLSearchParams({
    store_id: `eq.${m.store_id}`,
    kind: `eq.${m.kind}`,
    source_key: `eq.${m.source_key}`,
    select: "id,hit_count,target_value",
  });
  const get = await fetch(`${cfg.url}/rest/v1/learned_mappings?${q}`, { headers });
  const rows = get.ok ? await get.json() : [];
  if (rows[0]) {
    const same = rows[0].target_value === m.target_value;
    const patch = await fetch(`${cfg.url}/rest/v1/learned_mappings?id=eq.${rows[0].id}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({
        hit_count: same ? (rows[0].hit_count || 1) + 1 : 1,
        target_value: m.target_value,
        last_seen_at: new Date().toISOString(),
      }),
    });
    return patch.ok;
  }
  const ins = await fetch(`${cfg.url}/rest/v1/learned_mappings`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ ...m, hit_count: 1, last_seen_at: new Date().toISOString() }),
  });
  return ins.ok;
}

/** Insert feedback rows; tolerate a database that has not had the new columns added yet. */
export async function insertFeedback(cfg, headers, rows, { upsert = false } = {}) {
  const url = upsert
    ? `${cfg.url}/rest/v1/extraction_feedback?on_conflict=store_id,source,pending_rx_id,field_path`
    : `${cfg.url}/rest/v1/extraction_feedback`;
  const prefer = upsert ? "resolution=merge-duplicates,return=minimal" : "return=minimal";
  let resp = await fetch(url, { method: "POST", headers: { ...headers, Prefer: prefer }, body: JSON.stringify(rows) });
  if (resp.ok) return true;
  if (upsert) return false; // upsert needs the new unique index; do not degrade to duplicates
  const legacy = rows.map(({ source, pending_rx_id, ...rest }) => rest);
  resp = await fetch(`${cfg.url}/rest/v1/extraction_feedback`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify(legacy),
  });
  return resp.ok;
}

/**
 * Compare what the system produced with what staff finally entered in Kroll.
 * queueRow: agent_sync_queue row (planned incl. ocr_merged). actual: Kroll Rx columns.
 * Returns { feedback: [...], matches: {field:boolean} }.
 */
export function diffAgainstKroll(storeId, queueRow, actual) {
  const planned = queueRow?.planned && typeof queueRow.planned === "object" ? queueRow.planned : {};
  const merged = planned.ocr_merged || {};
  const med = (merged.medications && merged.medications[0]) || {};
  const pendingId = Number(queueRow?.pending_rx_id);
  const ctx = {
    ocr_din: str(med.din, 12),
    ocr_drug_name: str(med.drug_name, 120),
    ocr_strength: str(med.strength, 60),
    source: "kroll_staff",
  };
  const pick = (v) => (v == null ? "" : String(v).trim());
  const pairs = [
    ["kroll.pat_id", pick(planned.pat_id), pick(actual.rx_pat_id), "id"],
    ["kroll.doc_id", pick(planned.doc_id), pick(actual.rx_doc_id), "id"],
    ["kroll.drug_id", pick(planned.drug_id), pick(actual.rx_drug_id), "id"],
    ["medications[0].quantity", pick(med.quantity || planned.qty), pick(actual.rx_qty), "num"],
    ["medications[0].refills", pick(med.refills ?? planned.refills), pick(actual.rx_refills), "num"],
    ["medications[0].sig", pick(med.sig || planned.sig || queueRow?.sig_text), pick(actual.rx_sig), "text"],
  ];
  const norm = (v, kind) => {
    if (kind === "num") {
      const n = Number(v);
      return Number.isFinite(n) && v !== "" ? String(n) : v;
    }
    return kind === "text" ? v.toUpperCase().replace(/\s+/g, " ") : v;
  };
  const feedback = [];
  const matches = {};
  for (const [path, original, corrected, kind] of pairs) {
    if (!corrected) continue; // staff left it empty / column not configured: nothing to learn
    const same = norm(original, kind) === norm(corrected, kind);
    matches[path] = same;
    if (!same) {
      feedback.push({
        store_id: storeId,
        source: "kroll_staff",
        pending_rx_id: pendingId,
        script_id: null,
        document_name: null,
        field_path: path,
        original_value: str(original, 400),
        corrected_value: str(corrected, 400),
        context: ctx,
      });
    }
  }
  return { feedback, matches };
}

/**
 * Health Canada Drug Product Database (DPD) live lookup — finds candidate DINs for a drug name + strength.
 *
 * API: https://health-products.canada.ca/api/documentation/dpd-documentation-en.html
 *   drugproduct   ?brandname= | ?din= | ?id=<drug_code>   -> DIN, brand, company
 *   activeingredient ?ingredientname=                      -> drug_code, strength, strength_unit
 *   status        ?id=<drug_code>                          -> MARKETED / CANCELLED ... history
 *   form          ?id=<drug_code>                          -> dosage form
 *
 * Safety model: a DIN is NEVER guessed. `findDinCandidates` returns ranked, MARKETED products;
 * `pickUnique` only returns a DIN when exactly one marketed product matches name + strength (+ form).
 * Anything ambiguous is left for staff to choose.
 */

const DPD_BASE = "https://health-products.canada.ca/api/drug";
const TIMEOUT_MS = 7000;
const MAX_CODES = 24;
const BATCH = 12;

const NOISE = new Set([
  "mg", "mcg", "ug", "g", "ml", "iu", "unit", "units", "oral", "po", "capsule", "capsules", "cap", "caps",
  "tablet", "tablets", "tab", "tabs", "hcl", "hydrochloride", "sodium", "potassium", "calcium", "sulfate",
  "sulphate", "maleate", "tartrate", "besylate", "succinate", "er", "xr", "sr", "cr", "dr", "la", "and",
  "solution", "suspension", "cream", "ointment", "injection", "inh", "inhaler", "patch", "drops", "the", "of",
]);

const FORM_WORDS = [
  ["capsule", /\bcap(sule)?s?\b/i],
  ["tablet", /\btab(let)?s?\b/i],
  ["solution", /\bsolution\b|\bsyrup\b|\bliquid\b/i],
  ["suspension", /\bsuspension\b/i],
  ["cream", /\bcream\b/i],
  ["ointment", /\bointment\b/i],
  ["patch", /\bpatch\b/i],
  ["inhal", /\binhal|\bpuffer\b|\bmdi\b/i],
];

export function parseStrength(text) {
  const m = /(\d+(?:[.,]\d+)?)\s*(mg|mcg|µg|ug|g|iu|unit|units|ml|%)(?:\s*\/\s*(\d+(?:[.,]\d+)?)?\s*(ml|g|actuation|dose)?)?/i.exec(
    String(text || ""),
  );
  if (!m) return null;
  const unit = m[2].toLowerCase().replace("µg", "mcg").replace("ug", "mcg");
  return { value: Number(m[1].replace(",", ".")), unit };
}

function sameStrength(want, aiStrength, aiUnit) {
  if (!want) return true;
  const value = Number(String(aiStrength || "").replace(",", "."));
  const unit = String(aiUnit || "").toLowerCase().replace("µg", "mcg").replace("ug", "mcg");
  if (!Number.isFinite(value)) return false;
  return Math.abs(value - want.value) < 1e-9 && unit.startsWith(want.unit);
}

export function searchTerm(drugName) {
  const tokens = String(drugName || "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/\d+(?:[.,]\d+)?\s*(mg|mcg|ug|g|ml|iu|%)?/g, " ")
    .split(/[^a-z\-]+/)
    .filter((t) => t.length > 2 && !NOISE.has(t));
  return tokens[0] || "";
}

export function wantedForm(drugName) {
  for (const [name, re] of FORM_WORDS) if (re.test(String(drugName || ""))) return name;
  return "";
}

async function dpd(fetchImpl, endpoint, params) {
  const url = `${DPD_BASE}/${endpoint}/?${new URLSearchParams({ lang: "en", type: "json", ...params })}`;
  try {
    const resp = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data) ? data : data && typeof data === "object" ? [data] : [];
  } catch {
    return [];
  }
}

async function inBatches(items, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += BATCH) {
    out.push(...(await Promise.all(items.slice(i, i + BATCH).map(fn))));
  }
  return out;
}

function latestIsMarketed(statusRows) {
  if (!statusRows.length) return false;
  const sorted = [...statusRows].sort((a, b) =>
    String(b.history_date || b.original_market_date || "").localeCompare(String(a.history_date || a.original_market_date || "")),
  );
  return /MARKETED/i.test(String(sorted[0].status || "")) && !/CANCEL|DORMANT/i.test(String(sorted[0].status || ""));
}

/**
 * @param {{drug_name: string, strength?: string}} query
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{term: string, candidates: Array<{din: string, brand: string, company: string, strength: string, form: string}>}>}
 */
export async function findDinCandidates(query, fetchImpl = fetch) {
  const drugName = String(query?.drug_name || "").trim();
  const term = searchTerm(drugName);
  if (!term) return { term, candidates: [] };
  const want = parseStrength(query?.strength) || parseStrength(drugName);
  const form = wantedForm(drugName);

  // Brand-style names (Apo-Amoxi, Lipitor) match drugproduct directly; generic names match active ingredients.
  const [brandRows, ingredientRows] = await Promise.all([
    dpd(fetchImpl, "drugproduct", { brandname: term, status: "2" }),
    dpd(fetchImpl, "activeingredient", { ingredientname: term }),
  ]);

  const codes = new Map(); // drug_code -> strength text
  for (const ai of ingredientRows) {
    if (!sameStrength(want, ai.strength, ai.strength_unit)) continue;
    if (!codes.has(ai.drug_code)) codes.set(ai.drug_code, `${ai.strength} ${ai.strength_unit}`.trim());
  }
  const fromIngredient = [...codes.keys()].slice(0, MAX_CODES);

  const products = new Map(); // drug_code -> {din, brand, company, strength}
  for (const p of brandRows) {
    if (p.drug_code && p.drug_identification_number) {
      products.set(p.drug_code, {
        din: String(p.drug_identification_number).padStart(8, "0"),
        brand: p.brand_name || "",
        company: p.company_name || "",
        strength: codes.get(p.drug_code) || "",
        marketed: true,
      });
    }
  }

  await inBatches(fromIngredient, async (code) => {
    if (products.has(code)) return;
    const [prod, status] = await Promise.all([
      dpd(fetchImpl, "drugproduct", { id: String(code) }),
      dpd(fetchImpl, "status", { id: String(code) }),
    ]);
    const p = prod[0];
    if (!p?.drug_identification_number || !latestIsMarketed(status)) return;
    products.set(code, {
      din: String(p.drug_identification_number).padStart(8, "0"),
      brand: p.brand_name || "",
      company: p.company_name || "",
      strength: codes.get(code) || "",
      marketed: true,
    });
  });

  // Brand hits skip the strength filter above: resolve their strength and drop mismatches.
  const need = [...products.entries()].filter(([, v]) => !v.strength);
  await inBatches(need, async ([code, v]) => {
    const ai = await dpd(fetchImpl, "activeingredient", { id: String(code) });
    if (ai.length === 1) v.strength = `${ai[0].strength} ${ai[0].strength_unit}`.trim();
    v.ok = ai.length ? ai.length > 1 || sameStrength(want, ai[0].strength, ai[0].strength_unit) : true;
  });

  let list = [...products.entries()].filter(([, v]) => v.ok !== false);

  // Dosage form (capsule vs tablet ...) when the fax says one.
  await inBatches(list, async ([code, v]) => {
    const f = await dpd(fetchImpl, "form", { id: String(code) });
    v.form = f.map((x) => x.pharmaceutical_form_name).filter(Boolean).join(", ");
  });
  if (form) {
    const filtered = list.filter(([, v]) => !v.form || v.form.toLowerCase().includes(form));
    if (filtered.length) list = filtered;
  }

  const seen = new Set();
  const candidates = list
    .map(([, v]) => ({ din: v.din, brand: v.brand, company: v.company, strength: v.strength, form: v.form || "" }))
    .filter((c) => (seen.has(c.din) ? false : seen.add(c.din)))
    .sort((a, b) => a.brand.localeCompare(b.brand))
    .slice(0, 12);
  return { term, candidates };
}

/** The only case where a DIN may be filled automatically: exactly one marketed match. */
export function pickUnique(candidates) {
  return Array.isArray(candidates) && candidates.length === 1 ? candidates[0] : null;
}

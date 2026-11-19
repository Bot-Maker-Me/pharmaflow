import type { Medication, Script, Settings } from "@/lib/types";

/** Snapshot of AI/manual values at the moment the script entered the queue. */
export type ExtractionSnapshot = {
  patient: { full_name: string; dob: string; health_card_num: string };
  prescriber: { name: string; license_number: string };
  medications: Array<{
    drug_name: string;
    din: string;
    strength: string;
    quantity: number;
    refills: number;
    sig: string;
  }>;
};

export type FieldCorrection = {
  field_path: string;
  original_value: string;
  corrected_value: string;
  context?: Record<string, string>;
};

export type LearnedMapping = {
  kind: string;
  source_key: string;
  target_value: string;
  hit_count?: number;
};

const LOCAL_KEY = "pharmflow.learned.v1";

/**
 * Safety model (pharmacy) — keep in sync with server/learning.js:
 *  - AUTO-APPLIED: DIN -> drug name / strength (a DIN identifies the product), and patient /
 *    prescriber name spellings once confirmed MIN_HITS_REWRITE times.
 *  - FLAG ONLY: drug name, strength, quantity, refills, sig, DIN text. A single correction never
 *    silently rewrites a clinical value; the technician sees "staff changed this before".
 */
const MIN_HITS_REWRITE = 2;
const AUTO_REWRITE_PATHS = ["patient.full_name", "prescriber.name", "prescriber.license_number"];
const FLAG_ONLY_FIELDS = ["drug_name", "strength", "sig", "quantity", "refills", "din"] as const;
type FlagField = (typeof FLAG_ONLY_FIELDS)[number];

function canonicalPath(path: string): string {
  const m = /^medications\[\d+\]\.(\w+)$/.exec(path);
  if (m) return m[1] === "qty" ? "quantity" : m[1];
  return path;
}

const FIELD_LABEL: Record<FlagField, string> = {
  drug_name: "drug name",
  strength: "strength",
  sig: "directions (sig)",
  quantity: "quantity",
  refills: "refills",
  din: "DIN",
};

export function snapshotFromScript(script: Script): ExtractionSnapshot {
  return {
    patient: {
      full_name: script.patient.full_name,
      dob: script.patient.dob,
      health_card_num: script.patient.health_card_num,
    },
    prescriber: {
      name: script.prescriber.name,
      license_number: script.prescriber.license_number,
    },
    medications: script.medications.map((m) => ({
      drug_name: m.drug_name,
      din: m.din,
      strength: m.strength,
      quantity: m.quantity,
      refills: m.refills,
      sig: m.sig,
    })),
  };
}

export function diffScriptAgainstSnapshot(script: Script, snap?: ExtractionSnapshot | null): FieldCorrection[] {
  if (!snap) return [];
  const out: FieldCorrection[] = [];
  const push = (path: string, original: string, corrected: string, context?: Record<string, string>) => {
    if (String(original ?? "") === String(corrected ?? "")) return;
    out.push({ field_path: path, original_value: String(original ?? ""), corrected_value: String(corrected ?? ""), context });
  };

  push("patient.full_name", snap.patient.full_name, script.patient.full_name);
  push("patient.dob", snap.patient.dob, script.patient.dob);
  push("patient.health_card_num", snap.patient.health_card_num, script.patient.health_card_num, {
    patient_name: script.patient.full_name,
  });
  push("prescriber.name", snap.prescriber.name, script.prescriber.name);
  push("prescriber.license_number", snap.prescriber.license_number, script.prescriber.license_number);

  const n = Math.max(snap.medications.length, script.medications.length);
  for (let i = 0; i < n; i += 1) {
    const o = snap.medications[i];
    const c = script.medications[i];
    if (!o || !c) continue;
    const ctx = { drug_name: c.drug_name, strength: c.strength, din: c.din };
    push(`medications[${i}].drug_name`, o.drug_name, c.drug_name, ctx);
    push(`medications[${i}].din`, o.din, c.din, ctx);
    push(`medications[${i}].strength`, o.strength, c.strength, ctx);
    push(`medications[${i}].quantity`, String(o.quantity), String(c.quantity), ctx);
    push(`medications[${i}].refills`, String(o.refills), String(c.refills), ctx);
    push(`medications[${i}].sig`, o.sig, c.sig, ctx);
  }
  return out;
}

function loadLocalMappings(): LearnedMapping[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LearnedMapping[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalMappings(mappings: LearnedMapping[]) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(mappings.slice(0, 200)));
  } catch {
    /* ignore */
  }
}

function normText(v: string): string {
  return String(v ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

/** Merge server mappings into local cache (by kind+source_key). */
export function mergeLearnedMappings(incoming: LearnedMapping[]) {
  const map = new Map<string, LearnedMapping>();
  for (const m of [...loadLocalMappings(), ...incoming]) {
    if (!m?.kind || !m?.source_key || !m?.target_value) continue;
    const key = `${m.kind}::${m.source_key}`;
    const prev = map.get(key);
    if (!prev || (m.hit_count || 0) >= (prev.hit_count || 0)) map.set(key, m);
  }
  const list = Array.from(map.values());
  saveLocalMappings(list);
  return list;
}

export function getLearnedMappings(): LearnedMapping[] {
  return loadLocalMappings();
}

/**
 * Auto-apply identity-safe learned mappings to a medication: DIN -> drug name / strength.
 * Fills an empty field right away; overwrites an existing value only once the mapping has been
 * confirmed MIN_HITS_REWRITE times. Everything else is surfaced as a flag (learnedFlags).
 */
export function applyLearnedToMedication(med: Medication, mappings?: LearnedMapping[]): Medication {
  const list = mappings ?? loadLocalMappings();
  const din = (med.din || "").replace(/\D/g, "");
  const key8 = din.length === 7 ? din.padStart(8, "0") : din.length >= 8 ? din.slice(-8) : "";
  if (!key8) return med;
  const next = { ...med };

  for (const m of list) {
    if (m.source_key !== key8) continue;
    const hits = m.hit_count ?? 1;
    if (m.kind === "din_to_drug" && (!next.drug_name.trim() || hits >= MIN_HITS_REWRITE)) {
      next.drug_name = m.target_value;
    }
    if (m.kind === "din_to_strength" && (!next.strength.trim() || hits >= MIN_HITS_REWRITE)) {
      next.strength = m.target_value;
    }
  }
  return next;
}

/** "Staff changed this before" warnings for values the model just repeated. Never rewrites anything. */
export function learnedFlags(script: Script, mappings?: LearnedMapping[]): string[] {
  const list = mappings ?? loadLocalMappings();
  const flags = new Set<string>();
  for (const m of list) {
    if (m.kind !== "text_replace") continue;
    const sep = m.source_key.indexOf("::");
    if (sep < 0) continue;
    const field = canonicalPath(m.source_key.slice(0, sep));
    if (!(FLAG_ONLY_FIELDS as readonly string[]).includes(field)) continue;
    const original = normText(m.source_key.slice(sep + 2));
    if (!original) continue;
    for (const med of script.medications) {
      const current = normText(String((med as unknown as Record<string, unknown>)[field === "quantity" ? "quantity" : field] ?? ""));
      if (current === original && normText(m.target_value) !== current) {
        flags.add(
          `Staff previously changed ${FIELD_LABEL[field as FlagField]} "${original}" to "${m.target_value}" for a similar scan. Check the fax and confirm which is correct.`,
        );
      }
    }
  }
  return Array.from(flags);
}

/** Apply learned mappings to a full script after extraction. */
export function applyLearnedToScript(script: Script, mappings?: LearnedMapping[]): Script {
  const list = mappings ?? loadLocalMappings();
  const patient = { ...script.patient };
  const prescriber = { ...script.prescriber };

  for (const m of list) {
    if (m.kind !== "text_replace" || (m.hit_count ?? 1) < MIN_HITS_REWRITE) continue;
    const sep = m.source_key.indexOf("::");
    if (sep < 0) continue;
    const path = m.source_key.slice(0, sep);
    if (!AUTO_REWRITE_PATHS.includes(path)) continue;
    const original = normText(m.source_key.slice(sep + 2));
    if (!original) continue;

    if (path === "patient.full_name" && normText(patient.full_name) === original) patient.full_name = m.target_value;
    else if (path === "prescriber.name" && normText(prescriber.name) === original) prescriber.name = m.target_value;
    else if (path === "prescriber.license_number" && normText(prescriber.license_number) === original) {
      prescriber.license_number = m.target_value;
    }
  }

  const medications = script.medications.map((med) => applyLearnedToMedication(med, list));
  const next: Script = {
    ...script,
    patient,
    prescriber,
    medications,
    dinVerifiedCount: medications.filter((med) => med.din_status === "verified").length,
  };
  next.flags = Array.from(new Set([...(script.flags ?? []), ...learnedFlags(next, list)]));
  return next;
}

/** Local mapping equivalents of what the server infers (same safety rules). */
function localMappingsFromCorrections(corrections: FieldCorrection[]): LearnedMapping[] {
  const out: LearnedMapping[] = [];
  for (const c of corrections) {
    if (c.field_path.endsWith(".din") && c.context?.drug_name) {
      const din = c.corrected_value.replace(/\D/g, "").slice(-8);
      if (din) out.push({ kind: "din_to_drug", source_key: din, target_value: c.context.drug_name, hit_count: 1 });
      if (din && c.context.strength) {
        out.push({ kind: "din_to_strength", source_key: din, target_value: c.context.strength, hit_count: 1 });
      }
    }
    const canon = canonicalPath(c.field_path);
    const learnable = AUTO_REWRITE_PATHS.includes(canon) || (FLAG_ONLY_FIELDS as readonly string[]).includes(canon);
    if (learnable && c.original_value && c.corrected_value && c.original_value !== c.corrected_value) {
      out.push({
        kind: "text_replace",
        source_key: `${c.field_path}::${c.original_value}`.slice(0, 240),
        target_value: c.corrected_value,
        hit_count: 1,
      });
    }
  }
  return out;
}

export async function submitCorrections(
  settings: Settings,
  payload: {
    store_id?: string;
    script_id: string;
    document_name: string;
    corrections: FieldCorrection[];
  },
): Promise<{ ok: boolean; saved?: number }> {
  if (!payload.corrections.length) return { ok: true, saved: 0 };
  const base = (settings.apiBaseUrl || "").replace(/\/$/, "");
  const endpoint = `${base}/api/learn`;
  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(settings.apiToken ? { "x-access-token": settings.apiToken } : {}),
      },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) return { ok: false };
    const data = (await resp.json()) as { saved?: number };

    mergeLearnedMappings(localMappingsFromCorrections(payload.corrections));
    return { ok: true, saved: data.saved ?? payload.corrections.length };
  } catch {
    mergeLearnedMappings(localMappingsFromCorrections(payload.corrections));
    return { ok: true, saved: payload.corrections.length };
  }
}

export async function refreshLearnedMappings(settings: Settings, storeId = "default") {
  const base = (settings.apiBaseUrl || "").replace(/\/$/, "");
  try {
    const resp = await fetch(`${base}/api/learn?store_id=${encodeURIComponent(storeId)}&limit=120`, {
      headers: {
        ...(settings.apiToken ? { "x-access-token": settings.apiToken } : {}),
      },
    });
    if (!resp.ok) return loadLocalMappings();
    const data = (await resp.json()) as { mappings?: LearnedMapping[] };
    return mergeLearnedMappings(data.mappings ?? []);
  } catch {
    return loadLocalMappings();
  }
}

/** Compact, non-PHI hint lines for the vision model (drug identity only, never names/DOB/cards). */
export function fewShotHintsFromMappings(limit = 12): string[] {
  const out: string[] = [];
  for (const m of loadLocalMappings()) {
    if (out.length >= limit) break;
    if (m.kind === "din_to_drug") {
      out.push(`DIN ${m.source_key} is "${m.target_value}"`);
    } else if (m.kind === "text_replace") {
      const [path, original] = m.source_key.split("::");
      if (canonicalPath(path ?? "") === "drug_name" && original) {
        out.push(`Staff corrected drug name "${original}" to "${m.target_value}"`);
      }
    }
  }
  return out;
}

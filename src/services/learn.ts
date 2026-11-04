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

/** Apply learned DIN → drug / strength when fields are still empty. */
export function applyLearnedToMedication(med: Medication): Medication {
  const mappings = loadLocalMappings();
  const din = (med.din || "").replace(/\D/g, "");
  if (din.length < 7) return med;
  const key = din.length === 7 ? din.padStart(8, "0") : din.slice(-8);
  let next = { ...med };
  for (const m of mappings) {
    if (m.source_key !== key && m.source_key !== din) continue;
    if (m.kind === "din_to_drug" && !next.drug_name.trim()) next.drug_name = m.target_value;
    if (m.kind === "din_to_strength" && !next.strength.trim()) next.strength = m.target_value;
  }
  for (const m of mappings) {
    if (m.kind !== "text_replace") continue;
    const [path, original] = m.source_key.split("::");
    if (!path || original == null) continue;
    if (path.includes("drug_name") && next.drug_name === original) next.drug_name = m.target_value;
    if (path.includes(".sig") && next.sig === original) next.sig = m.target_value;
    if (path.includes("strength") && next.strength === original) next.strength = m.target_value;
  }
  return next;
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

    // Also stash locally so next session benefits even before GET
    const localAdds: LearnedMapping[] = [];
    for (const c of payload.corrections) {
      if (c.field_path.endsWith(".din") && c.context?.drug_name) {
        const din = c.corrected_value.replace(/\D/g, "").slice(-8);
        if (din) localAdds.push({ kind: "din_to_drug", source_key: din, target_value: c.context.drug_name, hit_count: 1 });
      }
      if (c.field_path.endsWith(".din") && c.context?.strength) {
        const din = c.corrected_value.replace(/\D/g, "").slice(-8);
        if (din) localAdds.push({ kind: "din_to_strength", source_key: din, target_value: c.context.strength, hit_count: 1 });
      }
      if (c.original_value && c.corrected_value && c.original_value !== c.corrected_value) {
        localAdds.push({
          kind: "text_replace",
          source_key: `${c.field_path}::${c.original_value}`.slice(0, 240),
          target_value: c.corrected_value,
          hit_count: 1,
        });
      }
    }
    mergeLearnedMappings(localAdds);
    return { ok: true, saved: data.saved ?? payload.corrections.length };
  } catch {
    mergeLearnedMappings(
      payload.corrections.map((c) => ({
        kind: "text_replace",
        source_key: `${c.field_path}::${c.original_value}`.slice(0, 240),
        target_value: c.corrected_value,
        hit_count: 1,
      })),
    );
    return { ok: true, saved: payload.corrections.length };
  }
}

export async function refreshLearnedMappings(settings: Settings, storeId = "default") {
  const base = (settings.apiBaseUrl || "").replace(/\/$/, "");
  try {
    const resp = await fetch(`${base}/api/learn?store_id=${encodeURIComponent(storeId)}&limit=100`, {
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

/** Compact few-shot lines for the vision system (no full PHI dumps). */
export function fewShotHintsFromMappings(limit = 12): string[] {
  return loadLocalMappings()
    .filter((m) => m.kind === "text_replace" || m.kind === "din_to_drug")
    .slice(0, limit)
    .map((m) => {
      if (m.kind === "din_to_drug") return `DIN ${m.source_key} → drug "${m.target_value}"`;
      const parts = m.source_key.split("::");
      return `When ${parts[0]} was "${parts[1] ?? ""}" staff corrected to "${m.target_value}"`;
    });
}

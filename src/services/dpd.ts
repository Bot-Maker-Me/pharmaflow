import type { DinStatus } from "@/lib/types";

/**
 * Health Canada Drug Product Database (DPD) cross-reference.
 *
 * Offline subset powers verification without network. Unknown-but-well-formed
 * DINs stay "unverified". When a DIN matches, brand + strength can auto-fill
 * empty medication fields so technicians are not typing twice.
 */

export interface DpdRecord {
  din: string;
  brand_name: string;
  ingredient: string;
  strength: string;
  dosage_form: string;
  therapeutic_class: string;
  schedule: string;
}

/** Compute the DIN check digit from the first seven digits. */
export function checkDigit(base: string): number {
  const digits = base.replace(/\D/g, "").slice(0, 7).split("").map(Number);
  while (digits.length < 7) digits.unshift(0);
  const weights = [2, 1, 2, 1, 2, 1, 2];
  const total = digits.reduce((sum, digit, index) => {
    const product = digit * weights[index];
    return sum + (product > 9 ? product - 9 : product);
  }, 0);
  return (10 - (total % 10)) % 10;
}

/** Build a checksum-valid 8-digit DIN from a 7-digit base. */
export function dinFromBase(base: string): string {
  const normalised = base.replace(/\D/g, "").padStart(7, "0").slice(0, 7);
  return `${normalised}${checkDigit(normalised)}`;
}

/** Normalise user/OCR input to an 8-digit string when possible. */
export function normaliseDin(raw: string): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length === 8) return digits;
  if (digits.length === 7) return dinFromBase(digits);
  if (digits.length > 8) return digits.slice(-8);
  return digits;
}

export function isValidDinFormat(din: string): boolean {
  const digits = normaliseDin(din);
  if (digits.length !== 8) return false;
  return checkDigit(digits.slice(0, 7)) === Number(digits[7]);
}

interface SeedRecord extends Omit<DpdRecord, "din"> {
  base: string;
}

const SEED: SeedRecord[] = [
  { base: "0062811", brand_name: "Apo-Amoxi", ingredient: "Amoxicillin", strength: "500 mg", dosage_form: "Capsule", therapeutic_class: "Penicillin antibiotic", schedule: "Prescription" },
  { base: "0224769", brand_name: "Lipitor", ingredient: "Atorvastatin Calcium", strength: "20 mg", dosage_form: "Tablet", therapeutic_class: "HMG-CoA reductase inhibitor", schedule: "Prescription" },
  { base: "0022651", brand_name: "Apo-Metformin", ingredient: "Metformin Hydrochloride", strength: "500 mg", dosage_form: "Tablet", therapeutic_class: "Biguanide antidiabetic", schedule: "Prescription" },
  { base: "0219593", brand_name: "Ventolin HFA", ingredient: "Salbutamol Sulphate", strength: "100 mcg/actuation", dosage_form: "Pressurised inhalation", therapeutic_class: "Short-acting beta2 agonist", schedule: "Prescription" },
  { base: "0251650", brand_name: "Pantoloc", ingredient: "Pantoprazole Sodium", strength: "40 mg", dosage_form: "Tablet (delayed release)", therapeutic_class: "Proton pump inhibitor", schedule: "Prescription" },
  { base: "0088639", brand_name: "Norvasc", ingredient: "Amlodipine Besylate", strength: "5 mg", dosage_form: "Tablet", therapeutic_class: "Calcium channel blocker", schedule: "Prescription" },
  { base: "0236263", brand_name: "Altace", ingredient: "Ramipril", strength: "5 mg", dosage_form: "Capsule", therapeutic_class: "ACE inhibitor", schedule: "Prescription" },
  { base: "0074055", brand_name: "Synthroid", ingredient: "Levothyroxine Sodium", strength: "50 mcg", dosage_form: "Tablet", therapeutic_class: "Thyroid hormone", schedule: "Prescription" },
  { base: "0205180", brand_name: "Cipro", ingredient: "Ciprofloxacin Hydrochloride", strength: "500 mg", dosage_form: "Tablet", therapeutic_class: "Fluoroquinolone antibiotic", schedule: "Prescription" },
  { base: "0230457", brand_name: "Zithromax", ingredient: "Azithromycin Dihydrate", strength: "250 mg", dosage_form: "Tablet", therapeutic_class: "Macrolide antibiotic", schedule: "Prescription" },
  { base: "0224290", brand_name: "Crestor", ingredient: "Rosuvastatin Calcium", strength: "10 mg", dosage_form: "Tablet", therapeutic_class: "HMG-CoA reductase inhibitor", schedule: "Prescription" },
  { base: "0223105", brand_name: "Plavix", ingredient: "Clopidogrel Bisulfate", strength: "75 mg", dosage_form: "Tablet", therapeutic_class: "Antiplatelet", schedule: "Prescription" },
  { base: "0224553", brand_name: "Nexium", ingredient: "Esomeprazole Magnesium", strength: "40 mg", dosage_form: "Tablet (delayed release)", therapeutic_class: "Proton pump inhibitor", schedule: "Prescription" },
  { base: "0224055", brand_name: "Advair Diskus", ingredient: "Fluticasone / Salmeterol", strength: "250/50 mcg", dosage_form: "Inhalation powder", therapeutic_class: "ICS / LABA", schedule: "Prescription" },
  { base: "0224429", brand_name: "Spiriva", ingredient: "Tiotropium Bromide", strength: "18 mcg", dosage_form: "Inhalation powder", therapeutic_class: "Anticholinergic", schedule: "Prescription" },
  { base: "0000212", brand_name: "Tylenol with Codeine No. 3", ingredient: "Acetaminophen / Codeine", strength: "300 mg / 30 mg", dosage_form: "Tablet", therapeutic_class: "Analgesic", schedule: "Prescription" },
  { base: "0059038", brand_name: "Apo-Prednisone", ingredient: "Prednisone", strength: "5 mg", dosage_form: "Tablet", therapeutic_class: "Corticosteroid", schedule: "Prescription" },
  { base: "0214680", brand_name: "Apo-Furosemide", ingredient: "Furosemide", strength: "40 mg", dosage_form: "Tablet", therapeutic_class: "Loop diuretic", schedule: "Prescription" },
  { base: "0223115", brand_name: "Coversyl", ingredient: "Perindopril Erbumine", strength: "4 mg", dosage_form: "Tablet", therapeutic_class: "ACE inhibitor", schedule: "Prescription" },
  { base: "0224681", brand_name: "Actonel", ingredient: "Risedronate Sodium", strength: "35 mg", dosage_form: "Tablet", therapeutic_class: "Bisphosphonate", schedule: "Prescription" },
  { base: "0223965", brand_name: "Aricept", ingredient: "Donepezil Hydrochloride", strength: "10 mg", dosage_form: "Tablet", therapeutic_class: "Cholinesterase inhibitor", schedule: "Prescription" },
  { base: "0224299", brand_name: "Singulair", ingredient: "Montelukast Sodium", strength: "10 mg", dosage_form: "Tablet", therapeutic_class: "Leukotriene receptor antagonist", schedule: "Prescription" },
  { base: "0224050", brand_name: "Celebrex", ingredient: "Celecoxib", strength: "200 mg", dosage_form: "Capsule", therapeutic_class: "COX-2 inhibitor", schedule: "Prescription" },
  { base: "0223110", brand_name: "Effexor XR", ingredient: "Venlafaxine Hydrochloride", strength: "75 mg", dosage_form: "Capsule (extended release)", therapeutic_class: "SNRI antidepressant", schedule: "Prescription" },
  { base: "0224295", brand_name: "Wellbutrin XL", ingredient: "Bupropion Hydrochloride", strength: "150 mg", dosage_form: "Tablet (extended release)", therapeutic_class: "Antidepressant", schedule: "Prescription" },
  { base: "0223100", brand_name: "Pariet", ingredient: "Rabeprazole Sodium", strength: "20 mg", dosage_form: "Tablet (delayed release)", therapeutic_class: "Proton pump inhibitor", schedule: "Prescription" },
  { base: "0082450", brand_name: "Apo-Atenolol", ingredient: "Atenolol", strength: "50 mg", dosage_form: "Tablet", therapeutic_class: "Beta blocker", schedule: "Prescription" },
  { base: "0058146", brand_name: "Apo-Hydro", ingredient: "Hydrochlorothiazide", strength: "25 mg", dosage_form: "Tablet", therapeutic_class: "Thiazide diuretic", schedule: "Prescription" },
  { base: "0223112", brand_name: "Flovent HFA", ingredient: "Fluticasone Propionate", strength: "125 mcg", dosage_form: "Pressurised inhalation", therapeutic_class: "Inhaled corticosteroid", schedule: "Prescription" },
  { base: "0224550", brand_name: "Symbicort", ingredient: "Budesonide / Formoterol", strength: "200/6 mcg", dosage_form: "Inhalation powder", therapeutic_class: "ICS / LABA", schedule: "Prescription" },
];

const DPD: Record<string, DpdRecord> = SEED.reduce<Record<string, DpdRecord>>((acc, seed) => {
  const din = dinFromBase(seed.base);
  acc[din] = {
    din,
    brand_name: seed.brand_name,
    ingredient: seed.ingredient,
    strength: seed.strength,
    dosage_form: seed.dosage_form,
    therapeutic_class: seed.therapeutic_class,
    schedule: seed.schedule,
  };
  return acc;
}, {});

export function lookupDin(din: string): DpdRecord | null {
  const digits = normaliseDin(din);
  return DPD[digits] ?? null;
}

/** Resolve the verification status of a DIN as shown in the UI. */
export function resolveDinStatus(
  din: string,
  isCompound: boolean,
): { status: DinStatus; product?: string; record?: DpdRecord } {
  if (isCompound) return { status: "compound" };
  const digits = normaliseDin(din);
  if (!digits) return { status: "unverified" };
  if (!isValidDinFormat(digits)) return { status: "invalid" };
  const record = lookupDin(digits);
  if (!record) return { status: "unverified" };
  return {
    status: "verified",
    product: `${record.brand_name} — ${record.ingredient} ${record.strength} ${record.dosage_form}`,
    record,
  };
}

/**
 * When a DIN verifies against DPD, fill empty drug_name / strength so the
 * technician does not re-type what Health Canada already knows.
 * Never overwrites a non-empty technician or AI value.
 */
export function enrichMedicationFromDin<T extends { din: string; drug_name: string; strength: string; is_compound: boolean }>(
  med: T,
): T & { din_status: DinStatus; din_product?: string } {
  const resolved = resolveDinStatus(med.din, med.is_compound);
  const next = { ...med, din_status: resolved.status, din_product: resolved.product };
  if (resolved.record) {
    if (!String(next.drug_name || "").trim()) {
      next.drug_name = `${resolved.record.brand_name} ${resolved.record.strength}`.trim();
    }
    if (!String(next.strength || "").trim()) {
      next.strength = resolved.record.strength;
    }
    next.din = resolved.record.din;
  } else if (isValidDinFormat(med.din)) {
    next.din = normaliseDin(med.din);
  }
  return next;
}

export const DIN_STATUS_META: Record<DinStatus, { label: string; chip: string }> = {
  verified: {
    label: "DPD verified",
    chip: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  },
  unverified: {
    label: "DIN unverified",
    chip: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  },
  invalid: {
    label: "Invalid DIN",
    chip: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
  },
  compound: {
    label: "Compound",
    chip: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300",
  },
};

import type { DinStatus } from "@/lib/types";

/**
 * Health Canada Drug Product Database (DPD) cross-reference.
 *
 * The real integration point is `GET {apiBaseUrl}/api/dpd/{din}`, which proxies
 * the DPD "drug product" extract. This module ships a deterministic offline
 * subset so the verification workflow is fully functional without network
 * access; unknown-but-well-formed DINs are surfaced as "unverified" exactly as
 * the live service would report them.
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

export function isValidDinFormat(din: string): boolean {
  const digits = din.replace(/\D/g, "");
  if (digits.length !== 8) return false;
  return checkDigit(digits.slice(0, 7)) === Number(digits[7]);
}

interface SeedRecord extends Omit<DpdRecord, "din"> {
  base: string;
}

const SEED: SeedRecord[] = [
  {
    base: "0062811",
    brand_name: "Apo-Amoxi",
    ingredient: "Amoxicillin",
    strength: "500 mg",
    dosage_form: "Capsule",
    therapeutic_class: "Penicillin antibiotic",
    schedule: "Prescription",
  },
  {
    base: "0224769",
    brand_name: "Lipitor",
    ingredient: "Atorvastatin Calcium",
    strength: "20 mg",
    dosage_form: "Tablet",
    therapeutic_class: "HMG-CoA reductase inhibitor",
    schedule: "Prescription",
  },
  {
    base: "0022651",
    brand_name: "Apo-Metformin",
    ingredient: "Metformin Hydrochloride",
    strength: "500 mg",
    dosage_form: "Tablet",
    therapeutic_class: "Biguanide antidiabetic",
    schedule: "Prescription",
  },
  {
    base: "0219593",
    brand_name: "Ventolin HFA",
    ingredient: "Salbutamol Sulphate",
    strength: "100 mcg/actuation",
    dosage_form: "Pressurised inhalation",
    therapeutic_class: "Short-acting beta2 agonist",
    schedule: "Prescription",
  },
  {
    base: "0251650",
    brand_name: "Pantoloc",
    ingredient: "Pantoprazole Sodium",
    strength: "40 mg",
    dosage_form: "Tablet (delayed release)",
    therapeutic_class: "Proton pump inhibitor",
    schedule: "Prescription",
  },
  {
    base: "0088639",
    brand_name: "Norvasc",
    ingredient: "Amlodipine Besylate",
    strength: "5 mg",
    dosage_form: "Tablet",
    therapeutic_class: "Calcium channel blocker",
    schedule: "Prescription",
  },
  {
    base: "0236263",
    brand_name: "Altace",
    ingredient: "Ramipril",
    strength: "5 mg",
    dosage_form: "Capsule",
    therapeutic_class: "ACE inhibitor",
    schedule: "Prescription",
  },
  {
    base: "0074055",
    brand_name: "Synthroid",
    ingredient: "Levothyroxine Sodium",
    strength: "50 mcg",
    dosage_form: "Tablet",
    therapeutic_class: "Thyroid hormone",
    schedule: "Prescription",
  },
  {
    base: "0205180",
    brand_name: "Cipro",
    ingredient: "Ciprofloxacin Hydrochloride",
    strength: "500 mg",
    dosage_form: "Tablet",
    therapeutic_class: "Fluoroquinolone antibiotic",
    schedule: "Prescription",
  },
  {
    base: "0230457",
    brand_name: "Zithromax",
    ingredient: "Azithromycin Dihydrate",
    strength: "250 mg",
    dosage_form: "Tablet",
    therapeutic_class: "Macrolide antibiotic",
    schedule: "Prescription",
  },
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
  const digits = din.replace(/\D/g, "");
  return DPD[digits] ?? null;
}

/** Resolve the verification status of a DIN as shown in the UI. */
export function resolveDinStatus(
  din: string,
  isCompound: boolean,
): { status: DinStatus; product?: string } {
  if (isCompound) return { status: "compound" };
  const digits = din.replace(/\D/g, "");
  if (!digits) return { status: "unverified" };
  if (!isValidDinFormat(digits)) return { status: "invalid" };
  const record = lookupDin(digits);
  if (!record) return { status: "unverified" };
  return {
    status: "verified",
    product: `${record.brand_name} — ${record.ingredient} ${record.strength} ${record.dosage_form}`,
  };
}

export const DIN_STATUS_META: Record<DinStatus, { label: string; chip: string }> = {
  verified: { label: "DPD verified", chip: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  unverified: { label: "DIN unverified", chip: "border-amber-200 bg-amber-50 text-amber-700" },
  invalid: { label: "Invalid DIN", chip: "border-red-200 bg-red-50 text-red-700" },
  compound: { label: "Compound", chip: "border-violet-200 bg-violet-50 text-violet-700" },
};

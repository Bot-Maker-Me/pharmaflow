/**
 * Sig translation.
 *
 * Vision AI returns plain-English directions ("Take 1 capsule by mouth three
 * times daily for 10 days"); legacy Pharmacy Management Systems expect the
 * compact Latin form ("1 CAP PO TID X 10D"). The helpers below are applied in
 * order and produce the `sig_text` value in the helper payload contract.
 */

/** Ordered [pattern, replacement] pairs applied to the plain-English sig. */
const RULES: Array<[RegExp, string]> = [
  // Strip the leading verb - PMS sig fields start at the dose.
  [/\b(please\s+)?take\b/gi, ""],
  [/\binhale\b/gi, "INH"],
  [/\bapply\b/gi, "APPLY"],

  // Dosage forms
  [/\bcapsules?\b/gi, "CAP"],
  [/\btablets?\b/gi, "TAB"],
  [/\bsuppositor(?:y|ies)\b/gi, "SUPP"],
  [/\bpatches?\b/gi, "PATCH"],
  [/\bsachets?\b/gi, "SACH"],
  [/\bpuffs?\b/gi, "PUFF"],
  [/\bdrops?\b/gi, "GTT"],
  [/\binhaler\b/gi, "INH"],
  [/\bcream\b/gi, "CRM"],
  [/\bointment\b/gi, "OINT"],

  // Routes
  [/\bby mouth\b/gi, "PO"],
  [/\borally\b/gi, "PO"],
  [/\bsubcutaneously\b/gi, "SC"],
  [/\bby injection\b/gi, "INJ"],
  [/\btopically\b/gi, "TOP"],
  [/\bto the affected area\b/gi, "TOP"],
  [/\ba thin layer\b/gi, ""],
  [/\binto (?:the )?(?:affected )?eye\(s\)\b/gi, "OU"],
  [/\binto (?:the )?(?:affected )?ear\(s\)\b/gi, "AU"],

  // Frequency
  [/\bfour times daily\b/gi, "QID"],
  [/\bthree times daily\b/gi, "TID"],
  [/\btwice daily\b/gi, "BID"],
  [/\bonce daily\b/gi, "OD"],
  [/\bevery (\d+)\s*(?:-|to)\s*(\d+) hours\b/gi, "Q$1-$2H"],
  [/\bevery (\d+) hours\b/gi, "Q$1H"],
  [/\bevery (\d+) days\b/gi, "Q$1D"],
  [/\bat bedtime\b/gi, "QHS"],
  [/\bin the morning\b/gi, "QAM"],
  [/\bas needed\b/gi, "PRN"],
  [/\bwith meals\b/gi, "C MEALS"],
  [/\bafter meals\b/gi, "PC"],
  [/\bbefore meals\b/gi, "AC"],
  [/\bbefore breakfast\b/gi, "AC BREAKFAST"],
  [/\bdaily\b/gi, "OD"],

  // Duration
  [/\bfor (\d+) days?\b/gi, "X $1D"],
  [/\bfor (\d+) weeks?\b/gi, "X $1W"],
  [/\bfor (\d+) months?\b/gi, "X $1M"],

  // Cleanup
  [/\bshortness of breath\b/gi, "SOB"],
  [/\s{2,}/g, " "],
];

/** Convert plain-English directions into a compact PMS sig string. */
export function toPmsSig(sig: string): string {
  let result = ` ${sig} `;
  RULES.forEach(([pattern, replacement]) => {
    result = result.replace(pattern, replacement);
  });
  return result
    .replace(/\s*([,.;])\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .toUpperCase();
}

/** Latin sig abbreviations this module understands (documented in the UI). */
export const SIG_GLOSSARY: Array<{ code: string; meaning: string }> = [
  { code: "PO", meaning: "by mouth" },
  { code: "OD", meaning: "once daily" },
  { code: "BID", meaning: "twice daily" },
  { code: "TID", meaning: "three times daily" },
  { code: "QID", meaning: "four times daily" },
  { code: "QHS", meaning: "at bedtime" },
  { code: "PRN", meaning: "as needed" },
  { code: "X 10D", meaning: "for 10 days" },
  { code: "TOP", meaning: "topically" },
  { code: "INH", meaning: "inhaled" },
];

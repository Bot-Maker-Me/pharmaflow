// Port of flow.py sig_fix_is_safe: a learned sig fix may be applied automatically only when it changes wording
// or adds a note. Any change to a dose, number, duration or frequency stays a hint for staff.
const NOTE_RE = /[(\[]\s*LU[^)\]]*[)\]]|\bLU\s*[:=]?\s*(?:CODE\s*[:=]?\s*)?\d+|\*\s*NOT COVERED[^*]*\*?|\bUNWRAP\s*&/gi;
const FREQ = new Set(["PRN", "QD", "BID", "TID", "QID", "HS", "QHS", "AM", "PM", "OD", "STAT"]);

function riskTokens(sig) {
  const text = String(sig ?? "").toUpperCase().replace(NOTE_RE, " ");
  const toks = text.match(/[A-Z0-9]+/g) || [];
  return toks.filter((t) => /\d/.test(t) || FREQ.has(t)).sort();
}

export function sigFixIsSafe(oldSig, newSig) {
  return JSON.stringify(riskTokens(oldSig)) === JSON.stringify(riskTokens(newSig));
}

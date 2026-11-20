/** Parse / repair the JSON the vision model returns. */

export function extractJson(text) {
  const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/gim, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in model output");
  return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * Salvage JSON that the model cut off (reply hit max_tokens): close open strings/brackets and, if that still
 * does not parse, drop the unfinished tail back to the previous complete object. Returns null if hopeless.
 */
export function repairJson(text) {
  const start = String(text || "").indexOf("{");
  if (start === -1) return null;
  let s = text.slice(start);
  for (let i = 0; i < 40; i += 1) {
    const stack = [];
    let inStr = false;
    let esc = false;
    for (const ch of s) {
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === "{" || ch === "[") stack.push(ch);
      else if (ch === "}" || ch === "]") stack.pop();
    }
    let t = s + (inStr ? '"' : "");
    t = t.replace(/[,:\s]+$/, "") + stack.reverse().map((c) => (c === "{" ? "}" : "]")).join("");
    try {
      const value = JSON.parse(t);
      if (value && typeof value === "object") return value;
    } catch {
      /* fall through: cut back to the previous complete object */
    }
    const cut = s.lastIndexOf("},");
    if (cut <= 0) return null;
    s = s.slice(0, cut + 1);
  }
  return null;
}

/** { value, repaired } or null when the text holds no usable JSON. */
export function parseModelJson(text) {
  try {
    return { value: extractJson(text), repaired: false };
  } catch {
    const value = repairJson(text);
    return value ? { value, repaired: true } : null;
  }
}


// Small helpers shared by agent-facing endpoints that talk to Anthropic and Supabase.
import { timingSafeEqual } from "node:crypto";

export function keyMatches(provided, expected) {
  if (typeof provided !== "string" || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function parseDataUrl(url) {
  const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(url || "");
  if (!match) return null;
  return { media_type: match[1] === "image/jpg" ? "image/jpeg" : match[1], data: match[2] };
}

export function extractJson(text) {
  const cleaned = String(text || "").replace(/^```(?:json)?\s*|\s*```$/gim, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON in model output");
  return JSON.parse(cleaned.slice(start, end + 1));
}

export function supabaseConfig() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}

export function sbHeaders(key, extra = {}) {
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...extra };
}

/** Private bucket upload; returns "private:<path>" (turned into a signed link when read) or null. */
export async function uploadPrivateImage(cfg, path, dataUrl) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  const resp = await fetch(`${cfg.url}/storage/v1/object/rx-images/${path}`, {
    method: "POST",
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, "Content-Type": parsed.media_type, "x-upsert": "true" },
    body: Buffer.from(parsed.data, "base64"),
  });
  if (!resp.ok) {
    console.warn("[storage] upload failed", resp.status, (await resp.text()).slice(0, 180));
    return null;
  }
  return `private:${path}`;
}

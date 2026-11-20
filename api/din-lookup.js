/**
 * GET /api/din-lookup?name=fluoxetine%2010mg%20capsule&strength=10%20mg
 * Returns marketed Health Canada DPD products matching the drug, so staff can pick a DIN.
 * Auth: x-access-token = EXTRACT_ACCESS_TOKEN (web app) or x-api-key = AGENT_API_KEY (agent).
 */

import { timingSafeEqual } from "node:crypto";

import { findDinCandidates, pickUnique } from "../server/dpd.js";

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function keyMatches(provided, expected) {
  if (typeof provided !== "string" || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, { error: "GET only" });
  const ok =
    keyMatches(req.headers["x-access-token"], process.env.EXTRACT_ACCESS_TOKEN) ||
    keyMatches(req.headers["x-api-key"], process.env.AGENT_API_KEY);
  if (!ok) return send(res, 401, { error: "Unauthorized" });

  const q = new URL(req.url, "http://x").searchParams;
  const name = String(q.get("name") || "").slice(0, 120);
  const strength = String(q.get("strength") || "").slice(0, 40);
  if (name.trim().length < 3) return send(res, 400, { error: "name is required" });

  const { term, candidates } = await findDinCandidates({ drug_name: name, strength });
  const unique = pickUnique(candidates);
  return send(res, 200, { ok: true, term, candidates, unique_din: unique?.din || null });
}

import test from "node:test";
import assert from "node:assert/strict";
import { parseModelJson } from "./jsonrepair.js";

const full = JSON.stringify({ scripts: [
  { patient: { full_name: "A B", dob: "2016-05-22" }, medications: [{ drug_name: "fluoxetine", quantity: 30 }] },
  { patient: { full_name: "C D", dob: "1980-01-01" }, medications: [{ drug_name: "amoxicillin \"500\"", quantity: 20 }] },
] });

test("clean JSON, with fences and prose around it", () => {
  const r = parseModelJson("Here you go:\n```json\n" + full + "\n```");
  assert.equal(r.repaired, false);
  assert.equal(r.value.scripts.length, 2);
});

test("reply cut off mid-string is repaired and keeps complete scripts", () => {
  const cut = full.slice(0, full.indexOf("amoxicillin") + 6);
  const r = parseModelJson(cut);
  assert.ok(r.repaired);
  assert.ok(r.value.scripts.length >= 1);
  assert.equal(r.value.scripts[0].patient.full_name, "A B");
});

test("reply cut off after a key is repaired", () => {
  const r = parseModelJson(full.slice(0, full.indexOf('"quantity": 20') > 0 ? full.indexOf('"quantity":20') + 11 : full.length - 9));
  assert.ok(r && r.value.scripts.length >= 1);
});

test("prose with no JSON returns null", () => {
  assert.equal(parseModelJson("This page is a fax cover sheet with no prescription."), null);
});

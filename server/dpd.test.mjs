import test from "node:test";
import assert from "node:assert/strict";
import { findDinCandidates, parseStrength, pickUnique, searchTerm, wantedForm } from "./dpd.js";

function mockFetch(db) {
  return async (url) => {
    const u = new URL(url);
    const ep = u.pathname.split("/").filter(Boolean).pop();
    const p = Object.fromEntries(u.searchParams);
    const rows = (db[ep] || []).filter((r) =>
      Object.entries(p).every(([k, v]) => {
        if (["lang", "type"].includes(k)) return true;
        if (k === "ingredientname") return r.ingredient_name.toLowerCase().includes(v.toLowerCase());
        if (k === "brandname") return (r.brand_name || "").toLowerCase().includes(v.toLowerCase());
        if (k === "id") return String(r.drug_code) === v;
        if (k === "status") return true;
        return true;
      }),
    );
    return { ok: true, json: async () => rows };
  };
}

const base = {
  activeingredient: [
    { drug_code: 1, ingredient_name: "FLUOXETINE HYDROCHLORIDE", strength: "10", strength_unit: "MG" },
    { drug_code: 2, ingredient_name: "FLUOXETINE HYDROCHLORIDE", strength: "10", strength_unit: "MG" },
    { drug_code: 3, ingredient_name: "FLUOXETINE HYDROCHLORIDE", strength: "20", strength_unit: "MG" },
  ],
  drugproduct: [
    { drug_code: 1, drug_identification_number: "02177145", brand_name: "APO-FLUOXETINE", company_name: "APOTEX" },
    { drug_code: 2, drug_identification_number: "02244559", brand_name: "OLD-FLUOX", company_name: "GONE" },
    { drug_code: 3, drug_identification_number: "02177153", brand_name: "APO-FLUOXETINE", company_name: "APOTEX" },
  ],
  status: [
    { drug_code: 1, status: "MARKETED", history_date: "2020-01-01" },
    { drug_code: 2, status: "CANCELLED POST MARKET", history_date: "2021-01-01" },
    { drug_code: 3, status: "MARKETED", history_date: "2020-01-01" },
  ],
  form: [
    { drug_code: 1, pharmaceutical_form_name: "Capsule" },
    { drug_code: 2, pharmaceutical_form_name: "Capsule" },
    { drug_code: 3, pharmaceutical_form_name: "Capsule" },
  ],
};

test("helpers", () => {
  assert.equal(searchTerm("fluoxetine HCL 10 mg Oral Capsule"), "fluoxetine");
  assert.equal(searchTerm("Apo-Amoxi 500 mg Capsules"), "apo-amoxi");
  assert.deepEqual(parseStrength("10 mg"), { value: 10, unit: "mg" });
  assert.equal(wantedForm("fluoxetine HCL 10 mg Oral Capsule"), "capsule");
});

test("unique marketed match for strength is returned and cancelled products are dropped", async () => {
  const r = await findDinCandidates({ drug_name: "fluoxetine HCL 10 mg Oral Capsule", strength: "10 mg" }, mockFetch(base));
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0].din, "02177145");
  assert.equal(pickUnique(r.candidates).din, "02177145");
});

test("ambiguous matches are not auto-picked", async () => {
  const db = structuredClone(base);
  db.activeingredient.push({ drug_code: 4, ingredient_name: "FLUOXETINE HYDROCHLORIDE", strength: "10", strength_unit: "MG" });
  db.drugproduct.push({ drug_code: 4, drug_identification_number: "02305437", brand_name: "TEVA-FLUOXETINE", company_name: "TEVA" });
  db.status.push({ drug_code: 4, status: "MARKETED", history_date: "2022-01-01" });
  db.form.push({ drug_code: 4, pharmaceutical_form_name: "Capsule" });
  const r = await findDinCandidates({ drug_name: "fluoxetine 10 mg capsule", strength: "10 mg" }, mockFetch(db));
  assert.equal(r.candidates.length, 2);
  assert.equal(pickUnique(r.candidates), null);
});

test("API failure returns no candidates instead of throwing", async () => {
  const r = await findDinCandidates({ drug_name: "fluoxetine 10 mg" }, async () => { throw new Error("down"); });
  assert.deepEqual(r.candidates, []);
});

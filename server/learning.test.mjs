import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import extractHandler from "../api/extract.js";
import learnHandler from "../api/learn.js";
import syncQueueHandler from "../api/sync-queue.js";
import {
  canonicalPath,
  diffAgainstKroll,
  inferMappings,
  isAutoRewritePath,
  isFlagOnlyPath,
  normDin,
} from "./learning.js";

const TOKEN = "t".repeat(24);
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function call(handler, { method = "POST", headers = {}, body, url = "/" } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) {
        this.headers[k] = v;
      },
      end(payload) {
        resolve({ status: this.statusCode, json: payload ? JSON.parse(payload) : null });
      },
    };
    handler({ method, headers, body, url }, res);
  });
}

let calls;
let routes;
const realFetch = globalThis.fetch;

function stubFetch() {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(url), method: init.method || "GET", body });
    for (const [match, reply] of routes) {
      if (String(url).includes(match) && (!reply.method || reply.method === (init.method || "GET"))) {
        const r = typeof reply.res === "function" ? reply.res(body) : reply.res;
        return { ok: r.status < 400, status: r.status, json: async () => r.body, text: async () => JSON.stringify(r.body) };
      }
    }
    return { ok: true, status: 200, json: async () => [], text: async () => "[]" };
  };
}

beforeEach(() => {
  process.env.EXTRACT_ACCESS_TOKEN = TOKEN;
  process.env.ANTHROPIC_API_KEY = "sk-test";
  process.env.AGENT_API_KEY = "a".repeat(32);
  process.env.SUPABASE_URL = "https://db.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
  routes = [];
  stubFetch();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("path rules", () => {
  it("never auto-rewrites clinical fields", () => {
    for (const p of ["medications[0].quantity", "medications[0].qty", "medications[0].refills", "medications[0].sig", "medications[0].drug_name", "medications[0].strength"]) {
      assert.equal(isAutoRewritePath(p), false, p);
      assert.equal(isFlagOnlyPath(p), true, p);
    }
    assert.equal(canonicalPath("medications[2].qty"), "quantity");
    assert.equal(isAutoRewritePath("patient.full_name"), true);
  });

  it("never learns DOB or health card as rules", () => {
    const m = inferMappings("s", [
      { field_path: "patient.dob", original_value: "1950-01-01", corrected_value: "1951-01-01" },
      { field_path: "patient.health_card_num", original_value: "1234", corrected_value: "5678" },
      { field_path: "kroll.drug_id", original_value: "1", corrected_value: "2" },
    ]);
    assert.deepEqual(m, []);
  });

  it("learns DIN -> drug/strength and flag-only text fixes", () => {
    const m = inferMappings("s", [
      { field_path: "medications[0].din", original_value: "1", corrected_value: "00628115", context: { drug_name: "Metformin", strength: "500 mg" } },
      { field_path: "medications[0].quantity", original_value: "30", corrected_value: "28" },
    ]);
    // DIN -> drug, DIN -> strength, plus flag-only text rules for the DIN text and the quantity.
    assert.deepEqual(m.map((x) => x.kind).sort(), ["din_to_drug", "din_to_strength", "text_replace", "text_replace"]);
    assert.equal(normDin("0628115"), "00628115");
    assert.equal(normDin("628115"), "628115", "6 digits is not guessed into a DIN");
  });
});

describe("kroll diff", () => {
  const row = {
    pending_rx_id: 7,
    planned: { pat_id: 1, doc_id: 2, drug_id: 3, qty: 30, refills: 1, sig: "1 tab bid", ocr_merged: { medications: [{ din: "00628115", quantity: 30, refills: 1, sig: "1 tab BID" }] } },
  };
  it("reports only real differences and ignores case/whitespace/number format", () => {
    const { feedback, matches } = diffAgainstKroll("s", row, { rx_pat_id: 1, rx_doc_id: 2, rx_drug_id: 9, rx_qty: "30.0", rx_refills: 1, rx_sig: "1  TAB bid" });
    assert.deepEqual(feedback.map((f) => f.field_path), ["kroll.drug_id"]);
    assert.equal(feedback[0].corrected_value, "9");
    assert.equal(feedback[0].pending_rx_id, 7);
    assert.equal(matches["medications[0].quantity"], true);
  });
});

describe("/api/extract", () => {
  const body = { page_images: [PNG], store_id: "s1" };
  const claude = (script) => ({ status: 200, body: { content: [{ type: "text", text: JSON.stringify({ scripts: [script] }) }] } });
  const script = {
    patient: { full_name: "Jon Smith", dob: "1980-02-03", health_card_num: "123" },
    prescriber: { name: "Dr Lee", license_number: "L1" },
    medications: [{ drug_name: "Metfrmin", din: "00628115", strength: "", quantity: 30, refills: 1, sig: "BID" }],
  };

  it("health check reports a bad key instead of hiding it", async () => {
    routes = [["api.anthropic.com", { res: { status: 401, body: { error: { message: "invalid x-api-key" } } } }]];
    const r = await call(extractHandler, { method: "GET", headers: { "x-access-token": TOKEN } });
    assert.equal(r.status, 502);
    assert.match(r.json.error, /ANTHROPIC_API_KEY/);
  });

  it("names the missing variable", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const r = await call(extractHandler, { headers: { "x-access-token": TOKEN }, body });
    assert.equal(r.status, 503);
    assert.match(r.json.error, /ANTHROPIC_API_KEY/);
  });

  const mappingRows = (hits) => ({
    status: 200,
    body: [
      { kind: "din_to_drug", source_key: "00628115", target_value: "Metformin", hit_count: hits },
      { kind: "din_to_strength", source_key: "00628115", target_value: "500 mg", hit_count: hits },
      { kind: "text_replace", source_key: "medications[0].quantity::30", target_value: "28", hit_count: 5 },
      { kind: "text_replace", source_key: "medications[0].drug_name::Metfrmin", target_value: "Metformin", hit_count: 5 },
      { kind: "text_replace", source_key: "patient.full_name::Jon Smith", target_value: "John Smith", hit_count: 1 },
    ],
  });

  it("fills empty fields from a DIN mapping, but never rewrites quantity or drug text from past corrections", async () => {
    routes = [["api.anthropic.com", { res: claude(script) }], ["learned_mappings", { res: mappingRows(1) }]];
    const emptyName = { ...script, medications: [{ ...script.medications[0], drug_name: "" }] };
    routes[0] = ["api.anthropic.com", { res: claude(emptyName) }];
    const r = await call(extractHandler, { headers: { "x-access-token": TOKEN }, body });
    assert.equal(r.status, 200);
    const med = r.json.scripts[0].medications[0];
    assert.equal(med.drug_name, "Metformin", "empty name is filled from the DIN");
    assert.equal(med.strength, "500 mg");
    assert.equal(med.quantity, 30, "quantity must stay as read from the fax");
    assert.equal(r.json.scripts[0].patient.full_name, "Jon Smith", "1 hit is not enough to rewrite a name");
    const sent = calls.find((c) => c.url.includes("anthropic")).body;
    assert.match(JSON.stringify(sent.messages), /DIN 00628115 is/);
  });

  it("keeps a misspelled name until the DIN mapping is confirmed twice, then corrects it", async () => {
    routes = [["api.anthropic.com", { res: claude(script) }], ["learned_mappings", { res: mappingRows(1) }]];
    let r = await call(extractHandler, { headers: { "x-access-token": TOKEN }, body });
    assert.equal(r.json.scripts[0].medications[0].drug_name, "Metfrmin");
    assert.equal(r.json.scripts[0].medications[0].quantity, 30);

    routes = [["api.anthropic.com", { res: claude(script) }], ["learned_mappings", { res: mappingRows(2) }]];
    r = await call(extractHandler, { headers: { "x-access-token": TOKEN }, body });
    assert.equal(r.json.scripts[0].medications[0].drug_name, "Metformin");
    assert.equal(r.json.scripts[0].medications[0].quantity, 30, "quantity is never auto-rewritten, even at 5 hits");
  });

  it("surfaces a model failure as a readable error", async () => {
    routes = [["api.anthropic.com", { res: { status: 429, body: {} } }]];
    const r = await call(extractHandler, { headers: { "x-access-token": TOKEN }, body });
    assert.equal(r.status, 502);
    assert.match(r.json.error, /rate limit|credit/i);
  });
});

describe("/api/learn", () => {
  it("stores feedback and bumps mappings atomically", async () => {
    routes = [["rpc/bump_learned_mapping", { res: { status: 200, body: 2 } }]];
    const r = await call(learnHandler, {
      headers: { "x-access-token": TOKEN },
      body: { store_id: "s", corrections: [{ field_path: "medications[0].din", original_value: "1", corrected_value: "00628115", context: { drug_name: "Metformin" } }] },
    });
    assert.equal(r.status, 201);
    const bumps = calls.filter((c) => c.url.includes("rpc/bump_learned_mapping")).map((c) => c.body.p_kind).sort();
    assert.deepEqual(bumps, ["din_to_drug", "text_replace"]);
    const fb = calls.find((c) => c.url.endsWith("/extraction_feedback"));
    assert.equal(fb.body[0].source, "verify_ui");
  });

  it("still works before the migration is applied", async () => {
    let first = true;
    routes = [
      ["/extraction_feedback", { res: (b) => (first && b.some((x) => "source" in x) ? ((first = false), { status: 400, body: {} }) : { status: 201, body: [] }) }],
      ["rpc/bump_learned_mapping", { res: { status: 404, body: {} } }],
    ];
    const r = await call(learnHandler, {
      headers: { "x-access-token": TOKEN },
      body: { store_id: "s", corrections: [{ field_path: "patient.full_name", original_value: "Jon", corrected_value: "John" }] },
    });
    assert.equal(r.status, 201);
  });
});

describe("/api/sync-queue shadow_result (learn from Kroll)", () => {
  const queued = {
    pending_rx_id: 7,
    sig_text: null,
    actual: null,
    planned: { pat_id: 1, doc_id: 2, drug_id: 3, qty: 30, refills: 1, ocr_merged: { medications: [{ din: "00628115", quantity: 30, refills: 1, sig: "1 tab BID" }] }, learning: { suggested_drug_id: "9" } },
  };
  const actual = { rx_pat_id: 1, rx_doc_id: 2, rx_drug_id: 9, rx_qty: 60, rx_refills: 1, rx_sig: "1 tab BID" };

  it("records what staff changed, learns DIN->Kroll drug, scores the suggestion", async () => {
    routes = [
      ["select=pending_rx_id,planned,actual,sig_text", { method: "GET", res: { status: 200, body: [queued] } }],
      ["rpc/bump_learned_mapping", { res: { status: 200, body: 1 } }],
      ["agent_sync_queue?store_id", { method: "PATCH", res: { status: 200, body: [{ id: 1 }] } }],
    ];
    const r = await call(syncQueueHandler, {
      headers: { "x-api-key": process.env.AGENT_API_KEY },
      body: { type: "shadow_result", store_id: "s", pending_rx_id: 7, actual, field_match: {} },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.learned.corrections, 2); // drug_id + quantity
    assert.equal(r.json.learned.mapping, true);
    const upsert = calls.find((c) => c.url.includes("on_conflict=store_id,source,pending_rx_id,field_path"));
    assert.deepEqual(upsert.body.map((f) => f.field_path).sort(), ["kroll.drug_id", "medications[0].quantity"]);
    const bump = calls.find((c) => c.url.includes("rpc/bump_learned_mapping")).body;
    assert.deepEqual([bump.p_kind, bump.p_source_key, bump.p_target_value], ["din_to_kroll_drug", "00628115", "9"]);
    const patch = calls.find((c) => c.method === "PATCH").body;
    assert.equal(patch.planned.learning.suggestion_correct, true);
  });

  it("a later manual edit updates the correction and does not double-count the mapping", async () => {
    const already = { ...queued, actual };
    routes = [
      ["select=pending_rx_id,planned,actual,sig_text", { method: "GET", res: { status: 200, body: [already] } }],
      ["agent_sync_queue?store_id", { method: "PATCH", res: { status: 200, body: [{ id: 1 }] } }],
    ];
    const r = await call(syncQueueHandler, {
      headers: { "x-api-key": process.env.AGENT_API_KEY },
      body: { type: "shadow_result", store_id: "s", pending_rx_id: 7, actual: { ...actual, rx_qty: 90 }, field_match: {} },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.learned.mapping, false, "same DIN->drug as last time: not counted twice");
    const upsert = calls.find((c) => c.url.includes("on_conflict="));
    assert.equal(upsert.body.find((f) => f.field_path === "medications[0].quantity").corrected_value, "90");
  });

  it("a Kroll failure never loses the comparison", async () => {
    routes = [
      ["select=pending_rx_id,planned,actual,sig_text", { method: "GET", res: { status: 500, body: {} } }],
      ["agent_sync_queue?store_id", { method: "PATCH", res: { status: 200, body: [{ id: 1 }] } }],
    ];
    const r = await call(syncQueueHandler, {
      headers: { "x-api-key": process.env.AGENT_API_KEY },
      body: { type: "shadow_result", store_id: "s", pending_rx_id: 7, actual, field_match: {} },
    });
    assert.equal(r.status, 200);
  });
});

import { applySigLearning } from "./learning.js";

it("sig learning: applied only after 2 confirmations and exact text", () => {
  const m = (hits) => [{ kind: "text_replace", source_key: "medications[0].sig::take 1 cap daily", target_value: "T1C PO QD", hit_count: hits }];
  assert.equal(applySigLearning("Take 1 cap  daily", m(1)).applied, null);
  const r = applySigLearning("Take 1 cap  daily", m(2));
  assert.equal(r.sig, "T1C PO QD");
  assert.equal(r.applied.hits, 2);
  assert.equal(applySigLearning("take 2 caps daily", m(5)).applied, null);
  assert.equal(applySigLearning("", m(5)).applied, null);
});

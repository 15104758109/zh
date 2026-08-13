import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const workflow = JSON.parse(readFileSync(path.join(root, "docs/后端/n8n/世界设定生成助手.json"), "utf8"));

function node(name) {
  const value = workflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(value, `missing workflow node: ${name}`);
  return value;
}

function run(name, input, sources = {}) {
  const context = vm.createContext({
    $input: { first: () => ({ json: input }) },
    $: (sourceName) => ({ item: { json: sources[sourceName] } }),
  });
  return new vm.Script(`(function(){${node(name).parameters.jsCode}})()`).runInContext(context, { timeout: 1000 });
}

const scope = Object.freeze({
  local_operator_id: "11111111-1111-4111-8111-111111111111",
  book_id: "22222222-2222-4222-8222-222222222222",
});

const completeWorldAtoms = Object.freeze([
  ["rule", "rule"],
  ["geography", "geo"],
  ["resource", "resource"],
  ["faction", "faction"],
  ["profession", "job"],
  ["monster", "monster"],
  ["event", "event"],
].map(([board_type, atom_type]) => ({
  client_ref: `${board_type}-ref`,
  board_type,
  atom_type,
  atom_key: `${board_type}.primary`,
  atom_value_jsonb: { title: `${board_type} primary` },
  affordance_dims: ["documented-use"],
  source_type: "manual",
  setting_layer: "initial",
})));

test("the repaired world attachment preserves its existing 12-node topology", () => {
  assert.deepEqual(workflow.nodes.map((item) => item.name), [
    "Webhook",
    "Validate World Action",
    "Route World Action",
    "读取已有设定及书本设定",
    "Validate Effective Model Config",
    "Route Effective Model Config",
    "FP002-04 世界设定生成/校验助手",
    "json修复",
    "Call World RPC",
    "Format RPC Response",
    "Format Redacted Error",
    "返回结果",
  ]);
  assert.equal(workflow.connections.Webhook.main[0][0].node, "Validate World Action");
  assert.equal(workflow.connections["Route World Action"].main[1][0].node, "Call World RPC");
  assert.equal(workflow.connections["Call World RPC"].main[0][0].node, "Format RPC Response");
});

test("the world command boundary distinguishes generation, candidate save, read, and confirmation", () => {
  const commands = [
    { ...scope, action: "generate_candidate", creator_input: "补全一条制度代价", correlation_id: "world-generate" },
    {
      ...scope,
      action: "save_candidate",
      atoms: completeWorldAtoms,
      bindings: [],
      correlation_id: "world-save",
    },
    { ...scope, action: "read_versions", correlation_id: "world-read" },
    {
      ...scope,
      action: "confirm",
      world_candidate_ids: ["33333333-3333-4333-8333-333333333333"],
      binding_candidate_ids: [],
      idempotency_key: "world-confirm",
      correlation_id: "world-confirm",
    },
    {
      ...scope,
      action: "confirm",
      delete_world_ids: ["44444444-4444-4444-8444-444444444444"],
      delete_world_binding_ids: ["55555555-5555-4555-8555-555555555555"],
      idempotency_key: "world-delete",
      correlation_id: "world-delete",
    },
  ];

  for (const command of commands) {
    const result = run("Validate World Action", { body: command })[0].json;
    assert.notEqual(result.route, "invalid", command.action);
  }
  const unsupported = run("Validate World Action", {
    body: { ...scope, action: "restore", version_id: "33333333-3333-4333-8333-333333333333", correlation_id: "world-restore" },
  })[0].json;
  assert.equal(unsupported.route, "invalid");
  assert.equal(unsupported.response.redacted_error.code, "INVALID_REQUEST");
});

test("world saves one complete candidate snapshot and confirms its exact atom and binding set", () => {
  const query = node("Call World RPC").parameters.query;
  assert.match(query, /rpc_commit_world_settings/);
  assert.match(query, /world_candidate_ids/);
  assert.match(query, /binding_candidate_ids/);
  assert.match(query, /delete_world_ids/);
  assert.match(query, /delete_world_binding_ids/);
  assert.match(query, /read_versions/);
  assert.match(query, /world_progressions/);
  assert.match(query, /api\.v_world_candidate_write/);
  assert.match(query, /api\.v_world_binding_candidate_write/);
  assert.match(query, /candidate_saved/);
  assert.match(query, /deleted_candidate_atoms/);
  assert.match(query, /deleted_candidate_bindings/);
  assert.match(query, /rpc_commit_world_settings/);
  assert.doesNotMatch(query, /(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?public\.product_request_log/i);
  assert.doesNotMatch(query, /\b(?:INSERT|UPDATE|DELETE|MERGE)\s+(?:INTO\s+|FROM\s+)?public\.(?:world_state|world_binding)\b/i);
});

test("world rejects an incomplete snapshot and exposes history as read-only versions", () => {
  const invalid = run("Validate World Action", {
    body: {
      ...scope,
      action: "save_candidate",
      atoms: completeWorldAtoms.slice(0, 6),
      bindings: [],
      correlation_id: "world-incomplete",
    },
  })[0].json;
  assert.equal(invalid.route, "invalid");
  assert.equal(invalid.response.redacted_error.code, "INVALID_REQUEST");

  const query = node("Call World RPC").parameters.query;
  assert.match(query, /state', 'candidate'/);
  assert.match(query, /current_snapshot_key/);
  assert.match(query, /state', 'history'/);
  assert.match(query, /history:/);
  assert.match(query, /revision_no/);
});

test("generated world content remains a transient candidate and malformed output fails closed", () => {
  const sources = { "Validate Effective Model Config": { request: { correlation_id: "world-candidate" } } };
  const candidate = {
    board_type: "rule",
    atom_type: "rule",
    item_name: "price",
    item_content: { cost: "memory" },
    affordance_dims: ["制度代价"],
  };
  const parsed = run("json修复", {
    output_text: JSON.stringify({ mode: "generate", candidates: [candidate], validation_conflicts: [], data_debt: [] }),
  }, sources)[0].json;
  assert.equal(parsed.response.ok, true);
  assert.equal(parsed.response.result.status, "generated_candidate");
  assert.equal(Object.hasOwn(parsed, "request"), false);

  const malformed = run("json修复", { output_text: "not-json" }, sources)[0].json;
  assert.equal(malformed.response.redacted_error.code, "CANDIDATE_OUTPUT_INVALID");
});

test("malformed requests and stable RPC failures return redacted user-facing errors", () => {
  const invalid = run("Validate World Action", { body: { action: "save_candidate", correlation_id: "world-invalid" } })[0].json;
  assert.deepEqual(JSON.parse(JSON.stringify(invalid.response)), {
    ok: false,
    correlation_id: "world-invalid",
    redacted_error: { code: "INVALID_REQUEST", message: "The request could not be accepted." },
  });

  const sources = { "Validate World Action": { request: { correlation_id: "world-rejected" } } };
  const rejected = run("Format RPC Response", {
    response: { ok: false, error: { code: "CANDIDATE_REJECTED", message: "internal SQL detail" } },
  }, sources)[0].json;
  assert.deepEqual(JSON.parse(JSON.stringify(rejected.response)), {
    ok: false,
    correlation_id: "world-rejected",
    redacted_error: { code: "CANDIDATE_REJECTED", message: "候选已失效、归属不符或不能确认，请重新读取。" },
  });
  assert.equal(JSON.stringify(rejected).includes("internal SQL detail"), false);
});

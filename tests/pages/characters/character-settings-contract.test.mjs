import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

const root = resolve(import.meta.dirname, "../../..");
const workflowPath = "docs/后端/n8n/角色设定生成助手.json";
const operator = "11111111-1111-1111-1111-111111111111";
const bookId = "22222222-2222-2222-2222-222222222222";
const candidateId = "33333333-3333-3333-3333-333333333333";
const base = { correlation_id: "characters-1", local_operator_id: operator, book_id: bookId };

async function workflow() {
  return JSON.parse(await readFile(resolve(root, workflowPath), "utf8"));
}

function runCode(source, context) {
  return vm.runInNewContext(`(() => { ${source} })()`, context);
}

test("FP003-04 accepts its existing manual trigger without inventing an input form", async () => {
  const flow = await workflow();
  const validator = flow.nodes.find((node) => node.name === "Validate Character Command").parameters.jsCode;

  const accepted = runCode(validator, { $json: { body: { ...base, action: "generate_candidate" } } });
  assert.equal(accepted[0].json.valid, true);

  const rejectedExtra = runCode(validator, { $json: { body: { ...base, action: "generate_candidate", creator_input: { premise: "x" } } } });
  assert.equal(rejectedExtra[0].json.valid, false);
  assert.equal(rejectedExtra[0].json.response.error.code, "INVALID_REQUEST");
});

test("FP003-04 requires provider-side JSON object output before candidate validation", async () => {
  const flow = await workflow();
  const model = flow.nodes.find((node) => node.name === "FP003-04 角色设定生成助手");

  assert.equal(model.parameters.options.responseFormat, "json_object");
});

test("candidate persistence and snapshot reads use the documented character contract", async () => {
  const flow = await workflow();
  const validator = flow.nodes.find((node) => node.name === "Validate Character Command").parameters.jsCode;
  const persistence = flow.nodes.find((node) => node.name === "Commit Character Settings RPC").parameters.query;

  const saved = runCode(validator, { $json: { body: { ...base, action: "save_candidate", candidate: { characters: [], relations: [], initial_memories: [] }, bindings: [] } } });
  assert.equal(saved[0].json.valid, false);
  const snapshots = runCode(validator, { $json: { body: { ...base, action: "read_versions" } } });
  assert.equal(snapshots[0].json.valid, true);

  const confirmed = runCode(validator, {
    $json: {
      body: {
        ...base,
        action: "confirm",
        idempotency_key: "character-confirm-1",
        character_candidate_ids: [candidateId],
      },
    },
  });
  assert.equal(confirmed[0].json.valid, true);
  assert.deepEqual(JSON.parse(JSON.stringify(confirmed[0].json.rpc_request)), {
    local_operator_id: operator,
    book_id: bookId,
    idempotency_key: "character-confirm-1",
    character_candidate_ids: [candidateId],
  });
  assert.match(persistence, /'frozen', NOT public\.v7_design_editable\(\(request\.value->>'book_id'\)::uuid\)/);
});

test("FP003-04 candidate remains transient and contains the V7 character data needed for review", async () => {
  const flow = await workflow();
  const parser = flow.nodes.find((node) => node.name === "Validate Candidate Payload").parameters.jsCode;
  const request = { ...base, action: "generate_candidate" };
  const candidate = {
    characters: [{
      client_ref: "rival-one",
      char_name: "沈砚",
      char_type: "antagonist",
      five_layers_json: { L0: {}, L1: {}, L2: {}, L3: {} },
      knowledge_boundary_json: { knows: [], unknown: [], false_belief: [], reasonable_suspect: [] },
      arc_json: {},
    }],
    relations: [],
    initial_memories: [],
  };

  const result = runCode(parser, {
    $json: { text: JSON.stringify(candidate) },
    $: () => ({ first: () => ({ json: { request } }) }),
  });
  assert.equal(result[0].json.response.ok, true);
  assert.equal(result[0].json.response.result.status, "candidate");
  assert.deepEqual(JSON.parse(JSON.stringify(result[0].json.response.result.candidate)), candidate);
  assert.equal("character_candidate_ids" in result[0].json.response.result, false);
});

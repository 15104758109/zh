import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { docker, isDockerUnavailable, runtimeUnavailableMessage } from "../../support/docker-runtime.mjs";

const root = resolve(import.meta.dirname, "../../..");
const workflowPath = "docs/后端/n8n/角色设定生成助手.json";
const operator = "11111111-1111-1111-1111-111111111111";
const book = "22222222-2222-2222-2222-222222222222";
const candidateId = "33333333-3333-3333-3333-333333333333";
const secondCandidateId = "44444444-4444-4444-4444-444444444444";
const correlationId = "character-flow-1";
const postgresContainer = process.env.ZH_V7_POSTGRES_CONTAINER ?? "n8n-pgvector";

const candidatePayload = {
  characters: [
    {
      client_ref: "lead-ref",
      char_name: "Lead",
      char_type: "protagonist",
      five_layers_json: { L0: {}, L1: {}, L2: {}, L3: {} },
      knowledge_boundary_json: { knows: [], unknown: [], false_belief: [], reasonable_suspect: [] },
      arc_json: {},
    },
    {
      client_ref: "rival-ref",
      char_name: "Rival",
      char_type: "antagonist",
      five_layers_json: { L0: {}, L1: {}, L2: {}, L3: {} },
      knowledge_boundary_json: { knows: [], unknown: [], false_belief: [], reasonable_suspect: [] },
      arc_json: {},
    },
  ],
  relations: [{
    from_ref: "lead-ref",
    to_ref: "rival-ref",
    trust: -10,
    intimacy: 0,
    power_balance: 15,
    dependence: 5,
    hostility: 70,
    common_goal: 20,
    secret_known: 10,
    emotional_bond: -15,
    relation_type: "rivals",
    relation_hierarchy: "peers",
    change_event_json: { description: "The rivalry is traceable to a public dispute." },
  }],
  initial_memories: [{
    char_ref: "lead-ref",
    memory_type: "event",
    truth_status: "true",
    memory_content: "A generated initial memory.",
  }],
};

async function readWorkflow() {
  return JSON.parse(await readFile(resolve(root, workflowPath), "utf8"));
}

function runCode(source, context) {
  return vm.runInNewContext("(() => { " + source + " })()", context);
}

function node(workflow, name) {
  const found = workflow.nodes.find((item) => item.name === name);
  assert.ok(found, "expected node " + name);
  return found;
}

function compilePostgresNodeQuery(query) {
  const postgresUser = docker(["exec", postgresContainer, "printenv", "POSTGRES_USER"]).trim();
  assert.ok(postgresUser, "expected the existing PostgreSQL container user");
  const statement = query.replace(/;\s*$/, "");
  return docker([
      "exec", "-i", postgresContainer, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-q",
      "-U", postgresUser, "-d", "zh_narrative", "-f", "-",
    ], { input: `PREPARE zhreplan_b3_node(jsonb) AS ${statement};\nDEALLOCATE zhreplan_b3_node;\n` });
}

test("FP003 n8n attachment preserves its 12-node topology", async () => {
  const workflow = await readWorkflow();

  assert.equal(workflow.nodes.length, 12);
  assert.deepEqual(
    workflow.nodes.map((item) => item.name),
    [
      "Webhook",
      "FP003-04 角色设定生成助手",
      "Validate Character Command",
      "Valid Request?",
      "读世界设定和已有角色",
      "Require Active Model Binding",
      "Runtime Configuration Available?",
      "Generate Candidate?",
      "Validate Candidate Payload",
      "Valid Candidate?",
      "Commit Character Settings RPC",
      "Respond to Webhook",
    ],
  );
  assert.deepEqual(workflow.connections["Webhook"].main[0][0].node, "Validate Character Command");
  assert.deepEqual(workflow.connections["Valid Request?"].main[0][0].node, "Generate Candidate?");
  assert.deepEqual(workflow.connections["Valid Request?"].main[1][0].node, "Respond to Webhook");
  assert.deepEqual(workflow.connections["Generate Candidate?"].main[0][0].node, "读世界设定和已有角色");
  assert.deepEqual(workflow.connections["Generate Candidate?"].main[1][0].node, "Commit Character Settings RPC");
  assert.deepEqual(workflow.connections["Valid Candidate?"].main[0][0].node, "Respond to Webhook");
  assert.doesNotMatch(JSON.stringify(workflow.connections["Valid Candidate?"]), /Commit Character Settings RPC/);
});

test("validator accepts candidate saving, snapshot reads, and an exact confirmation RPC envelope", async () => {
  const workflow = await readWorkflow();
  const validator = node(workflow, "Validate Character Command").parameters.jsCode;

  const generation = {
    action: "generate_candidate",
    correlation_id: correlationId,
    local_operator_id: operator,
    book_id: book,
  };
  const generated = runCode(validator, { $json: { body: generation } });
  assert.equal(generated[0].json.valid, true);
  assert.deepEqual(generated[0].json.request, generation);

  const confirmation = {
    action: "confirm",
    correlation_id: correlationId,
    local_operator_id: operator,
    book_id: book,
    idempotency_key: "character-confirm-1",
    character_candidate_ids: [candidateId],
    relation_candidate_ids: [],
    binding_candidate_ids: [],
    initial_memories: [{
      char_id: candidateId,
      memory_type: "event",
      truth_status: "true",
      memory_content: "A valid initial memory.",
    }],
  };
  const confirmed = runCode(validator, { $json: { body: confirmation } });
  assert.equal(confirmed[0].json.valid, true);
  assert.deepEqual(JSON.parse(JSON.stringify(confirmed[0].json.rpc_request)), {
    local_operator_id: operator,
    book_id: book,
    idempotency_key: "character-confirm-1",
    character_candidate_ids: [candidateId],
    relation_candidate_ids: [],
    binding_candidate_ids: [],
    initial_memories: [{
      char_id: candidateId,
      memory_type: "event",
      truth_status: "true",
      memory_content: "A valid initial memory.",
    }],
  });
  assert.equal("action" in confirmed[0].json.rpc_request, false);
  assert.equal("correlation_id" in confirmed[0].json.rpc_request, false);

  const missingMemoryMetadata = structuredClone(confirmation);
  delete missingMemoryMetadata.initial_memories[0].truth_status;
  const metadataRejected = runCode(validator, { $json: { body: missingMemoryMetadata } });
  assert.equal(metadataRejected[0].json.valid, false);

  const saved = runCode(validator, {
    $json: {
      body: {
        action: "save_candidate",
        correlation_id: correlationId,
        local_operator_id: operator,
        book_id: book,
        candidate: candidatePayload,
        bindings: [],
      },
    },
  });
  assert.equal(saved[0].json.valid, true);
  assert.equal(saved[0].json.request.action, "save_candidate");
  assert.equal(saved[0].json.request.candidate.relations[0].from_ref, "lead-ref");

  const snapshots = runCode(validator, {
    $json: { body: { action: "read_versions", correlation_id: correlationId, local_operator_id: operator, book_id: book } },
  });
  assert.equal(snapshots[0].json.valid, true);
  assert.equal(snapshots[0].json.request.action, "read_versions");

  const brokenReference = structuredClone(candidatePayload);
  brokenReference.relations[0].to_ref = "missing-ref";
  const rejected = runCode(validator, {
    $json: { body: { action: "save_candidate", correlation_id: correlationId, local_operator_id: operator, book_id: book, candidate: brokenReference, bindings: [] } },
  });
  assert.equal(rejected[0].json.valid, false);
  assert.equal(rejected[0].json.response.error.code, "INVALID_REQUEST");

});

test("FP003-04 validates the prompt-library candidate shape and returns no persistence claim", async () => {
  const workflow = await readWorkflow();
  const parser = node(workflow, "Validate Candidate Payload").parameters.jsCode;
  const request = {
    action: "generate_candidate",
    correlation_id: correlationId,
    local_operator_id: operator,
    book_id: book,
  };
  const candidate = {
    characters: [{
      client_ref: "rival-one",
      char_name: "沈砚",
      char_type: "antagonist",
      five_layers_json: { L0: {}, L1: {}, L2: {}, L3: {} },
      knowledge_boundary_json: {
        knows: [],
        unknown: [],
        false_belief: [],
        reasonable_suspect: [],
      },
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
  assert.equal("candidate_hash" in result[0].json.response.result, false);
  assert.equal("character_candidate_ids" in result[0].json.response.result, false);

  const malformed = runCode(parser, {
    $json: { text: JSON.stringify({ candidates: [] }) },
    $: () => ({ first: () => ({ json: { request } }) }),
  });
  assert.equal(malformed[0].json.response.ok, false);
  assert.equal(malformed[0].json.response.error.code, "INTERNAL_ERROR");
  assert.equal(malformed[0].json.response.error.message, "角色候选格式不完整，请重新生成。");
});

test("FP003-04 normalizes a structured relation event and rejects an incomplete relation", async () => {
  const workflow = await readWorkflow();
  const parser = node(workflow, "Validate Candidate Payload").parameters.jsCode;
  const request = {
    action: "generate_candidate",
    correlation_id: correlationId,
    local_operator_id: operator,
    book_id: book,
  };
  const candidate = {
    characters: [
      {
        client_ref: "rival-one",
        char_name: "Rival",
        char_type: "antagonist",
        five_layers_json: { L0: {}, L1: {}, L2: {}, L3: {} },
        knowledge_boundary_json: { knows: [], unknown: [], false_belief: [], reasonable_suspect: [] },
        arc_json: {},
      },
      {
        client_ref: "witness-one",
        char_name: "Witness",
        char_type: "supporting",
        five_layers_json: { L0: {}, L1: {}, L2: {}, L3: {} },
        knowledge_boundary_json: { knows: [], unknown: [], false_belief: [], reasonable_suspect: [] },
        arc_json: {},
      },
    ],
    relations: [{
      from_ref: "rival-one",
      to_ref: "witness-one",
      trust: -20,
      intimacy: 15,
      power_balance: 30,
      dependence: -10,
      hostility: 70,
      common_goal: 35,
      secret_known: 20,
      emotional_bond: -25,
      relation_type: "adversarial alliance",
      relation_hierarchy: "peers",
      change_event: {
        event_type: "public dispute",
        description: "The rival exposes the witness's conflicting account.",
      },
    }],
    initial_memories: [],
  };

  const result = runCode(parser, {
    $json: { text: JSON.stringify(candidate) },
    $: () => ({ first: () => ({ json: { request } }) }),
  });
  assert.equal(result[0].json.response.ok, true);
  const relation = result[0].json.response.result.candidate.relations[0];
  assert.deepEqual(JSON.parse(JSON.stringify(relation.change_event_json)), candidate.relations[0].change_event);
  assert.equal("change_event" in relation, false);

  const memoryComplete = JSON.parse(JSON.stringify(candidate));
  memoryComplete.initial_memories = [{
    char_ref: "rival-one",
    memory_type: "event",
    truth_status: "true",
    memory_content: "A concrete initial memory.",
  }];
  const memoryAccepted = runCode(parser, {
    $json: { text: JSON.stringify(memoryComplete) },
    $: () => ({ first: () => ({ json: { request } }) }),
  });
  assert.equal(memoryAccepted[0].json.response.ok, true);

  const missingMemoryTruth = JSON.parse(JSON.stringify(memoryComplete));
  delete missingMemoryTruth.initial_memories[0].truth_status;
  const memoryRejected = runCode(parser, {
    $json: { text: JSON.stringify(missingMemoryTruth) },
    $: () => ({ first: () => ({ json: { request } }) }),
  });
  assert.equal(memoryRejected[0].json.response.ok, false);

  const incomplete = JSON.parse(JSON.stringify(candidate));
  delete incomplete.relations[0].trust;
  const rejected = runCode(parser, {
    $json: { text: JSON.stringify(incomplete) },
    $: () => ({ first: () => ({ json: { request } }) }),
  });
  assert.equal(rejected[0].json.response.ok, false);
  assert.equal(rejected[0].json.response.error.code, "INTERNAL_ERROR");

  const invalidLayer = JSON.parse(JSON.stringify(candidate));
  invalidLayer.characters[0].five_layers_json.L0 = "not-an-object";
  const layerRejected = runCode(parser, {
    $json: { text: JSON.stringify(invalidLayer) },
    $: () => ({ first: () => ({ json: { request } }) }),
  });
  assert.equal(layerRejected[0].json.response.ok, false);

  const invalidType = JSON.parse(JSON.stringify(candidate));
  invalidType.characters[1].char_type = "supporting_worker";
  const typeRejected = runCode(parser, {
    $json: { text: JSON.stringify(invalidType) },
    $: () => ({ first: () => ({ json: { request } }) }),
  });
  assert.equal(typeRejected[0].json.response.ok, false);

  const mirroredPair = JSON.parse(JSON.stringify(candidate));
  mirroredPair.relations.push({
    ...mirroredPair.relations[0],
    from_ref: "witness-one",
    to_ref: "rival-one",
    power_balance: -mirroredPair.relations[0].power_balance,
  });
  const mirroredPairRejected = runCode(parser, {
    $json: { text: JSON.stringify(mirroredPair) },
    $: () => ({ first: () => ({ json: { request } }) }),
  });
  assert.equal(mirroredPairRejected[0].json.response.ok, false);
});

test("reader and existing write node keep candidate, snapshot, and confirmation responsibilities scoped", async () => {
  const workflow = await readWorkflow();
  const reader = node(workflow, "读世界设定和已有角色");
  const query = reader.parameters.query;
  const commit = node(workflow, "Commit Character Settings RPC");
  const responder = node(workflow, "Respond to Webhook");
  const prompt = node(workflow, "FP003-04 角色设定生成助手").parameters.responses.values[0].content;

  assert.match(query, /public\.v7_design_editable/);
  assert.match(query, /public\.v_prompt_runtime_binding/);
  assert.match(query, /public\.l1a_unit/);
  assert.match(query, /status = 'candidate'/);
  assert.doesNotMatch(query, /design_frozen_at/);
  assert.doesNotMatch(query, /\b(?:INSERT|UPDATE|DELETE|rpc_commit_character_settings)\b/i);
  assert.match(reader.parameters.options.queryReplacement, /JSON\.stringify\(\$json\.request\)/);

  assert.match(commit.parameters.query, /api\.v_character_candidate_write/);
  assert.match(commit.parameters.query, /api\.v_relation_candidate_write/);
  assert.doesNotMatch(commit.parameters.query, /memory_write AS/);
  assert.doesNotMatch(commit.parameters.query, /INSERT INTO public\.character_memory/);
  assert.doesNotMatch(commit.parameters.query, /initial_memory_ids/);
  assert.match(commit.parameters.query, /'candidate', jsonb_build_object\([\s\S]*?'initial_memories', '\[\]'::jsonb\)/);
  assert.doesNotMatch(commit.parameters.query, /api\.v_world_binding_candidate_write/);
  assert.match(commit.parameters.query, /public\.rpc_commit_character_settings/);
  assert.match(commit.parameters.query, /read_versions/);
  assert.match(commit.parameters.query, /client_ref/);
  assert.match(commit.parameters.query, /char_code/);
  assert.match(commit.parameters.query, /COALESCE\(NULLIF\((?:character|item\.value)->>'char_code', ''\), (?:character|item\.value)->>'client_ref'\)/);
  assert.match(commit.parameters.query, /local_operator_id/);
  assert.match(commit.parameters.options.queryReplacement, /JSON\.stringify\(\$json\.request\)/);
  assert.match(node(workflow, "Generate Candidate?").parameters.conditions.conditions[0].leftValue, /request\.action/);
  assert.match(responder.parameters.responseBody, /角色设定服务暂时无法完成/);
  assert.match(prompt, /候选不是正式事实/);
  assert.match(prompt, /不能写入数据库/);
  assert.match(prompt, /characters/);
  assert.match(prompt, /change_event_json/);
  assert.match(prompt, /trust/);
  assert.match(prompt, /relation_hierarchy/);
  assert.match(prompt, /protagonist.*supporting.*ensemble.*antagonist/);
  assert.match(prompt, /顶层只允许 characters、relations、initial_memories/);
  assert.match(prompt, /client_ref、char_name、char_type/);
  assert.match(prompt, /arc_json.*direction.*stakes/);
  assert.match(prompt, /char_ref、memory_type、truth_status、memory_content/);
  assert.match(prompt, /memory_type/);
  assert.match(prompt, /truth_status/);
  assert.match(prompt, /不得使用 candidates、char_id_hint、generation_rationale/);
  assert.match(prompt, /from_ref.*to_ref.*本次.*client_ref/);
  assert.match(prompt, /同一无向角色对只能输出一个 relations 项/);
  assert.match(prompt, /trust.*intimacy.*power_balance.*dependence.*emotional_bond.*-100.*100/);
  assert.match(prompt, /hostility.*common_goal.*secret_known.*0.*100/);
  assert.doesNotMatch(prompt, /creator_input/);
  const expressionBody = prompt.replace(/^=\{\{/, "").replace(/\}\}$/, "");
  assert.match(expressionBody, /JSON\.parse/);
  assert.doesNotMatch(expressionBody, /\{\{|\}\}/);
});

test("candidate persistence updates an existing same-code candidate before inserting a new one", async () => {
  const workflow = await readWorkflow();
  const query = node(workflow, "Commit Character Settings RPC").parameters.query;

  assert.match(query, /existing_characters AS/);
  assert.match(query, /character_update AS \(\s*UPDATE api\.v_character_candidate_write AS current/);
  assert.match(query, /character_insert AS \(\s*INSERT INTO api\.v_character_candidate_write/);
  assert.match(query, /character_input[\s\S]*COALESCE\(existing_character\.id, gen_random_uuid\(\)\)/);
  assert.match(query, /existing_relations AS/);
  assert.match(query, /relation_update AS \(\s*UPDATE api\.v_relation_candidate_write AS current/);
  assert.match(query, /relation_insert AS \(\s*INSERT INTO api\.v_relation_candidate_write/);
  assert.match(query, /client_ref_map[\s\S]*character_input/);
});

test("existing character persistence node compiles as PostgreSQL before live n8n import", async (t) => {
  const workflow = await readWorkflow();
  const query = node(workflow, "Commit Character Settings RPC").parameters.query;

  try {
    compilePostgresNodeQuery(query);
  } catch (error) {
    if (!isDockerUnavailable(error)) throw error;
    return t.skip(runtimeUnavailableMessage(error, "PostgreSQL"));
  }
});

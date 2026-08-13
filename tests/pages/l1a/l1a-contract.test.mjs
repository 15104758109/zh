import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { dockerLong, isDockerUnavailable, runtimeUnavailableMessage } from "../../support/docker-runtime.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const readJson = (file) => JSON.parse(readFileSync(path.join(root, file), "utf8"));
const generate = readJson("docs/后端/n8n/ZH02-L1A生成.json");
const finalize = readJson("docs/后端/n8n/ZH03-三线排序.json");
const operator = "11111111-1111-4111-8111-111111111111";
const book = "22222222-2222-4222-8222-222222222222";
const character = "44444444-4444-4444-8444-444444444444";
const world = "33333333-3333-4333-8333-333333333333";

function node(workflow, name) {
  const aliases = {
    "Validate L1A Workflow Request": "96c33460-38eb-482b-a904-8060014b2a19",
    "Read FP004 Sort Context": "96c33460-38eb-482b-a904-8060014b2a19",
    "Require FP004 Sort Context": "2e022a5a-312c-471a-9d38-b3cc4b300438",
    "FP004-02 Chronicle Analysis": "aaa1787f-a2e7-4037-8d60-edfccfdb641d",
    "Validate Chronicle Output": "b3c44b4d-8f82-4381-bfaf-9b3ccc2252f1",
    "FP004-02 Premise Analysis": "6ffea3d1-df0e-43fb-8a45-fa0eacb3951a",
    "Validate Premise Output": "675735c5-5846-4f9c-ba23-6c1f797f52e4",
    "FP004-02 Character Arc Analysis": "33398b43-d37e-462e-bdee-1edea26863b2",
    "Validate Arc Output": "2e022a5a-312c-471a-9d38-b3cc4b300438",
    "FP004-02 Three-line Ordering": "da994e56-5a28-46a1-a999-482a741fc058",
    "Validate Complete Ordering": "a0081724-4329-43d0-aecf-47a50e3c35c6",
    "FP004-02 Gap Analysis": "cfbe9006-da8e-4d8d-8567-8f1d03ab6afa",
    "Validate Sort Review Result": "272a8c00-a662-42c3-b890-84ad7abff15d",
    "Canonical L1A Workflow Response": "272a8c00-a662-42c3-b890-84ad7abff15d",
    "Controlled L1A Workflow Error": "104abc75-17f9-4c05-a329-4248f357d5a8",
    "FP004-04 Finalize L1A RPC": "418a1592-eba4-4187-a4b6-afe55b867309",
  };
  const found = workflow.nodes.find((item) => item.name === name || item.id === aliases[name]);
  assert.ok(found, name);
  return found;
}

function executeCode(codeNode, input, named = {}) {
  const inputs = Array.isArray(input) ? input : [input];
  return vm.runInNewContext(`(() => {\n${codeNode.parameters.jsCode}\n})()`, {
    $input: {
      first: () => ({ json: inputs[0] }),
      all: () => inputs.map((json) => ({ json })),
    },
    $json: inputs[0],
    $: (name) => ({ first: () => ({ json: named[name]
      ?? (name === "开始三线排序" && named["Require FP004 Sort Context"] ? { body: named["Require FP004 Sort Context"].request } : undefined)
      ?? (name === "读取设计阶段快照1" && named["Require FP004 Sort Context"] ? { response: { ok: true, context: named["Require FP004 Sort Context"].context } } : undefined)
      ?? named["Validate Premise Output"]
      ?? named["Validate Arc Output"]
      ?? named["Validate Complete Ordering"]
      ?? named["Validate Sort Review Result"] }) }),
  });
}

function executeResponse(responseNode, inputs, named = {}) {
  const expression = responseNode.parameters.responseBody.replace(/^=\{\{\s*|\s*\}\}$/g, "");
  return vm.runInNewContext(`(${expression})`, {
    $input: { all: () => inputs.map((json) => ({ json })) },
    $: (name) => {
      const values = Array.isArray(named[name]) ? named[name] : [named[name]];
      return {
        first: () => ({ json: values[0] }),
        all: () => values.map((json) => ({ json })),
      };
    },
  });
}

const generatedCandidate = {
  l1a_name: "Pressure point",
  scene_location: "Formal-world location",
  conflict_background: "The selected world resists the selected character.",
  escalation_path: "The cost compounds.",
  stakes: "A relationship changes.",
  irreversible_consequence: "The choice cannot be undone.",
  plot_emotion_commit: { plot: "A choice becomes unavoidable.", emotion: "Trust is spent." },
  arc_requirement: { character_id: character, direction: "growth" },
  info_reveal_boundary: { reveal: ["formal-world-key"] },
  role_arc_json: { [character]: "growth" },
  world_resistance_refs: [{ atom_key: "formal-world-key" }],
  participant_chars_json: [character],
  role_arcs: [{ char_id: character, direction: "growth", conflict_with_L0: false }],
};

const generatedModelCandidate = {
  l1a_name: generatedCandidate.l1a_name,
  scene_location: generatedCandidate.scene_location,
  conflict_background: generatedCandidate.conflict_background,
  escalation_path: generatedCandidate.escalation_path,
  stakes: generatedCandidate.stakes,
  irreversible_consequence: generatedCandidate.irreversible_consequence,
  plot_emotion_commit: generatedCandidate.plot_emotion_commit,
  arc_requirement: generatedCandidate.arc_requirement,
  info_reveal_boundary: generatedCandidate.info_reveal_boundary,
  role_arc_entries: [{ char_ref: "C001", direction: "growth", conflict_with_L0: false }],
  world_resistance_refs: [{ world_ref: "W001" }],
  participant_char_refs: ["C001"],
};

const referenceCatalog = {
  characters: [{ ref: "C001", id: character, char_name: "Test character" }],
  worlds: [{ ref: "W001", atom_key: "formal-world-key" }],
};

test("ZH02 accepts exact read and generation commands and forwards only stable RPC candidates", () => {
  const read = {
    action: "read", local_operator_id: operator, book_id: book, correlation_id: "l1a-read-1",
  };
  const request = {
    action: "generate", local_operator_id: operator, book_id: book, correlation_id: "l1a-generate-1", idempotency_key: "l1a-generate-key",
  };
  const validator = node(generate, "Validate Generate Request");
  assert.deepEqual(JSON.parse(JSON.stringify(executeCode(validator, { body: read })[0].json.request)), read);
  assert.deepEqual(JSON.parse(JSON.stringify(executeCode(validator, { body: request })[0].json.request)), request);
  assert.equal(executeCode(validator, { body: { ...request, world_version_id: world } })[0].json.redacted_error.code, "INVALID_REQUEST");
  assert.equal(executeCode(validator, { body: { ...read, idempotency_key: "not-needed" } })[0].json.redacted_error.code, "INVALID_REQUEST");

  const parser = node(generate, "Parse Canonical L1A Candidates");
  const parserSource = {
    request,
    context: {
      world_states: [{ atom_key: "formal-world-key" }],
      characters: [{ id: character }],
    },
    reference_catalog: referenceCatalog,
  };
  const named = { "Require FP016 L1A Binding": parserSource };
  const parsed = executeCode(parser, { output_text: JSON.stringify([generatedModelCandidate]) }, named);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed[0].json.internal_request)), {
    local_operator_id: operator,
    book_id: book,
    correlation_id: request.correlation_id,
    idempotency_key: request.idempotency_key,
    candidates: [generatedCandidate],
  });

  const actualN8nShape = executeCode(parser, {
    output: [{ content: [{ type: "output_text", text: JSON.stringify([generatedModelCandidate]) }] }],
  }, named);
  assert.deepEqual(JSON.parse(JSON.stringify(actualN8nShape[0].json.internal_request)), {
    local_operator_id: operator,
    book_id: book,
    correlation_id: request.correlation_id,
    idempotency_key: request.idempotency_key,
    candidates: [generatedCandidate],
  });
  assert.equal("world_version_id" in parsed[0].json.internal_request, false);
  assert.equal("creator_input" in parsed[0].json.internal_request, false);
  assert.doesNotMatch(JSON.stringify(parsed[0].json.internal_request), /\b[CW]\d{3}\b/);

  const nestedReferenceCandidate = {
    ...generatedModelCandidate,
    arc_requirement: {
      focus_char_refs: ["C001"],
      world_anchor_ref: "W001",
      requirement: "growth under pressure",
    },
    info_reveal_boundary: {
      reveal: ["C001 faces pressure from W001"],
      withhold: ["The remaining mechanism"],
    },
  };
  const nestedReferences = executeCode(parser, {
    output_text: JSON.stringify([nestedReferenceCandidate]),
  }, named);
  assert.deepEqual(JSON.parse(JSON.stringify(nestedReferences[0].json.internal_request.candidates[0].arc_requirement)), {
    focus_char_refs: [character],
    world_anchor_ref: "formal-world-key",
    requirement: "growth under pressure",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(nestedReferences[0].json.internal_request.candidates[0].info_reveal_boundary)), {
    reveal: ["Test character faces pressure from formal-world-key"],
    withhold: ["The remaining mechanism"],
  });
  assert.doesNotMatch(JSON.stringify(nestedReferences[0].json.internal_request), /\b[CW]\d{3}\b/);
  assert.equal(executeCode(parser, {
    output_text: JSON.stringify([{ ...nestedReferenceCandidate, arc_requirement: { focus_char_refs: ["C099"] } }]),
  }, named)[0].json.redacted_error.code, "CANDIDATE_INCOMPLETE");
  assert.equal(executeCode(parser, {
    output_text: JSON.stringify([{ ...generatedModelCandidate, world_resistance_refs: [{ world_ref: "W99" }] }]),
  }, named)[0].json.redacted_error.code, "CANDIDATE_INCOMPLETE");
  for (const invalid of [
    { ...generatedModelCandidate, scene_location: "" },
    { ...generatedModelCandidate, plot_emotion_commit: {} },
    { ...generatedModelCandidate, role_arc_entries: [] },
    { ...generatedModelCandidate, role_arc_entries: [{ char_ref: "C99", direction: "growth", conflict_with_L0: false }] },
    { ...generatedModelCandidate, role_arc_entries: [
      { char_ref: "C001", direction: "growth", conflict_with_L0: false },
      { char_ref: "C001", direction: "stable", conflict_with_L0: false },
    ] },
    { ...generatedModelCandidate, participant_char_refs: [] },
    { ...generatedModelCandidate, participant_char_refs: ["C99"] },
    { ...generatedModelCandidate, participant_char_refs: ["C001", "C001"] },
    { ...generatedModelCandidate, participant_char_refs: [character] },
    { ...generatedModelCandidate, scenes_json: [{ scene_location: "Unpersisted parallel scene" }] },
  ]) {
    assert.equal(executeCode(parser, { output_text: JSON.stringify([invalid]) }, named)[0].json.redacted_error.code, "CANDIDATE_INCOMPLETE");
  }

  const mixedBatch = executeCode(parser, {
    output_text: JSON.stringify([
      generatedModelCandidate,
      { ...generatedModelCandidate, role_arc_entries: [{ char_ref: "C99", direction: "growth", conflict_with_L0: false }] },
    ]),
  }, named);
  assert.equal(mixedBatch[0].json.redacted_error.code, "CANDIDATE_INCOMPLETE");
  assert.equal("internal_request" in mixedBatch[0].json, false);
});

test("ZH02 returns the read projection before any model gate and blocks an absent generation binding", () => {
  const request = { action: "generate", correlation_id: "l1a-config-1" };
  const gate = node(generate, "Require FP016 L1A Binding");
  const projection = {
    ok: true,
    correlation_id: "l1a-read-1",
    result: { book: {}, l1as: [], characters: [], chapters: [] },
  };
  assert.deepEqual(JSON.parse(JSON.stringify(executeCode(gate, { response: projection }, {
    "Validate Generate Request": { request: { action: "read", correlation_id: projection.correlation_id } },
  })[0].json)), projection);

  const blocked = executeCode(gate, {
    response: {
      ok: true,
      context: {
        design_editable: true,
        initial_l1as: [{}],
        world_states: [{ atom_key: "formal-world-key" }],
        characters: [{ id: character, char_name: "Test character" }],
        genre_skills: [{}],
        skills_response: { ok: true, skills: [{}] },
        binding: {},
      },
    },
  }, { "Validate Generate Request": { request } });
  assert.deepEqual(JSON.parse(JSON.stringify(blocked[0].json)), {
    ok: false, correlation_id: request.correlation_id,
    redacted_error: { code: "CONFIG_CONTRACT_BLOCKED", message: "An active FP004-01 model and prompt binding is required." },
  });

  const noSkillRows = executeCode(gate, {
    response: {
      ok: true,
      context: {
        design_editable: true,
        initial_l1as: [{}],
        world_states: [{ atom_key: "formal-world-key" }],
        characters: [{ id: character, char_name: "Test character" }],
        genre_skills: [],
        skills_response: { ok: true, skills: [] },
        binding: {
          model_name: "current-model",
          provider_base_url: "http://127.0.0.1:11434/v1",
          prompt_text: "Current FP004-01 prompt",
          api_key_ref: "local-secret-ref",
        },
      },
    },
  }, { "Validate Generate Request": { request } });
  assert.equal(noSkillRows[0].json.request, request);
  assert.deepEqual(JSON.parse(JSON.stringify(noSkillRows[0].json.reference_catalog)), referenceCatalog);

  const normalized = executeCode(node(generate, "Canonical Generate Response"), {
    response: { ok: false, error: { code: "UPSTREAM_INCOMPLETE", message: "Missing formal design context." } },
  }, { "Validate Generate Request": { request } });
  assert.deepEqual(JSON.parse(JSON.stringify(normalized[0].json)), {
    ok: false,
    correlation_id: request.correlation_id,
    redacted_error: { code: "UPSTREAM_INCOMPLETE", message: "Missing formal design context." },
  });
});

test("ZH02 exposes the FP016 binding under an n8n-safe expression key", () => {
  const requireBinding = node(generate, "Require FP016 L1A Binding");
  const modelNodes = [
    node(generate, "FP004-01 Conflict Traversal"),
    node(generate, "FP004-01 Commercial and Emotion Filter"),
  ];

  assert.match(requireBinding.parameters.jsCode, /runtime_binding: binding/);
  for (const modelNode of modelNodes) {
    assert.equal(modelNode.type, "n8n-nodes-base.httpRequest", modelNode.name);
    assert.equal(modelNode.typeVersion, 4.2, modelNode.name);
    assert.equal(modelNode.parameters.authentication, "predefinedCredentialType", modelNode.name);
    assert.equal(modelNode.parameters.nodeCredentialType, "openAiApi", modelNode.name);
    assert.match(modelNode.parameters.url, /provider_base_url/u, modelNode.name);
    assert.match(modelNode.parameters.url, /chat\/completions/u, modelNode.name);
    assert.doesNotMatch(JSON.stringify(modelNode.parameters), /context\.binding/, modelNode.name);
    assert.match(JSON.stringify(modelNode.parameters), /runtime_binding/, modelNode.name);
    assert.doesNotMatch(JSON.stringify(modelNode.parameters), /\/responses/u, modelNode.name);
  }
});

test("workflow manifests preserve topology and expose only the V7 FP004-01 projection and RPC path", () => {
  assert.equal(generate.active, false, "repository workflow attachments stay inactive until serialized live publication");
  assert.equal(node(generate, "Webhook: Generate L1A").parameters.httpMethod, "POST");
  assert.equal(node(generate, "Webhook: Generate L1A").webhookId, "988709bc-e64d-4f3f-b318-e22d29bb6874");
  const requiredIds = new Set([
    "0ec48a29-f3f6-4ad8-a1e5-910736393217", "428c4551-57b7-4b85-a4f8-20f2344c6e06",
    "c5d49ae6-0d7d-4d80-ad82-1a387d6015c6", "a7576dfb-f0df-4569-ab36-a5d0e1fd42d1",
    "e19786bb-39d3-4977-a304-84b7677f38e3", "e0ece32d-9575-4438-a6ea-4b9dbdcacd37",
    "3ee2fcf1-9566-498e-a0fc-a1c669e3d7ad", "323e7cf9-a595-4153-a676-892970c74a76",
    "9794d2f9-f892-4a26-a953-381f4590a2bb", "c78ed7fc-2a2a-4402-ae75-d99f1c2f9d5e",
    "c5454ae0-1f50-4299-a7af-ac9dc21ca5af", "67cde73a-d79f-4e66-b957-ca680fa3333c",
    "57616f7f-eac1-41c4-afb0-bf3c742d17ec", "77368431-bc45-422a-a2d8-15f8125cd63b",
    "dd579a68-c1fc-445d-9834-6a0a84b3b0a7", "adacdec3-6595-4bcc-87ec-22a5569d8c48",
  ]);
  assert.equal(generate.nodes.length, 16);
  assert.deepEqual(new Set(generate.nodes.map((item) => item.id)), requiredIds);
  assert.equal(generate.nodes.some((item) => item.id === "77368431-bc45-4222-8d8e-2d8f12a0b9fd"), false);
  assert.equal(generate.connections["Canonical Candidates Parsed?"].main[0][0].node, "Generate L1A RPC");
  assert.equal(generate.connections["Valid Generate Request?"].main[1][0].node, "Respond: L1A Generation");
  assert.equal(generate.connections["Canonical Candidates Parsed?"].main[1][0].node, "Respond: L1A Generation");
  assert.equal(generate.connections["Valid Generate Request?"].main[1].flatMap((branch) => branch).some((edge) => edge.node.includes("RPC")), false);
  assert.equal(generate.connections["Canonical Candidates Parsed?"].main[1].flatMap((branch) => branch).some((edge) => edge.node.includes("RPC")), false);
  const serialized = JSON.stringify(generate);
  assert.doesNotMatch(serialized, /world_version_id|character_version_id|creator_input|generated_candidates|FP004-05|rpc_acquire_run_lock/i);
  assert.match(node(generate, "Read FP016 L1A Binding").parameters.query, /request->>'action' = 'read'/);
  assert.match(node(generate, "Read FP016 L1A Binding").parameters.query, /'book', jsonb_build_object/);
  assert.match(node(generate, "Read FP016 L1A Binding").parameters.query, /'l1as'/);
  assert.match(node(generate, "Read FP016 L1A Binding").parameters.query, /'characters'/);
  assert.match(node(generate, "Read FP016 L1A Binding").parameters.query, /'chapters'/);
  assert.match(node(generate, "Read FP016 L1A Binding").parameters.query, /'sort_draft'/);
  assert.match(node(generate, "Read FP016 L1A Binding").parameters.query, /public\.product_request_log/);
  assert.match(node(generate, "Read FP016 L1A Binding").parameters.query, /fp004_02_sort_l1a/);
  assert.match(node(generate, "Read FP016 L1A Binding").parameters.query, /candidate_fingerprint/);
  assert.match(node(generate, "Read FP016 L1A Binding").parameters.query, /public\.rpc_get_effective_skills/);
  assert.match(node(generate, "Read FP016 L1A Binding").parameters.query, /target_words/);
  assert.match(node(generate, "Read FP016 L1A Binding").parameters.query, /chapter_words/);
  const traversal = node(generate, "FP004-01 Conflict Traversal");
  assert.match(traversal.parameters.jsonBody, /initial_l1as/);
  assert.match(traversal.parameters.jsonBody, /world_resistance_refs/);
  assert.match(traversal.parameters.jsonBody, /role_arc_entries/);
  assert.match(traversal.parameters.jsonBody, /participant_char_refs/);
  assert.match(traversal.parameters.jsonBody, /REFERENCE_CATALOG=/);
  assert.match(traversal.parameters.jsonBody, /Do not output[^.]*scenes_json/);
  const commercial = node(generate, "FP004-01 Commercial and Emotion Filter");
  assert.equal(commercial.id, "dd579a68-c1fc-445d-9834-6a0a84b3b0a7");
  assert.match(commercial.parameters.jsonBody, /runtime_binding\.model_name/);
  assert.match(commercial.parameters.jsonBody, /future_value_reserved/);
  assert.match(commercial.parameters.jsonBody, /role_arc_entries/);
  assert.match(commercial.parameters.jsonBody, /REFERENCE_CATALOG=/);
  assert.match(commercial.parameters.jsonBody, /Do not guess or alter references/);
  assert.match(commercial.parameters.jsonBody, /choices\?\.\[0\]\?\.message\?\.content/);
  assert.match(node(generate, "Parse Canonical L1A Candidates").parameters.jsCode, /choices\?\.\[0\]\?\.message\?\.content/);
  const skillTool = node(generate, "Approved Genre Skill Tool (preloaded)");
  assert.equal(skillTool.id, "adacdec3-6595-4bcc-87ec-22a5569d8c48");
  assert.equal(skillTool.disabled, true);
  for (const pg of generate.nodes.filter((item) => item.type === "n8n-nodes-base.postgres")) {
    assert.equal(pg.onError, "continueErrorOutput");
    assert.ok(pg.parameters.options.queryReplacement);
  }
  assert.match(node(generate, "Generate L1A RPC").parameters.query, /^SELECT public\.rpc_generate_l1a_conflicts\(\$1::jsonb\) AS response;$/);
});

test("ZH03 preserves the approved action topology and one L1A persistence authority", () => {
  assert.equal(finalize.active, false, "repository workflow attachments stay inactive until serialized live publication");
  const ids = new Set(finalize.nodes.map((item) => item.id));
  assert.equal(finalize.nodes.length, 23);
  assert.equal(ids.size, 23);
  const webhook = finalize.nodes.find((item) => item.id === "a0649be5-8d1a-4d64-ae64-068c8441e5b0");
  assert.ok(webhook, "ZH03 must retain its original webhook trigger node");
  assert.equal(webhook.parameters.path, "finalize_l1a");
  assert.equal(webhook.webhookId, "6d33d3e1-d5c5-48b9-be8a-056c6ed8dc5c");
  const persistence = node(finalize, "FP004-04 Finalize L1A RPC");
  assert.match(persistence.parameters.query, /UPDATE api\.v_l1a_candidate_write/);
  assert.match(persistence.parameters.query, /public\.rpc_finalize_l1a/);
  assert.doesNotMatch(persistence.parameters.query, /UPDATE public\.l1a_unit/);
  assert.equal(finalize.connections["IF：审计通过？"].main[0][0].node, persistence.name);
});

test("ZH03 reads the request at the original entry and gates the original context edge", () => {
  const read = node(finalize, "读取设计阶段快照1");
  const gate = node(finalize, "IF：已有 L1A 候选？");
  assert.equal(read.type, "n8n-nodes-base.postgres");
  assert.match(read.parameters.options.queryReplacement, /body/);
  assert.match(gate.parameters.conditions.conditions[0].leftValue, /response/);
  assert.match(read.parameters.query, /candidate_fingerprint/);
  assert.match(read.parameters.query, /'runtime_binding',r\.binding/);
  assert.doesNotMatch(JSON.stringify(finalize.nodes), /context\.binding\./);
  for (const model of finalize.nodes.filter((item) => item.type === "@n8n/n8n-nodes-langchain.openAi")) {
    assert.match(JSON.stringify(model.parameters), /context\.runtime_binding\./, model.name);
  }
});

test("ZH03 routes sort through every FP004-02 model and finalization directly to FP004-04", () => {
  const contextGate = node(finalize, "IF：已有 L1A 候选？");
  const actionRoute = node(finalize, "Route Sort Or Finalize");
  const chronicle = node(finalize, "大事纪划分");
  const finalizeRequest = node(finalize, "Prepare Finalize RPC Request");
  const response = node(finalize, "FP004-03 三线排序完成");
  const modelNames = [
    "大事纪划分",
    "前提分析",
    "人物弧光分析",
    "FP004-02 执行时间线/故事线/人物线物理排序",
    "5类缺口诊断与补充",
  ];

  assert.equal(contextGate.type, "n8n-nodes-base.if");
  assert.equal(actionRoute.type, "n8n-nodes-base.switch");
  assert.match(JSON.stringify(actionRoute.parameters), /action === 'sort'/);
  assert.match(JSON.stringify(actionRoute.parameters), /action === 'finalize'/);
  assert.equal(finalize.connections[contextGate.name].main[0][0].node, actionRoute.name);
  assert.equal(finalize.connections[actionRoute.name].main[0][0].node, chronicle.name);
  assert.equal(finalize.connections[actionRoute.name].main[1][0].node, finalizeRequest.name);
  assert.equal(finalize.connections[actionRoute.name].main[2][0].node, response.name);

  const reachable = (from) => {
    const seen = new Set([from]);
    const queue = [from];
    while (queue.length) {
      const current = queue.shift();
      for (const outputs of Object.values(finalize.connections[current] ?? {})) {
        for (const branch of outputs) for (const edge of branch) {
          if (!seen.has(edge.node)) { seen.add(edge.node); queue.push(edge.node); }
        }
      }
    }
    return seen;
  };
  const sortPath = reachable(chronicle.name);
  const finalizePath = reachable(finalizeRequest.name);
  for (const name of modelNames) {
    assert.ok(sortPath.has(name), `sort must execute ${name}`);
    assert.equal(finalizePath.has(name), false, `finalize must not execute ${name}`);
  }
  assert.ok(finalizePath.has("FP004-04"));
  assert.ok(finalizePath.has(response.name));
  assert.match(finalizeRequest.parameters.jsCode, /action === 'finalize'/);
  assert.match(finalizeRequest.parameters.jsCode, /rpc_request/);
  const finalizePayload = {
    action: "finalize",
    local_operator_id: operator,
    book_id: book,
    correlation_id: "finalize-route",
    idempotency_key: "finalize-route",
    ordered_l1a_ids: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
    design_fingerprint: "a".repeat(64),
    candidate_fingerprint: "b".repeat(64),
  };
  const prepared = executeCode(finalizeRequest, {}, {
    "Require FP004 Sort Context": { request: finalizePayload, context: { design_fingerprint: finalizePayload.design_fingerprint } },
  }).map((item) => item.json);
  assert.deepEqual(JSON.parse(JSON.stringify(prepared.map((item) => item.stage))), ["finalize_lock", "finalize_apply"]);
  assert.ok(prepared.every((item) => item.finalize_passthrough));
  assert.ok(prepared.every((item) => !Object.hasOwn(item.rpc_request, "action") && !Object.hasOwn(item.rpc_request, "candidate_fingerprint")));
});

test("ZH03 sends all five FP004-02 prompts through the configured Chat Completions endpoint", () => {
  const modelNames = [
    "大事纪划分",
    "前提分析",
    "人物弧光分析",
    "FP004-02 执行时间线/故事线/人物线物理排序",
    "5类缺口诊断与补充",
  ];
  for (const name of modelNames) {
    const model = node(finalize, name);
    assert.equal(model.type, "n8n-nodes-base.httpRequest", name);
    assert.equal(model.typeVersion, 4.2, name);
    assert.equal(model.parameters.method, "POST", name);
    assert.equal(model.parameters.authentication, "predefinedCredentialType", name);
    assert.equal(model.parameters.nodeCredentialType, "openAiApi", name);
    assert.match(model.parameters.url, /provider_base_url/u, name);
    assert.match(model.parameters.url, /chat\/completions/u, name);
    assert.match(model.parameters.jsonBody, /runtime_binding\.model_name/u, name);
    assert.match(model.parameters.jsonBody, /runtime_binding\.temperature/u, name);
    assert.match(model.parameters.jsonBody, /messages/u, name);
    assert.doesNotMatch(JSON.stringify(model.parameters), /\/responses/u, name);
    assert.deepEqual(model.credentials, {
      openAiApi: { id: "ktkbgOI2RQI4Y8QK", name: "OpenAI account" },
    }, name);
  }

  for (const validatorName of [
    "JSON修复与排序结构校验1",
    "JSON修复与排序结构校验2",
    "JSON修复与排序结构校验3",
    "JSON修复与排序结构校验",
    "JSON修复与排序结构校验4",
  ]) {
    assert.match(node(finalize, validatorName).parameters.jsCode, /choices\?\.\[0\]\?\.message\?\.content/u, validatorName);
  }
});

test("ZH03 validates only completed predecessors and keeps final reviewed input authoritative", () => {
  const chronology = node(finalize, "JSON修复与排序结构校验1").parameters.jsCode;
  const arc = node(finalize, "JSON修复与排序结构校验3").parameters.jsCode;
  const ordering = node(finalize, "JSON修复与排序结构校验").parameters.jsCode;
  const review = node(finalize, "JSON修复与排序结构校验4").parameters.jsCode;
  assert.match(chronology, /开始三线排序/);
  assert.match(arc, /JSON修复与排序结构校验2/);
  assert.match(ordering, /更新候选数据/);
  assert.match(review, /finalize_passthrough/);
  assert.match(review, /ordered_l1a_ids/);
});

test("ZH03 model expressions reference only nodes already executed upstream", () => {
  const nodeNames = new Set(finalize.nodes.map((item) => item.name));
  const predecessors = new Map(finalize.nodes.map((item) => [item.name, []]));
  for (const [source, connectionTypes] of Object.entries(finalize.connections)) {
    for (const outputs of Object.values(connectionTypes)) {
      for (const branch of outputs) {
        for (const edge of branch) predecessors.get(edge.node)?.push(source);
      }
    }
  }
  const entry = finalize.nodes.find((item) => item.type === "n8n-nodes-base.webhook")?.name;
  assert.ok(entry);
  const dominators = new Map([...nodeNames].map((name) => [
    name,
    name === entry ? new Set([entry]) : new Set(nodeNames),
  ]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const name of nodeNames) {
      if (name === entry) continue;
      const incoming = predecessors.get(name) ?? [];
      const intersection = incoming.length
        ? new Set([...dominators.get(incoming[0])].filter((candidate) => (
            incoming.slice(1).every((predecessor) => dominators.get(predecessor).has(candidate))
          )))
        : new Set();
      intersection.add(name);
      const previous = dominators.get(name);
      if (intersection.size !== previous.size || [...intersection].some((candidate) => !previous.has(candidate))) {
        dominators.set(name, intersection);
        changed = true;
      }
    }
  }

  for (const model of finalize.nodes.filter((item) => item.type === "@n8n/n8n-nodes-langchain.openAi")) {
    const references = [...JSON.stringify(model.parameters).matchAll(/\$\('([^']+)'\)/g)].map((match) => match[1]);
    assert.ok(references.length > 0, model.name);
    for (const reference of new Set(references)) {
      assert.ok(nodeNames.has(reference), `${model.name} references missing node ${reference}`);
      assert.ok(dominators.get(model.name).has(reference), `${model.name} references node not executed on its first path: ${reference}`);
    }
  }
});

test("ZH03 persists the complete sort revision set atomically before it returns success", () => {
  const persistence = node(finalize, "FP004-04 Finalize L1A RPC");
  const query = persistence.parameters.query;
  assert.match(query, /local_operator_id/);
  assert.match(query, /book_id/);
  assert.match(query, /design_fingerprint/);
  assert.match(query, /candidate_revisions/);
  assert.match(query, /candidate_fingerprint/);
  assert.match(query, /v7_replay_product_request/);
  assert.match(query, /v7_request_intent/);
  assert.match(query, /product_request_log/);
  assert.match(query, /set_config/);
  for (const stage of ["sort_lock", "sort_prepare", "sort_shift", "sort_apply", "sort_commit", "finalize_lock", "finalize_apply"]) {
    assert.match(query, new RegExp(stage));
  }
  assert.match(query, /jsonb_array_length/);
  assert.match(query, /count\(DISTINCT/);
  assert.match(query, /plot_emotion_commit\s*=/);
  assert.match(query, /arc_requirement\s*=/);
  assert.match(query, /participant_chars_json\s*=/);
  assert.match(query, /l1a_index\s*=/);
  assert.match(query, /status\s*=\s*'sorted'/);
  assert.match(query, /SORT_WRITE_REJECTED/);
  // A model transport/output failure is already a controlled workflow error;
  // it must short-circuit the transactional sort rather than masquerade as a
  // candidate-write rejection at the final response node.
  assert.match(query, /jsonb_typeof\(n\.payload->'workflow_error'\)\s*=\s*'object'/);
  assert.match(query, /n\.payload #>> '\{workflow_error,code\}'/);
  assert.equal(persistence.parameters.options.queryReplacement, "={{ [JSON.stringify($json)] }}");
  assert.equal(persistence.parameters.options.queryBatching, "transaction");
});

test("ZH03 finalization sends only the reviewed exact order and fingerprints to the RPC", () => {
  const review = node(finalize, "JSON修复与排序结构校验4").parameters.jsCode;
  const batch = node(finalize, "阶段审计 判断排序是否可进入生产").parameters.jsCode;
  assert.match(review, /const {action,candidate_fingerprint,...rpc_request}/);
  assert.match(review, /finalize_passthrough/);
  assert.match(batch, /finalize_lock/);
  assert.match(batch, /finalize_apply/);
  assert.match(review, /if\(base\.finalize_passthrough\)\{const \{action,candidate_fingerprint,\.\.\.rpc_request\}/);
});

test("ZH03 emits the five-step transaction batch after validated sort review", () => {
  const batch = node(finalize, "阶段审计 判断排序是否可进入生产").parameters.jsCode;
  for (const stage of ["sort_lock", "sort_prepare", "sort_shift", "sort_apply", "sort_commit"]) assert.match(batch, new RegExp(stage));
  assert.match(node(finalize, "IF：审计通过？").parameters.conditions.conditions[0].leftValue, /stage/);
});

test("ZH03 VM path preserves reviewed finalization input and returns the terminal transaction result", () => {
  const ids = [
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  ];
  const fingerprint = "a".repeat(64);
  const context = {
    design_fingerprint: fingerprint,
    candidate_fingerprint: "b".repeat(64),
    l1as: ids.map((id) => ({ id })),
    characters: [{ id: character }],
  };
  const sortRequest = {
    action: "sort", local_operator_id: operator, book_id: book,
    correlation_id: "sort-vm-path", idempotency_key: "sort-vm-path",
  };
  const chatOutput = (value) => ({
    choices: [{ message: { role: "assistant", content: JSON.stringify(value) } }],
  });
  const start = { body: sortRequest };
  const chronology = executeCode(node(finalize, "JSON修复与排序结构校验1"), chatOutput({
    timeline: ids.map((l1a_id) => ({ l1a_id, anchor: "anchor", phase: "phase" })),
  }), {
    "开始三线排序": start,
    "读取设计阶段快照1": { response: { ok: true, context } },
  })[0].json;
  const premises = executeCode(node(finalize, "JSON修复与排序结构校验2"), chatOutput({
    dependencies: [],
  }), { "JSON修复与排序结构校验1": chronology })[0].json;
  const arcs = executeCode(node(finalize, "JSON修复与排序结构校验3"), chatOutput({
    character_arcs: [], l0_conflicts: [],
  }), { "JSON修复与排序结构校验1": chronology, "JSON修复与排序结构校验2": premises })[0].json;
  const revisions = ids.map((l1a_id, index) => ({
    l1a_id,
    l1a_index: index + 1,
    plot_emotion_commit: { plot: `plot-${index + 1}` },
    arc_requirement: { direction: "growth" },
    participant_chars_json: [character],
  }));
  const ordering = executeCode(node(finalize, "JSON修复与排序结构校验"), chatOutput({
    ordered_l1a_ids: ids,
    three_lines: { timeline: [], story: [], character: [] },
    candidate_revisions: revisions,
  }), {
    "更新候选数据": { response: arcs },
    "开始三线排序": start,
    "读取设计阶段快照1": { response: { ok: true, context } },
  })[0].json;
  const reviewed = executeCode(node(finalize, "JSON修复与排序结构校验4"), chatOutput({
    step5_gap_analysis: {
      gaps: [{ type: "缺依赖", description: "A required dependency is missing.", suggestion: "插补" }],
      patch_suggestions: ["Insert the missing dependency."],
    },
  }), { "JSON修复与排序结构校验": ordering })[0].json;
  assert.deepEqual(JSON.parse(JSON.stringify(reviewed.sort_result.gaps)), [{
    type: "缺依赖",
    summary: "A required dependency is missing.",
    suggestion: "插补",
  }]);
  const batch = executeCode(node(finalize, "阶段审计 判断排序是否可进入生产"), {}, {
    "JSON修复与排序结构校验4": reviewed,
  }).map((item) => item.json);
  assert.deepEqual(JSON.parse(JSON.stringify(batch.map((item) => item.stage))), ["sort_lock", "sort_prepare", "sort_shift", "sort_apply", "sort_commit"]);

  const response = executeResponse(node(finalize, "FP004-03 三线排序完成"), [
    ...batch.slice(0, -1).map(() => ({ response: null })),
    { response: { ok: true, correlation_id: sortRequest.correlation_id, result: reviewed.sort_result } },
  ], { "开始三线排序": start, "FP004-04": [
    ...batch.slice(0, -1).map(() => ({ response: null })),
    { response: { ok: true, correlation_id: sortRequest.correlation_id, result: reviewed.sort_result } },
  ] });
  assert.equal(response.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(response.result.ordered_l1a_ids)), ids);

  const finalizeRequest = {
    action: "finalize", local_operator_id: operator, book_id: book,
    correlation_id: "finalize-vm-path", idempotency_key: "finalize-vm-path",
    ordered_l1a_ids: ids, design_fingerprint: fingerprint, candidate_fingerprint: "b".repeat(64),
  };
  const finalizeStart = { body: finalizeRequest };
  const finalizeChronology = executeCode(node(finalize, "JSON修复与排序结构校验1"), { output_text: "{}" }, {
    "开始三线排序": finalizeStart,
    "读取设计阶段快照1": { response: { ok: true, context } },
  })[0].json;
  const finalizePremises = executeCode(node(finalize, "JSON修复与排序结构校验2"), {}, {
    "JSON修复与排序结构校验1": finalizeChronology,
  })[0].json;
  const finalizeArcs = executeCode(node(finalize, "JSON修复与排序结构校验3"), {}, {
    "JSON修复与排序结构校验1": finalizeChronology,
    "JSON修复与排序结构校验2": finalizePremises,
  })[0].json;
  const finalizeOrdering = executeCode(node(finalize, "JSON修复与排序结构校验"), {}, {
    "更新候选数据": { response: finalizeArcs },
    "开始三线排序": finalizeStart,
    "读取设计阶段快照1": { response: { ok: true, context } },
  })[0].json;
  const finalizeReviewed = executeCode(node(finalize, "JSON修复与排序结构校验4"), {}, {
    "JSON修复与排序结构校验": finalizeOrdering,
  })[0].json;
  assert.deepEqual(JSON.parse(JSON.stringify(finalizeReviewed.rpc_request)), {
    local_operator_id: operator,
    book_id: book,
    correlation_id: "finalize-vm-path",
    idempotency_key: "finalize-vm-path",
    ordered_l1a_ids: ids,
    design_fingerprint: fingerprint,
  });
  assert.equal("candidate_fingerprint" in finalizeReviewed.rpc_request, false);
  assert.deepEqual(JSON.parse(JSON.stringify(executeCode(node(finalize, "阶段审计 判断排序是否可进入生产"), {}, {
    "JSON修复与排序结构校验4": finalizeReviewed,
  }).map((item) => item.json.stage))), ["finalize_lock", "finalize_apply"]);
});

test("ZH03 maps model short references to the scoped L1A and character identifiers", () => {
  const l1aIds = [
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  ];
  const characterIds = [
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  ];
  const request = {
    action: "sort", local_operator_id: operator, book_id: book,
    correlation_id: "sort-short-reference", idempotency_key: "sort-short-reference",
  };
  const context = {
    design_fingerprint: "a".repeat(64),
    candidate_fingerprint: "b".repeat(64),
    l1as: l1aIds.map((id, index) => ({ id, l1a_name: `L1A ${index + 1}` })),
    characters: characterIds.map((id, index) => ({ id, char_name: `Character ${index + 1}` })),
  };
  const start = { body: request };
  const snapshot = { response: { ok: true, context } };
  const names = {
    start: finalize.nodes.find((item) => item.id === "a0649be5-8d1a-4d64-ae64-068c8441e5b0").name,
    snapshot: node(finalize, "Read FP004 Sort Context").name,
    chronology: node(finalize, "Validate Chronicle Output").name,
    premises: node(finalize, "Validate Premise Output").name,
    arcs: node(finalize, "Validate Arc Output").name,
  };
  const responsesOutput = (value) => ({
    output: [{ content: [{ type: "output_text", text: JSON.stringify(value) }] }],
  });
  const chronology = executeCode(node(finalize, "Validate Chronicle Output"), responsesOutput({
    timeline: [
      { l1a_ref: "L001", anchor: "start", phase: "opening" },
      { l1a_ref: "L002", anchor: "turn", phase: "middle" },
    ],
  }), {
    [names.start]: start,
    [names.snapshot]: snapshot,
  })[0].json;
  assert.deepEqual(JSON.parse(JSON.stringify(chronology.chronology.timeline.map((item) => item.l1a_id))), l1aIds);

  const premises = executeCode(node(finalize, "Validate Premise Output"), responsesOutput({
    dependencies: [{ from_l1a_ref: "L001", to_l1a_ref: "L002", strength: "hard", reason: "cause" }],
  }), {
    [names.chronology]: chronology,
  })[0].json;
  assert.deepEqual(JSON.parse(JSON.stringify(premises.premises.dependencies)), [{
    from_l1a_id: l1aIds[0], to_l1a_id: l1aIds[1], strength: "hard", reason: "cause",
  }]);

  const arcs = executeCode(node(finalize, "Validate Arc Output"), responsesOutput({
    character_arcs: [], l0_conflicts: [],
  }), {
    [names.chronology]: chronology,
    [names.premises]: premises,
  })[0].json;
  const ordering = executeCode(node(finalize, "Validate Complete Ordering"), responsesOutput({
    ordered_l1a_refs: ["L002", "L001"],
    three_lines: { timeline: ["L002", "L001"], story: [], character: ["C002", "C001"] },
    candidate_revisions: [
      {
        l1a_ref: "L002", l1a_index: 1,
        plot_emotion_commit: { focus: "C002" },
        arc_requirement: { lead: "C002" },
        participant_char_refs: ["C002"],
      },
      {
        l1a_ref: "L001", l1a_index: 2,
        plot_emotion_commit: { focus: "C001" },
        arc_requirement: { lead: "C001" },
        participant_char_refs: ["C001"],
      },
    ],
  }), {
    [finalize.nodes.find((item) => item.id === "37e2198f-21aa-4545-8182-074b8318a8db").name]: { response: arcs },
    [names.start]: start,
    [names.snapshot]: snapshot,
  })[0].json;
  assert.deepEqual(JSON.parse(JSON.stringify(ordering.ordering.ordered_l1a_ids)), [l1aIds[1], l1aIds[0]]);
  assert.deepEqual(JSON.parse(JSON.stringify(ordering.ordering.candidate_revisions.map((item) => item.participant_chars_json))), [[characterIds[1]], [characterIds[0]]]);
  assert.equal(ordering.ordering.candidate_revisions[0].arc_requirement.lead, characterIds[1]);
  assert.deepEqual(JSON.parse(JSON.stringify(ordering.ordering.three_lines.character)), characterIds.slice().reverse());

  const unknown = executeCode(node(finalize, "Validate Premise Output"), responsesOutput({
    dependencies: [{ from_l1a_ref: "L099", to_l1a_ref: "L002", strength: "hard", reason: "unknown" }],
  }), {
    [names.chronology]: chronology,
  })[0].json;
  assert.equal(unknown.workflow_error.code, "SORT_OUTPUT_INVALID");
});

test("ZH03 n8n regular-output failures reach a controlled webhook response", (t) => {
  let runtimeSource;
  try {
    runtimeSource = dockerLong([
      "exec", "n8n-server", "sh", "-lc",
      "file=$(find /usr/local/lib/node_modules/n8n/node_modules/.pnpm -path '*n8n-core*/node_modules/n8n-core/dist/execution-engine/workflow-execute.js' | head -1); test -n \"$file\"; cat \"$file\"",
    ]);
  } catch (error) {
    if (!isDockerUnavailable(error)) throw error;
    return t.skip(runtimeUnavailableMessage(error, "n8n"));
  }
  assert.match(runtimeSource, /\['continueRegularOutput', 'continueErrorOutput'\]\.includes/);
  assert.match(runtimeSource, /onError === 'continueErrorOutput'[\s\S]*?handleNodeErrorOutput/);

  const guarded = finalize.nodes.filter((item) => item.onError);
  assert.equal(guarded.length, 15);
  for (const item of guarded) {
    assert.equal(item.onError, "continueRegularOutput", item.name);
    const outputs = finalize.connections[item.name]?.main || [];
    assert.equal(outputs[1]?.length || 0, 0, `${item.name} must not require an unconnected error output`);
  }

  const responder = node(finalize, "FP004-03 三线排序完成");
  assert.doesNotMatch(responder.parameters.responseBody, /\.prototype\b/);
  assert.match(responder.parameters.responseBody, /value\.ok === true \|\| value\.ok === false/);

  const ids = ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"];
  const request = {
    action: "sort", local_operator_id: operator, book_id: book,
    correlation_id: "sort-failure-path", idempotency_key: "sort-failure-path",
  };
  const start = { body: request };
  const context = {
    design_fingerprint: "a".repeat(64),
    candidate_fingerprint: "b".repeat(64),
    l1as: ids.map((id) => ({ id })),
    characters: [{ id: character }],
  };
  const snapshot = { response: { ok: true, context } };
  const continueFromChronicle = (input) => {
    const chronology = executeCode(node(finalize, "JSON修复与排序结构校验1"), input, {
      "开始三线排序": start,
      "读取设计阶段快照1": snapshot,
    })[0].json;
    const premises = executeCode(node(finalize, "JSON修复与排序结构校验2"), {}, {
      "JSON修复与排序结构校验1": chronology,
    })[0].json;
    const arcs = executeCode(node(finalize, "JSON修复与排序结构校验3"), {}, {
      "JSON修复与排序结构校验1": chronology,
      "JSON修复与排序结构校验2": premises,
    })[0].json;
    return executeCode(node(finalize, "JSON修复与排序结构校验"), {}, {
      "更新候选数据": { response: arcs },
      "开始三线排序": start,
      "读取设计阶段快照1": snapshot,
    })[0].json;
  };
  const toBatch = (ordering) => {
    const reviewed = executeCode(node(finalize, "JSON修复与排序结构校验4"), {}, {
      "JSON修复与排序结构校验": ordering,
    })[0].json;
    return executeCode(node(finalize, "阶段审计 判断排序是否可进入生产"), {}, {
      "JSON修复与排序结构校验4": reviewed,
      "开始三线排序": start,
      "读取设计阶段快照1": snapshot,
    }).map((item) => item.json);
  };

  const modelFailure = toBatch(continueFromChronicle({ error: { message: "model transport failed" } }));
  const jsonFailure = toBatch(continueFromChronicle({ output_text: "not-json" }));
  const pgOrdering = executeCode(node(finalize, "JSON修复与排序结构校验"), {}, {
    "更新候选数据": { error: { message: "postgres failed" } },
    "开始三线排序": start,
    "读取设计阶段快照1": snapshot,
  })[0].json;
  const pgFailure = toBatch(pgOrdering);
  for (const [kind, batch] of [["model", modelFailure], ["json", jsonFailure], ["postgres", pgFailure]]) {
    assert.deepEqual(JSON.parse(JSON.stringify(batch.map((item) => item.stage))), ["sort_lock", "sort_prepare", "sort_shift", "sort_apply", "sort_commit"], kind);
    assert.ok(batch.every((item) => item.workflow_error), kind);
    assert.deepEqual(JSON.parse(JSON.stringify(batch[0].sort_result.candidate_revisions)), [], kind);
  }
  assert.equal(modelFailure[0].workflow_error.code, "SORT_FAILED");
  assert.equal(jsonFailure[0].workflow_error.code, "SORT_OUTPUT_INVALID");
  assert.equal(pgFailure[0].workflow_error.code, "SORT_FAILED");

  const repaired = executeCode(node(finalize, "JSON修复"), [{ stage: "sort_lock" }, { stage: "sort_prepare" }]);
  assert.deepEqual(JSON.parse(JSON.stringify(repaired.map((item) => item.json.stage))), ["sort_lock", "sort_prepare"]);

  const finalPgError = [{ error: { message: "connection unavailable" } }];
  const response = executeResponse(responder, finalPgError, {
    "开始三线排序": start,
    "FP004-04": finalPgError,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(response)), {
    ok: false,
    correlation_id: request.correlation_id,
    redacted_error: {
      code: "SORT_WRITE_REJECTED",
      message: "The complete sorted L1A revision set could not be saved.",
    },
  });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const workflow = JSON.parse(readFileSync(path.join(root, "docs/后端/n8n/ZH04-生产拆解.json"), "utf8"));
const promptMaterial = readFileSync(path.join(root, "docs/后端/对齐版提示词.md"), "utf8");
const node = (id) => workflow.nodes.find((candidate) => candidate.id === id);
const expressionValue = (template, json) => {
  const expression = template.replace(/^=\{\{\s*/, "").replace(/\s*\}\}$/, "");
  return runInNewContext(`(${expression})`, { $json: json });
};
const compileExpression = (template) => {
  const expression = template.replace(/^=\{\{\s*/, "").replace(/\s*\}\}$/, "");
  return new Function("$json", "$", `return (${expression});`);
};
const executeCode = (source, sandbox) => runInNewContext(`(() => { ${source} })()`, sandbox);
const promptSection = (start, end) => promptMaterial.slice(
  promptMaterial.indexOf(`### ${start}`),
  promptMaterial.indexOf(`### ${end}`, promptMaterial.indexOf(`### ${start}`)),
);

const ids = Object.freeze({
  webhook: "868b6b62-496b-4bb8-b9b5-eccf23301d93",
  context: "e2b252ed-31f0-43e0-91fd-71c0835e99a0",
  actionRoute: "13c6301c-7613-4586-8778-e56bb6aed03f",
  approvalRoute: "a5b0c1df-ca67-4ac8-a7b0-685aebcd2b67",
  materialization: "d02111c6-3ef5-4bf5-b8ce-2bdc5bece554",
  firstExecution: "eb626387-b909-4254-ab59-5932bba7448c",
  materializationFix: "f6c75e19-e537-4e6c-aca3-56ba2124df15",
  presentationFix: "273ce2a9-3a92-48f5-9c64-91bfe5d3a0f9",
  mapper: "4e8ee2ce-e8cc-413a-9449-e85ad7e26370",
  autoMapper: "0ddbed79-5690-4b66-b2b0-01498470f06a",
  persistence: "57c4276f-f164-47f5-b1b9-023de84d512f",
  response: "94840c52-69dd-4ffe-9192-ab524ee9c880",
  wait: "c2976bd1-8251-4368-9aed-0675a83e8b31",
});

const sceneConditionPackage = {
  scene_location: "The documented threshold",
  participant_chars: ["lead"],
  rule_locks: [],
  scene_affordance: [
    { item_code: "resource.initial", available: true, functional: true, functions: ["CF-01"] },
    { item_code: "resource.secondary", available: true, functional: true, functions: ["CF-05"] },
  ],
  available_resource_codes: ["resource.initial", "resource.secondary"],
  info_reveal_candidates: [],
  chain_reaction_candidates: [],
  scene_constraints: [],
  forbid_lines_active: [],
  materialize_notes: [],
};

const fp005ProviderResponses = JSON.parse(readFileSync(path.join(
  root,
  "tests/fixtures/production-stage/fp005-provider-responses.fixture.json",
), "utf8"));

const fp005Context = () => ({
  scope_ok: true,
  scope: {
    local_operator_id: "11111111-1111-4111-8111-111111111111",
    book_id: "22222222-2222-4222-8222-222222222222",
    l1a_id: "33333333-3333-4333-8333-4333-333333333333",
  },
  l1a_unit: {
    scene_location: sceneConditionPackage.scene_location,
    participant_chars_json: sceneConditionPackage.participant_chars,
  },
  data_debt: [],
});

const completionText = (content, statusCode = 200) => ({
  statusCode,
  data: JSON.stringify({ choices: [{ message: { content } }] }),
});
const completionResponse = (dto, statusCode = 200) => completionText(JSON.stringify(dto), statusCode);

const runFp005Repair = (response, context = fp005Context()) => executeCode(
  node(ids.materializationFix)?.parameters.jsCode ?? "",
  {
    $: () => ({ first: () => ({ json: { context } }) }),
    $json: response,
  },
)[0].json;

test("FP006 and FP007 consume the current D-002 commitment fields", () => {
  const fp006 = promptSection("FP006-01", "FP007-01");
  const fp007 = promptSection("FP007-01", "FP008-01");
  for (const section of [fp006, fp007]) {
    assert.match(section, /plot_emotion_commit/u);
    assert.match(section, /conflict_background/u);
    assert.match(section, /escalation_path/u);
    assert.match(section, /irreversible_consequence/u);
    assert.match(section, /mid_goals/u);
    assert.doesNotMatch(section, /emotion_promise_json|qingxu_json|plot_promise_json|mid_goal_json|pudianl_json|\bhouguo\b|\bshengji\b/u);
  }
  assert.match(fp007, /输出前对每一章强制执行颗粒映射自检/u);
  assert.match(fp007, /后者的集合与数量必须等于前者去除 deferred 后的集合与数量/u);
  assert.match(fp007, /deferred 编号不属于 particles 或 deferred 编号出现在 core/u);
});

test("ZH04 keeps its nodes while using the approved read, generate, approve, and return path", () => {
  assert.equal(workflow.nodes.length, 19);
  assert.equal(workflow.active, false);

  const webhook = node(ids.webhook);
  assert.equal(webhook?.parameters.httpMethod, "POST");
  assert.equal(webhook?.parameters.responseMode, "responseNode");
  assert.equal(webhook?.parameters.options.allowedOrigins, "*");

  const context = node(ids.context);
  assert.equal(context?.parameters.operation, "executeQuery");
  assert.match(context?.parameters.query ?? "", /v_world_assets_for_exec/);
  assert.match(context?.parameters.query ?? "", /v_character_active/);
  assert.match(context?.parameters.query ?? "", /rpc_get_effective_skills/);
  assert.match(context?.parameters.query ?? "", /requested_l1a_id/);
  assert.match(context?.parameters.query ?? "", /public\.rpc_select_l1a_for_production/);
  assert.match(context?.parameters.query ?? "", /available_l1as/);
  assert.match(context?.parameters.query ?? "", /'item_code', ws\.atom_key/);
  assert.doesNotMatch(context?.parameters.query ?? "", /\b(?:INSERT|UPDATE|DELETE|MERGE)\b/i);

  const actionRoute = node(ids.actionRoute);
  assert.match(actionRoute?.parameters.conditions?.conditions?.[0]?.leftValue ?? "", /request\.action/);
  assert.equal(actionRoute?.parameters.conditions?.conditions?.[0]?.rightValue, "generate");
  const approvalRoute = node(ids.approvalRoute);
  assert.match(approvalRoute?.parameters.conditions?.conditions?.[0]?.leftValue ?? "", /request\.action/);
  assert.equal(approvalRoute?.parameters.conditions?.conditions?.[0]?.rightValue, "approve");

  const materialization = node(ids.materialization);
  assert.equal(materialization?.retryOnFail, true);
  assert.equal(materialization?.maxTries, 3);
  assert.equal(materialization?.waitBetweenTries, 5000);

  const presentation = node("73c95996-64b3-4bb6-8c5b-119d80c55732");
  // Preserve provider failures for the existing fail-closed repair node.
  assert.equal(presentation?.retryOnFail, true);
  assert.equal(presentation?.maxTries, 3);
  assert.equal(presentation?.waitBetweenTries, 5000);
  assert.equal(presentation?.parameters.options?.timeout, 240000);
  assert.equal(presentation?.parameters.options?.response?.response?.fullResponse, true);
  assert.equal(presentation?.parameters.options?.response?.response?.neverError, true);
  assert.equal(presentation?.onError, "stopWorkflow");

  for (const modelId of [ids.firstExecution, "14cd7dda-b21d-437c-ad70-95f8c7340580"]) {
    const chapterPlanModel = node(modelId);
    assert.equal(chapterPlanModel?.retryOnFail, true);
    assert.equal(chapterPlanModel?.maxTries, 3);
    assert.equal(chapterPlanModel?.waitBetweenTries, 5000);
  }

  const persistence = node(ids.persistence);
  assert.match(persistence?.parameters.query ?? "", /rpc_persist_chapter_execution_plan/);
  assert.match(persistence?.parameters.query ?? "", /CASE WHEN \$1::boolean THEN public\.rpc_persist_chapter_execution_plan\(\$2::jsonb\)/);
  assert.match(persistence?.parameters.options.queryReplacement ?? "", /Boolean\(\$json\.mapping_ok\)/);
  assert.doesNotMatch(persistence?.parameters.query ?? "", /PLAN_INCOMPLETE/);

  const response = node(ids.response);
  assert.match(response?.parameters.responseBody ?? "", /l1a_presentation_plan/);
  assert.match(response?.parameters.responseBody ?? "", /scene_condition_package/);
  assert.match(response?.parameters.responseBody ?? "", /request\.action === 'read'/);
  assert.match(response?.parameters.responseBody ?? "", /available_l1as/);
  assert.match(response?.parameters.responseBody ?? "", /return/);
  assert.equal(node(ids.wait)?.disabled, true);
  assert.doesNotMatch(JSON.stringify(workflow.connections), /FP006-02/);
});

test("ZH04 loader accepts the documented page approval envelope without widening scope ownership", () => {
  const query = node(ids.context)?.parameters.query ?? "";
  const scope = {
    local_operator_id: "11111111-1111-4111-8111-111111111111",
    book_id: "22222222-2222-4222-8222-222222222222",
    l1a_id: "33333333-3333-4333-8333-333333333333",
  };
  const normalizeRequestedL1a = (request) => {
    const value = request.l1a_id ?? request.scope?.l1a_id;
    return typeof value === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value)
      ? value.toLowerCase()
      : null;
  };

  const pageApproval = {
    action: "approve",
    local_operator_id: scope.local_operator_id,
    book_id: scope.book_id,
    scope,
  };
  assert.equal(normalizeRequestedL1a(pageApproval), scope.l1a_id);
  assert.equal(normalizeRequestedL1a({ ...pageApproval, scope: { ...scope, l1a_id: "not-a-uuid" } }), null);
  assert.equal(normalizeRequestedL1a({ ...pageApproval, l1a_id: "not-a-uuid" }), null,
    "an invalid top-level l1a_id must not be silently replaced by the nested value");
  assert.equal(normalizeRequestedL1a({ action: "generate", ...scope }), scope.l1a_id,
    "the existing top-level generate input remains valid");

  assert.match(query, /COALESCE\(request->>'l1a_id', request #>> '\{scope,l1a_id\}'\)/);
  assert.match(query, /CASE WHEN COALESCE\(request->>'l1a_id', request #>> '\{scope,l1a_id\}'\) ~\*/);
  assert.doesNotMatch(query, /request #>> '\{scope,local_operator_id\}'/);
  assert.doesNotMatch(query, /request #>> '\{scope,book_id\}'/);
});

test("ZH04 calls the configured provider through its reachable chat-completions contract", () => {
  const modelIds = [
    ids.materialization,
    "73c95996-64b3-4bb6-8c5b-119d80c55732",
    ids.firstExecution,
    "14cd7dda-b21d-437c-ad70-95f8c7340580",
  ];

  for (const modelId of modelIds) {
    const modelNode = node(modelId);
    assert.equal(modelNode?.type, "n8n-nodes-base.httpRequest", modelNode?.name);
    assert.equal(modelNode?.typeVersion, 4.2, modelNode?.name);
    assert.equal(modelNode?.parameters.method, "POST", modelNode?.name);
    assert.equal(modelNode?.parameters.authentication, "predefinedCredentialType", modelNode?.name);
    assert.equal(modelNode?.parameters.nodeCredentialType, "openAiApi", modelNode?.name);
    assert.match(modelNode?.parameters.url ?? "", /chat\\\/completions/, modelNode?.name);
    assert.match(modelNode?.parameters.jsonBody ?? "", /messages/, modelNode?.name);
    assert.match(modelNode?.parameters.jsonBody ?? "", /model_name/, modelNode?.name);
    assert.match(modelNode?.parameters.jsonBody ?? "", /prompt_text/, modelNode?.name);
    assert.match(modelNode?.parameters.jsonBody ?? "", /temperature/, modelNode?.name);
    assert.equal(modelNode?.parameters.responses, undefined, modelNode?.name);
    assert.doesNotThrow(() => compileExpression(modelNode?.parameters.url ?? ""), `${modelNode?.name} URL expression`);
    assert.doesNotThrow(() => compileExpression(modelNode?.parameters.jsonBody ?? ""), `${modelNode?.name} JSON body expression`);
  }

  for (const parserId of [ids.materializationFix, ids.presentationFix, ids.mapper, ids.autoMapper]) {
    assert.match(node(parserId)?.parameters.jsCode ?? "", /choices\?\.\[0\]\?\.message\?\.content/, node(parserId)?.name);
  }
  for (const parserId of [ids.materializationFix, ids.presentationFix]) {
    const parser = node(parserId)?.parameters.jsCode ?? "";
    assert.match(parser, /statusCode/);
    assert.match(parser, /JSON\.parse/);
    assert.match(parser, /choices\?\.\[0\]\?\.message\?\.content/);
  }
});

test("ZH04 strict approval repair reads its active binding from the scoped context", () => {
  const repair = node("14cd7dda-b21d-437c-ad70-95f8c7340580");
  assert.doesNotMatch(repair?.parameters.url ?? "", /FIX1: JSON修复2/);
  assert.match(repair?.parameters.url ?? "", /根据编号读取数据/);
  assert.match(repair?.parameters.url ?? "", /context\.runtime_bindings/);
});

test("ZH04 strict approval repair keeps the FP007 request within the scoped input boundary", () => {
  const repair = node("14cd7dda-b21d-437c-ad70-95f8c7340580");
  const bodyExpression = repair?.parameters.jsonBody ?? "";
  assert.match(bodyExpression, /const skillCategories = \['章节展开', '题材组合'\]/u);
  assert.match(bodyExpression, /const presentation = \{ l1a_presentation_plan, scene_condition_package \}/u);
  assert.match(bodyExpression, /const decision = \{ l1a_presentation_plan, scene_condition_package \}/u);
  assert.doesNotMatch(bodyExpression, /const decision = \$json\.body \|\| \$json/u);
  assert.doesNotMatch(bodyExpression, /runtime_bindings\s*:\s*context\.runtime_bindings/u);
  assert.doesNotMatch(bodyExpression, /world_state\s*:/u);

  const binding = {
    model_name: "configured-model",
    provider_base_url: "https://provider.example/v1",
    prompt_text: "FP007 prompt",
    api_key_ref: "credential-ref",
    temperature: 0.2,
  };
  const scopedContext = {
    scope_ok: true,
    scope: { local_operator_id: "11111111-1111-4111-8111-111111111111", book_id: "22222222-2222-4222-8222-222222222222", l1a_id: "33333333-3333-4333-8333-333333333333" },
    request: { l1a_presentation_plan: { chapter_division: [{ chapter_seq: 1 }] }, scene_condition_package: { scene_location: "scene", available_resource_codes: [] } },
    l1a_unit: { l1a_id: "33333333-3333-4333-8333-333333333333" },
    characters: [{ character_id: "character", knowledge_boundary_json: {} }],
    skills: [
      { skill_id: "chapter-skill", skill_category: "章节展开", payload: "x".repeat(2_000) },
      { skill_id: "combo-skill", skill_category: "题材组合" },
      { skill_id: "camera-skill", skill_category: "镜头语言", payload: "y".repeat(200_000) },
    ],
    world_state: [{ payload: "z".repeat(200_000) }],
    runtime_bindings: { "FP007-01": binding, unrelated: { prompt_text: "q".repeat(200_000) } },
  };
  const expression = bodyExpression.replace(/^=\{\{\s*/, "").replace(/\s*\}\}$/, "");
  const lookup = (name) => ({ first: () => ({ json: name === "根据编号读取数据" ? { context: scopedContext } : {} }) });
  const requestBody = JSON.parse(new Function("$", "$json", `return (${expression});`)(lookup, { context: scopedContext }));
  assert.ok(requestBody.messages[0].content.length < 128_000, "repair input must fit the configured free-model context");
  assert.doesNotMatch(requestBody.messages[0].content, /camera-skill|world_state|unrelated/u);
});

test("FP007 model prompts declare the V7 forbid-content and dialogue closures", () => {
  for (const id of [ids.firstExecution, "14cd7dda-b21d-437c-ad70-95f8c7340580"]) {
    const body = node(id)?.parameters.jsonBody ?? "";
    assert.match(body, /Forbid-content closure:/u);
    assert.match(body, /forbid_content.*exactly \[\]/u);
    assert.match(body, /forbid_lines_active/u);
    assert.match(body, /must_not_reveal/u);
    assert.match(body, /D-01.*D-02.*D-03/u);
    assert.match(body, /dialogue_coverage/u);
    assert.match(body, /DIALOGUE CLOSURE/u);
    assert.match(body, /D-01.*D-02.*D-03/u);
  }
});

test("FP007 projects effective skills to their V7 execution fields before both model calls", () => {
  const binding = {
    model_name: "configured-model",
    provider_base_url: "https://provider.example/v1",
    prompt_text: "FP007 prompt",
    api_key_ref: "credential-ref",
    temperature: 0.2,
  };
  const executionFields = [
    "skill_id", "version", "source_type", "skill_category", "skill_name",
    "skill_description", "combo_logic", "fun_source", "arc_structure",
    "applicable_scene", "constraint_fields",
  ].sort();
  const skills = [
    {
      skill_id: "chapter-skill", version: 3, source_type: "system_builtin", skill_category: "章节展开",
      skill_name: "Chapter expansion", skill_description: "Keep the tension moving.",
      combo_logic: { beat: "turn" }, fun_source: "reversal", arc_structure: { nodes: ["start", "turn"] },
      applicable_scene: ["conflict"], constraint_fields: ["pov"],
      raw_source: "chapter-raw-source-".repeat(10_000),
      skill_config_jsonb: { raw_source: "nested-raw-source-".repeat(10_000) },
      lifecycle_status: "active", preference_status: "enabled", skill_version_id: "version-id",
      stable_slug: "chapter", template_fields: { internal: "x".repeat(10_000) },
    },
    {
      skill_id: "combo-skill", version: 2, source_type: "system_builtin", skill_category: "题材组合",
      skill_name: "Genre combo", skill_description: "Match genre expectations.",
      combo_logic: "science-fiction suspense", fun_source: "risk", arc_structure: { nodes: ["threat"] },
      applicable_scene: ["reveal"], constraint_fields: ["world"],
      raw_source: "combo-raw-source-".repeat(10_000),
      skill_config_jsonb: { raw_source: "combo-nested-raw-source-".repeat(10_000) },
      owner_local_operator_id: "operator", genre_main: "科幻", skill_tags_jsonb: ["internal"],
    },
    { skill_id: "camera-skill", skill_category: "镜头语言", raw_source: "camera-raw-source-".repeat(10_000) },
  ];
  const context = {
    runtime_bindings: { "FP007-01": binding, unrelated: { prompt_text: "x".repeat(100_000) } },
    request: {
      l1a_presentation_plan: { chapter_division: [{ chapter_seq: 1 }] },
      scene_condition_package: { scene_location: "scene", available_resource_codes: [] },
    },
    l1a_unit: { l1a_id: "l1a", plot_emotion_commit: { goal: "goal" } },
    characters: [{ character_id: "character", knowledge_boundary_json: {} }],
    skills,
    world_state: [{ payload: "z".repeat(100_000) }],
  };
  const lookup = (name) => ({ first: () => ({ json: name === "根据编号读取数据" ? { context } : {} }) });

  for (const modelId of [ids.firstExecution, "14cd7dda-b21d-437c-ad70-95f8c7340580"]) {
    const bodyExpression = node(modelId)?.parameters.jsonBody ?? "";
    assert.match(bodyExpression, /const projectSkill = \(skill\) => \(\{/);
    assert.match(bodyExpression, /\.filter\(\(skill\) => skill && skillCategories\.includes\(skill\.skill_category\)\)\.map\(projectSkill\)/);
    const expression = bodyExpression.replace(/^=\{\{\s*/, "").replace(/\s*\}\}$/, "");
    const payload = JSON.parse(new Function("$", "$json", `return (${expression});`)(lookup, { context }));
    const content = payload.messages[0].content;
    const inputText = modelId === ids.firstExecution
      ? content.split("\nINPUT=")[1].split("\nSTRUCTURAL OUTPUT RULES:")[0]
      : content.split("\nINPUT=")[1];
    const input = JSON.parse(inputText);
    assert.deepEqual(input.skills.map((skill) => skill.skill_id), ["chapter-skill", "combo-skill"]);
    assert.deepEqual(Object.keys(input.skills[0]).sort(), executionFields);
    assert.deepEqual(Object.keys(input.skills[1]).sort(), executionFields);
    assert.equal(input.skills[0].version, 3);
    assert.equal(input.skills[0].source_type, "system_builtin");
    assert.deepEqual(input.skills[0].arc_structure, { nodes: ["start", "turn"] });
    assert.equal(input.skills[1].combo_logic, "science-fiction suspense");
    assert.doesNotMatch(content, /raw-source|skill_config_jsonb|lifecycle_status|preference_status|template_fields|owner_local_operator_id|skill_tags_jsonb|world_state|unrelated/u);
    assert.ok(content.length < 20_000, `${node(modelId)?.name} must exclude effective-skill governance payloads`);
  }
});

test("ZH04 consumes the FP007 provider JSON body through the normal production path", () => {
  const fp007 = node(ids.firstExecution);

  assert.deepEqual(fp007?.parameters.options, {});
  const mapper = node(ids.mapper)?.parameters.jsCode ?? "";
  assert.match(mapper, /providerResponse = \$input\.item\.json\.data \?\? \$input\.item\.json\.body \?\? \$input\.item\.json/);
  assert.match(mapper, /(?:JSON\.parse\(providerResponse\)|parseSingleJson\(providerResponse\))/);
  assert.match(mapper, /providerResponse\.choices\?\.\[0\]\?\.message\?\.content/);
});

test("FP006 sends one V7-scoped presentation input and no unrelated bindings", () => {
  const fp006 = node("73c95996-64b3-4bb6-8c5b-119d80c55732");
  const binding = {
    node_code: "FP006-01", model_config_id: "model", model_config_version: 3,
    prompt_config_id: "prompt", prompt_version: 2, template_type: "simple_logic",
    model_name: "configured-model", provider_base_url: "https://provider.example/v1",
    prompt_text: "FP006 prompt", api_key_ref: "credential-ref", temperature: 0.2,
  };
  const payload = JSON.parse(compileExpression(fp006.parameters.jsonBody)({
    context: {
      book: { book_id: "book", title: "Book", genre_main: "科幻", intent_json: { premise: "x" }, forbid_json: { huge: "x".repeat(200_000) } },
      scope: { local_operator_id: "operator", book_id: "book", l1a_id: "l1a" },
      l1a_unit: { l1a_id: "l1a", plot_emotion_commit: { goal: "goal" } },
      runtime_bindings: { "FP006-01": binding, "FP005-01": { prompt_text: "x".repeat(200_000) }, "FP007-01": { prompt_text: "x".repeat(200_000) } },
      characters: [
        { character_id: "lead", char_name: "Lead", five_layers_json: {}, knowledge_boundary_json: {} },
        { character_id: "other", char_name: "Other", five_layers_json: {}, knowledge_boundary_json: {}, irrelevant: "x".repeat(200_000) },
      ],
      skills: [
        { skill_id: "arc", version: 1, source_type: "system_builtin", skill_category: "章节展开", arc_structure: { steps: [] } },
        { skill_id: "combo", version: 1, source_type: "system_builtin", skill_category: "题材组合", combo_logic: "logic", fun_source: "fun" },
        { skill_id: "camera", skill_category: "镜头语言", payload: "x".repeat(200_000) },
      ],
    },
    scene_condition_package: { ...sceneConditionPackage, participant_chars: ["lead"] },
    unrelated: { payload: "x".repeat(200_000) },
  }));
  const input = JSON.parse(payload.messages[0].content.split("\nINPUT=")[1]);
  assert.equal(input.book.forbid_json, undefined);
  assert.deepEqual(input.characters.map((character) => character.character_id), ["lead"]);
  assert.deepEqual(input.skills.map((skill) => skill.skill_id), ["arc", "combo"]);
  assert.deepEqual(Object.keys(input.runtime_binding).sort(), ["model_config_id", "model_config_version", "node_code", "prompt_config_id", "prompt_version", "temperature", "template_type"]);
  assert.equal(input.runtime_bindings, undefined);
  assert.ok(payload.messages[0].content.length < 20_000);
});

test("FP005 sends only the V7 materialization input and fails closed on transport errors", () => {
  const fp005 = node(ids.materialization);
  const binding = {
    node_code: "FP005-01", model_config_id: "model", model_config_version: 3,
    prompt_config_id: "prompt", prompt_version: 2, template_type: "simple_logic",
    model_name: "configured-model", provider_base_url: "https://provider.example/v1",
    prompt_text: "FP005 prompt", api_key_ref: "credential-ref", temperature: 0.2,
  };
  const payload = JSON.parse(compileExpression(fp005.parameters.jsonBody)({
    context: {
      book: { book_id: "book", title: "Book", genre_main: "科幻", intent_json: { premise: "x" }, forbid_json: { huge: "x".repeat(200_000) } },
      scope: { local_operator_id: "operator", book_id: "book", l1a_id: "l1a" },
      l1a_unit: { l1a_id: "l1a", scene_location: "scene", participant_chars_json: ["lead"] },
      runtime_bindings: { "FP005-01": binding, "FP006-01": { prompt_text: "x".repeat(200_000) }, "FP007-01": { prompt_text: "x".repeat(200_000) } },
      world_state: [{ world_id: "world", board_type: "resource", atom_type: "resource", atom_key: "tool", item_code: "tool", atom_value_jsonb: {}, unrelated: "x".repeat(200_000) }],
      characters: [{ character_id: "lead", char_name: "Lead", knowledge_boundary_json: {}, irrelevant: "x".repeat(200_000) }],
      skills: [{ skill_id: "unrelated", payload: "x".repeat(200_000) }],
    },
  }));
  const input = JSON.parse(payload.messages[0].content.split("\nINPUT=")[1]);
  assert.equal(input.book.forbid_json, undefined);
  assert.equal(input.skills, undefined);
  assert.equal(input.runtime_bindings, undefined);
  assert.deepEqual(Object.keys(input.runtime_binding).sort(), ["model_config_id", "model_config_version", "node_code", "prompt_config_id", "prompt_version", "temperature", "template_type"]);
  assert.equal(input.world_state[0].unrelated, undefined);
  assert.equal(input.characters[0].irrelevant, undefined);
  assert.ok(payload.messages[0].content.length < 20_000);
  assert.equal(fp005.onError, "stopWorkflow");
  assert.equal(fp005.parameters.options.timeout, 240000);
  assert.equal(fp005.parameters.options.response.response.fullResponse, true);
  assert.equal(fp005.parameters.options.response.response.neverError, true);
});

test("FP006 failure cannot be converted to an empty successful item", () => {
  const fp006 = node("73c95996-64b3-4bb6-8c5b-119d80c55732");
  assert.equal(fp006.onError, "stopWorkflow");
  assert.equal(fp006.parameters.options.response.response.fullResponse, true);
  assert.equal(fp006.parameters.options.response.response.neverError, true);
});

test("FP007 sends one V7-scoped decision input without unrelated runtime payloads", () => {
  const fp007 = node(ids.firstExecution);
  const binding = {
    model_name: "configured-model",
    provider_base_url: "https://provider.example/v1",
    prompt_text: "FP007 prompt",
    api_key_ref: "credential-ref",
    temperature: 0.2,
  };
  const payload = JSON.parse(compileExpression(fp007.parameters.jsonBody)({
    context: {
      runtime_bindings: {
        "FP007-01": binding,
        unrelated: { prompt_text: "x".repeat(200_000) },
      },
      request: {
        l1a_presentation_plan: { chapter_division: [{ chapter_seq: 1 }] },
        scene_condition_package: { scene_location: "scene", available_resource_codes: [] },
      },
      l1a_unit: { l1a_id: "l1a", plot_emotion_commit: { goal: "goal" } },
      characters: [{ character_id: "character", knowledge_boundary_json: {} }],
      skills: [
        { skill_id: "chapter-skill", skill_category: "章节展开" },
        { skill_id: "combo-skill", skill_category: "题材组合" },
        { skill_id: "camera-skill", skill_category: "镜头语言", payload: "y".repeat(200_000) },
      ],
      world_state: [{ payload: "z".repeat(200_000) }],
      available_l1as: [{ payload: "q".repeat(200_000) }],
    },
  }));

  const content = payload.messages[0].content;
  const inputText = content.split("\nINPUT=")[1].split("\nSTRUCTURAL OUTPUT RULES:")[0];
  const input = JSON.parse(inputText);
  assert.deepEqual(input.decision.l1a_presentation_plan.chapter_division, [{ chapter_seq: 1 }]);
  assert.equal(input.decision.scene_condition_package.scene_location, "scene");
  assert.equal(input.l1a_unit.l1a_id, "l1a");
  assert.equal(input.characters.length, 1);
  assert.deepEqual(input.skills.map((skill) => skill.skill_id), ["chapter-skill", "combo-skill"]);
  assert.equal(input.runtime_bindings, undefined);
  assert.equal(input.world_state, undefined);
  assert.equal(input.available_l1as, undefined);
  assert.ok(content.length < 20_000, "unrelated large fields must not inflate the FP007 request");
});

test("ZH04 returns the locked-L1A selection projection without entering a model branch", () => {
  const response = node(ids.response);
  const projection = {
    context: {
      request: { action: "read", correlation_id: "read-1" },
      book: { book_id: "22222222-2222-4222-8222-222222222222", title: "Book", current_l1a_id: null },
      available_l1as: [{ l1a_id: "33333333-3333-4333-8333-333333333333", l1a_index: 1, l1a_name: "L1A", status: "finalized", is_formal: true, is_locked: true }],
    },
  };
  const body = expressionValue(response.parameters.responseBody, projection);
  assert.equal(body.ok, true);
  assert.equal(body.result.l1as.length, 1);
  assert.equal(expressionValue(response.parameters.options.responseCode, projection), 200);
});

test("ZH04 returns FP005 data debt without replacing it with a generic request error", () => {
  const response = node(ids.response);
  const blocked = {
    context: {
      request: { action: "generate", correlation_id: "generate-data-debt" },
      scope: {
        local_operator_id: "11111111-1111-4111-8111-111111111111",
        book_id: "22222222-2222-4222-8222-222222222222",
        l1a_id: "33333333-3333-4333-8333-333333333333",
      },
    },
    materialization_ready: false,
    l1a_presentation_plan: null,
    scene_condition_package: null,
    data_debt: [{ field: "world_state.resource", upstream: "FP002-01", reason: "missing" }],
    redacted_error: { code: "DATA_DEBT", message: "The scene condition package is blocked by missing upstream data." },
  };

  const body = expressionValue(response.parameters.responseBody, blocked);
  assert.equal(body.ok, false);
  assert.equal(body.redacted_error.code, "DATA_DEBT");
  assert.equal(expressionValue(response.parameters.options.responseCode, blocked), 400);
});

test("ZH04 returns read-only names for the current scene participants", () => {
  const response = node(ids.response);
  const body = expressionValue(response.parameters.responseBody, {
    context: {
      request: { action: "generate", correlation_id: "generate-roles" },
      scope: { l1a_id: "33333333-3333-4333-8333-333333333333" },
      characters: [
        { character_id: "33333333-3333-4333-8333-333333333333", char_name: "江枫", knowledge_boundary_json: { hidden: true } },
        { character_id: "44444444-4444-4444-8444-444444444444", char_name: "叶凡" },
      ],
    },
    presentation_ready: true,
    l1a_presentation_plan: { chapter_division: [] },
    scene_condition_package: { ...sceneConditionPackage, participant_chars: ["33333333-3333-4333-8333-333333333333"] },
    data_debt: [],
  });

  assert.equal(body.ok, true);
  assert.equal(JSON.stringify(body.result.context.characters), JSON.stringify([
    { character_id: "33333333-3333-4333-8333-333333333333", char_name: "江枫" },
  ]));
});

test("ZH04 rejects a presentation candidate that creates no chapter boundary", () => {
  const presentationFix = node(ids.presentationFix)?.parameters.jsCode ?? "";
  const scope = {
    local_operator_id: "11111111-1111-4111-8111-111111111111",
    book_id: "22222222-2222-4222-8222-222222222222",
    l1a_id: "33333333-3333-4333-8333-333333333333",
  };
  const plan = {
    plot_retained: [], small_arc_sequence: [], emotion_arc: {}, foreshadow_layers: {},
    hook_positions: [], hotpoint_positions: [], revelation_plan: {}, chapter_division: [],
  };
  const output = executeCode(presentationFix, {
    $: () => ({ first: () => ({ json: {
      context: { scope_ok: true, scope, request: { action: "generate" } },
      materialization_ready: true,
      scene_condition_package: sceneConditionPackage,
      data_debt: [],
      redacted_error: null,
    } }) }),
    $json: completionResponse({ l1a_presentation_plan: plan }),
  })[0].json;

  assert.equal(output.presentation_ready, false);
  assert.equal(output.l1a_presentation_plan, null);
  assert.equal(output.redacted_error.code, "INVALID_REQUEST");
});

test("ZH04 rejects invalid scope and non-presentation candidates before either model branch", () => {
  const scope = {
    local_operator_id: "11111111-1111-4111-8111-111111111111",
    book_id: "22222222-2222-4222-8222-222222222222",
    l1a_id: "33333333-3333-4333-8333-333333333333",
  };
  const presentation = {
    plot_retained: [], small_arc_sequence: [], emotion_arc: {}, foreshadow_layers: {},
    hook_positions: [], hotpoint_positions: [], revelation_plan: {}, chapter_division: [],
  };
  const generateRoute = node(ids.actionRoute)?.parameters.conditions?.conditions?.[0]?.leftValue;
  const approveRoute = node(ids.approvalRoute)?.parameters.conditions?.conditions?.[0]?.leftValue;
  assert.equal(expressionValue(generateRoute, { context: { scope_ok: true, request: { action: "generate" } } }), "generate");
  assert.equal(expressionValue(generateRoute, { context: { scope_ok: false, request: { action: "generate" } } }), "");

  const approvalContext = { scope_ok: true, scope, request: { action: "approve", scope, l1a_presentation_plan: presentation, scene_condition_package: sceneConditionPackage, idempotency_key: "approve-1" } };
  assert.equal(expressionValue(approveRoute, { context: approvalContext }), "approve");
  assert.equal(expressionValue(approveRoute, { context: { ...approvalContext, request: { ...approvalContext.request, idempotency_key: undefined } } }), "");
  assert.equal(expressionValue(approveRoute, { context: { ...approvalContext, request: { ...approvalContext.request, idempotency_key: " invalid key" } } }), "");
  assert.equal(expressionValue(approveRoute, { context: { ...approvalContext, request: { ...approvalContext.request, idempotency_key: `a${"x".repeat(128)}` } } }), "");
  assert.equal(expressionValue(approveRoute, { context: { ...approvalContext, request: { ...approvalContext.request, scope: { ...scope, book_id: "44444444-4444-4444-8444-444444444444" } } } }), "");
  assert.equal(expressionValue(approveRoute, { context: { ...approvalContext, request: { ...approvalContext.request, l1a_presentation_plan: { ...presentation, particles_json: [] } } } }), "");
  assert.equal(expressionValue(approveRoute, { context: { ...approvalContext, scope_ok: false } }), "");
});

test("ZH04 validates its candidate and uses active bindings only for generation and approval", () => {
  for (const id of ["d02111c6-3ef5-4bf5-b8ce-2bdc5bece554", "73c95996-64b3-4bb6-8c5b-119d80c55732", ids.firstExecution]) {
    const current = node(id);
    assert.notEqual(current?.disabled, true);
    assert.match(JSON.stringify(current?.parameters), /runtime_bindings/);
    assert.match(JSON.stringify(current?.parameters), /CONFIG_CONTRACT_BLOCKED/);
  }
  const mapper = node(ids.mapper)?.parameters.jsCode ?? "";
  assert.match(mapper, /parsed\?\.chapter_plans/);
  assert.match(mapper, /sourceRequest\.idempotency_key/);
  assert.match(mapper, /l1a_presentation_plan/);
  assert.match(mapper, /scopeMatches/);
  assert.match(mapper, /mapping_ok/);
  assert.match(mapper, /output\?\.content\?\.text/);
  const fp007Prompt = node(ids.firstExecution)?.parameters.jsonBody ?? "";
  assert.match(fp007Prompt, /V7 OUTPUT CONTRACT/);
  assert.match(fp007Prompt, /core_plot_tasks/);
  assert.match(fp007Prompt, /pov_declaration\.pov_char/);
  assert.match(fp007Prompt, /pov_declaration\.switch_rule/);
  assert.match(fp007Prompt, /A scene constraint or risk is not a resource/);
  assert.match(fp007Prompt, /pov_declaration\.pov_boundaries/);
  assert.match(fp007Prompt, /particles_json under target_snapshot_json/);
  assert.match(fp007Prompt, /resource particle MUST also include world_verified=true/);
  assert.match(fp007Prompt, /reveal_to MUST be exactly all, reader, or an array of formal character UUIDs/);
  assert.match(fp007Prompt, /never a translated label such as 全员 or 仅读者/u);
  assert.match(fp007Prompt, /never reference a particle from another chapter/u);
  assert.match(fp007Prompt, /forbid_content may be \[\] only when INPUT contains no explicit L1A prohibited bridge/);
  assert.match(fp007Prompt, /must never be derived from forbid_lines_active/);
  assert.match(fp007Prompt, /exactly one chapter_plans item for each item in INPUT\.decision\.l1a_presentation_plan\.chapter_division/);
  assert.match(fp007Prompt, /Never duplicate a chapter_index/);
  assert.match(fp007Prompt, /Do not emit meta, quality_self_check/);
  assert.match(fp007Prompt, /pov_declaration must be an object, not an array/);
  assert.match(fp007Prompt, /Particle type is an exact enum: truth, resource, info, emotion, or hook/);
  assert.match(fp007Prompt, /Never use plot, fact, event, or any alias/);
  assert.match(fp007Prompt, /Never relabel resource possession, consumption, or use as truth, info, emotion, or hook to bypass resource verification/);
  const fp007RepairPrompt = node("14cd7dda-b21d-437c-ad70-95f8c7340580")?.parameters.jsonBody ?? "";
  assert.match(fp007RepairPrompt, /STRICT OUTPUT REPAIR/);
  assert.match(fp007RepairPrompt, /reference every particle_id exactly once/);
  assert.match(fp007RepairPrompt, /reveal_to must be exactly all, reader, or an array of formal character UUIDs/);
  assert.match(fp007RepairPrompt, /no duplicate, missing, or cross-chapter value/);
  assert.doesNotMatch(fp007Prompt, /STRICT JSON SCHEMA|const output_schema|response_format/);
  assert.doesNotMatch(fp007RepairPrompt, /STRICT JSON SCHEMA|const output_schema|response_format/);
  assert.equal((fp007Prompt.match(/const binding =/g) ?? []).length, 1,
    "FP007 should validate and reuse one runtime binding inside the n8n expression");
  assert.match(fp007Prompt, /const body = \{ model: binding\.model_name/);
  assert.match(fp007RepairPrompt, /const body = \{ model: binding\.model_name/);
  assert.doesNotMatch(mapper, /chapter_index\s*:\s*\?\?|chapter_index\s*:\s*1/);
  const scope = {
    local_operator_id: "11111111-1111-4111-8111-111111111111",
    book_id: "22222222-2222-4222-8222-222222222222",
    l1a_id: "33333333-3333-4333-8333-333333333333",
  };
  const candidate = {
    plot_retained: [], small_arc_sequence: [], emotion_arc: {}, foreshadow_layers: {},
    hook_positions: [], hotpoint_positions: [], revelation_plan: {}, chapter_division: [{ chapter_seq: 1 }],
  };
  const approvalRequest = (idempotency_key, overrides = {}) => ({
    scope,
    l1a_presentation_plan: candidate,
    scene_condition_package: sceneConditionPackage,
    idempotency_key,
    correlation_id: "c",
    ...overrides,
  });
  const chapterPlan = {
    chapter_index: 1,
    title: "Chapter",
    target_snapshot_json: {
      core_plot_tasks: [{ task_id: "T1", description: "Task" }],
      emotion_goals: [{ goal_id: "E1", description: "Emotion" }],
      hook_tasks: [{ hook_id: "H1", description: "Hook" }],
      forbid_content: [],
      particles_json: [{ particle_id: "P1", content: "Fact", type: "truth", source_field: "l1a", purpose: "Use", reveal_to: "all" }],
      scene_condition_package: sceneConditionPackage,
      pov_declaration: {
        pov_char: "lead",
        switch_rule: "无",
        pov_boundaries: { can_perceive: [], can_misjudge: [], must_ignore: [] },
      },
    },
    chapter_implementation_json: {
      execution_steps: [{ core_particles: ["P1"] }],
      lens_order: [{ pov: "lead", sensory: "视觉" }],
      dialogue_plan: [
        { unit_id: "D1", speaker: "lead", listener: "lead", primary_function: "D-01", secondary_function: "无" },
        { unit_id: "D2", speaker: "lead", listener: "lead", primary_function: "D-02", secondary_function: "无" },
        { unit_id: "D3", speaker: "lead", listener: "lead", primary_function: "D-03", secondary_function: "无" },
      ],
      dialogue_coverage: { "D-01": 1, "D-02": 1, "D-03": 1, "D-04": 0, "D-05": 0, "D-06": 0, "D-07": 0, "D-08": 0 },
    },
    exception_summary_jsonb: { deferred_tasks: [], data_debt: [], conflict_deadlocks: [] },
  };
  const output = executeCode(mapper, {
    $: () => ({ first: () => ({ json: { context: { scope_ok: true, scope, l1a_unit: { scene_location: "The documented threshold", participant_chars_json: ["lead"] }, request: approvalRequest("approve-1") } } }) }),
    $input: { item: { json: { output: { content: { text: JSON.stringify({ chapter_plans: [chapterPlan] }) } } } } },
  });
  assert.equal(output[0].json.mapping_ok, true);
  assert.equal(output[0].json.rpc_request.book_id, scope.book_id);
  assert.equal(output[0].json.rpc_request.l1a_id, scope.l1a_id);
  assert.equal(output[0].json.rpc_request.idempotency_key, "approve-1");

  for (const legacyRevealTo of ["全员", "仅读者", "特定角色", [], ["lead"], ["00000000-0000-4000-8000-000000000000"]]) {
    const invalidPlan = structuredClone(chapterPlan);
    invalidPlan.target_snapshot_json.particles_json[0].reveal_to = legacyRevealTo;
    const invalidOutput = executeCode(mapper, {
      $: () => ({ first: () => ({ json: { context: { scope_ok: true, scope, l1a_unit: { scene_location: "The documented threshold", participant_chars_json: ["lead"] }, request: approvalRequest("reject-reveal-to") } } }) }),
      $input: { item: { json: { output_text: JSON.stringify({ chapter_plans: [invalidPlan] }) } } },
    })[0].json;
    assert.equal(invalidOutput.mapping_ok, false, `reveal_to=${JSON.stringify(legacyRevealTo)} must not reach RPC-007`);
    assert.equal(invalidOutput.rpc_request.chapter_plans, undefined);
  }

  const autoMapper = node(ids.autoMapper)?.parameters.jsCode ?? "";
  const topLevelExceptionOutput = executeCode(autoMapper, {
    $: () => ({ first: () => ({ json: { context: { scope_ok: true, scope, l1a_unit: { scene_location: "The documented threshold", participant_chars_json: ["lead"] }, request: approvalRequest("approve-top-level-exception") } } }) }),
    $input: { item: { json: { output_text: JSON.stringify({ chapter_plans: [chapterPlan] }) } } },
  });
  assert.equal(topLevelExceptionOutput[0].json.mapping_ok, true);
  assert.equal(JSON.stringify(topLevelExceptionOutput[0].json.rpc_request.chapter_plans[0].exception_summary_jsonb), JSON.stringify(chapterPlan.exception_summary_jsonb));
  assert.equal("exception_summary_jsonb" in topLevelExceptionOutput[0].json.rpc_request.chapter_plans[0].chapter_implementation_json, false);

  const providerUnavailableOutput = executeCode(autoMapper, {
    $: () => ({ first: () => ({ json: { context: { scope_ok: true, scope, l1a_unit: { scene_location: "The documented threshold", participant_chars_json: ["lead"] }, request: approvalRequest("approve-provider-unavailable") } } }) }),
    $input: { item: { json: {
      statusCode: 200,
      data: JSON.stringify({ choices: [{
        finish_reason: "error",
        error: { code: "provider_unavailable", message: "upstream 502" },
        message: { content: null },
      }] }),
    } } },
  })[0].json;
  assert.equal(providerUnavailableOutput.mapping_ok, false);
  assert.equal(providerUnavailableOutput.rpc_request.chapter_plans, undefined);
  assert.equal(JSON.stringify(providerUnavailableOutput.redacted_error), JSON.stringify({
    code: "MODEL_PROVIDER_UNAVAILABLE",
    message: "The current model service is unavailable.",
  }));
  const providerFailureReplacements = expressionValue(
    node("21a8d8d7-39c8-4d1e-9a12-bbd361a766ca").parameters.options.queryReplacement,
    providerUnavailableOutput,
  );
  assert.equal(providerFailureReplacements[0], false, "an HTTP 200 provider error must not invoke RPC-007");
  assert.equal(JSON.parse(providerFailureReplacements[2]).redacted_error.code, "MODEL_PROVIDER_UNAVAILABLE");

  const misplacedExceptionPlan = structuredClone(chapterPlan);
  misplacedExceptionPlan.chapter_implementation_json.exception_summary_jsonb = misplacedExceptionPlan.exception_summary_jsonb;
  delete misplacedExceptionPlan.exception_summary_jsonb;
  const misplacedExceptionOutput = executeCode(autoMapper, {
    $: () => ({ first: () => ({ json: { context: { scope_ok: true, scope, l1a_unit: { scene_location: "The documented threshold", participant_chars_json: ["lead"] }, request: approvalRequest("approve-misplaced-exception") } } }) }),
    $input: { item: { json: { output_text: JSON.stringify({ chapter_plans: [misplacedExceptionPlan] }) } } },
  });
  assert.equal(misplacedExceptionOutput[0].json.mapping_ok, true,
    "a complete exception summary misplaced inside implementation is restored to the documented chapter-plan field");
  assert.equal(JSON.stringify(misplacedExceptionOutput[0].json.rpc_request.chapter_plans[0].exception_summary_jsonb), JSON.stringify(chapterPlan.exception_summary_jsonb));
  assert.equal("exception_summary_jsonb" in misplacedExceptionOutput[0].json.rpc_request.chapter_plans[0].chapter_implementation_json, false);

  const incompleteMisplacedException = structuredClone(misplacedExceptionPlan);
  delete incompleteMisplacedException.chapter_implementation_json.exception_summary_jsonb.conflict_deadlocks;
  const incompleteMisplacedOutput = executeCode(autoMapper, {
    $: () => ({ first: () => ({ json: { context: { scope_ok: true, scope, l1a_unit: { scene_location: "The documented threshold", participant_chars_json: ["lead"] }, request: approvalRequest("approve-incomplete-misplaced-exception") } } }) }),
    $input: { item: { json: { output_text: JSON.stringify({ chapter_plans: [incompleteMisplacedException] }) } } },
  });
  assert.equal(incompleteMisplacedOutput[0].json.mapping_ok, false);

  const conflictingExceptionPlan = structuredClone(chapterPlan);
  conflictingExceptionPlan.chapter_implementation_json.exception_summary_jsonb = structuredClone(chapterPlan.exception_summary_jsonb);
  const conflictingExceptionOutput = executeCode(autoMapper, {
    $: () => ({ first: () => ({ json: { context: { scope_ok: true, scope, l1a_unit: { scene_location: "The documented threshold", participant_chars_json: ["lead"] }, request: approvalRequest("approve-conflicting-exception") } } }) }),
    $input: { item: { json: { output_text: JSON.stringify({ chapter_plans: [conflictingExceptionPlan] }) } } },
  });
  assert.equal(conflictingExceptionOutput[0].json.mapping_ok, false);
  assert.equal(conflictingExceptionOutput[0].json.rpc_request.chapter_plans, undefined);

  const dataDebtPlan = structuredClone(chapterPlan);
  dataDebtPlan.exception_summary_jsonb = {
    deferred_tasks: [],
    data_debt: [{ field: "world_state.resource", upstream: "FP002-01" }],
    conflict_deadlocks: [],
  };
  const dataDebtOutput = executeCode(mapper, {
    $: () => ({ first: () => ({ json: { context: { scope_ok: true, scope, l1a_unit: { scene_location: "The documented threshold", participant_chars_json: ["lead"] }, request: approvalRequest("approve-data-debt") } } }) }),
    $input: { item: { json: { output_text: JSON.stringify({ chapter_plans: [dataDebtPlan] }) } } },
  });
  assert.equal(dataDebtOutput[0].json.mapping_ok, false);
  assert.equal(dataDebtOutput[0].json.rpc_request.chapter_plans, undefined);
  assert.equal(dataDebtOutput[0].json.redacted_error.code, "DATA_DEBT");

  const fullTextResponse = executeCode(mapper, {
    $: () => ({ first: () => ({ json: { context: { scope_ok: true, scope, l1a_unit: { scene_location: "The documented threshold", participant_chars_json: ["lead"] }, request: approvalRequest("approve-full-text") } } }) }),
    $input: { item: { json: { statusCode: 200, body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ chapter_plans: [chapterPlan] }) } }] }) } } },
  });
  assert.equal(fullTextResponse[0].json.mapping_ok, true);
  assert.equal(fullTextResponse[0].json.rpc_request.idempotency_key, "approve-full-text");

  const fullDataTextResponse = executeCode(mapper, {
    $: () => ({ first: () => ({ json: { context: { scope_ok: true, scope, l1a_unit: { scene_location: "The documented threshold", participant_chars_json: ["lead"] }, request: approvalRequest("approve-full-data-text") } } }) }),
    $input: { item: { json: { statusCode: 200, data: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ chapter_plans: [chapterPlan] }) } }] }) } } },
  });
  assert.equal(fullDataTextResponse[0].json.mapping_ok, true,
    "n8n 2.x full text responses expose the provider body through data");
  assert.equal(fullDataTextResponse[0].json.rpc_request.idempotency_key, "approve-full-data-text");
  assert.equal(JSON.stringify(output[0].json.rpc_request.chapter_plans[0].target_snapshot_json.scene_condition_package), JSON.stringify(sceneConditionPackage));

  const unswitchedPovPlan = structuredClone(chapterPlan);
  unswitchedPovPlan.chapter_implementation_json.lens_order.push({ pov: "other", sensory: "听觉" });
  const unswitchedPovOutput = executeCode(mapper, {
    $: () => ({ first: () => ({ json: { context: { scope_ok: true, scope, l1a_unit: { scene_location: "The documented threshold", participant_chars_json: ["lead"] }, request: approvalRequest("approve-unswitched-pov") } } }) }),
    $input: { item: { json: { output_text: JSON.stringify({ chapter_plans: [unswitchedPovPlan] }) } } },
  });
  assert.equal(unswitchedPovOutput[0].json.mapping_ok, false,
    "a plan declaring no POV switch must not persist a second POV lens");

  const illegalParticleType = structuredClone(chapterPlan);
  illegalParticleType.target_snapshot_json.particles_json[0].type = "plot";
  const illegalParticleTypeOutput = executeCode(mapper, {
    $: () => ({ first: () => ({ json: { context: { scope_ok: true, scope, l1a_unit: { scene_location: "The documented threshold", participant_chars_json: ["lead"] }, request: approvalRequest("approve-illegal-particle") } } }) }),
    $input: { item: { json: { output_text: JSON.stringify({ chapter_plans: [illegalParticleType] }) } } },
  });
  assert.equal(illegalParticleTypeOutput[0].json.mapping_ok, false);
  assert.equal(illegalParticleTypeOutput[0].json.redacted_error.code, "INVALID_REQUEST");

  const duplicateChapterOutput = executeCode(mapper, {
    $: () => ({ first: () => ({ json: { context: { scope_ok: true, scope, l1a_unit: { scene_location: "The documented threshold", participant_chars_json: ["lead"] }, request: approvalRequest("approve-duplicate-chapter") } } }) }),
    $input: { item: { json: { output_text: JSON.stringify({ chapter_plans: [chapterPlan, structuredClone(chapterPlan)] }) } } },
  });
  assert.equal(duplicateChapterOutput[0].json.mapping_ok, false);
  assert.equal(duplicateChapterOutput[0].json.redacted_error.code, "INVALID_REQUEST");

  const oneExtraClosingBrace = executeCode(mapper, {
    $: () => ({ first: () => ({ json: { context: { scope_ok: true, scope, l1a_unit: { scene_location: "The documented threshold", participant_chars_json: ["lead"] }, request: approvalRequest("approve-repaired") } } }) }),
    $input: { item: { json: { output: { content: { text: JSON.stringify({ chapter_plans: [chapterPlan] }) + "}" } } } } },
  });
  assert.equal(oneExtraClosingBrace[0].json.mapping_ok, false,
    "an altered JSON object must not be repaired into an RPC-007 request");
  assert.equal(oneExtraClosingBrace[0].json.rpc_request.chapter_plans, undefined);

  const validChapterJson = JSON.stringify({ chapter_plans: [chapterPlan] });
  const oneMissingPlanBrace = executeCode(mapper, {
    $: () => ({ first: () => ({ json: { context: { scope_ok: true, scope, l1a_unit: { scene_location: "The documented threshold", participant_chars_json: ["lead"] }, request: approvalRequest("approve-missing-brace") } } }) }),
    $input: { item: { json: { output_text: validChapterJson.replace(/}]\}\s*$/, "]}") } } },
  });
  assert.equal(oneMissingPlanBrace[0].json.mapping_ok, false,
    "a truncated JSON object must not be repaired into an RPC-007 request");
  assert.equal(oneMissingPlanBrace[0].json.rpc_request.chapter_plans, undefined);

  const fencedJson = executeCode(mapper, {
    $: () => ({ first: () => ({ json: { context: { scope_ok: true, scope, l1a_unit: { scene_location: "The documented threshold", participant_chars_json: ["lead"] }, request: approvalRequest("approve-fenced") } } }) }),
    $input: { item: { json: { output_text: `\`\`\`json\n${validChapterJson}\n\`\`\`` } } },
  });
  assert.equal(fencedJson[0].json.mapping_ok, true, "a complete fenced JSON object remains valid");

  const forbiddenFromScene = structuredClone(chapterPlan);
  forbiddenFromScene.target_snapshot_json.forbid_content = ["The scene outline must not become chapter prohibition."];
  const forbiddenOutput = executeCode(mapper, {
    $: () => ({ first: () => ({ json: { context: { scope_ok: true, scope, l1a_unit: { scene_location: "The documented threshold", participant_chars_json: ["lead"] }, request: approvalRequest("approve-forbidden-scene") } } }) }),
    $input: { item: { json: { output_text: JSON.stringify({ chapter_plans: [forbiddenFromScene] }) } } },
  })[0].json;
  assert.equal(forbiddenOutput.mapping_ok, false, "without a V7-defined L1A prohibited bridge, scene-derived forbidden content must not persist");

  const missingDialogueCore = structuredClone(chapterPlan);
  missingDialogueCore.chapter_implementation_json.dialogue_plan = missingDialogueCore.chapter_implementation_json.dialogue_plan.filter((entry) => entry.primary_function !== "D-02");
  missingDialogueCore.chapter_implementation_json.dialogue_coverage["D-02"] = 0;
  const missingDialogueOutput = executeCode(mapper, {
    $: () => ({ first: () => ({ json: { context: { scope_ok: true, scope, l1a_unit: { scene_location: "The documented threshold", participant_chars_json: ["lead"] }, request: approvalRequest("approve-missing-dialogue") } } }) }),
    $input: { item: { json: { output_text: JSON.stringify({ chapter_plans: [missingDialogueCore] }) } } },
  })[0].json;
  assert.equal(missingDialogueOutput.mapping_ok, false, "D-01 through D-03 must each be covered by the actual dialogue plan");

  const spoofedCanReveal = structuredClone(chapterPlan);
  spoofedCanReveal.target_snapshot_json.particles_json[0] = {
    ...spoofedCanReveal.target_snapshot_json.particles_json[0],
    content: "A scene candidate must not be relabeled as a locked L1A revelation.",
    source_field: "info_reveal_boundary.can_reveal[0]",
  };
  const spoofedRevealOutput = executeCode(mapper, {
    $: () => ({ first: () => ({ json: { context: {
      scope_ok: true, scope,
      l1a_unit: {
        scene_location: "The documented threshold", participant_chars_json: ["lead"],
        info_reveal_boundary: { can_reveal: ["Only this exact locked L1A fact is revealable."] },
      },
      request: approvalRequest("approve-spoofed-reveal"),
    } } }) }),
    $input: { item: { json: { output_text: JSON.stringify({ chapter_plans: [spoofedCanReveal] }) } } },
  })[0].json;
  assert.equal(spoofedRevealOutput.mapping_ok, false, "a can_reveal source label must preserve the exact L1A value");

  const nestedPlan = structuredClone(chapterPlan);
  nestedPlan.target_snapshot_json.chapter_implementation_json = nestedPlan.chapter_implementation_json;
  nestedPlan.target_snapshot_json.exception_summary_jsonb = nestedPlan.exception_summary_jsonb;
  delete nestedPlan.chapter_implementation_json;
  delete nestedPlan.exception_summary_jsonb;
  const nestedFieldsRepaired = executeCode(mapper, {
    $: () => ({ first: () => ({ json: { context: { scope_ok: true, scope, l1a_unit: { scene_location: "The documented threshold", participant_chars_json: ["lead"] }, request: approvalRequest("approve-nested-fields") } } }) }),
    $input: { item: { json: { output_text: JSON.stringify({ chapter_plans: [nestedPlan] }) } } },
  });
  assert.equal(nestedFieldsRepaired[0].json.mapping_ok, true, "existing implementation fields may be reparented without fabricating content");
  assert.equal(nestedFieldsRepaired[0].json.rpc_request.chapter_plans[0].chapter_implementation_json.execution_steps.length, 1);
  assert.equal("chapter_implementation_json" in nestedFieldsRepaired[0].json.rpc_request.chapter_plans[0].target_snapshot_json, false);

  const wrongScopeOutput = executeCode(mapper, {
    $: () => ({ first: () => ({ json: { context: { scope_ok: true, scope, l1a_unit: { scene_location: "The documented threshold", participant_chars_json: ["lead"] }, request: approvalRequest("approve-2", { scope: { ...scope, l1a_id: "44444444-4444-4444-8444-444444444444" } }) } } }) }),
    $input: { item: { json: { output_text: JSON.stringify({ chapter_plans: [chapterPlan] }) } } },
  });
  assert.equal(wrongScopeOutput[0].json.mapping_ok, false);
  assert.equal(wrongScopeOutput[0].json.redacted_error.code, "INVALID_REQUEST");
  const missingScenePackage = executeCode(mapper, {
    $: () => ({ first: () => ({ json: { context: { scope_ok: true, scope, l1a_unit: { scene_location: "The documented threshold", participant_chars_json: ["lead"] }, request: approvalRequest("approve-missing-scene", { scene_condition_package: undefined }) } } }) }),
    $input: { item: { json: { output_text: JSON.stringify({ chapter_plans: [chapterPlan] }) } } },
  });
  assert.equal(missingScenePackage[0].json.mapping_ok, false);
  assert.match(promptMaterial, /"chapter_plans": \[\{/);
  assert.match(promptMaterial, /"type": "truth\|resource\|info\|emotion\|hook"/);
});

test("ZH04 keeps the presentation candidate in memory and refuses execution fields before approval", () => {
  const presentationFix = node(ids.presentationFix)?.parameters.jsCode ?? "";
  const context = { request: { action: "generate" }, scope_ok: true };
  const upstream = { context, materialization_ready: true, data_debt: [], redacted_error: null };
  const validPlan = {
    plot_retained: [], small_arc_sequence: [], emotion_arc: {}, foreshadow_layers: {},
    hook_positions: [], hotpoint_positions: [], revelation_plan: {},
    chapter_division: [{ chapter_seq: 1, emotion_target: { rhythm: "抑" } }],
  };
  const execute = (plan) => executeCode(presentationFix, {
    $: () => ({ first: () => ({ json: upstream }) }),
    $json: completionResponse({ l1a_presentation_plan: plan }),
  })[0].json;
  assert.equal(JSON.stringify(execute(validPlan).l1a_presentation_plan), JSON.stringify(validPlan));
  const nestedCompletion = executeCode(presentationFix, {
    $: () => ({ first: () => ({ json: upstream }) }),
    $json: {
      statusCode: 200,
      data: JSON.stringify({ choices: [{ message: { content: JSON.stringify(validPlan) } }] }),
    },
  })[0].json;
  assert.equal(nestedCompletion.presentation_ready, true,
    "n8n full-response text envelopes must unwrap choices[0].message.content before V7 validation");
  assert.equal(JSON.stringify(nestedCompletion.l1a_presentation_plan), JSON.stringify(validPlan));
  const noRhythmSource = {
    ...validPlan,
    chapter_division: [1, 2, 3].map((chapter_seq) => ({ chapter_seq, emotion_target: { rhythm: "未提供" } })),
  };
  assert.equal(execute(noRhythmSource).presentation_ready, true,
    "an absent V7 emotion rhythm must not be treated as three repeated rhythms");
  const repeatedDefinedRhythm = {
    ...validPlan,
    chapter_division: [1, 2, 3].map((chapter_seq) => ({ chapter_seq, emotion_target: { rhythm: "抑" } })),
  };
  assert.equal(execute(repeatedDefinedRhythm).presentation_ready, false,
    "three explicit identical rhythms remain invalid");
  const rejected = execute({ ...validPlan, chapter_implementation_json: {} });
  assert.equal(rejected.presentation_ready, false);
  assert.equal(rejected.l1a_presentation_plan, null);
  assert.equal(rejected.redacted_error.code, "INVALID_REQUEST");
});

test("ZH04 auto branch carries the validated scene package into chapter plans", () => {
  const mapper = node(ids.autoMapper)?.parameters.jsCode ?? "";
  const leadId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const scope = {
    local_operator_id: "11111111-1111-4111-8111-111111111111",
    book_id: "22222222-2222-4222-8222-222222222222",
    l1a_id: "33333333-3333-4333-8333-333333333333",
  };
  const chapterPlans = { chapter_plans: [{
    chapter_index: 1,
    title: "Chapter",
    target_snapshot_json: {
      particles_json: [
        { particle_id: "P005", reveal_to: [leadId] },
        { particle_id: "P006", reveal_to: [leadId] },
      ],
    },
    chapter_implementation_json: {
      execution_steps: [{ core_particles: ["P005", "P006"] }],
      dialogue_plan: [
        { unit_id: "auto-d1", primary_function: "D-01", secondary_function: "无" },
        { unit_id: "auto-d2", primary_function: "D-02", secondary_function: "无" },
        { unit_id: "auto-d3", primary_function: "D-03", secondary_function: "无" },
      ],
      dialogue_coverage: { "D-01": 1, "D-02": 1, "D-03": 1, "D-04": 0, "D-05": 0, "D-06": 0, "D-07": 0, "D-08": 0 },
    },
    exception_summary_jsonb: { deferred_tasks: [], data_debt: [], conflict_deadlocks: [] },
  }] };
  const run = (scenePackage, plans = chapterPlans, outputText = JSON.stringify(plans)) => executeCode(mapper, {
    $: () => ({ first: () => ({ json: {
      presentation_ready: true,
      scene_condition_package: scenePackage,
      context: { scope, characters: [{ character_id: leadId }], request: { idempotency_key: "auto-1", correlation_id: "auto-1" } },
    } }) }),
    $input: { item: { json: { output_text: outputText } } },
  })[0].json;

  const mapped = run(sceneConditionPackage);
  assert.equal(mapped.mapping_ok, true);
  assert.deepEqual(mapped.rpc_request.chapter_plans[0].target_snapshot_json.scene_condition_package, sceneConditionPackage);
  const reorderedParticleReferences = structuredClone(chapterPlans);
  reorderedParticleReferences.chapter_plans[0].chapter_implementation_json.execution_steps[0].core_particles = ["P006", "P005"];
  const reorderedOutput = run(sceneConditionPackage, reorderedParticleReferences);
  assert.equal(reorderedOutput.mapping_ok, true,
    "unique core particle references with the same set and count may use execution-step order");
  assert.equal(JSON.stringify(reorderedOutput.rpc_request.chapter_plans[0].chapter_implementation_json.execution_steps[0].core_particles), JSON.stringify(["P006", "P005"]));
  const completeAutoJson = JSON.stringify(chapterPlans);
  const truncated = run(sceneConditionPackage, chapterPlans, completeAutoJson.slice(0, -1));
  assert.equal(truncated.mapping_ok, false, "a truncated automatic JSON object must not enter RPC-007");
  assert.equal(truncated.rpc_request.chapter_plans, undefined);
  const fenced = run(sceneConditionPackage, chapterPlans, `\`\`\`json\n${completeAutoJson}\n\`\`\``);
  assert.equal(fenced.mapping_ok, true, "a complete fenced automatic JSON object remains valid");
  assert.equal(Boolean(run(null).mapping_ok), false);
  const withDataDebt = structuredClone(chapterPlans);
  withDataDebt.chapter_plans[0].exception_summary_jsonb.data_debt.push({ field: "world_state.resource", upstream: "FP002-01" });
  const blocked = run(sceneConditionPackage, withDataDebt);
  assert.equal(blocked.mapping_ok, false);
  assert.equal(blocked.rpc_request.chapter_plans, undefined);
  assert.equal(blocked.redacted_error.code, "DATA_DEBT");
  const missingDebtDeclaration = structuredClone(chapterPlans);
  delete missingDebtDeclaration.chapter_plans[0].exception_summary_jsonb;
  const malformed = run(sceneConditionPackage, missingDebtDeclaration);
  assert.equal(malformed.mapping_ok, false);
  assert.equal(malformed.rpc_request.chapter_plans, undefined);
  assert.equal(malformed.redacted_error.code, "INVALID_REQUEST");
  const duplicateParticleReference = structuredClone(chapterPlans);
  duplicateParticleReference.chapter_plans[0].chapter_implementation_json.execution_steps[0].core_particles = ["P005", "P006", "P006"];
  const duplicateParticleOutput = run(sceneConditionPackage, duplicateParticleReference);
  assert.equal(duplicateParticleOutput.mapping_ok, false,
    "automatic plans must reference every particle exactly once and in particles_json order");
  assert.equal(duplicateParticleOutput.rpc_request.chapter_plans, undefined);
  assert.equal(duplicateParticleOutput.redacted_error.code, "INVALID_REQUEST");
  const missingParticleReference = structuredClone(chapterPlans);
  missingParticleReference.chapter_plans[0].chapter_implementation_json.execution_steps[0].core_particles = ["P005"];
  assert.equal(run(sceneConditionPackage, missingParticleReference).mapping_ok, false,
    "a non-deferred particle cannot be omitted from execution steps");
  const crossChapterParticleReference = structuredClone(chapterPlans);
  crossChapterParticleReference.chapter_plans[0].chapter_implementation_json.execution_steps[0].core_particles = ["P005", "P006", "P999"];
  assert.equal(run(sceneConditionPackage, crossChapterParticleReference).mapping_ok, false,
    "a chapter plan cannot reference a particle that its own particles_json does not contain");
  const unknownParticleReference = structuredClone(chapterPlans);
  unknownParticleReference.chapter_plans[0].chapter_implementation_json.execution_steps[0].core_particles = ["P005", "P006", "P999"];
  assert.equal(run(sceneConditionPackage, unknownParticleReference).mapping_ok, false,
    "an execution step cannot reference an unknown particle");
  const dataDebtPlan = structuredClone(chapterPlans);
  dataDebtPlan.chapter_plans[0].exception_summary_jsonb.data_debt.push({ field: "world_state.resource", upstream: "FP002-01" });
  assert.equal(run(sceneConditionPackage, dataDebtPlan).mapping_ok, false,
    "a plan with declared data debt cannot enter RPC-007");
});

test("ZH04 approval mapper reads the submitted candidate without evaluating the auto branch", () => {
  const mapper = node(ids.autoMapper)?.parameters.jsCode ?? "";
  const leadId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const scope = {
    local_operator_id: "11111111-1111-4111-8111-111111111111",
    book_id: "22222222-2222-4222-8222-222222222222",
    l1a_id: "33333333-3333-4333-8333-333333333333",
  };
  const candidate = {
    plot_retained: [], small_arc_sequence: [], emotion_arc: {}, foreshadow_layers: {},
    hook_positions: [], hotpoint_positions: [], revelation_plan: {}, chapter_division: [{ chapter_seq: 1 }],
  };
  let sourceReads = 0;
  const output = executeCode(mapper, {
    $: () => {
      sourceReads += 1;
      if (sourceReads > 1) throw new Error("approval must not read an unexecuted automatic node");
      return { first: () => ({ json: { context: {
        scope_ok: true,
        scope,
        characters: [{ character_id: leadId }],
        l1a_unit: { scene_location: sceneConditionPackage.scene_location, participant_chars_json: sceneConditionPackage.participant_chars },
        request: {
          action: "approve", scope, l1a_presentation_plan: candidate, scene_condition_package: sceneConditionPackage,
          idempotency_key: "approve-fallback", correlation_id: "approve-fallback",
        },
      } } }) };
    },
    $input: { item: { json: { output_text: JSON.stringify({ chapter_plans: [{
      chapter_index: 1, title: "Chapter", target_snapshot_json: {
        particles_json: [{ particle_id: "P1", reveal_to: [leadId] }],
      },
      chapter_implementation_json: {
        execution_steps: [{ core_particles: ["P1"] }],
        dialogue_plan: [
          { unit_id: "fallback-d1", primary_function: "D-01", secondary_function: "无" },
          { unit_id: "fallback-d2", primary_function: "D-02", secondary_function: "无" },
          { unit_id: "fallback-d3", primary_function: "D-03", secondary_function: "无" },
        ],
        dialogue_coverage: { "D-01": 1, "D-02": 1, "D-03": 1, "D-04": 0, "D-05": 0, "D-06": 0, "D-07": 0, "D-08": 0 },
      },
      exception_summary_jsonb: { deferred_tasks: [], data_debt: [], conflict_deadlocks: [] },
    }] }) } } },
  })[0].json;
  assert.equal(sourceReads, 1);
  assert.equal(output.mapping_ok, true);
  assert.equal(output.rpc_request.idempotency_key, "approve-fallback");
});

test("ZH04 approval mapper rejects duplicate particle references before RPC", () => {
  const mapper = node(ids.autoMapper)?.parameters.jsCode ?? "";
  assert.match(mapper, /particleReferencesValid/);
  assert.match(mapper, /expectedCoreParticleSet/);
  assert.match(mapper, /new Set\(referencedParticleIds\)\.size === referencedParticleIds\.length/);
  assert.match(mapper, /referencedParticleIds\.every\(\(id\) => typeof id === 'string' && expectedCoreParticleSet\.has\(id\)/);
  assert.doesNotMatch(mapper, /expectedCoreParticleIds\[index\]/);
});

test("ZH04 approval mapper rejects the observed cross-chapter and missing particle mapping before RPC", () => {
  const mapper = node(ids.autoMapper)?.parameters.jsCode ?? "";
  const leadId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const scope = {
    local_operator_id: "11111111-1111-4111-8111-111111111111",
    book_id: "22222222-2222-4222-8222-222222222222",
    l1a_id: "33333333-3333-4333-8333-333333333333",
  };
  const particle = (particle_id) => ({ particle_id, reveal_to: [leadId] });
  const chapter = (chapter_index, particleIds, coreParticles) => ({
    chapter_index,
    title: `Chapter ${chapter_index}`,
    target_snapshot_json: { particles_json: particleIds.map(particle) },
    chapter_implementation_json: { execution_steps: [{ core_particles: coreParticles }] },
    exception_summary_jsonb: { deferred_tasks: [], data_debt: [], conflict_deadlocks: [] },
  });
  const context = {
    scope_ok: true,
    scope,
    characters: [{ character_id: leadId }],
    l1a_unit: {
      scene_location: sceneConditionPackage.scene_location,
      participant_chars_json: sceneConditionPackage.participant_chars,
    },
    request: {
      action: "approve",
      scope,
      l1a_presentation_plan: {
        plot_retained: [], small_arc_sequence: [], emotion_arc: {}, foreshadow_layers: {},
        hook_positions: [], hotpoint_positions: [], revelation_plan: {},
        chapter_division: [{ chapter_seq: 1 }, { chapter_seq: 2 }],
      },
      scene_condition_package: sceneConditionPackage,
      idempotency_key: "observed-cross-chapter-particles",
      correlation_id: "observed-cross-chapter-particles",
    },
  };
  const output = executeCode(mapper, {
    $: () => ({ first: () => ({ json: { context } }) }),
    $input: { item: { json: { output_text: JSON.stringify({ chapter_plans: [
      chapter(1, ["P001", "P007", "P008", "P009"], ["P001"]),
      chapter(2, ["P010", "P013", "P014"], ["P010", "P013", "P014", "P007"]),
    ] }) } } },
  })[0].json;
  assert.equal(output.mapping_ok, false);
  assert.equal(output.rpc_request.chapter_plans, undefined,
    "the mapper must not invent steps or move a particle between chapters");
  assert.equal(output.redacted_error.code, "INVALID_REQUEST");
});

test("ZH04 approval mapper permits only explicitly deferred particles to stay out of core", () => {
  const mapper = node(ids.autoMapper)?.parameters.jsCode ?? "";
  const leadId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const scope = {
    local_operator_id: "11111111-1111-4111-8111-111111111111",
    book_id: "22222222-2222-4222-8222-222222222222",
    l1a_id: "33333333-3333-4333-8333-333333333333",
  };
  const candidate = {
    plot_retained: [], small_arc_sequence: [], emotion_arc: {}, foreshadow_layers: {},
    hook_positions: [], hotpoint_positions: [], revelation_plan: {}, chapter_division: [{ chapter_seq: 1 }],
  };
  const run = (coreParticles, deferredTasks, particles = ["P1", "P2", "P3"]) => {
    const context = {
      scope_ok: true,
      scope,
      characters: [{ character_id: leadId }],
      l1a_unit: { scene_location: sceneConditionPackage.scene_location, participant_chars_json: sceneConditionPackage.participant_chars },
      request: {
        action: "approve", scope, l1a_presentation_plan: candidate, scene_condition_package: sceneConditionPackage,
        idempotency_key: "deferred-check", correlation_id: "deferred-check",
      },
    };
    return executeCode(mapper, {
    $: () => ({ first: () => ({ json: { context } }) }),
    $input: { item: { json: { output_text: JSON.stringify({ chapter_plans: [{
      chapter_index: 1, title: "Chapter", target_snapshot_json: { particles_json: particles.map((particle_id) => ({ particle_id, reveal_to: [leadId] })) },
      chapter_implementation_json: {
        execution_steps: [{ core_particles: coreParticles }],
        dialogue_plan: [
          { unit_id: "deferred-d1", primary_function: "D-01", secondary_function: "无" },
          { unit_id: "deferred-d2", primary_function: "D-02", secondary_function: "无" },
          { unit_id: "deferred-d3", primary_function: "D-03", secondary_function: "无" },
        ],
        dialogue_coverage: { "D-01": 1, "D-02": 1, "D-03": 1, "D-04": 0, "D-05": 0, "D-06": 0, "D-07": 0, "D-08": 0 },
      },
      exception_summary_jsonb: { deferred_tasks: deferredTasks, data_debt: [], conflict_deadlocks: [] },
    }] }) } } },
    })[0].json;
  };

  assert.equal(run(["P1", "P2"], [{ particle_id: "P3", reason: "resource unavailable" }]).mapping_ok, true);
  assert.equal(run(["P1"], [{ particle_id: "P3", reason: "resource unavailable" }]).mapping_ok, false,
    "a non-deferred particle cannot remain unmapped");
  assert.equal(run(["P1", "P2", "P3"], [{ particle_id: "P3", reason: "resource unavailable" }]).mapping_ok, false,
    "a deferred particle cannot be referenced by an execution step");
});

test("FP005 requires an explicit top-level data-debt result before materialization can continue", () => {
  const materializationFix = node(ids.materializationFix)?.parameters.jsCode ?? "";
  const context = {
    scope_ok: true,
    scope: {
      local_operator_id: "11111111-1111-4111-8111-111111111111",
      book_id: "22222222-2222-4222-8222-222222222222",
      l1a_id: "33333333-3333-4333-8333-333333333333",
    },
    l1a_unit: {
      scene_location: sceneConditionPackage.scene_location,
      participant_chars_json: sceneConditionPackage.participant_chars,
    },
    data_debt: [],
  };
  const run = (modelOutput) => executeCode(materializationFix, {
    $: () => ({ first: () => ({ json: { context } }) }),
    $json: completionResponse(modelOutput),
  })[0].json;

  const missingDebtField = run({ scene_condition_package: sceneConditionPackage });
  assert.equal(missingDebtField.materialization_ready, false);
  assert.equal(missingDebtField.scene_condition_package, null);

  const explicitNoDebt = run({ scene_condition_package: sceneConditionPackage, data_debt: [] });
  assert.equal(explicitNoDebt.materialization_ready, true);

  const completionEnvelope = executeCode(materializationFix, {
    $: () => ({ first: () => ({ json: { context } }) }),
    $json: completionResponse({ scene_condition_package: sceneConditionPackage, data_debt: [] }),
  })[0].json;
  assert.equal(completionEnvelope.materialization_ready, true);

  const scalarFunctions = structuredClone(sceneConditionPackage);
  scalarFunctions.scene_affordance[0].functions = "documented-use";
  assert.equal(run({ scene_condition_package: scalarFunctions, data_debt: [] }).materialization_ready, false);

  const trailingPunctuation = structuredClone(sceneConditionPackage);
  trailingPunctuation.scene_location = `${trailingPunctuation.scene_location}。`;
  const trailingLocation = run({ scene_condition_package: trailingPunctuation, data_debt: [] });
  assert.equal(trailingLocation.materialization_ready, false);
  assert.equal(trailingLocation.scene_condition_package, null);

  const differentLocation = structuredClone(sceneConditionPackage);
  differentLocation.scene_location = "A different documented location";
  assert.equal(run({ scene_condition_package: differentLocation, data_debt: [] }).materialization_ready, false);

  const blocked = run({
    scene_condition_package: sceneConditionPackage,
    data_debt: [{ field: "world_state.resource", upstream: "FP002-01" }],
  });
  assert.equal(blocked.materialization_ready, false);
  assert.equal(blocked.scene_condition_package, null);
  assert.equal(blocked.redacted_error.code, "DATA_DEBT");

  const fp005ModelRequest = node(ids.materialization)?.parameters.jsonBody ?? "";
  assert.match(fp005ModelRequest, /data_debt/);
  const fp005Start = promptMaterial.indexOf("### FP005-01");
  const fp005End = promptMaterial.indexOf("### FP006-01", fp005Start);
  const fp005Prompt = promptMaterial.slice(fp005Start, fp005End);
  assert.match(fp005Prompt, /具体资源、设备、设施或消耗品/);
  assert.match(fp005Prompt, /数据债/);
  assert.match(fp005Prompt, /l1a_unit_json 是当前剧情段已锁定的正式承诺/u);
  assert.match(fp005Prompt, /不得要求 world_pack_json 重复提供同一段内的冲突、事件、揭露结果或不可逆后果/u);
  assert.match(fp005Prompt, /资源已有正式存在依据/u);
  assert.match(fp005Prompt, /scarcity_level/u);
  assert.match(fp005Prompt, /当前 L1A 未明确要求具体数量或有效期/u);
  assert.match(fp005Prompt, /叙事性提到“数量不足”或“稀缺”不等于要求可核验的库存数值/u);
  assert.match(fp005Prompt, /当前 L1A 明确指定可核验的具体数量、库存值或有效期条件/u);
  assert.match(fp005Prompt, /配给额度、信用余额、余量、容量或分配计算/u);
  assert.match(fp005Prompt, /FP008-02 的运行时变量/u);

  const fp007Start = promptMaterial.indexOf("### FP007-01");
  const fp007End = promptMaterial.indexOf("## FP008", fp007Start);
  const fp007Prompt = promptMaterial.slice(fp007Start, fp007End);
  assert.match(fp007Prompt, /不得把资源的占有、消耗或使用改标为 truth、info、emotion 或 hook/);
});

test("FP005 uses a fixed provider-response matrix before semantic validation", () => {
  const fullResponse = runFp005Repair(fp005ProviderResponses.valid_full_response);
  assert.equal(fullResponse.materialization_ready, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(fullResponse.scene_condition_package.scene_affordance[0].functions)),
    ["CF-05"],
    "a single documented CF code is a lossless one-element function set",
  );

  const execution3457Envelope = runFp005Repair(fp005ProviderResponses.execution_3457_completion_envelope);
  assert.equal(execution3457Envelope.materialization_ready, true,
    "the execution 3457 n8n full-response envelope must unwrap provider content before V7 validation");
  assert.deepEqual(
    JSON.parse(JSON.stringify(execution3457Envelope.scene_condition_package.scene_affordance.map((item) => item.functions))),
    [["CF-05"], ["CF-01"]],
    "the execution 3457 completion keeps its documented functions while normalizing only the lossless scalar form",
  );

  const directChoices = runFp005Repair(fp005ProviderResponses.direct_choices_response);
  assert.equal(directChoices.materialization_ready, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(directChoices.scene_condition_package.scene_affordance[0].functions)),
    ["CF-05"],
  );

  for (const response of [
    fp005ProviderResponses.malformed_data_response,
    fp005ProviderResponses.transport_error_response,
    fp005ProviderResponses.empty_response,
  ]) {
    const result = runFp005Repair(response);
    assert.equal(result.materialization_ready, false);
    assert.equal(result.scene_condition_package, null);
    assert.equal(result.redacted_error.code, "INVALID_REQUEST");
  }
});

test("FP005 permits only lossless scene-function scalar compatibility", () => {
  const validPackage = structuredClone(sceneConditionPackage);
  validPackage.scene_affordance[0].functions = fp005ProviderResponses.functions.legal_scalar;
  const normalized = runFp005Repair({
    ...completionResponse({ scene_condition_package: validPackage, data_debt: [] }),
  });
  assert.equal(normalized.materialization_ready, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(normalized.scene_condition_package.scene_affordance[0].functions)),
    ["CF-05"],
  );

  for (const functions of [
    fp005ProviderResponses.functions.illegal_scalar,
    fp005ProviderResponses.functions.empty_scalar,
    fp005ProviderResponses.functions.unknown_scalar,
    fp005ProviderResponses.functions.object,
  ]) {
    const invalidPackage = structuredClone(sceneConditionPackage);
    invalidPackage.scene_affordance[0].functions = functions;
    const result = runFp005Repair({
      ...completionResponse({ scene_condition_package: invalidPackage, data_debt: [] }),
    });
    assert.equal(result.materialization_ready, false);
    assert.equal(result.scene_condition_package, null);
  }

  const arrayPackage = structuredClone(sceneConditionPackage);
  arrayPackage.scene_affordance[0].functions = fp005ProviderResponses.functions.array;
  const arrayResult = runFp005Repair({
    ...completionResponse({ scene_condition_package: arrayPackage, data_debt: [] }),
  });
  assert.equal(arrayResult.materialization_ready, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(arrayResult.scene_condition_package.scene_affordance[0].functions)),
    fp005ProviderResponses.functions.array,
  );

  for (const scene_location of [`${sceneConditionPackage.scene_location}。`, "A different documented location"]) {
    const mismatch = runFp005Repair(completionResponse({
      scene_condition_package: { ...sceneConditionPackage, scene_location }, data_debt: [],
    }));
    assert.equal(mismatch.materialization_ready, false, "scene_location must remain an exact V7 upstream pass-through");
    assert.equal(mismatch.scene_condition_package, null);
  }
});

test("ZH04 rejects a scene package without the V7 forbid-lines field before presentation", () => {
  const materializationFix = node(ids.materializationFix)?.parameters.jsCode ?? "";
  const scope = {
    local_operator_id: "11111111-1111-4111-8111-111111111111",
    book_id: "22222222-2222-4222-8222-222222222222",
    l1a_id: "33333333-3333-4333-8333-333333333333",
  };
  const incomplete = structuredClone(sceneConditionPackage);
  delete incomplete.forbid_lines_active;
  const output = executeCode(materializationFix, {
    $: () => ({ first: () => ({ json: {
      context: {
        scope_ok: true,
        scope,
        l1a_unit: { scene_location: sceneConditionPackage.scene_location, participant_chars_json: sceneConditionPackage.participant_chars },
        data_debt: [],
      },
    } }) }),
    $json: completionResponse({ scene_condition_package: incomplete }),
  })[0].json;

  assert.equal(output.materialization_ready, false);
  assert.equal(output.scene_condition_package, null);
  assert.equal(output.redacted_error.code, "INVALID_REQUEST");

  const invalidNotes = structuredClone(sceneConditionPackage);
  invalidNotes.materialize_notes = {};
  const invalidNotesOutput = executeCode(materializationFix, {
    $: () => ({ first: () => ({ json: {
      context: {
        scope_ok: true,
        scope,
        l1a_unit: { scene_location: sceneConditionPackage.scene_location, participant_chars_json: sceneConditionPackage.participant_chars },
        data_debt: [],
      },
    } }) }),
    $json: completionResponse({ scene_condition_package: invalidNotes }),
  })[0].json;

  assert.equal(invalidNotesOutput.materialization_ready, false);
  assert.equal(invalidNotesOutput.scene_condition_package, null);
  assert.equal(invalidNotesOutput.redacted_error.code, "INVALID_REQUEST");
});

test("FP005 drops runtime and qualitative resource debts but preserves an explicit quantity debt", () => {
  const materializationFix = node(ids.materializationFix)?.parameters.jsCode ?? "";
  const scope = {
    local_operator_id: "11111111-1111-4111-8111-111111111111",
    book_id: "22222222-2222-4222-8222-222222222222",
    l1a_id: "33333333-3333-4333-8333-333333333333",
  };
  const baseContext = (l1a = {}) => ({
    scope_ok: true,
    scope,
    l1a_unit: {
      scene_location: sceneConditionPackage.scene_location,
      participant_chars_json: sceneConditionPackage.participant_chars,
      ...l1a,
    },
    world_state: [{
      board_type: "resource",
      atom_type: "resource",
      atom_key: "resource.slice001",
      atom_value_jsonb: { scarcity_level: "稀缺", usability: "身份凭据" },
    }],
    data_debt: [],
  });
  const run = (debts, l1a) => executeCode(materializationFix, {
    $: () => ({ first: () => ({ json: { context: baseContext(l1a) } }) }),
    $json: completionResponse({ scene_condition_package: sceneConditionPackage, data_debt: debts }),
  })[0].json;

  const runtime = run([
    { field: "信用余额", upstream: "hero" },
    { field: "配给额度", upstream: "resource.slice001" },
    { field: "资源余量", upstream: "resource.slice001" },
  ]);
  assert.equal(runtime.materialization_ready, true);
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.data_debt)), []);

  const qualitative = run([{ field: "身份凭据数量", upstream: "resource.slice001" }]);
  assert.equal(qualitative.materialization_ready, true);
  assert.deepEqual(JSON.parse(JSON.stringify(qualitative.data_debt)), []);

  const explicit = run(
    [{ field: "身份凭据数量", upstream: "resource.slice001" }],
    { conflict_background: "本段明确要求至少 3 枚身份凭据才能通过核验。" },
  );
  assert.equal(explicit.materialization_ready, false);
  assert.equal(JSON.parse(JSON.stringify(explicit.data_debt))[0].field, "身份凭据数量");
});

test("FP005 requires the V7 density note for a sparse functional scene package", () => {
  const materializationFix = node(ids.materializationFix)?.parameters.jsCode ?? "";
  const scope = {
    local_operator_id: "11111111-1111-4111-8111-111111111111",
    book_id: "22222222-2222-4222-8222-222222222222",
    l1a_id: "33333333-3333-4333-8333-333333333333",
  };
  const run = (sceneConditionPackage) => executeCode(materializationFix, {
    $: () => ({ first: () => ({ json: {
      context: {
        scope_ok: true,
        scope,
        l1a_unit: {
          scene_location: sceneConditionPackage.scene_location,
          participant_chars_json: sceneConditionPackage.participant_chars,
        },
        data_debt: [],
      },
    } }) }),
    $json: completionResponse({ scene_condition_package: sceneConditionPackage, data_debt: [] }),
  })[0].json;

  const sparse = {
    ...sceneConditionPackage,
    scene_affordance: [sceneConditionPackage.scene_affordance[0]],
    available_resource_codes: ["resource.initial"],
    materialize_notes: [],
  };
  const missingNote = run(sparse);
  assert.equal(missingNote.materialization_ready, false);
  assert.equal(missingNote.redacted_error.code, "INVALID_REQUEST");

  const marked = run({
    ...sparse,
    materialize_notes: ["场景资源功能密度不足"],
  });
  assert.equal(marked.materialization_ready, true);

  const equivalent = run({
    ...sparse,
    materialize_notes: ["资源功能密度不足：身份凭据需与配给制规则严格绑定"],
  });
  assert.equal(equivalent.materialization_ready, true);
  assert.equal(JSON.stringify(equivalent.scene_condition_package.materialize_notes), JSON.stringify(["场景资源功能密度不足"]));
});

test("FP005 prompt requires the exact sparse-density note text", () => {
  const start = promptMaterial.indexOf("### FP005-01");
  const end = promptMaterial.indexOf("### FP006-01", start);
  assert.match(promptMaterial.slice(start, end), /materialize_notes 必须逐字包含/u);
});

test("ZH04 rejects a truncated scene-package JSON object before presentation", () => {
  const materializationFix = node(ids.materializationFix)?.parameters.jsCode ?? "";
  const scope = {
    local_operator_id: "11111111-1111-4111-8111-111111111111",
    book_id: "22222222-2222-4222-8222-222222222222",
    l1a_id: "33333333-3333-4333-8333-333333333333",
  };
  const completeOutput = JSON.stringify({ scene_condition_package: sceneConditionPackage, data_debt: [] });
  const truncated = executeCode(materializationFix, {
    $: () => ({ first: () => ({ json: {
      context: {
        scope_ok: true,
        scope,
        l1a_unit: { scene_location: sceneConditionPackage.scene_location, participant_chars_json: sceneConditionPackage.participant_chars },
        data_debt: [],
      },
    } }) }),
    $json: completionText(completeOutput.slice(0, -1)),
  })[0].json;

  assert.equal(truncated.materialization_ready, false);
  assert.equal(truncated.scene_condition_package, null);
  assert.equal(truncated.redacted_error.code, "INVALID_REQUEST");

  const finalFenced = executeCode(materializationFix, {
    $: () => ({ first: () => ({ json: {
      context: {
        scope_ok: true,
        scope,
        l1a_unit: { scene_location: sceneConditionPackage.scene_location, participant_chars_json: sceneConditionPackage.participant_chars },
        data_debt: [],
      },
    } }) }),
    $json: completionText(`模型分析：先核对场景约束。\n{"draft":"not a DTO"}\n\`\`\`json\n${completeOutput}\n\`\`\``),
  })[0].json;
  assert.equal(finalFenced.materialization_ready, true);
  assert.equal(finalFenced.scene_condition_package.scene_location, sceneConditionPackage.scene_location);

  const trailingText = executeCode(materializationFix, {
    $: () => ({ first: () => ({ json: {
      context: {
        scope_ok: true,
        scope,
        l1a_unit: { scene_location: sceneConditionPackage.scene_location, participant_chars_json: sceneConditionPackage.participant_chars },
        data_debt: [],
      },
    } }) }),
    $json: completionText(`\`\`\`json\n${completeOutput}\n\`\`\`\n继续说明`),
  })[0].json;
  assert.equal(trailingText.materialization_ready, false);
  assert.equal(trailingText.scene_condition_package, null);

  const multipleRoots = executeCode(materializationFix, {
    $: () => ({ first: () => ({ json: {
      context: {
        scope_ok: true,
        scope,
        l1a_unit: { scene_location: sceneConditionPackage.scene_location, participant_chars_json: sceneConditionPackage.participant_chars },
        data_debt: [],
      },
    } }) }),
    $json: completionText(`${completeOutput}\n{"draft":"not a DTO"}`),
  })[0].json;
  assert.equal(multipleRoots.materialization_ready, false);
  assert.equal(multipleRoots.scene_condition_package, null);
});

test("FP005 treats active forbid lines as the current L1A outline boundary only", () => {
  const start = promptMaterial.indexOf("### FP005-01");
  const end = promptMaterial.indexOf("### FP006-01", start);
  const fp005Prompt = promptMaterial.slice(start, end);

  assert.match(fp005Prompt, /forbid_lines_active/);
  assert.match(fp005Prompt, /只作用于当前 L1A/);
  assert.match(fp005Prompt, /不得从 book_project\.forbid_json 生成/);
  assert.match(fp005Prompt, /不得跨 L1A 继承/);
  assert.match(fp005Prompt, /不是章节级硬约束/);
  assert.match(fp005Prompt, /不需要在后续内容延续/);
  assert.match(fp005Prompt, /不得自动复制为 forbid_content/);
  assert.match(fp005Prompt, /world_pack_json、rule_locks 或 scene_constraints/);
  assert.match(fp005Prompt, /scene_location 必须与输入完全逐字复制/);
  assert.match(fp005Prompt, /participant_chars 必须与输入 participant_chars_json 完全一致的 JSON 数组/);
  assert.match(fp005Prompt, /materialize_notes 必须是字符串数组/);
});

test("FP006 requires at least one chapter boundary before its candidate can enter approval", () => {
  const start = promptMaterial.indexOf("### FP006-01");
  const end = promptMaterial.indexOf("### FP007-01", start);
  const fp006Prompt = promptMaterial.slice(start, end);

  assert.match(fp006Prompt, /chapter_division 必须至少包含一项/u);
});

test("ZH04 provider errors and mapping failures remain on the response path without invoking RPC-007", () => {
  for (const id of [
    ids.context,
    ids.firstExecution,
    "14cd7dda-b21d-437c-ad70-95f8c7340580",
    ids.persistence,
    "21a8d8d7-39c8-4d1e-9a12-bbd361a766ca",
  ]) assert.equal(node(id)?.onError, "continueRegularOutput", node(id)?.name);
  assert.equal(node("d02111c6-3ef5-4bf5-b8ce-2bdc5bece554")?.onError, "stopWorkflow");
  assert.equal(node("73c95996-64b3-4bb6-8c5b-119d80c55732")?.onError, "stopWorkflow");

  const actionRoute = node(ids.actionRoute);
  const approvalRoute = node(ids.approvalRoute);
  const responseName = node(ids.response).name;
  const contextError = { error: "database unavailable" };
  assert.equal(expressionValue(actionRoute.parameters.conditions.conditions[0].leftValue, contextError), "");
  assert.equal(expressionValue(approvalRoute.parameters.conditions.conditions[0].leftValue, contextError), "");
  assert.equal(workflow.connections[approvalRoute.name].main[1][0].node, responseName);

  const scope = {
    local_operator_id: "11111111-1111-4111-8111-111111111111",
    book_id: "22222222-2222-4222-8222-222222222222",
    l1a_id: "33333333-3333-4333-8333-333333333333",
  };
  const candidate = {
    plot_retained: [], small_arc_sequence: [], emotion_arc: {}, foreshadow_layers: {},
    hook_positions: [], hotpoint_positions: [], revelation_plan: {}, chapter_division: [],
  };
  const modelContext = {
    scope_ok: true,
    scope,
    request: { action: "generate" },
    l1a_unit: { scene_location: "scene", participant_chars_json: [] },
    data_debt: [],
    runtime_bindings: {},
  };
  const materializationFailure = executeCode(node(ids.materializationFix).parameters.jsCode, {
    $: () => ({ first: () => ({ json: { context: modelContext } }) }),
    $json: { error: "FP005 provider unavailable" },
  })[0].json;
  assert.equal(materializationFailure.materialization_ready, false);
  assert.equal(materializationFailure.scene_condition_package, null);

  const presentationFailure = executeCode(node(ids.presentationFix).parameters.jsCode, {
    $: () => ({ first: () => ({ json: { ...materializationFailure, materialization_ready: true } }) }),
    $json: { error: "FP006 provider unavailable" },
  })[0].json;
  assert.equal(presentationFailure.presentation_ready, false);
  assert.equal(presentationFailure.l1a_presentation_plan, null);

  const mapper = node(ids.mapper).parameters.jsCode;
  const mapped = executeCode(mapper, {
    $: () => ({ first: () => ({ json: { context: { scope_ok: true, scope, request: { scope, l1a_presentation_plan: candidate, idempotency_key: "approve-error", correlation_id: "c" } } } }) }),
    $input: { item: { json: { error: "provider unavailable" } } },
  })[0].json;
  assert.equal(mapped.mapping_ok, false);

  const persistence = node(ids.persistence);
  const replacements = expressionValue(persistence.parameters.options.queryReplacement, mapped);
  assert.equal(replacements[0], false);
  assert.equal(JSON.parse(replacements[2]).ok, false);
  assert.match(persistence.parameters.query, /CASE WHEN \$1::boolean THEN public\.rpc_persist_chapter_execution_plan/);

  const controlled = JSON.parse(replacements[2]);
  const response = node(ids.response);
  assert.equal(expressionValue(response.parameters.responseBody, { response: controlled }).ok, false);
  assert.equal(expressionValue(response.parameters.options.responseCode, { response: controlled }), 400);
});

test("ZH04 preserves an FP005 data-debt result when later presentation mapping has no candidate", () => {
  const response = node(ids.response);
  const blocked = {
    context: {
      request: { action: "generate", correlation_id: "production-data-debt" },
      scope: {
        local_operator_id: "11111111-1111-4111-8111-111111111111",
        book_id: "22222222-2222-4222-8222-222222222222",
        l1a_id: "33333333-3333-4333-8333-333333333333",
      },
    },
    presentation_ready: false,
    l1a_presentation_plan: null,
    data_debt: [{ field: "resource.usability", upstream: "world_state" }],
    redacted_error: {
      code: "DATA_DEBT",
      message: "The scene condition package is blocked by missing upstream data.",
    },
  };

  const body = expressionValue(response.parameters.responseBody, blocked);
  assert.equal(body.ok, false);
  assert.equal(body.correlation_id, "production-data-debt");
  assert.equal(body.redacted_error.code, "DATA_DEBT");
  assert.equal(body.redacted_error.message, blocked.redacted_error.message);
  assert.equal(expressionValue(response.parameters.options.responseCode, blocked), 400);
});

test("ZH04 returns 200 for a validated return action only", () => {
  const response = node(ids.response);
  const scope = {
    local_operator_id: "11111111-1111-4111-8111-111111111111",
    book_id: "22222222-2222-4222-8222-222222222222",
    l1a_id: "33333333-3333-4333-8333-433333333333",
  };
  const validReturn = {
    context: {
      scope_ok: true,
      scope,
      request: {
        action: "return",
        scope,
        return_direction: "补充场景条件",
        correlation_id: "return-valid",
      },
    },
  };
  const invalidReturn = {
    context: {
      scope_ok: true,
      scope,
      request: {
        action: "return",
        scope: { ...scope, book_id: "44444444-4444-4444-8444-444444444444" },
        return_direction: "补充场景条件",
        correlation_id: "return-invalid",
      },
    },
  };

  assert.equal(expressionValue(response.parameters.responseBody, validReturn).ok, true);
  assert.equal(expressionValue(response.parameters.options.responseCode, validReturn), 200);
  assert.equal(expressionValue(response.parameters.responseBody, invalidReturn).ok, false);
  assert.equal(expressionValue(response.parameters.options.responseCode, invalidReturn), 400);
});

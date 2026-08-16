import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const workflowPath = path.join(root, "docs/\u540e\u7aef/n8n/ZH01-\u65b0\u4e66\u521b\u5efa.json");
const promptPath = path.join(root, "docs/\u540e\u7aef/\u5bf9\u9f50\u7248\u63d0\u793a\u8bcd.md");
const workflow = JSON.parse(readFileSync(workflowPath, "utf8"));
const promptSource = readFileSync(promptPath, "utf8");

const names = Object.freeze({
  format: "\u6574\u7406\u524d\u7aef\u683c\u5f0f\u5316\u8868\u5355",
  route: "FP001-02",
  skillReader: "\u8bfb\u5e93\u9898\u6750\u6280\u80fd",
  dialogue: "FP001-03 \u5f00\u4e66\u8868\u5355\u62bd\u53d6\u8865\u5168",
  dialogueModel: "\u8bfb\u9898\u6750\u6280\u80fd",
  commercial: "FP001-05 \u5546\u4e1a\u6f5c\u529b\u8bc4\u4ef7",
  aggregate: "FP001-03+05 \u786e\u5b9a\u6027\u6c47\u603b",
  validator: "JSON \u4fee\u590d / \u8f93\u51fa\u6821\u9a8c",
  respond: "Respond\uff1a\u8fd4\u56de\u524d\u7aef",
  compiler: "\u7f16\u8bd1\u6b63\u5f0f\u63d0\u4ea4\u5305",
  write: "FP001-07",
  success: "Respond\uff1a\u521b\u5efa\u6210\u529f",
  memory: "Simple Memory",
});

function node(name) {
  const result = workflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(result, `missing workflow node: ${name}`);
  return result;
}

function edgeCount() {
  return Object.values(workflow.connections)
    .flatMap((typed) => Object.values(typed))
    .flatMap((outputs) => outputs)
    .flatMap((group) => group || [])
    .length;
}

function runCode(name, input, sources = {}, executionId = "zh01-test") {
  const source = (sourceName) => {
    if (!Object.hasOwn(sources, sourceName)) throw new Error(`source not executed: ${sourceName}`);
    return { item: { json: sources[sourceName] } };
  };
  const execute = new Function("$input", "$execution", "$", node(name).parameters.jsCode);
  return execute({ item: { json: input } }, { id: executionId }, source);
}

function resolveN8nExpression(expression, json, sources = {}) {
  const source = String(expression || "").trim();
  assert.match(source, /^=\{\{[\s\S]*\}\}$/);
  const upstream = (name) => {
    if (!Object.hasOwn(sources, name)) throw new Error(`source not executed: ${name}`);
    return { first: () => ({ json: sources[name] }) };
  };
  return new Function("$json", "$", `return (${source.slice(3, -2)});`)(json, upstream);
}

function serializeCommercialChatRequest(commercial, runtime) {
  return JSON.parse(resolveN8nExpression(commercial.parameters.jsonBody, runtime));
}

test("ZH01 attachment preserves the 14-node, 16-edge recovery topology", () => {
  assert.equal(workflow.name, "ZH01-\u65b0\u4e66\u521b\u5efa");
  assert.equal(workflow.active, false);
  assert.equal(workflow.nodes.length, 14);
  assert.equal(edgeCount(), 16);
  assert.equal(workflow.nodes.some((candidate) => candidate.name === "FP001-03/05 \u914d\u7f6e\u9884\u68c0"), false);

  const reader = node(names.skillReader);
  assert.equal(reader.type, "n8n-nodes-base.postgres");
  assert.equal(reader.typeVersion, 2.6);
  assert.match(reader.parameters.query, /rpc_workbench\(jsonb_build_object\(\s*'action', 'read'/);
  assert.match(reader.parameters.query, /'FP001-03'/);
  assert.match(reader.parameters.query, /'FP001-05'/);
  assert.match(reader.parameters.query, /source_type='system_builtin'/);
  assert.match(reader.parameters.query, /lifecycle_status='active'/);
  assert.equal(reader.parameters.options.queryReplacement, "={{ [JSON.stringify($json)] }}");

  const routes = workflow.connections[names.route].main;
  assert.equal(routes.length, 4);
  assert.equal(routes[0][0].node, names.compiler);
  assert.equal(routes[1][0].node, names.skillReader);
  assert.deepEqual(routes[2].map((edge) => edge.node), [names.dialogue, names.commercial]);
  assert.equal(routes[3][0].node, names.respond);
  assert.equal(workflow.connections[names.skillReader].main[0][0].node, names.route);
  assert.equal(workflow.connections[names.compiler].main[0][0].node, names.write);
  assert.equal(workflow.connections[names.write].main[0][0].node, names.success);
  assert.deepEqual(workflow.connections[names.aggregate].main[0].map((edge) => edge.node), [names.validator]);
  assert.equal(workflow.connections[names.validator].main[0][0].node, names.respond);

  const memory = node(names.memory);
  assert.equal(memory.parameters.sessionIdType, "customKey");
  assert.equal(memory.parameters.sessionKey, "={{ $json.correlation_id }}");
});

test("ZH01 model calls retry transient network failures at most twice", () => {
  for (const name of [names.dialogueModel, names.commercial]) {
    const model = node(name);
    assert.equal(model.retryOnFail, true, name);
    assert.equal(model.maxTries, 3, name);
    assert.equal(model.waitBetweenTries, 3000, name);
  }
});

test("FP001-03 keeps the V1 chat model contract required for dynamic provider binding", () => {
  const model = node(names.dialogueModel);
  assert.equal(model.type, "@n8n/n8n-nodes-langchain.lmChatOpenAi");
  assert.equal(model.typeVersion, 1);
  assert.equal(typeof model.parameters.model, "string");
  assert.equal(Object.hasOwn(model.parameters, "responsesApiEnabled"), false);
  assert.equal(Object.hasOwn(model.parameters, "builtInTools"), false);
  assert.equal(Object.hasOwn(model.parameters.options, "responseFormat"), false);
  assert.equal(model.parameters.options.timeout, 60000);

  const validator = node(names.validator).parameters.jsCode;
  assert.match(validator, /(?:JSON\.parse\(value\)|parseSingleJson\(value\))/);
  assert.doesNotMatch(validator, /jsonrepair|parsePartialJson|lastIndexOf\(['"]\}['"]\)/i);
});

test("FP001-05 consumes the active commercial binding through a dynamic HTTP chat-completions request", () => {
  const commercial = node(names.commercial);
  assert.equal(commercial.type, "n8n-nodes-base.httpRequest");
  assert.equal(commercial.typeVersion, 4.2);
  assert.equal(commercial.parameters.method, "POST");
  assert.equal(commercial.parameters.authentication, "predefinedCredentialType");
  assert.equal(commercial.parameters.nodeCredentialType, "openAiApi");
  assert.equal(commercial.parameters.sendBody, true);
  assert.equal(commercial.parameters.contentType, "json");
  assert.equal(commercial.parameters.specifyBody, "json");
  assert.equal(commercial.retryOnFail, true);
  assert.equal(commercial.maxTries, 3);
  assert.equal(commercial.waitBetweenTries, 3000);
  assert.equal(commercial.onError, "continueRegularOutput");
  assert.equal(commercial.credentials.openAiApi.name, "OpenAI account");
  const runtime = {
    commercial_model: {
      model_name: "nvidia/nemotron-3-super-120b-a12b:free",
      provider_base_url: "https://openrouter.ai/api/v1",
      temperature: 0.7,
    },
    commercial_prompt: "Commercial analysis prompt",
    commercial_input: { form_snapshot: { title: "Preview" }, creator_message: "Check the current draft." },
  };
  assert.equal(resolveN8nExpression(commercial.parameters.url, runtime), "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(
    resolveN8nExpression(commercial.parameters.url, {
      ...runtime,
      commercial_model: { ...runtime.commercial_model, provider_base_url: "https://openrouter.ai/api/v1/chat/completions" },
    }),
    "https://openrouter.ai/api/v1/chat/completions",
  );
  const serializedRequest = serializeCommercialChatRequest(commercial, runtime);
  assert.equal(serializedRequest.model, runtime.commercial_model.model_name);
  assert.equal(serializedRequest.temperature, runtime.commercial_model.temperature);
  assert.deepEqual(serializedRequest.messages, [
    { role: "system", content: runtime.commercial_prompt },
    { role: "user", content: JSON.stringify(runtime.commercial_input) },
  ]);
  assert.doesNotMatch(JSON.stringify(commercial), /\/responses\b/u);
  assert.doesNotMatch(JSON.stringify(commercial), /api\.openai\.com/u);
});

test("FP001-03 V1 submodel resolves all runtime fields from the explicit skill-reader output", () => {
  const model = node(names.dialogueModel);
  const skillReaderOutput = {
    dialogue_model: {
      model_name: "gpt-5.6-terra",
      provider_base_url: "https://sub2api.izhe.top/v1",
      temperature: 0.35,
    },
  };

  assert.equal(resolveN8nExpression(model.parameters.model, {}, { [names.skillReader]: skillReaderOutput }), "gpt-5.6-terra");
  assert.equal(resolveN8nExpression(model.parameters.options.baseURL, {}, { [names.skillReader]: skillReaderOutput }), "https://sub2api.izhe.top/v1");
  assert.equal(resolveN8nExpression(model.parameters.options.temperature, {}, { [names.skillReader]: skillReaderOutput }), 0.35);

  for (const expression of [
    model.parameters.model,
    model.parameters.options.baseURL,
    model.parameters.options.temperature,
  ]) {
    assert.match(expression, /\$\('读库题材技能'\)\.first\(\)\.json\.dialogue_model/);
  }
});

test("FP001-03 prompt requires a final exact JSON syntax check", () => {
  const start = promptSource.indexOf("### FP001-03");
  const end = promptSource.indexOf("### FP001-05", start);
  assert.ok(start >= 0 && end > start, "FP001-03 prompt section is missing");
  const fp001Prompt = promptSource.slice(start, end);
  assert.match(fp001Prompt, /JSON\.parse/);
  assert.match(fp001Prompt, /不得输出多余的闭合花括号/);
});

test("formatter only dispatches creator action and preserves the supplied correlation ID", () => {
  const preview = runCode(names.format, {
    action: "preview",
    form_data: { correlation_id: "preview-correlation", title: "Draft" },
    creator_message: "Help find the premise.",
  })[0].json;
  assert.deepEqual(preview, {
    action: "preview",
    route: "preflight",
    form_data: { correlation_id: "preview-correlation", title: "Draft" },
    creator_message: "Help find the premise.",
    correlation_id: "preview-correlation",
  });

  const confirm = runCode(names.format, {
    action: "confirm_create",
    correlation_id: "outer-correlation",
    form_data: { title: "Formal" },
  })[0].json;
  assert.equal(confirm.route, "confirm");
  assert.equal(confirm.correlation_id, "outer-correlation");

  const blocked = runCode(names.format, { action: "unexpected" })[0].json;
  assert.equal(blocked.route, "blocked");
  assert.doesNotMatch(node(names.format).parameters.jsCode, /stage_lock|candidate_apply|commercial|world_atoms/);
});

test("confirm branch compiles only the stable create RPC DTO", () => {
  const request = {
    local_operator_id: "11111111-1111-1111-1111-111111111111",
    idempotency_key: "zh01-confirm-1",
    title: "Workflow contract book",
    intent_json: { genre_main: "\u79d1\u5e7b" },
    forbid_json: {},
    characters: [],
    relations: [],
    world_states: [],
    world_bindings: [],
    initial_l1a: {},
  };
  const compiled = runCode(names.compiler, {
    action: "confirm_create",
    route: "confirm",
    form_data: request,
    correlation_id: "create-1",
  })[0].json;
  assert.deepEqual(compiled, {
    create_request: { ...request, correlation_id: "create-1" },
    correlation_id: "create-1",
  });
  assert.equal(Object.hasOwn(compiled.create_request, "genre_main"), false);
  assert.equal(node(names.write).parameters.query, "SELECT public.rpc_create_book_project($1::jsonb) AS response");
  assert.equal(node(names.write).parameters.options.queryReplacement, "={{ [JSON.stringify($json.create_request)] }}");
});

test("preview normalizer requires dialogue JSON while treating commercial advice as optional", () => {
  const sources = {
    [names.skillReader]: { correlation_id: "preview-1" },
    [names.dialogue]: {
      output: JSON.stringify({
        missing_items: ["characters"],
        chat_message: "Who will bear the cost?",
        lock_respected: true,
        incremental_updates: { intent_json: { theme: "choice" } },
        stage_completion: { origin: 1 },
      }),
    },
    [names.commercial]: {
      output: JSON.stringify({
        shangye: 6,
        shangye_dimensions: { originality: 2, visualization: 1, emotion_value: 1, stickiness: 1, depth: 1 },
        shangye_deduction_reasons: {
          originality: "The premise has a distinct constraint.",
          visualization: "The setting can produce visible pressure.",
          emotion_value: "The emotional cost is present but still broad.",
          stickiness: "The long-term promise needs sharper hooks.",
          depth: "The value conflict is visible but not yet layered.",
        },
        stage_analysis: [],
        cross_stage_conflicts: [],
      }),
    },
  };
  const preview = runCode(names.validator, {}, sources)[0].json;
  assert.equal(preview.status, "preview");
  assert.equal(preview.correlation_id, "preview-1");
  assert.deepEqual(preview.missing_fields, ["characters"]);
  assert.equal(preview.commercial_potential.shangye, 6);

  const blocked = runCode(names.validator, {}, {
    ...sources,
    [names.dialogue]: { output: "not-json" },
  })[0].json;
  assert.deepEqual(blocked, {
    status: "BLOCKED",
    code: "PREVIEW_OUTPUT_INVALID",
    message: "The preview could not be produced.",
    correlation_id: "preview-1",
  });

  const previewWithoutCommercialAdvice = runCode(names.validator, {}, {
    ...sources,
    [names.commercial]: { output: "not-json" },
  })[0].json;
  assert.equal(previewWithoutCommercialAdvice.status, "preview");
  assert.equal(previewWithoutCommercialAdvice.commercial_potential, null);
  assert.equal(previewWithoutCommercialAdvice.correlation_id, "preview-1");
});

test("preview normalizer reads five-dimension commercial advice from the HTTP chat-completions output", () => {
  const commercial = {
    shangye: 6,
    shangye_dimensions: { originality: 2, visualization: 1, emotion_value: 1, stickiness: 1, depth: 1 },
    shangye_deduction_reasons: {
      originality: "The premise has a distinct constraint.",
      visualization: "The setting can produce visible pressure.",
      emotion_value: "The emotional cost is present but still broad.",
      stickiness: "The long-term promise needs sharper hooks.",
      depth: "The value conflict is visible but not yet layered.",
    },
    stage_analysis: [],
    cross_stage_conflicts: [],
  };
  const preview = runCode(names.validator, {}, {
    [names.skillReader]: { correlation_id: "preview-openai-commercial-1" },
    [names.dialogue]: {
      output: JSON.stringify({
        missing_items: [],
        chat_message: "Which existing fact should the creator decide next?",
        lock_respected: true,
        incremental_updates: { intent_json: { theme: "choice" } },
        stage_completion: { origin: 1 },
      }),
    },
    [names.commercial]: {
      choices: [{ message: { content: JSON.stringify(commercial) } }],
    },
  })[0].json;

  assert.equal(preview.status, "preview");
  assert.deepEqual(preview.commercial_potential, commercial);
});

test("preview normalizer restores a V7 missing-items list misplaced inside candidate updates", () => {
  const result = runCode(names.validator, {}, {
    [names.skillReader]: { correlation_id: "preview-misplaced-missing-items" },
    [names.dialogue]: {
      output: JSON.stringify({
        chat_message: "Which missing fact should the creator decide next?",
        lock_respected: true,
        incremental_updates: {
          missing_items: ["characters[0].five_layers_json.L1.background"],
        },
        stage_completion: { origin: 1 },
      }),
    },
    [names.commercial]: { output: "not-json" },
  })[0].json;

  assert.equal(result.status, "preview");
  assert.deepEqual(result.missing_fields, ["characters[0].five_layers_json.L1.background"]);
  assert.equal(Object.hasOwn(result.incremental_updates, "missing_items"), false);
});

test("preview normalizer rejects placeholder business values without turning increments into a full-package gate", () => {
  // Regression evidence: before the JSON normalizer was repaired, these values
  // could pass through as reviewable candidates despite being non-business placeholders.
  const commercial = {
    output: JSON.stringify({
      shangye: 6,
      shangye_dimensions: { originality: 2, visualization: 1, emotion_value: 1, stickiness: 1, depth: 1 },
      shangye_deduction_reasons: {
        originality: "Distinct premise.",
        visualization: "Visible pressure.",
        emotion_value: "Clear emotional cost.",
        stickiness: "Sustained story engine.",
        depth: "Layered value conflict.",
      },
      stage_analysis: [],
      cross_stage_conflicts: [],
    }),
  };
  const dialogue = (incrementalUpdates, missingItems = []) => ({
    [names.skillReader]: { correlation_id: "preview-placeholder-1" },
    [names.dialogue]: {
      output: JSON.stringify({
        missing_items: missingItems,
        chat_message: "请审阅本轮候选，并说明哪条约束最重要？",
        lock_respected: true,
        incremental_updates: incrementalUpdates,
        stage_completion: { "创作原点": 0.5, "世界设定": 0, "角色设定": 0, "冲突种子": 0 },
      }),
    },
    [names.commercial]: commercial,
  });

  const invalidUpdates = [
    { book_project: { intent_json: { core_conflict: "..." } } },
    { book_project: { intent_json: { core_conflict: "来源未明确" } } },
    { book_project: { intent_json: { forbidden_direction: "来源未明确，待创作者确认。" } } },
    { book_project: { intent_json: { target_emotion: "未知" } } },
    { book_project: { intent_json: { core_selling_point: "TODO" } } },
    { book_project: { intent_json: { core_conflict: "   " } } },
    { book_project: { target_words: 0 } },
    { book_project: { chapter_words: 0 } },
  ];
  for (const incrementalUpdates of invalidUpdates) {
    const result = runCode(names.validator, {}, dialogue(incrementalUpdates))[0].json;
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.code, "PREVIEW_OUTPUT_INVALID");
  }

  const partial = runCode(names.validator, {}, dialogue({
    book_project: {
      intent_json: {
        core_conflict: "封闭避难城要在资源耗尽前决定由谁承担迁徙代价",
        forbidden_direction: null,
      },
      target_words: 1000000,
      chapter_words: 2000,
    },
  }, ["book_project.intent_json.forbidden_direction"]))[0].json;
  assert.equal(partial.status, "preview");
  assert.equal(partial.incremental_updates.book_project.intent_json.forbidden_direction, null);
});

test("preview normalizer converts only explicitly missing empty fields to null", () => {
  const commercial = {
    output: JSON.stringify({
      shangye: 6,
      shangye_dimensions: { originality: 2, visualization: 1, emotion_value: 1, stickiness: 1, depth: 1 },
      shangye_deduction_reasons: {
        originality: "Distinct premise.",
        visualization: "Visible pressure.",
        emotion_value: "Clear emotional cost.",
        stickiness: "Sustained story engine.",
        depth: "Layered value conflict.",
      },
      stage_analysis: [],
      cross_stage_conflicts: [],
    }),
  };
  const sources = (incrementalUpdates, missingItems) => ({
    [names.skillReader]: { correlation_id: "preview-null-1" },
    [names.dialogue]: {
      output: JSON.stringify({
        missing_items: missingItems,
        chat_message: "请审阅本轮候选，并说明哪条约束最重要？",
        lock_respected: true,
        incremental_updates: incrementalUpdates,
        stage_completion: { "创作原点": 0.5, "世界设定": 0, "角色设定": 0, "冲突种子": 0 },
      }),
    },
    [names.commercial]: commercial,
  });

  const listed = runCode(
    names.validator,
    {},
    sources({ characters: [{ char_name: "" }] }, ["characters[0].char_name"]),
  )[0].json;
  assert.equal(listed.status, "preview");
  assert.equal(listed.incremental_updates.characters[0].char_name, null);

  const unlisted = runCode(
    names.validator,
    {},
    sources({ characters: [{ char_name: "" }] }, []),
  )[0].json;
  assert.equal(unlisted.status, "BLOCKED");
  assert.equal(unlisted.code, "PREVIEW_OUTPUT_INVALID");
});

test("FP001-03 normalizes a top-level world candidate without preserving cross-board L1 fields", () => {
  const dialogue = {
    missing_items: [],
    chat_message: "请确认这处地理设定是否符合创作意图。",
    lock_respected: true,
    incremental_updates: {
      world_state: [{
        board_type: "地理",
        atom_type: "geo",
        atom_key: "geography.orbital-station",
        item_name: "轨道站主体结构",
        item_content: {
          summary: "环轨居住站的维护区域。",
          purpose: "限制无授权人员进入核心轨道。",
          danger_level: "high",
          location_text: "近地轨道的旧维护环。",
        },
        affordance_dims: ["身份门槛"],
      }],
    },
    stage_completion: { world: 0.5 },
  };
  const sources = (payload) => ({
    [names.skillReader]: { correlation_id: "preview-world-l1-contract" },
    [names.dialogue]: { output: JSON.stringify(payload) },
    [names.commercial]: { output: "not-json" },
  });

  assert.equal(runCode(names.validator, {}, sources(dialogue))[0].json.status, "preview");

  const misplaced = structuredClone(dialogue);
  const candidate = misplaced.incremental_updates.world_state[0];
  candidate.item_content = {
    summary: candidate.item_content.summary,
    purpose: candidate.item_content.purpose,
  };
  candidate.danger_level = "high";
  candidate.location_text = "近地轨道的旧维护环。";
  misplaced.missing_items = [];

  const returned = runCode(names.validator, {}, sources(misplaced))[0].json;
  assert.equal(returned.status, "preview");
  assert.deepEqual(returned.incremental_updates.world_state[0].item_content, {
    summary: "环轨居住站的维护区域。",
    purpose: "限制无授权人员进入核心轨道。",
    danger_level: "high",
    location_text: "近地轨道的旧维护环。",
  });
  assert.equal(Object.hasOwn(returned.incremental_updates.world_state[0], "danger_level"), false);
  assert.equal(Object.hasOwn(returned.incremental_updates.world_state[0], "location_text"), false);
});

test("FP001-03 recovers a partial top-level resource response only when it does not touch a locked stage", () => {
  const response = {
    world_state: [{
      atom_key: "resource.industrial_waste",
      board_type: "resource",
      atom_type: "resource",
      item_name: "工业园废料",
      item_content: { summary: "可清点的废钢与低阶晶核。", purpose: "为熔炼和制造提供有限材料。" },
      scarcity_level: "枯竭中",
      usability: "铸造与能量",
      danger_level: 1,
    }],
    missing_items: [],
    stage_completion: { "创作原点": 1, "世界设定": 0.2, "角色设定": 0, "冲突种子": 0 },
  };
  const sources = (lockedStages) => ({
    [names.skillReader]: { correlation_id: "preview-partial-resource", form_data: { locked_stages: lockedStages } },
    [names.dialogue]: { output: JSON.stringify(response) },
    [names.commercial]: { output: "not-json" },
  });

  const recovered = runCode(names.validator, {}, sources([0]))[0].json;
  assert.equal(recovered.status, "preview");
  assert.equal(recovered.lock_respected, true);
  assert.match(recovered.chat_message, /是否/u);
  assert.deepEqual(recovered.incremental_updates.world_state[0].item_content, {
    summary: "可清点的废钢与低阶晶核。",
    purpose: "为熔炼和制造提供有限材料。",
    scarcity_level: "枯竭中",
    usability: "铸造与能量",
  });

  const blocked = runCode(names.validator, {}, sources([1]))[0].json;
  assert.equal(blocked.status, "BLOCKED");
  assert.equal(blocked.code, "PREVIEW_OUTPUT_INVALID");
});

test("FP001-03 restores omitted rule fields only when the creator explicitly supplied them", () => {
  const dialogue = {
    missing_items: [],
    chat_message: "请审阅晶核规则候选，并说明它怎样限制行动？",
    lock_respected: true,
    incremental_updates: {
      world_state: [{
        board_type: "规则",
        atom_type: "rule",
        atom_key: "rule.energy_conservation",
        item_name: "晶核守恒与熔炼代价",
        item_content: {
          summary: "晶核能量只会转移或耗散。",
          purpose: "限制熔炼的能量消耗。",
        },
        affordance_dims: ["能量约束"],
      }],
    },
    stage_completion: { "创作原点": 1, "世界设定": 0.2, "角色设定": 0, "冲突种子": 0 },
  };
  const sources = (creatorMessage) => ({
    [names.skillReader]: { correlation_id: "preview-explicit-rule-fields", creator_message: creatorMessage },
    [names.dialogue]: { output: JSON.stringify(dialogue) },
    [names.commercial]: { output: "not-json" },
  });

  const repaired = runCode(
    names.validator,
    {},
    sources("rule_type=天道，apply_scope=全世界，violate_cost=生命风险。"),
  )[0].json;
  assert.deepEqual(repaired.incremental_updates.world_state[0].item_content, {
    summary: "晶核能量只会转移或耗散。",
    purpose: "限制熔炼的能量消耗。",
    rule_type: "天道",
    apply_scope: "全世界",
    violate_cost: "生命风险",
  });

  const withheld = runCode(names.validator, {}, sources("晶核能量守恒。"))[0].json;
  assert.equal(Object.hasOwn(withheld.incremental_updates, "world_state"), false);
  assert.deepEqual(withheld.missing_fields, [
    "world_state[0].item_content.violate_cost",
    "world_state[0].item_content.apply_scope",
    "world_state[0].item_content.rule_type",
  ]);
});

test("FP001-03 restores explicit fields for the candidate's own world board only", () => {
  const dialogue = {
    missing_items: [],
    chat_message: "请审阅启动资源候选，并说明最先要节省什么？",
    lock_respected: true,
    incremental_updates: {
      world_state: [{
        board_type: "资源",
        atom_type: "resource",
        atom_key: "resource.low_grade_cores",
        item_name: "低阶晶核启动物资",
        item_content: { summary: "工业园内可清点的低阶晶核。", purpose: "为熔炼提供有限启动能量。" },
        affordance_dims: ["资源约束"],
      }],
    },
    stage_completion: { "创作原点": 1, "世界设定": 0.2, "角色设定": 0, "冲突种子": 0 },
  };
  const result = runCode(names.validator, {}, {
    [names.skillReader]: {
      correlation_id: "preview-explicit-resource-fields",
      creator_message: "scarcity_level=枯竭中，usability=铸造与能量，rule_type=天道。",
    },
    [names.dialogue]: { output: JSON.stringify(dialogue) },
    [names.commercial]: { output: "not-json" },
  })[0].json;

  assert.deepEqual(result.incremental_updates.world_state[0].item_content, {
    summary: "工业园内可清点的低阶晶核。",
    purpose: "为熔炼提供有限启动能量。",
    scarcity_level: "枯竭中",
    usability: "铸造与能量",
  });
  assert.equal(Object.hasOwn(result.incremental_updates.world_state[0].item_content, "rule_type"), false);
});

test("FP001-03 rejects fractional relation dimensions outside the V7 integer scale", () => {
  const result = runCode(names.validator, {}, {
    [names.skillReader]: { correlation_id: "preview-relation-scale" },
    [names.dialogue]: {
      output: JSON.stringify({
        missing_items: [],
        chat_message: "Please provide the next detail.",
        lock_respected: true,
        incremental_updates: {
          relation_state: [{
            char_a_ref: "alpha",
            char_b_ref: "beta",
            trust: 0.74,
          }],
        },
        stage_completion: { characters: 0.5 },
      }),
    },
    [names.commercial]: { output: "not-json" },
  })[0].json;

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.code, "PREVIEW_OUTPUT_INVALID");

  const start = promptSource.indexOf("### FP001-03");
  const end = promptSource.indexOf("### FP001-05", start);
  const fp001Prompt = promptSource.slice(start, end);
  assert.match(fp001Prompt, /trust.*-100.*100/);
  assert.match(fp001Prompt, /hostility.*0.*100/);
});

test("FP001-03 blocks an L2 resource candidate without a matching character-world binding", () => {
  const dialogue = {
    missing_items: [],
    chat_message: "请审阅角色的世界资源，并确认是否符合创作意图？",
    lock_respected: true,
    incremental_updates: {
      world_state: [{
        board_type: "resource",
        atom_type: "resource",
        atom_key: "resource.initial",
        item_name: "身份凭据",
        item_content: { summary: "可核验身份", purpose: "进入受限区域", scarcity_level: "稀缺", usability: "仅持有人可用" },
        affordance_dims: ["改变选择集"],
      }],
      characters: [{
        char_id_hint: "hero",
        five_layers_json: { L2: { resources: ["resource.initial"] } },
      }],
    },
    stage_completion: { "创作原点": 1, "世界设定": 1, "角色设定": 1, "冲突种子": 0 },
  };
  const sources = (payload) => ({
    [names.skillReader]: { correlation_id: "preview-unbound-character-resource" },
    [names.dialogue]: { output: JSON.stringify(payload) },
    [names.commercial]: { output: "not-json" },
  });
  const result = runCode(names.validator, {}, sources(dialogue))[0].json;

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.code, "PREVIEW_OUTPUT_INVALID");

  const bound = structuredClone(dialogue);
  bound.incremental_updates.world_bindings = [{
    from_ref_type: "character",
    from_ref_id: "hero",
    to_ref_type: "world",
    to_ref_id: "resource.initial",
    binding_type: "持有",
    binding_strength: "strong",
  }];
  assert.equal(runCode(names.validator, {}, sources(bound))[0].json.status, "preview");
});

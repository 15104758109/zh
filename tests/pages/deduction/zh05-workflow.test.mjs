import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflowPath = new URL("../../../docs/后端/n8n/ZH05-正文推演.json", import.meta.url);
const promptMaterialPath = new URL("../../../docs/后端/对齐版提示词.md", import.meta.url);
const rpcContractPath = new URL("../../../db/install/v7-data-rpc-contract.sql", import.meta.url);
const serviceMainPath = new URL(
  "../../../apps/api/src/features/fp008/fp008-02/main.mjs",
  import.meta.url,
);

async function readWorkflow() {
  return JSON.parse((await readFile(workflowPath, "utf8")).replace(/^\uFEFF/u, ""));
}

test("FP008-01 prompt material produces the particle contract consumed by ZH05", async () => {
  const promptMaterial = await readFile(promptMaterialPath, "utf8");
  const match = promptMaterial.match(/### FP008-01\b[\s\S]*?(?=\n### FP008-02\b)/u);
  assert.ok(match, "FP008-01 prompt section must exist");
  const prompt = match[0];

  assert.match(prompt, /"ok": true/u);
  assert.match(prompt, /"chapters": \[/u);
  for (const field of [
    "particle_id", "content", "type", "emotion_phase", "staged_task", "reveal_to",
    "assigned_to_role_type", "involved_chars", "required_chars", "source_field", "purpose",
  ]) assert.match(prompt, new RegExp(`"${field}"`, "u"), field);
  for (const field of ["char_id", "char_code", "role_type", "activation_reason"]) {
    assert.match(prompt, new RegExp(`"${field}"`, "u"), field);
  }
  assert.match(prompt, /participating_chars/u);
  assert.match(prompt, /world_verified/u);
  assert.match(prompt, /颗粒 `type` 只能为 truth、resource、info、emotion、hook/u);
  assert.match(prompt, /规则、约束、制度限制和场景硬条件只能映射为 `info`.*`truth`/u);
  assert.match(prompt, /逐颗粒类型自检/u);
  assert.match(prompt, /\u4e0d\u5f97\u751f\u6210\u89d2\u8272\u9010\u9897\u7c92\u4efb\u52a1\u5305/u);
  assert.match(prompt, /\u4e25\u683c\u53ea\u8f93\u51fa\u539f\u751f JSON/u);
  assert.doesNotMatch(prompt, /\u53ef\u7528\u9897\u7c92\u5217\u8868|\u89d2\u8272\u4efb\u52a1\u5305\u6a21\u677f/u);
});

test("FP008-02 prompt material uses the V7 knowledge-boundary field names", async () => {
  const promptMaterial = await readFile(promptMaterialPath, "utf8");
  const match = promptMaterial.match(/### FP008-02\b[\s\S]*?(?=\n### FP008-03\b|$)/u);
  assert.ok(match, "FP008-02 prompt section must exist");
  assert.match(match[0], /knowledge_boundary\.unknown/u);
  assert.doesNotMatch(match[0], /knowledge_boundary\.does_not_know/u);
  assert.match(match[0], /candidate_action.*audit_block.*布尔值/u);
  assert.match(match[0], /输出前结构自检/u);
  assert.match(match[0], /audit_block_reason.*audit_block=false/u);
  assert.match(match[0], /char_tasks\[\]\.char_code.*participating_roles_json.*char_code/u);
  assert.match(match[0], /绝不输出 UUID.*角色数据库 ID/u);
  assert.match(match[0], /角色标识一一匹配自检/u);
});

function edgeCount(connections) {
  return Object.values(connections).reduce((total, channels) => (
    total + Object.values(channels).reduce((channelTotal, groups) => (
      channelTotal + groups.reduce((groupTotal, group) => groupTotal + group.length, 0)
    ), 0)
  ), 0);
}

function runCodeNode(source, input, namedNodes, execution = { id: "test-execution" }) {
  const lookup = name => {
    const values = Array.isArray(namedNodes[name]) ? namedNodes[name] : [namedNodes[name]];
    return {
      first: () => ({ json: values[0] }),
      all: () => values.map(json => ({ json })),
    };
  };
  return new Function("$", "$json", "$execution", source)(lookup, input, execution);
}

function runExpression(expression, input) {
  const source = expression.trim().replace(/^={{\s*|\s*}}$/g, "");
  return new Function("$json", `return (${source});`)(input);
}

function runExpressionWithNodes(expression, input, namedNodes) {
  const source = expression.trim().replace(/^={{\s*|\s*}}$/g, "");
  const lookup = name => ({ first: () => ({ json: namedNodes[name] }) });
  return new Function("$", "$json", `return (${source});`)(lookup, input);
}

test("ZH05 routes first starts and checkpoint resumes into their existing responsibility branches", async () => {
  const workflow = await readWorkflow();
  const node = name => workflow.nodes.find(candidate => candidate.name === name);

  assert.equal(workflow.name, "ZH05-正文推演");
  assert.equal(workflow.active, false);
  assert.equal(workflow.nodes.length, 37);
  assert.equal(Object.keys(workflow.connections).length, 33);
  assert.equal(edgeCount(workflow.connections), 46);

  assert.equal(node("Webhook：/production_stage")?.type, "n8n-nodes-base.webhook");
  assert.equal(node("Webhook：/production_stage")?.parameters.httpMethod, "POST");
  assert.equal(node("Webhook：/production_stage")?.parameters.options.allowedOrigins, "*");
  const commandRouter = node("路由 FP008 推演命令");
  assert.equal(commandRouter?.type, "n8n-nodes-base.switch");
  assert.equal(commandRouter?.typeVersion, 3.4);
  assert.equal(commandRouter?.parameters.rules.values.length, 2);
  assert.deepEqual(
    commandRouter?.parameters.rules.values.map(rule => ({
      outputKey: rule.outputKey,
      actions: rule.conditions.conditions.map(condition => condition.rightValue),
      combinator: rule.conditions.combinator,
    })),
    [
      { outputKey: "start", actions: ["start", "restart", "replan"], combinator: "or" },
      { outputKey: "resume", actions: ["resume"], combinator: "and" },
    ],
  );
  assert.equal(commandRouter?.parameters.options.fallbackOutput, "extra");
  assert.deepEqual(workflow.connections["Webhook：/production_stage"], {
    main: [[{ node: "路由 FP008 推演命令", type: "main", index: 0 }]],
  });
  assert.deepEqual(workflow.connections["路由 FP008 推演命令"], {
    main: [
      [{ node: "读取拆解结果", type: "main", index: 0 }],
      [{ node: "读取拆解结果1", type: "main", index: 0 }],
      [{ node: "读取拆解结果1", type: "main", index: 0 }],
    ],
  });
  assert.equal(node("When Executed by Another Workflow")?.type, "n8n-nodes-base.executeWorkflowTrigger");
  assert.deepEqual(node("When Executed by Another Workflow")?.parameters, {
    inputSource: "passthrough",
    workflowInputs: { values: [] },
  });
  assert.equal(workflow.nodes.filter(candidate => candidate.name.startsWith("读取拆解结果")).length, 2);
  assert.equal(workflow.nodes.filter(candidate => candidate.name.startsWith("FP008-01 剧情段颗粒拆解")).length, 3);
  assert.equal(workflow.nodes.filter(candidate => candidate.name.startsWith("FP008-02 核心推演与服务层")).length, 2);
  for (const serviceNode of workflow.nodes.filter(candidate => candidate.name.startsWith("FP008-02 核心推演与服务层"))) {
    assert.equal(serviceNode.parameters.options?.timeout, 10800000);
  }
  assert.equal(workflow.nodes.filter(candidate => candidate.name.startsWith("FP008-03 阶段审计")).length, 5);
  assert.equal(workflow.nodes.filter(candidate => candidate.name.startsWith("If审计通过")).length, 2);
  assert.equal(workflow.nodes.filter(candidate => candidate.name.startsWith("推演结果断章入库")).length, 2);
  assert.equal(workflow.nodes.filter(candidate => candidate.name.startsWith("Respond to Webhook")).length, 2);

  for (const name of ["FP008-04断章分析", "FP008-04断章分析1"]) {
    assert.equal(node(name)?.disabled, true, `${name} must not make a non-V7 model decision`);
  }
  for (const name of ["异常样本入库", "异常样本入库1"]) {
    assert.equal(node(name)?.disabled, true, `${name} must not write without defined failure evidence`);
  }
});

test("ZH05 routes the active FP016 credential reference through static n8n credentials", async () => {
  const workflow = await readWorkflow();
  const node = name => workflow.nodes.find(candidate => candidate.name === name);
  const routes = [
    ["路由 FP008-01 模型凭据", "FP008-01 剧情段颗粒拆解", "FP008-01 剧情段颗粒拆解 RelayCove", "JSON修复"],
    ["路由 FP008-03 初始模型凭据", "FP008-03 阶段审计", "FP008-03 阶段审计 RelayCove", "JSON修复2"],
    ["路由 FP008-03 恢复模型凭据", "FP008-03 阶段审计1", "FP008-03 阶段审计1 RelayCove", "JSON修复7"],
  ];

  for (const [routeName, openAiName, relayName, repairName] of routes) {
    const route = node(routeName);
    assert.equal(route?.type, "n8n-nodes-base.switch");
    assert.equal(route?.parameters.options.fallbackOutput, "extra");
    assert.deepEqual(
      route?.parameters.rules.values.map(rule => rule.conditions.conditions[0].rightValue),
      ["n8n-credential:openai-account-v1", "n8n-credential:relaycove-v1"],
    );
    if (routeName === "路由 FP008-01 模型凭据") {
      assert.ok(
        route.parameters.rules.values.every(rule => rule.conditions.conditions[0].leftValue.includes("context.scope_ok === true")),
        "FP008-01 must take its model branches only for a validated deduction scope",
      );
    }
    assert.deepEqual(workflow.connections[routeName], {
      main: [
        [{ node: openAiName, type: "main", index: 0 }],
        [{ node: relayName, type: "main", index: 0 }],
        [{ node: repairName, type: "main", index: 0 }],
      ],
    });
    assert.deepEqual(workflow.connections[relayName], {
      main: [[{ node: repairName, type: "main", index: 0 }]],
    });
    assert.deepEqual(node(relayName)?.credentials, {
      openAiApi: { id: "ZpJ7ejgoXbQb5xUW", name: "RelayCove account" },
    });
  }
});

test("ZH05 returns a controlled upstream failure through its existing response path", async () => {
  const workflow = await readWorkflow();
  const node = name => workflow.nodes.find(candidate => candidate.name === name);
  const fp008StartNodes = workflow.nodes.filter(candidate => (
    candidate.name.startsWith("FP008-01 ") && candidate.type === "n8n-nodes-base.httpRequest"
  ));

  assert.equal(fp008StartNodes.length, 2);
  for (const startNode of fp008StartNodes) {
    assert.equal(startNode.onError, "continueRegularOutput");
  }

  const repair = node("JSON修复6");
  const output = runCodeNode(repair.parameters.jsCode, {}, {
    "JSON修复7": {
      audit_pass: false,
      engine_result: null,
      redacted_error: {
        code: "MODEL_PROVIDER_UNAVAILABLE",
        message: "The current model service is unavailable.",
      },
    },
    "JSON修复3": {
      engine_request: {
        scope: {
          local_operator_id: "11111111-1111-4111-8111-111111111111",
          book_id: "22222222-2222-4222-8222-222222222222",
          l1a_unit_id: "33333333-3333-4333-8333-333333333333",
        },
      },
    },
  });
  assert.equal(output[0].json.rpc_request, null);
  assert.deepEqual(output[0].json.response, {
    ok: false,
    redacted_error: {
      code: "MODEL_PROVIDER_UNAVAILABLE",
      message: "The current model service is unavailable.",
    },
  });

  assert.match(node("If审计通过").parameters.conditions.conditions[0].leftValue, /restart_required/);
  assert.match(node("If审计通过1").parameters.conditions.conditions[0].leftValue, /restart_required/);
});

test("both FP008-03 preaudit paths preserve provider failures instead of blaming the audit response", async () => {
  const workflow = await readWorkflow();
  const node = name => workflow.nodes.find(candidate => candidate.name === name);

  for (const [normalizerName, serviceName, initialName] of [
    ["JSON修复2", "JSON修复1", "JSON修复"],
    ["JSON修复7", "JSON修复4", null],
  ]) {
    const namedNodes = {
      [serviceName]: {
        service_ok: true,
        engine_result: { service_state: "paused" },
        redacted_error: null,
      },
    };
    if (initialName) namedNodes[initialName] = { mapping_ok: true, engine_request: { chapters: [] } };

    const [normalized] = runCodeNode(node(normalizerName).parameters.jsCode, {
      error: { message: "Bad gateway - the service failed to handle your request" },
    }, namedNodes);

    assert.equal(normalized.json.audit_pass, false);
    assert.deepEqual(normalized.json.redacted_error, {
      code: "MODEL_PROVIDER_UNAVAILABLE",
      message: "The current model service is unavailable.",
    });

    const [stringFailure] = runCodeNode(node(normalizerName).parameters.jsCode, {
      error: "Service unavailable - try again later or consider setting this node to retry automatically",
    }, namedNodes);
    assert.equal(stringFailure.json.audit_pass, false);
    assert.deepEqual(stringFailure.json.redacted_error, {
      code: "MODEL_PROVIDER_UNAVAILABLE",
      message: "The current model service is unavailable.",
    });
  }
});

test("ZH05 preserves the first P0 preaudit error when its automatic restart fails", async () => {
  const workflow = await readWorkflow();
  const normalizer = workflow.nodes.find(candidate => candidate.id === "a30059fc-13f2-4fa5-a002-30e34b746b45");
  const initialNormalizer = workflow.nodes.find(candidate => candidate.id === "a2670d52-4b56-401c-975c-6d8aee890140");
  const service = workflow.nodes.find(candidate => candidate.id === "d78f3c15-e61e-4422-918e-7c3e31e4c929");
  const initialMapper = workflow.nodes.find(candidate => candidate.id === "afd04fbe-6e85-49e0-ad50-7a5a5ab2542b");
  const firstGate = workflow.nodes.find(candidate => candidate.id === "1fa21130-04d4-4be8-9f3d-cc5a2ddddf93");
  const persistenceMapper = workflow.nodes.find(candidate => candidate.id === "f2300036-674d-4ac6-b2c6-09806acfa664");
  const finalGate = workflow.nodes.find(candidate => candidate.id === "ee59e5d8-7cdb-41b9-b949-9e635174ef09");
  assert.ok(normalizer && initialNormalizer && service && initialMapper && firstGate && persistenceMapper && finalGate);
  assert.equal(initialNormalizer.parameters.jsCode.includes(`$('${initialNormalizer.name}').all(0, 0)`), true);
  for (const gate of [firstGate, finalGate]) {
    assert.equal(normalizer.parameters.jsCode.includes(`$('${gate.name}').all(0, 0)`), true);
  }
  assert.equal(normalizer.parameters.jsCode.includes(`$('${normalizer.name}').all(`), false);
  const initial = {
    mapping_ok: true,
    engine_request: {
      action: "resume",
      scope: {
        local_operator_id: "11111111-1111-4111-8111-111111111111",
        book_id: "22222222-2222-4222-8222-222222222222",
        l1a_unit_id: "33333333-3333-4333-8333-333333333333",
      },
      chapters: [{ chapter_id: "chapter-1" }],
    },
  };
  const risk_hints = [
    { check_code: "AUDIT-02", outcome: "block" },
    { check_code: "AUDIT-03", outcome: "pass" },
    { check_code: "AUDIT-05", outcome: "pass" },
    { check_code: "AUDIT-06", outcome: "pass" },
    { check_code: "AUDIT-09", outcome: "pass" },
  ];
  const [preaudit] = runCodeNode(normalizer.parameters.jsCode, {
    data: { choices: [{ message: { content: JSON.stringify({ ok: false, risk_hints }) } }] },
  }, {
    [service.name]: {
      service_ok: true,
      engine_result: { service_state: "completed", chapters: [] },
      redacted_error: null,
    },
    [initialMapper.name]: initial,
  });

  assert.equal(preaudit.json.p0_blocked, true);
  assert.equal(preaudit.json.restart_required, true);
  assert.equal(preaudit.json.route_to_storage, false);
  assert.equal(preaudit.json.mapping_ok, true);
  assert.equal(preaudit.json.engine_request.action, "restart");
  assert.deepEqual(preaudit.json.redacted_error, {
    code: "DEDUCTION_PREAUDIT_BLOCKED",
    message: "The deduction result requires a complete L1A restart.",
  });
  assert.equal(runExpression(finalGate.parameters.conditions.conditions[0].leftValue, preaudit.json), false);

  const retryFailures = [firstGate, finalGate].map(gate => {
    const [retryFailure] = runCodeNode(normalizer.parameters.jsCode, {
      error: { message: "The deduction service connection was reset." },
    }, {
      [service.name]: {
        service_ok: false,
        engine_result: null,
        redacted_error: {
          code: "DEDUCTION_SERVICE_FAILED",
          message: "The deduction service could not complete the command.",
        },
      },
      [initialMapper.name]: initial,
      [gate.name]: [preaudit.json],
    });
    assert.equal(retryFailure.json.route_to_storage, false, gate.name);
    assert.equal(retryFailure.json.mapping_ok, false, gate.name);
    assert.equal(retryFailure.json.engine_request, null, gate.name);
    assert.deepEqual(retryFailure.json.redacted_error, preaudit.json.redacted_error, gate.name);
    assert.equal(runExpression(finalGate.parameters.conditions.conditions[0].leftValue, retryFailure.json), true, gate.name);
    return retryFailure.json;
  });

  const [persistence] = runCodeNode(persistenceMapper.parameters.jsCode, {}, {
    [normalizer.name]: retryFailures[0],
    [initialMapper.name]: initial,
  });
  assert.equal(persistence.json.rpc_request, null);
  assert.equal(persistence.json.restart_required, false);
  assert.equal(persistence.json.mapping_ok, false);
  assert.equal(persistence.json.engine_request, null);
  assert.deepEqual(persistence.json.response, {
    ok: false,
    redacted_error: retryFailures[0].redacted_error,
  });
  assert.equal(runExpression(finalGate.parameters.conditions.conditions[0].leftValue, persistence.json), true);
});

test("the FP008 service default listener matches the local n8n container route", async () => {
  const source = await readFile(serviceMainPath, "utf8");
  assert.match(source, /process\.env\.FP008_HOST \|\| "0\.0\.0\.0"/);
  assert.match(source, /process\.env\.FP008_PORT \|\| 4182/);
});

test("both entry paths read the selected current L1A through parameterized stable projections", async () => {
  const workflow = await readWorkflow();
  const readers = workflow.nodes.filter(candidate => candidate.name.startsWith("读取拆解结果"));

  assert.equal(readers.length, 2);
  for (const reader of readers) {
    const query = reader.parameters.query;
    assert.match(query, /public\.book_project/);
    assert.match(query, /current_l1a_id = a\.l1a_unit_id/);
    assert.match(query, /l1a_status = 'locked_for_deduction'/);
    assert.match(query, /l\.world_resistance_refs/);
    assert.match(query, /'world_resistance_refs', a\.world_resistance_refs/);
    assert.match(query, /public\.chapter_header/);
    assert.match(query, /public\.chapter_version/);
    assert.match(query, /version_state = 'candidate'/);
    assert.match(query, /public\.v_character_active/);
    assert.match(query, /jsonb_array_elements_text\(s\.participant_chars_json\)/);
    assert.match(query, /c\.id IN \(/);
    assert.match(query, /public\.character_memory/);
    assert.match(query, /public\.v_world_assets_for_exec/);
    assert.match(query, /public\.relation_state/);
    assert.match(query, /public\.v_prompt_runtime_binding/);
    assert.match(query, /NODE_05/);
    assert.match(query, /NODE_06/);
    assert.match(query, /token_budget = 3000000/);
    assert.match(query, /mvp-fixed-3000000/);
    assert.match(query, /jsonb_array_elements\(a\.chapters\)/);
    assert.match(query, /forbid_lines_active/);
    assert.match(query, /jsonb_typeof/);
    assert.match(query, /a\.action IS NULL/);
    assert.match(query, /CHECKPOINT_ACTION_MISMATCH/);
    assert.match(query, /predecessor_version_id/);
    assert.match(query, /a\.action IN \('start', 'resume', 'restart', 'replan'\)/);
    if (reader.name === "读取拆解结果") {
      assert.match(query, /n\.action IN \('replan', 'restart'\)/);
      assert.match(query, /\), restart AS MATERIALIZED \(\s+SELECT CASE\s+WHEN n\.action IN \('replan', 'restart'\) THEN public\.rpc_finalize_deduction_snapshot\(n\.request\)/s);
      assert.match(query, /CROSS JOIN restart AS r/);
      assert.doesNotMatch(query, /\b(?:BEGIN|COMMIT)\s*;/);
      assert.doesNotMatch(query, /current_setting\('zh05\.replan_response'/);
      assert.match(query, /a\.action = 'restart' AND a\.return_direction IS NULL\s+AND COALESCE\(a\.replan_response->>'ok', 'false'\) = 'true'\s+AND a\.checkpoint_count = 0/);
    }
    assert.match(query, /a\.action = 'replan' AND a\.return_direction IS NOT NULL\s+AND COALESCE\(a\.replan_response->>'ok', 'false'\) = 'true'\s+AND a\.checkpoint_count = 0/);
    assert.match(query, /WHERE a\.action IN \('start', 'resume', 'restart', 'replan'\);/);
    assert.match(query, /return_direction/);
    assert.match(query, /rpc_finalize_deduction_snapshot/);
    assert.doesNotMatch(query, /\bl1a_chapters\b/);
    assert.doesNotMatch(query, /\b(?:INSERT|UPDATE|DELETE|CALL)\b/i);
    assert.match(reader.parameters.options.queryReplacement, /JSON\.stringify\(\$json\.body \?\? \$json\)/);
  }
});

test("creator replan and technical restart commit before the ZH05 reader projects candidates", async () => {
  const workflow = await readWorkflow();
  const reader = workflow.nodes.find(candidate => candidate.name === "读取拆解结果");
  const query = reader?.parameters?.query || "";

  assert.match(query, /^WITH input AS \(/);
  assert.match(query, /restart AS MATERIALIZED/);
  assert.match(query, /n\.action IN \('replan', 'restart'\)/);
  assert.match(query, /public\.rpc_finalize_deduction_snapshot\(n\.request\)/);
  assert.match(query, /CROSS JOIN restart AS r/);
  assert.doesNotMatch(query, /\b(?:BEGIN|COMMIT)\s*;/);
  assert.doesNotMatch(query, /\bDO \$\$|set_config\('zh05\.replan_response'|current_setting\('zh05\.replan_response'/);
});

test("both ZH05 readers require a non-empty creator direction before RPC-009 replan projection", async () => {
  const workflow = await readWorkflow();
  const readers = workflow.nodes.filter(candidate => candidate.name.startsWith("读取拆解结果"));

  assert.equal(readers.length, 2);
  for (const reader of readers) {
    const query = reader.parameters.query;
    assert.match(query, /NULLIF\(btrim\(request->>'return_direction'\), ''\) AS return_direction/);
    assert.match(query, /a\.action = 'replan' AND a\.return_direction IS NOT NULL/);
    assert.match(query, /a\.action = 'replan' AND a\.return_direction IS NULL/);
    assert.match(query, /rpc_finalize_deduction_snapshot\(v_request\)|rpc_finalize_deduction_snapshot\(n\.request\)/);
    assert.match(query, /a\.action = 'replan'[\s\S]*?a\.checkpoint_count = 0/);
  }
});

test("RPC-009 contract keeps replan, version lineage, and snapshot replay atomic", async () => {
  const sql = await readFile(rpcContractPath, "utf8");
  const start = sql.indexOf("CREATE OR REPLACE FUNCTION public.rpc_finalize_deduction_snapshot");
  const end = sql.indexOf("CREATE OR REPLACE FUNCTION public.rpc_persist_candidate_text", start);
  assert.ok(start >= 0 && end > start, "the canonical RPC-009 definition must exist");
  const contract = sql.slice(start, end);
  const replanStart = contract.indexOf("IF v_action = 'replan' THEN");
  const snapshotStart = contract.indexOf("\n  IF v_l1a IS NULL", replanStart);
  assert.ok(replanStart >= 0 && snapshotStart > replanStart, "RPC-009 must keep replan and snapshot paths distinct");
  const replan = contract.slice(replanStart, snapshotStart);
  const snapshot = contract.slice(snapshotStart);

  assert.match(contract, /v_return_direction text := NULLIF\(btrim\(p_request->>'return_direction'\), ''\)/);
  assert.match(contract, /IF v_return_direction IS NULL/);
  assert.match(contract, /v7_replay_product_request\(\s*'rpc_finalize_deduction_snapshot'/s);
  assert.match(contract, /FOR UPDATE OF h, cv/);
  assert.match(contract, /SET version_state = 'shadow', is_shadow = true, is_formal = false, is_valid = false/);
  assert.match(contract, /predecessor_version_id,\s*\n\s*version_state, is_shadow, is_formal, is_valid/s);
  assert.match(contract, /DEDUCTION_REPLAN_NOT_AVAILABLE/);
  assert.match(contract, /IF v_action = 'restart' THEN/);
  assert.match(contract, /candidate_plot_sim_json = NULL,\s*\n\s*deduction_progress_json = NULL,\s*\n\s*deduction_locked = false/s);
  assert.match(contract, /SET status = 'plan_ready',\s*\n\s*run_status = 'plan_ready'/s);
  assert.match(contract, /DEDUCTION_RESTART_NOT_AVAILABLE/);
  const restartStart = contract.indexOf("IF v_action = 'restart' THEN");
  const restartEnd = contract.indexOf("IF v_l1a IS NULL", restartStart);
  const restart = contract.slice(restartStart, restartEnd);
  assert.ok(restartStart >= 0 && restartEnd > restartStart, "technical restart must have its own atomic RPC-009 branch");
  assert.doesNotMatch(restart, /INSERT INTO public\.chapter_version/);
  assert.doesNotMatch(restart, /version_state = 'shadow'/);
  assert.match(contract, /DEDUCTION_ALREADY_LOCKED/);
  assert.match(contract, /INSERT INTO public\.product_request_log\(operation, idempotency_key/s);

  for (const path of [replan, snapshot]) {
    const firstReplay = path.indexOf("v_result := public.v7_replay_product_request(");
    const bookLock = path.indexOf("PERFORM 1 FROM public.book_project WHERE id = v_book FOR UPDATE;");
    const secondReplay = path.indexOf("v_result := public.v7_replay_product_request(", firstReplay + 1);
    const firstMutation = path.indexOf("PERFORM public.v7_enable_internal_write();");
    assert.ok(
      firstReplay >= 0 && firstReplay < bookLock && bookLock < secondReplay && secondReplay < firstMutation,
      "an idempotent replay must return before either RPC-009 path can mutate candidate state",
    );
  }

  assert.match(replan, /WHERE id = v_l1a\s+AND book_id = v_book\s+AND status = 'locked_for_deduction'/);
  assert.match(replan, /WHERE h\.book_id = v_book\s+AND h\.l1a_unit_id = v_l1a\s+AND NOT h\.is_finalized\s+ORDER BY h\.chapter_index\s+FOR UPDATE OF h, cv/);
  assert.match(snapshot, /v_active_count <> jsonb_array_length\(p_request->'chapters'\)/);
  assert.match(snapshot, /WHERE id = v_input_chapter AND book_id = v_book AND l1a_unit_id = v_l1a\s+FOR UPDATE;/);
  assert.match(snapshot, /WHERE id = v_input_version\s+AND chapter_id = v_input_chapter\s+AND book_id = v_book\s+AND version_state = 'candidate'\s+AND is_valid\s+AND NOT is_shadow\s+FOR UPDATE;/);
});

test("ZH05 supplies stable state baselines to FP008 without writing a first live-state row", async () => {
  const workflow = await readWorkflow();
  const readers = workflow.nodes.filter(candidate => candidate.name.startsWith("读取拆解结果"));

  assert.equal(readers.length, 2);
  for (const reader of readers) {
    const query = reader.parameters.query;
    assert.match(query, /'live_state_id', c\.live_state_id/);
    assert.match(query, /'live_state_source', CASE WHEN c\.live_state_id IS NULL THEN 'initial_live_state_projection'/);
    assert.match(query, /'source', 'initial_live_state_projection'/);
    assert.match(query, /'five_layers_json', c\.five_layers_json/);
    assert.match(query, /'knowledge_boundary_json', c\.knowledge_boundary_json/);
    assert.match(query, /'world_state_id', ws\.id/);
    assert.doesNotMatch(query, /INSERT INTO public\.character_live_state/i);
    assert.doesNotMatch(query, /UPDATE public\.character_live_state/i);
  }
});

test("the FP008-01 start path uses the configured OpenAI-compatible chat endpoint and maps canonical particles", async () => {
  const workflow = await readWorkflow();
  const node = name => workflow.nodes.find(candidate => candidate.name === name);
  const promptNodes = [
    node("FP008-01 剧情段颗粒拆解"),
    node("FP008-01 剧情段颗粒拆解 RelayCove"),
  ];
  const mapperNodes = [node("JSON修复"), node("JSON修复3")];
  const context = {
    runtime_bindings: {
      "FP008-01": {
        model_name: "test-model",
        provider_base_url: "https://model.example/v1",
        prompt_text: "particle prompt",
        api_key_ref: "local-secure-ref:test",
        temperature: 0.2,
        parameters_jsonb: { timeout_ms: 240000 },
      },
    },
    l1a: { l1a_unit_id: "l1a-1" },
    chapters: [{ chapter_id: "chapter-1" }],
    characters: [{ character_id: "character-1" }],
    world_state: [{ world_id: "world-1" }],
    relations: [{ relation_state_id: "relation-1" }],
    model_bindings: { NODE_05: { prompt_text: "private role prompt" } },
  };

  for (const promptNode of promptNodes) {
    assert.equal(promptNode.type, "n8n-nodes-base.httpRequest");
    assert.equal(promptNode.typeVersion, 4.2);
    assert.equal(promptNode.parameters.method, "POST");
    assert.equal(promptNode.parameters.authentication, "predefinedCredentialType");
    assert.equal(promptNode.parameters.nodeCredentialType, "openAiApi");
    for (const expression of [promptNode.parameters.url, promptNode.parameters.jsonBody]) {
      assert.equal(expression.match(/}}/g)?.length, 1, "n8n must not terminate the expression inside JavaScript");
    }
    assert.equal(
      runExpression(promptNode.parameters.url, { context }),
      "https://model.example/v1/chat/completions",
    );
    const request = JSON.parse(runExpression(promptNode.parameters.jsonBody, { context }));
    assert.equal(request.model, "test-model");
    assert.equal(request.temperature, 0.2);
    assert.equal(request.messages.length, 1);
    const prompt = request.messages[0].content;
    for (const field of ["model_name", "provider_base_url", "prompt_text", "api_key_ref"]) {
      assert.match(promptNode.parameters.jsonBody, new RegExp(`\\b${field}\\b`));
    }
    assert.match(promptNode.parameters.jsonBody, /CONFIG_CONTRACT_BLOCKED/);
    assert.match(prompt, /^particle prompt\nINPUT=/);
    for (const value of ["l1a-1", "chapter-1", "character-1", "world-1", "relation-1"]) {
      assert.match(prompt, new RegExp(value));
    }
    assert.doesNotMatch(prompt, /runtime_bindings|model_bindings|api_key_ref|private role prompt/);
    assert.equal(promptNode.parameters.options.response.response.fullResponse, true);
    assert.equal(promptNode.parameters.options.response.response.neverError, true);
    assert.equal(promptNode.parameters.options.response.response.responseFormat, "text");
    assert.equal(runExpression(promptNode.parameters.options.timeout, { context }), 240000);
    assert.equal(promptNode.retryOnFail, true);
    assert.equal(promptNode.maxTries, 3);
    assert.equal(promptNode.waitBetweenTries, 5000);
  }

  for (const mapperNode of mapperNodes) {
    const source = mapperNode.parameters.jsCode;
    for (const field of [
      "particle_id", "content", "type", "emotion_phase", "staged_task", "reveal_to",
      "assigned_to_role_type", "involved_chars", "required_chars", "source_field", "purpose"
    ]) {
      assert.match(source, new RegExp(`\\b${field}\\b`));
    }
    const requestShape = source.match(/const engine_request = \{([\s\S]*?)\n\};/)?.[1] || "";
    for (const field of [
      "action", "scope", "token_budget", "token_budget_version", "chapters",
      "characters", "world_state", "world_resistance_refs", "relations", "model_bindings"
    ]) {
      assert.match(requestShape, new RegExp(`\\b${field}\\b`));
    }
    assert.match(source, /if \(action === 'resume' && chapter\.checkpoint != null\) mapped\.checkpoint = chapter\.checkpoint/);
    assert.match(source, /predecessor_version_id: chapter\.predecessor_version_id/);
    assert.match(source, /target_snapshot_json: chapter\.target_snapshot_json/);
    assert.match(source, /chapter_implementation_json: chapter\.chapter_implementation_json/);
    assert.match(source, /scene_condition_package: chapter\.scene_condition_package/);
    assert.match(source, /participating_chars:/);
    assert.match(source, /shadow_summary:/);
    if (mapperNode.name === "JSON修复") {
      assert.match(requestShape, /creator_direction/);
      assert.match(source, /action === 'replan'/);
    } else {
      assert.doesNotMatch(requestShape, /creator_direction/);
      assert.doesNotMatch(source, /action === 'restart'/);
    }
    assert.match(source, /particle\.type !== 'resource' \|\| particle\.world_verified === true/);
    assert.doesNotMatch(source, /\b(?:run_id|runId)\b/);
  }

  assert.doesNotMatch(JSON.stringify(workflow), /\b(?:run_id|runId)\b/);
});

test("both FP008-03 paths use the configured OpenAI-compatible chat endpoint and normalize its chat response", async () => {
  const workflow = await readWorkflow();
  const paths = [
    {
      audit: workflow.nodes.find(candidate => candidate.id === "b5718a0a-f087-47f1-a154-4e29cf062c3c"),
      reader: workflow.nodes.find(candidate => candidate.id === "189865e3-2c21-407f-ab81-6e46dfc61489"),
      service: workflow.nodes.find(candidate => candidate.id === "78a78ba1-45e7-4d06-8dfc-14bc4daf4ed0"),
      normalizer: workflow.nodes.find(candidate => candidate.id === "a2670d52-4b56-401c-975c-6d8aee890140"),
      initial: workflow.nodes.find(candidate => candidate.id === "64fb6f8a-de62-4543-a426-953bccbb6a20"),
    },
    {
      audit: workflow.nodes.find(candidate => candidate.id === "27389b02-a256-4603-9cba-84e9e65f7743"),
      reader: workflow.nodes.find(candidate => candidate.id === "be602323-61a1-419e-b214-7cd4c0b4ccf7"),
      service: workflow.nodes.find(candidate => candidate.id === "d78f3c15-e61e-4422-918e-7c3e31e4c929"),
      normalizer: workflow.nodes.find(candidate => candidate.id === "a30059fc-13f2-4fa5-a002-30e34b746b45"),
      initial: workflow.nodes.find(candidate => candidate.id === "afd04fbe-6e85-49e0-ad50-7a5a5ab2542b"),
    },
  ];

  const context = {
    runtime_bindings: {
      "FP008-03": {
        model_name: "test-model",
        provider_base_url: "https://model.example/v1",
        prompt_text: "preaudit prompt",
        api_key_ref: "local-secure-ref:test",
        temperature: 0.3,
      },
    },
    chapters: [{ chapter_id: "chapter-1" }],
    characters: [{ character_id: "character-1" }],
    world_state: [{ world_id: "world-1" }],
  };
  const risk_hints = ["AUDIT-02", "AUDIT-03", "AUDIT-05", "AUDIT-06", "AUDIT-09"]
    .map(check_code => ({ check_code, outcome: "pass" }));

  for (const { audit, reader, service, normalizer, initial } of paths) {
    assert.ok(audit && reader && service && normalizer && initial);
    const namedNodes = { [reader.name]: { context } };

    assert.equal(audit.type, "n8n-nodes-base.httpRequest");
    assert.equal(audit.typeVersion, 4.2);
    assert.equal(audit.parameters.method, "POST");
    assert.equal(audit.parameters.authentication, "predefinedCredentialType");
    assert.equal(audit.parameters.nodeCredentialType, "openAiApi");
    assert.equal(
      runExpressionWithNodes(audit.parameters.url, { service_ok: true }, namedNodes),
      "https://model.example/v1/chat/completions",
    );
    const request = runExpressionWithNodes(audit.parameters.jsonBody, {
      service_ok: true,
      engine_result: { chapters: [] },
      redacted_error: null,
    }, namedNodes);
    assert.equal(request.model, "test-model");
    assert.equal(request.temperature, 0.3);
    assert.equal(request.messages.length, 1);
    assert.match(request.messages[0].content, /^preaudit prompt\nINPUT=/);
    assert.doesNotMatch(request.messages[0].content, /runtime_bindings|api_key_ref|local-secure-ref/u);
    assert.match(audit.parameters.jsonBody, /CONFIG_CONTRACT_BLOCKED/);
    assert.equal(audit.parameters.options.response.response.fullResponse, true);
    assert.equal(audit.parameters.options.response.response.neverError, true);
    assert.doesNotMatch(JSON.stringify(audit), /\/responses\b/u);

    const [normalized] = runCodeNode(normalizer.parameters.jsCode, {
      data: { choices: [{ message: { content: JSON.stringify({ ok: true, risk_hints }) } }] },
    }, {
      [service.name]: { service_ok: true, engine_result: { service_state: "paused" }, redacted_error: null },
      [initial.name]: {},
    });
    assert.equal(normalized.json.preaudit_valid, true);
    assert.equal(normalized.json.audit_pass, true);
    assert.equal(normalized.json.route_to_storage, true);
    assert.equal(normalized.json.redacted_error, null);
  }
});

test("FP008-03 start audit keeps failed service input out of the model request", async () => {
  const workflow = await readWorkflow();
  const audit = workflow.nodes.find(candidate => candidate.id === "b5718a0a-f087-47f1-a154-4e29cf062c3c");
  const reader = workflow.nodes.find(candidate => candidate.id === "189865e3-2c21-407f-ab81-6e46dfc61489");
  assert.ok(audit && reader);
  const namedNodes = {
    [reader.name]: {
      context: {
        runtime_bindings: {
          "FP008-03": {
            model_name: "test-model",
            provider_base_url: "https://model.example/v1",
            prompt_text: "preaudit prompt",
            api_key_ref: "local-secure-ref:test",
            temperature: 0.3,
          },
        },
        chapters: [],
        characters: [],
        world_state: [],
      },
    },
  };
  assert.throws(
    () => runExpressionWithNodes(audit.parameters.url, {
      service_ok: false,
      redacted_error: { code: "MODEL_OUTPUT_INVALID" },
    }, namedNodes),
    /MODEL_OUTPUT_INVALID/u,
  );
  const request = runExpressionWithNodes(audit.parameters.jsonBody, {
    service_ok: true,
    redacted_error: null,
    engine_result: { chapters: [] },
  }, namedNodes);
  assert.equal(request.model, "test-model");
  assert.match(request.messages[0].content, /^preaudit prompt\nINPUT=/u);
});

test("the FP008 resume path reuses the persisted particle input without a model call", async () => {
  const workflow = await readWorkflow();
  const node = name => workflow.nodes.find(candidate => candidate.name === name);
  const resumeNode = node("FP008-01 剧情段颗粒拆解1");
  const mapper = node("JSON修复3").parameters.jsCode;
  const normalizer = node("JSON修复4").parameters.jsCode;
  const persistenceMapper = node("JSON修复6").parameters.jsCode;
  const { buildFp008Service } = await import(
    "../../../apps/api/src/features/fp008/fp008-02/service.ts"
  );
  const operator = "11111111-2222-4333-8444-555555555555";
  const book = "abcdefab-1234-4abc-8abc-abcdefabcdef";
  const l1a = "22222222-3333-4444-8555-666666666666";
  const chapter = "33333333-4444-4555-8666-777777777777";
  const version = "44444444-5555-4666-8777-888888888888";
  const character = "55555555-6666-4777-8888-999999999999";
  const particles = [1, 2, 3].map(index => ({
    particle_id: `particle-${index}`,
    content: `persisted-event-${index}`,
    type: "truth",
    emotion_phase: "setup",
    staged_task: `task-${index}`,
    reveal_to: [character],
    assigned_to_role_type: "protagonist",
    involved_chars: [character],
    required_chars: [character],
    source_field: "plot_emotion_commit",
    purpose: `purpose-${index}`,
  }));
  const participatingChars = [{
    char_id: character,
    char_code: "P001",
    role_type: "protagonist",
    activation_reason: "required by the persisted particle",
  }];
  const convergence = (particleId, completed) => ({
    particle_id: particleId,
    particle_status: "completed",
    p0_precheck: { passed: true },
    events_in_round: [{
      event_id: `event-${particleId}`,
      description: `event for ${particleId}`,
      primary_char: "P001",
      participating_chars: ["P001"],
      is_particle_advancing: true,
      is_short_climax: false,
      key_choices: ["action-1"],
      why_selected: "rooted in the character input",
    }],
    dual_spiral_verdict: "advance",
    rebellion_record: null,
    emotion_band: { band_type: "PLATFORM", entity_change_type: [], emotion_justified: true },
    state_diff: [],
    relation_diff: [],
    memory_changes: [],
    particles_completed: completed,
    particle_completion_evidence: [particleId],
    remaining_particles: particles.length - completed,
    retry_required: false,
    deduction_complete: completed === particles.length,
    hook_signals: [],
    alt_paths: [],
    chain_reaction_candidates: [],
    self_check: { emotion: true, hook: true, pivot: true },
    next_round_focus: null,
    token_budget_exceeded: false,
  });
  const distribution = particleId => ({
    char_tasks: [{
      char_code: "P001",
      task: {
        particle_id: particleId,
        isolation_confirmed: true,
        dramatic_enhancement: {
          supporting_staged_goal: null,
          antagonist_control_intent: null,
          ensemble_pressure_direction: null,
          peak_conflict_moment: null,
          enhancement_feedback: null,
        },
        newly_perceivable_particles: [particleId],
        long_term_promise: "complete the L1A promise",
        visible_situation: "only the visible situation",
        emotion_phase_hint: "setup",
        last_round_summary: null,
      },
    }],
  });
  const characterResult = () => ({
    char_code: "P001",
    knowledge_snapshot: { knows: [], unknown: [], false_belief: [], reasonable_suspect: [] },
    info_gap_exploited: null,
    l3_activation: null,
    trigger_check: { triggered: false },
    real_intent: "protect the current goal",
    hidden_goal: null,
    misread: null,
    misread_impact: null,
    dual_spiral: { relation_type: "advance" },
    candidate_actions: [{
      action_id: "action-1",
      action_type: "attempt",
      surface_action: "act on the visible situation",
      tactic_ref: "L1",
      deep_motivation: "current goal",
      root_basis: "five layer model",
      boundary_check: { passed: true },
      audit_block: false,
      audit_block_reason: null,
      memory_evidence: [],
      scene_coupling: "grounded",
      utilized_conditions: [],
    }],
    baseline_comparison: null,
    chain_reaction_risk: null,
    unresolved_risk: null,
    internal_drive_tension: null,
    hidden_resistance: [],
  });
  const successfulInvoker = calls => async (invocation) => {
    calls.push(invocation);
    if (invocation.mode === "director_distribute") {
      return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 300000 } };
    }
    if (invocation.mode === "character_respond") {
      return { output: characterResult(), usage: { total_tokens: 300000 } };
    }
    const completed = Number(String(invocation.input.particle.particle_id).split("-").pop());
    return {
      output: convergence(invocation.input.particle.particle_id, completed),
      usage: { total_tokens: 300000 },
    };
  };
  const context = {
    scope_ok: true,
    request: { action: "resume" },
    scope: { local_operator_id: operator, book_id: book, l1a_unit_id: l1a },
    token_budget: 3000000,
    token_budget_version: "mvp-fixed-3000000",
    chapters: [{
      chapter_id: chapter,
      chapter_version_id: version,
      predecessor_version_id: null,
      chapter_index: 1,
      target_snapshot_json: { goals: ["goal-1"] },
      chapter_implementation_json: { execution_steps: ["step-1"] },
      scene_condition_package: {
        scene_location: "documented threshold",
        participant_chars: ["lead"],
        rule_locks: [],
        scene_affordance: [],
        available_resource_codes: [],
        info_reveal_candidates: [],
        chain_reaction_candidates: [],
        scene_constraints: [],
        forbid_lines_active: [],
        materialize_notes: [],
      },
      shadow_summary: "",
      checkpoint: {
        candidate_plot_sim_json: {
          deduction_input_snapshot: {
            particles,
            participating_chars: participatingChars,
          },
          particles_records: [convergence("particle-1", 1)],
          candidate_truth_ledger: {
            schema_version: 1,
            world_changes: [],
            character_live_state_changes: [],
            relation_changes: [],
            memories: [],
          },
          chapter_summary: null,
        },
        deduction_progress_json: {
          current_particle_index: 1,
          token_consumed: 120,
          remaining_particles: 2,
          token_budget: 3000000,
          token_budget_version: "mvp-fixed-3000000",
          token_budget_exceeded: false,
          deduction_complete: false,
          reject_count: 0,
        },
      },
    }],
    characters: [{
      character_id: character,
      char_code: "P001",
      role_type: "protagonist",
      five_layers_json: { L0: {}, L1: {}, L2: {}, L3: {} },
      knowledge_boundary_json: { knows: [], unknown: [], false_belief: [], reasonable_suspect: [] },
      live_state_id: null,
      live_state_source: "initial_live_state_projection",
      live_state_json: { source: "initial_live_state_projection" },
      active_memory_json: [],
    }],
    l1a: { world_resistance_refs: [{ atom_key: "world-rule-1" }] },
    world_state: [{
      world_state_id: "99999999-aaaa-4bbb-8ccc-dddddddddddd",
      atom_key: "world-rule-1",
      atom_value_jsonb: { rule: "active" },
      is_active: true,
      setting_layer: "initial",
    }],
    relations: [],
    model_bindings: {
      NODE_05: {
        node_code: "NODE_05",
        prompt_text: "character prompt",
        model_name: "test-model",
        provider_base_url: "https://model.example/v1",
        api_key_ref: "local-secure-ref:test",
      },
      NODE_06: {
        node_code: "NODE_06",
        prompt_text: "director prompt",
        model_name: "test-model",
        provider_base_url: "https://model.example/v1",
        api_key_ref: "local-secure-ref:test",
      },
    },
  };

  assert.equal(resumeNode.type, "n8n-nodes-base.code");
  assert.equal(resumeNode.typeVersion, 1);
  assert.equal(Object.hasOwn(resumeNode, "credentials"), false);
  assert.doesNotMatch(JSON.stringify(resumeNode.parameters), /provider_base_url|openAiApi|runtime_bindings/u);

  const [snapshotPayload] = runCodeNode(resumeNode.parameters.jsCode, { context }, {});
  assert.deepEqual(JSON.parse(snapshotPayload.json.data), {
    ok: true,
    chapters: [{
      chapter_id: chapter,
      chapter_version_id: version,
      particles,
      participating_chars: participatingChars,
    }],
  });

  const [mapped] = runCodeNode(
    mapper,
    snapshotPayload.json,
    { "读取拆解结果1": { context } },
  );
  assert.equal(mapped.json.mapping_ok, true);
  assert.equal(mapped.json.engine_request.action, "resume");
  assert.deepEqual(mapped.json.engine_request.scope, context.scope);
  const [mappedChapter] = mapped.json.engine_request.chapters;
  assert.equal(mappedChapter.chapter_id, chapter);
  assert.equal(mappedChapter.chapter_version_id, version);
  assert.deepEqual(mappedChapter.particles, particles);
  assert.deepEqual(mappedChapter.participating_chars, participatingChars);
  assert.deepEqual(mappedChapter.checkpoint, context.chapters[0].checkpoint);
  assert.equal(mappedChapter.checkpoint.deduction_progress_json.current_particle_index, 1);
  assert.equal(mappedChapter.checkpoint.deduction_progress_json.remaining_particles, 2);
  assert.equal(mappedChapter.checkpoint.deduction_progress_json.token_budget, 3000000);
  assert.deepEqual(mapped.json.engine_request.world_resistance_refs, context.l1a.world_resistance_refs);

  const calls = [];
  const app = buildFp008Service({ invokeModel: successfulInvoker(calls) });
  const serviceResponse = await app.inject({
    method: "POST",
    url: "/fp008-02",
    payload: mapped.json.engine_request,
  });
  assert.equal(serviceResponse.statusCode, 200, serviceResponse.body);
  const servicePayload = serviceResponse.json();
  assert.equal(servicePayload.ok, true);
  assert.equal(servicePayload.result.service_state, "completed");
  assert.equal(servicePayload.result.deduction_complete, true);
  assert.equal(servicePayload.result.token_consumed, 1800120);
  const [serviceChapter] = servicePayload.result.chapters;
  assert.equal(serviceChapter.chapter_id, chapter);
  assert.equal(serviceChapter.candidate_version_id, version);
  assert.equal(serviceChapter.deduction_progress_json.current_particle_index, 3);
  assert.equal(serviceChapter.deduction_progress_json.remaining_particles, 0);
  assert.equal(serviceChapter.deduction_progress_json.token_consumed, 1800120);
  assert.equal(serviceChapter.deduction_progress_json.token_budget, 3000000);
  assert.equal(serviceChapter.deduction_progress_json.token_budget_exceeded, false);
  assert.equal(serviceChapter.candidate_plot_sim_json.particles_records.length, 3);
  assert.deepEqual(calls.map((call) => call.mode), [
    "director_distribute",
    "character_respond",
    "director_converge",
    "director_distribute",
    "character_respond",
    "director_converge",
  ]);
  assert.deepEqual(calls.map((call) => (
    call.mode === "character_respond" ? call.input.particle_id : call.input.particle.particle_id
  )), ["particle-2", "particle-2", "particle-2", "particle-3", "particle-3", "particle-3"]);

  const [normalizedService] = runCodeNode(
    normalizer,
    { body: servicePayload },
    { "JSON修复3": mapped.json },
  );
  assert.equal(normalizedService.json.service_ok, true);
  assert.equal(normalizedService.json.redacted_error, null);
  assert.deepEqual(normalizedService.json.engine_result, servicePayload.result);
  await app.close();

  const [persistence] = runCodeNode(
    persistenceMapper,
    {},
    {
      "JSON修复7": { route_to_storage: true, engine_result: normalizedService.json.engine_result },
      "JSON修复3": mapped.json,
    },
    { id: "resume-interface-1" },
  );
  assert.equal(persistence.json.route_to_storage, true);
  assert.deepEqual(persistence.json.rpc_request, {
    local_operator_id: operator,
    book_id: book,
    l1a_unit_id: l1a,
    idempotency_key: `fp008-04:${l1a}:resume-interface-1`,
    chapters: [{
      chapter_id: chapter,
      chapter_version_id: version,
      candidate_plot_sim_json: serviceChapter.candidate_plot_sim_json,
      deduction_progress_json: serviceChapter.deduction_progress_json,
    }],
  });

  const missingSnapshot = structuredClone(context);
  delete missingSnapshot.chapters[0].checkpoint.candidate_plot_sim_json.deduction_input_snapshot;
  const [missingPayload] = runCodeNode(resumeNode.parameters.jsCode, { context: missingSnapshot }, {});
  assert.deepEqual(JSON.parse(missingPayload.json.data), {
    ok: false,
    redacted_error: {
      code: "INVALID_CHECKPOINT",
      message: "The persisted deduction checkpoint cannot be resumed.",
    },
  });
  const [blocked] = runCodeNode(
    mapper,
    missingPayload.json,
    { "读取拆解结果1": { context: missingSnapshot } },
  );
  assert.equal(blocked.json.mapping_ok, false);
  assert.deepEqual(blocked.json.redacted_error, {
    code: "INVALID_CHECKPOINT",
    message: "The persisted deduction checkpoint cannot be resumed.",
  });
});

test("the ZH05 start mapper emits a command accepted by the FP008-02 validator", async () => {
  const { buildFp008Service } = await import(
    "../../../apps/api/src/features/fp008/fp008-02/service.ts"
  );
  const workflow = await readWorkflow();
  const mapper = workflow.nodes.find(candidate => candidate.name === "JSON修复").parameters.jsCode;
  const operator = "11111111-2222-4333-8444-555555555555";
  const book = "abcdefab-1234-4abc-8abc-abcdefabcdef";
  const l1a = "22222222-3333-4444-8555-666666666666";
  const chapter = "33333333-4444-4555-8666-777777777777";
  const version = "44444444-5555-4666-8777-888888888888";
  const character = "55555555-6666-4777-8888-999999999999";
  const particles = [1, 2, 3].map(index => ({
    particle_id: `particle-${index}`,
    content: `event-${index}`,
    type: "truth",
    emotion_phase: "setup",
    staged_task: `task-${index}`,
    reveal_to: index === 1 ? ["all"] : index === 2 ? ["reader"] : [character],
    assigned_to_role_type: "protagonist",
    involved_chars: [character],
    required_chars: [character],
    source_field: "plot_emotion_commit",
    purpose: `purpose-${index}`,
  }));
  const participatingChars = [{
    char_id: character,
    char_code: "P001",
    role_type: "protagonist",
    activation_reason: "required by the particle",
  }];
  const context = {
    scope_ok: true,
    request: { action: "start" },
    scope: { local_operator_id: operator, book_id: book, l1a_unit_id: l1a },
    token_budget: 3000000,
    token_budget_version: "mvp-fixed-3000000",
    chapters: [{
      chapter_id: chapter,
      chapter_version_id: version,
      predecessor_version_id: null,
      chapter_index: 1,
      target_snapshot_json: { goals: ["goal-1"] },
      chapter_implementation_json: { execution_steps: ["step-1"] },
      scene_condition_package: {
        scene_location: "documented threshold",
        participant_chars: ["lead"],
        rule_locks: [],
        scene_affordance: [],
        available_resource_codes: [],
        info_reveal_candidates: [],
        chain_reaction_candidates: [],
        scene_constraints: [],
        forbid_lines_active: [],
        materialize_notes: [],
      },
      shadow_summary: "",
      checkpoint: null,
    }],
    characters: [{
      character_id: character,
      char_code: "P001",
      role_type: "protagonist",
      five_layers_json: { L0: {}, L1: {}, L2: {}, L3: {} },
      knowledge_boundary_json: { knows: [], unknown: [], false_belief: [], reasonable_suspect: [] },
      live_state_id: null,
      live_state_source: "initial_live_state_projection",
      live_state_json: { source: "initial_live_state_projection" },
      active_memory_json: [],
    }],
    l1a: { world_resistance_refs: [{ atom_key: "world-rule-1" }] },
    world_state: [{
      world_state_id: "99999999-aaaa-4bbb-8ccc-dddddddddddd",
      atom_key: "world-rule-1",
      atom_value_jsonb: { rule: "active" },
      is_active: true,
      setting_layer: "initial",
    }],
    relations: [],
    model_bindings: {
      NODE_05: {
        node_code: "NODE_05",
        prompt_text: "character prompt",
        model_name: "test-model",
        provider_base_url: "https://model.example/v1",
        api_key_ref: "local-secure-ref:test",
      },
      NODE_06: {
        node_code: "NODE_06",
        prompt_text: "director prompt",
        model_name: "test-model",
        provider_base_url: "https://model.example/v1",
        api_key_ref: "local-secure-ref:test",
      },
    },
  };
  const [mapped] = runCodeNode(
    mapper,
    { data: JSON.stringify({
      choices: [{
        finish_reason: "stop",
        message: {
          content: JSON.stringify({
            ok: true,
            chapters: [{
              chapter_id: chapter,
              chapter_version_id: version,
              particles,
              participating_chars: participatingChars,
            }],
          }),
        },
      }],
    }) },
    { "读取拆解结果": { context } },
  );

  assert.equal(mapped.json.mapping_ok, true);
  assert.equal(Object.hasOwn(mapped.json.engine_request.chapters[0], "checkpoint"), false);
  assert.equal(mapped.json.engine_request.chapters[0].participating_chars.length, 1);
  assert.deepEqual(mapped.json.engine_request.chapters[0].particles.map(particle => particle.reveal_to), [
    "all",
    "reader",
    [character],
  ]);
  assert.equal(mapped.json.engine_request.chapters[0].predecessor_version_id, null);
  assert.deepEqual(mapped.json.engine_request.world_resistance_refs, context.l1a.world_resistance_refs);

  for (const invalidRevealTo of [
    ["all", character],
    ["unknown-character"],
    [],
  ]) {
    const invalidParticles = structuredClone(particles);
    invalidParticles[0].reveal_to = invalidRevealTo;
    const [invalid] = runCodeNode(
      mapper,
      { text: JSON.stringify({
        ok: true,
        chapters: [{
          chapter_id: chapter,
          chapter_version_id: version,
          particles: invalidParticles,
          participating_chars: participatingChars,
        }],
      }) },
      { "读取拆解结果": { context } },
    );
    assert.equal(invalid.json.mapping_ok, false, `reveal_to=${JSON.stringify(invalidRevealTo)} must remain fail-closed`);
  }

  const replanContext = structuredClone(context);
  replanContext.request = {
    action: "replan",
    return_direction: "Keep the decisive reveal for the final particle.",
  };
  const [replanned] = runCodeNode(
    mapper,
    { text: JSON.stringify({
      ok: true,
      chapters: [{
        chapter_id: chapter,
        chapter_version_id: version,
        particles,
        participating_chars: participatingChars,
      }],
    }) },
    { "读取拆解结果": { context: replanContext } },
  );
  assert.equal(replanned.json.mapping_ok, true);
  assert.equal(replanned.json.engine_request.action, "restart");
  assert.equal(replanned.json.engine_request.creator_direction, replanContext.request.return_direction);
  assert.equal(Object.hasOwn(replanned.json.engine_request, "return_direction"), false);
  assert.equal(Object.hasOwn(replanned.json.engine_request.chapters[0], "checkpoint"), false);

  const incompleteContext = structuredClone(context);
  incompleteContext.chapters[0].scene_condition_package = {};
  const [blocked] = runCodeNode(
    mapper,
    { text: JSON.stringify({
      ok: true,
      chapters: [{
        chapter_id: chapter,
        chapter_version_id: version,
        particles,
        participating_chars: participatingChars,
      }],
    }) },
    { "读取拆解结果": { context: incompleteContext } },
  );
  assert.equal(blocked.json.mapping_ok, false, "an incomplete D-A01 package must not reach FP008");

  const app = buildFp008Service({
    invokeModel: async () => ({ output: { char_tasks: [] }, usage: { total_tokens: 1 } }),
  });
  const response = await app.inject({
    method: "POST",
    url: "/fp008-02",
    payload: mapped.json.engine_request,
  });
  assert.equal(response.statusCode, 502, response.body);
  assert.equal(response.json().redacted_error.code, "MODEL_OUTPUT_INVALID");
  const replanResponse = await app.inject({
    method: "POST",
    url: "/fp008-02",
    payload: replanned.json.engine_request,
  });
  assert.equal(replanResponse.statusCode, 502, replanResponse.body);
  assert.equal(replanResponse.json().redacted_error.code, "MODEL_OUTPUT_INVALID");
  await app.close();
});

test("FP008-01 exposes formal character IDs required by its particle output contract", async () => {
  const workflow = await readWorkflow();
  const promptNode = workflow.nodes.find(candidate => candidate.name === "FP008-01 剧情段颗粒拆解");
  const mapper = workflow.nodes.find(candidate => candidate.name === "JSON修复").parameters.jsCode;
  const operator = "11111111-2222-4333-8444-555555555555";
  const book = "abcdefab-1234-4abc-8abc-abcdefabcdef";
  const l1a = "22222222-3333-4444-8555-666666666666";
  const chapter = "33333333-4444-4555-8666-777777777777";
  const version = "44444444-5555-4666-8777-888888888888";
  const character = "55555555-6666-4777-8888-999999999999";
  const characterCode = "lead-001";
  const sceneConditionPackage = {
    scene_location: "documented threshold",
    participant_chars: [character],
    rule_locks: [],
    scene_affordance: [],
    available_resource_codes: [],
    info_reveal_candidates: [],
    chain_reaction_candidates: [],
    scene_constraints: [],
    forbid_lines_active: [],
    materialize_notes: [],
  };
  const context = {
    scope_ok: true,
    request: { action: "start" },
    scope: { local_operator_id: operator, book_id: book, l1a_unit_id: l1a },
    token_budget: 3000000,
    token_budget_version: "mvp-fixed-3000000",
    runtime_bindings: {
      "FP008-01": {
        model_name: "test-model",
        provider_base_url: "https://model.example/v1",
        prompt_text: "particle prompt",
        api_key_ref: "local-secure-ref:test",
        temperature: 0.2,
      },
    },
    l1a: { l1a_unit_id: l1a, participant_chars_json: [character] },
    chapters: [{
      chapter_id: chapter,
      chapter_version_id: version,
      predecessor_version_id: null,
      chapter_index: 1,
      target_snapshot_json: {
        pov_char: character,
        particles_json: [{
          particle_id: "particle-1",
          reveal_to: [character],
          assigned_to_role_type: "protagonist",
        }],
      },
      chapter_implementation_json: { execution_steps: ["step-1"] },
      scene_condition_package: sceneConditionPackage,
      shadow_summary: "",
      checkpoint: null,
    }],
    characters: [{
      character_id: character,
      char_code: characterCode,
      role_type: "protagonist",
      five_layers_json: { L0: {}, L1: {}, L2: {}, L3: {} },
      knowledge_boundary_json: { knows: [], unknown: [], false_belief: [], reasonable_suspect: [] },
      live_state_json: {},
      active_memory_json: [],
    }],
    world_state: [],
    relations: [{ char_a_id: character, char_b_id: character }],
    model_bindings: {},
  };

  const request = JSON.parse(runExpression(promptNode.parameters.jsonBody, { context }));
  const modelInput = JSON.parse(request.messages[0].content.split("\nINPUT=")[1]);
  assert.equal(modelInput.characters[0].character_id, character);
  assert.equal(modelInput.l1a.participant_chars_json[0], character);
  assert.equal(modelInput.chapters[0].target_snapshot_json.pov_char, character);
  assert.deepEqual(
    modelInput.chapters[0].target_snapshot_json.particles_json[0].reveal_to,
    [character],
  );
  assert.equal(modelInput.chapters[0].scene_condition_package.participant_chars[0], character);
  assert.equal(modelInput.relations[0].char_a_id, character);
  assert.match(JSON.stringify(modelInput), new RegExp(character));

  const particles = [1, 2, 3].map(index => ({
    particle_id: `particle-${index}`,
    content: `event-${index}`,
    type: "truth",
    emotion_phase: "setup",
    staged_task: `task-${index}`,
    reveal_to: [character],
    assigned_to_role_type: "protagonist",
    involved_chars: [character],
    required_chars: [character],
    source_field: "plot_emotion_commit",
    purpose: `purpose-${index}`,
  }));
  const [mapped] = runCodeNode(
    mapper,
    { text: JSON.stringify({
      ok: true,
      chapters: [{
        chapter_id: chapter,
        chapter_version_id: version,
        particles,
        participating_chars: [{
          char_id: character,
          char_code: characterCode,
          role_type: "protagonist",
          activation_reason: "required by the particle",
        }],
      }],
    }) },
    { "读取拆解结果": { context } },
  );

  assert.equal(mapped.json.mapping_ok, true);
  assert.deepEqual(mapped.json.engine_request.chapters[0].particles[0].involved_chars, [character]);
  assert.deepEqual(mapped.json.engine_request.chapters[0].particles[0].required_chars, [character]);
  assert.deepEqual(mapped.json.engine_request.chapters[0].particles[0].reveal_to, [character]);
  assert.equal(mapped.json.engine_request.chapters[0].participating_chars[0].char_id, character);
  assert.equal(mapped.json.engine_request.characters[0].character_id, character);

});

test("FP008-01 uses the same-particle reader target reveal contract for an empty model reveal_to", async () => {
  const workflow = await readWorkflow();
  const mapper = workflow.nodes.find(candidate => candidate.parameters?.jsCode?.includes("const normalizeRevealTo"))?.parameters.jsCode;
  assert.ok(mapper, "the FP008-01 JSON repair mapper must be present");
  const resumeMapper = workflow.nodes
    .filter(candidate => candidate.parameters?.jsCode?.includes("const normalizeRevealTo"))
    .at(1)?.parameters.jsCode;
  assert.ok(resumeMapper, "the resumed FP008-01 JSON repair mapper must be present");
  assert.match(resumeMapper, /targetRevealTo === '[^']+'/u);
  assert.match(resumeMapper, /targetParticleById/u);
  const character = "55555555-6666-4777-8888-999999999999";
  const chapter = "33333333-4444-4555-8666-777777777777";
  const version = "44444444-5555-4666-8777-888888888888";
  const particle = (particleId, revealTo) => ({
    particle_id: particleId,
    content: `event-${particleId}`,
    type: "truth",
    emotion_phase: "setup",
    staged_task: `task-${particleId}`,
    reveal_to: revealTo,
    assigned_to_role_type: "protagonist",
    involved_chars: [character],
    required_chars: [character],
    source_field: "plot_emotion_commit",
    purpose: `purpose-${particleId}`,
  });
  const context = {
    scope_ok: true,
    request: { action: "start" },
    scope: {
      local_operator_id: "11111111-2222-4333-8444-555555555555",
      book_id: "abcdefab-1234-4abc-8abc-abcdefabcdef",
      l1a_unit_id: "22222222-3333-4444-8555-666666666666",
    },
    token_budget: 3000000,
    token_budget_version: "mvp-fixed-3000000",
    chapters: [{
      chapter_id: chapter,
      chapter_version_id: version,
      predecessor_version_id: null,
      chapter_index: 1,
      target_snapshot_json: {
        particles_json: [
          particle("reader-fallback", "reader"),
          particle("legacy-reader-fallback", "仅读者"),
          particle("all-must-reject", "全员"),
          particle("specific-must-reject", "特定角色"),
          particle("formal-id", [character]),
        ],
      },
      chapter_implementation_json: {},
      scene_condition_package: {
        scene_location: "documented threshold",
        participant_chars: [character],
        rule_locks: [],
        scene_affordance: [],
        available_resource_codes: [],
        info_reveal_candidates: [],
        chain_reaction_candidates: [],
        scene_constraints: [],
        forbid_lines_active: [],
        materialize_notes: [],
      },
      shadow_summary: "",
      checkpoint: null,
    }],
    characters: [{ character_id: character, char_code: "P001", role_type: "protagonist" }],
    world_state: [],
    relations: [],
    model_bindings: {},
  };
  const modelParticles = [
    particle("reader-fallback", []),
    particle("legacy-reader-fallback", []),
    particle("all-must-reject", []),
    particle("specific-must-reject", []),
    particle("formal-id", [character]),
  ];
  modelParticles[0].involved_chars = [];
  modelParticles[0].required_chars = [];
  modelParticles[1].involved_chars = [];
  modelParticles[1].required_chars = [];
  const contextNodeName = mapper.match(/\$\('([^']+)'/u)?.[1];
  assert.ok(contextNodeName, "the mapper must read its upstream context node");
  const [mapped] = runCodeNode(mapper, {
    text: JSON.stringify({
      ok: true,
      chapters: [{
        chapter_id: chapter,
        chapter_version_id: version,
        particles: modelParticles,
        participating_chars: [{
          char_id: character,
          char_code: "P001",
          role_type: "protagonist",
          activation_reason: "required by the particle",
        }],
      }],
    }),
  }, { [contextNodeName]: { context } });

  assert.equal(mapped.json.mapping_ok, false, "non-reader empty reveal_to values remain fail-closed");
  const mappedParticles = mapped.json.engine_request.chapters[0].particles;
  assert.equal(mappedParticles[0].reveal_to, "reader");
  assert.deepEqual(mappedParticles[0].involved_chars, [character]);
  assert.deepEqual(mappedParticles[0].required_chars, [character]);
  assert.equal(mappedParticles[1].reveal_to, "reader");
  assert.deepEqual(mappedParticles[1].involved_chars, [character]);
  assert.deepEqual(mappedParticles[1].required_chars, [character]);
  assert.deepEqual(mappedParticles[2].reveal_to, []);
  assert.deepEqual(mappedParticles[3].reveal_to, []);
  assert.deepEqual(mappedParticles[4].reveal_to, [character]);
});

test("FP008-01 rejects model participants outside the authoritative formal character input", async () => {
  const workflow = await readWorkflow();
  const mapper = workflow.nodes.find(candidate => candidate.name === "JSON修复").parameters.jsCode;
  const operator = "11111111-2222-4333-8444-555555555555";
  const book = "abcdefab-1234-4abc-8abc-abcdefabcdef";
  const l1a = "22222222-3333-4444-8555-666666666666";
  const chapter = "33333333-4444-4555-8666-777777777777";
  const version = "44444444-5555-4666-8777-888888888888";
  const character = "55555555-6666-4777-8888-999999999999";
  const particles = [1, 2, 3].map(index => ({
    particle_id: `particle-${index}`,
    content: `event-${index}`,
    type: "truth",
    emotion_phase: "setup",
    staged_task: `task-${index}`,
    reveal_to: [character],
    assigned_to_role_type: "protagonist",
    involved_chars: [character],
    required_chars: [character],
    source_field: "plot_emotion_commit",
    purpose: `purpose-${index}`,
  }));
  const context = {
    scope_ok: true,
    request: { action: "start" },
    scope: { local_operator_id: operator, book_id: book, l1a_unit_id: l1a },
    token_budget: 3000000,
    token_budget_version: "mvp-fixed-3000000",
    chapters: [{
      chapter_id: chapter,
      chapter_version_id: version,
      predecessor_version_id: null,
      chapter_index: 1,
      target_snapshot_json: { goals: ["goal-1"] },
      chapter_implementation_json: { execution_steps: ["step-1"] },
      scene_condition_package: {
        scene_location: "documented threshold",
        participant_chars: [character],
        rule_locks: [],
        scene_affordance: [],
        available_resource_codes: [],
        info_reveal_candidates: [],
        chain_reaction_candidates: [],
        scene_constraints: [],
        forbid_lines_active: [],
        materialize_notes: [],
      },
      shadow_summary: "",
      checkpoint: null,
    }],
    characters: [{
      character_id: character,
      char_code: "P001",
      role_type: "protagonist",
      five_layers_json: { L0: {}, L1: {}, L2: {}, L3: {} },
      knowledge_boundary_json: { knows: [], unknown: [], false_belief: [], reasonable_suspect: [] },
      live_state_json: {},
      active_memory_json: [],
    }],
    world_state: [],
    relations: [],
    model_bindings: {},
  };

  const [mapped] = runCodeNode(
    mapper,
    { text: JSON.stringify({
      ok: true,
      chapters: [{
        chapter_id: chapter,
        chapter_version_id: version,
        particles,
        participating_chars: [{
          char_id: character,
          char_code: "candidate-character-3",
          role_type: "protagonist",
          activation_reason: "invented model identifier",
        }],
      }],
    }) },
    { "读取拆解结果": { context } },
  );

  assert.equal(mapped.json.mapping_ok, false);
});

test("FP008-01 rejects particles with blank staged_task before FP008-02", async () => {
  const workflow = await readWorkflow();
  const mapper = workflow.nodes.find((candidate) => candidate.name === "JSON修复");
  assert.ok(mapper);
  assert.match(mapper.parameters.jsCode, /typeof particle\.staged_task === 'string' && particle\.staged_task\.trim\(\)\.length > 0/);
});

test("a FP008-01 data debt returns through the existing response path without calling FP008-02", async () => {
  const workflow = await readWorkflow();
  const node = name => workflow.nodes.find(candidate => candidate.name === name);
  const mapper = node("JSON修复").parameters.jsCode;
  const [mapped] = runCodeNode(mapper, {
    data: JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        ok: false,
        redacted_error: {
          code: "DATA_DEBT",
          message: "The selected L1A has insufficient formal participant data.",
        },
      }) } }],
    }),
  }, {
    "读取拆解结果": { context: { scope_ok: true, scope: {}, request: { action: "start" }, chapters: [] } },
  });
  assert.equal(mapped.json.mapping_ok, false);
  assert.deepEqual(mapped.json.redacted_error, {
    code: "DATA_DEBT",
    message: "The selected L1A has insufficient formal participant data.",
  });

  const gate = node("FP008-01 映射放行");
  assert.equal(gate?.type, "n8n-nodes-base.if");
  assert.equal(runExpression(gate.parameters.conditions.conditions[0].leftValue, { mapping_ok: true }), true);
  assert.equal(runExpression(gate.parameters.conditions.conditions[0].leftValue, { mapping_ok: false }), false);
  assert.deepEqual(workflow.connections["JSON修复"], {
    main: [[{ node: "FP008-01 映射放行", type: "main", index: 0 }]],
  });
  assert.deepEqual(workflow.connections["FP008-01 映射放行"], {
    main: [
      [{ node: "FP008-02 核心推演与服务层Node.js / TypeScript 编写独立的推演脚本引擎", type: "main", index: 0 }],
      [{ node: "Respond to Webhook", type: "main", index: 0 }],
    ],
  });
  assert.deepEqual(runExpression(node("Respond to Webhook").parameters.responseBody, mapped.json), {
    ok: false,
    redacted_error: mapped.json.redacted_error,
  });
});

test("FP008-01 preserves an HTTP-200 provider error as a controlled model outage", async () => {
  const workflow = await readWorkflow();
  const mapper = workflow.nodes.find(candidate => candidate.name === "JSON修复").parameters.jsCode;
  const [mapped] = runCodeNode(mapper, {
    data: JSON.stringify({
      error: {
        code: 502,
        message: "Upstream error: ResourceExhausted",
      },
    }),
    statusCode: 200,
  }, {
    "读取拆解结果": { context: { scope_ok: true, scope: {}, request: { action: "start" }, chapters: [] } },
  });

  assert.equal(mapped.json.mapping_ok, false);
  assert.deepEqual(mapped.json.redacted_error, {
    code: "MODEL_PROVIDER_UNAVAILABLE",
    message: "The current model service is unavailable.",
  });
});

test("FP008-01 maps an exhausted transport failure to the existing retryable failure state", async () => {
  const workflow = await readWorkflow();
  const mapper = workflow.nodes.find(candidate => candidate.name === "JSON修复").parameters.jsCode;
  const [mapped] = runCodeNode(mapper, {
    error: { message: "ETIMEDOUT: model request timed out after retries" },
  }, {
    "读取拆解结果": { context: { scope_ok: true, scope: {}, request: { action: "start" }, chapters: [] } },
  });

  assert.equal(mapped.json.mapping_ok, false);
  assert.deepEqual(mapped.json.redacted_error, {
    code: "MODEL_CALL_FAILED",
    message: "The current model request failed after retries.",
  });
});

test("FP008-01 classifies a blank HTTP-200 model reply as recoverable output failure", async () => {
  const workflow = await readWorkflow();
  const mapperNode = workflow.nodes.find(candidate => candidate.id === "64fb6f8a-de62-4543-a426-953bccbb6a20");
  assert.ok(mapperNode);
  const mapper = mapperNode.parameters.jsCode;
  const contextNodeName = mapper.match(/\$\('([^']+)'/u)?.[1];
  assert.ok(contextNodeName);
  const [mapped] = runCodeNode(mapper, {
    data: " \n\t ",
    statusCode: 200,
  }, {
    [contextNodeName]: { context: { scope_ok: true, scope: {}, request: { action: "start" }, chapters: [] } },
  });

  assert.equal(mapped.json.mapping_ok, false);
  assert.deepEqual(mapped.json.redacted_error, {
    code: "MODEL_OUTPUT_INVALID",
    message: "The current model response is invalid.",
  });
});

test("both FP008-02 nodes POST valid JSON only after mapping succeeds", async () => {
  const workflow = await readWorkflow();
  const node = name => workflow.nodes.find(candidate => candidate.name === name);
  const httpNodes = workflow.nodes.filter(candidate => candidate.name.startsWith("FP008-02 核心推演与服务层"));

  assert.equal(httpNodes.length, 2);
  for (const httpNode of httpNodes) {
    assert.equal(httpNode.parameters.method, "POST");
    assert.equal(httpNode.parameters.url, "http://host.docker.internal:4182/fp008-02");
    assert.equal(httpNode.parameters.sendBody, true);
    assert.equal(httpNode.parameters.rawContentType, "application/json");
    assert.match(httpNode.parameters.body, /JSON\.stringify/);
    assert.match(httpNode.parameters.body, /\$json\.mapping_ok === true/);
    assert.doesNotMatch(httpNode.parameters.body, /throw new Error/);
    assert.deepEqual(httpNode.parameters.options, { timeout: 10_800_000 });
    assert.equal(httpNode.parameters.response.response.neverError, true);
    assert.equal(httpNode.parameters.response.response.responseFormat, "json");
  }
  assert.ok(httpNodes.every(httpNode => !/restart|creator_direction/.test(httpNode.parameters.body)));

  for (const name of ["JSON修复1", "JSON修复4"]) {
    const source = node(name).parameters.jsCode;
    assert.match(source, /payload\?\.ok === true/);
    assert.match(source, /payload\?\.result/);
    assert.match(source, /payload\?\.redacted_error/);
    assert.match(source, /upstreamError/);
    assert.match(source, /DEDUCTION_SERVICE_FAILED/);
  }
});

test("both FP008-02 long-task requests allow a whole L1A to finish", async () => {
  const workflow = await readWorkflow();
  const httpNodes = workflow.nodes.filter(candidate => candidate.name.startsWith("FP008-02 核心推演与服务层"));
  assert.equal(httpNodes.length, 2);
  for (const node of httpNodes) {
    assert.equal(node.parameters.options.timeout, 10_800_000);
  }
});

test("both FP008 service response normalizers retain a controlled error from a serialized HTTP body", async () => {
  const workflow = await readWorkflow();
  const node = name => workflow.nodes.find(candidate => candidate.name === name);
  const expected = {
    code: "INVALID_REQUEST",
    message: "characters[0].char_code is required.",
  };

  for (const name of ["JSON修复1", "JSON修复4"]) {
    const [normalized] = runCodeNode(node(name).parameters.jsCode, {
      body: JSON.stringify({ ok: false, redacted_error: expected }),
    }, {});
    assert.deepEqual(JSON.parse(JSON.stringify(normalized.json)), {
      service_ok: false,
      engine_result: null,
      redacted_error: expected,
    });

    const [wrapped] = runCodeNode(node(name).parameters.jsCode, {
      error: {
        status: 400,
        message: `400 - ${JSON.stringify(JSON.stringify({ ok: false, redacted_error: expected }))}`,
      },
    }, {});
    assert.deepEqual(JSON.parse(JSON.stringify(wrapped.json)), {
      service_ok: false,
      engine_result: null,
      redacted_error: expected,
    });
  }
});

test("both FP008 service response normalizers keep only V7 self-check exhaustion on the FP008-03 path", async () => {
  const workflow = await readWorkflow();
  const node = name => workflow.nodes.find(candidate => candidate.name === name);

  for (const [normalizerName, upstreamName, preauditName, mapperName] of [
    ["JSON修复1", "JSON修复", "JSON修复2", "JSON修复5"],
    ["JSON修复4", "JSON修复3", "JSON修复7", "JSON修复6"],
  ]) {
    const source = node(normalizerName).parameters.jsCode;

    for (const [serviceState, blockedCode] of [
      ["blocked", "MODEL_CALL_FAILED"],
      ["blocked", "DEDUCTION_BLOCKED"],
      ["failed", "MODEL_OUTPUT_INVALID"],
    ]) {
      const [normalized] = runCodeNode(source, {
        body: JSON.stringify({
          ok: true,
          result: { service_state: serviceState, blocked_code: blockedCode },
        }),
      }, {
        [upstreamName]: { mapping_ok: true },
      });

      assert.deepEqual(JSON.parse(JSON.stringify(normalized.json)), {
        service_ok: false,
        engine_result: null,
        redacted_error: {
          code: blockedCode,
          message: "The deduction service could not complete the command.",
        },
      }, normalizerName);

      const [preaudit] = runCodeNode(node(preauditName).parameters.jsCode, {}, {
        [normalizerName]: normalized.json,
        [upstreamName]: { mapping_ok: true, engine_request: { scope: {} } },
      });
      const [mapped] = runCodeNode(node(mapperName).parameters.jsCode, {}, {
        [preauditName]: preaudit.json,
        [upstreamName]: { engine_request: { scope: {} } },
      });
      assert.equal(mapped.json.rpc_request, null, normalizerName + " must not construct an FP008-04 write");
      assert.deepEqual(JSON.parse(JSON.stringify(mapped.json.response)), {
        ok: false,
        redacted_error: {
          code: blockedCode,
          message: "The deduction service could not complete the command.",
        },
      }, normalizerName);
    }

    const pausedResult = { service_state: "paused", blocked_code: "MODEL_CALL_FAILED" };
    const [paused] = runCodeNode(source, {
      body: JSON.stringify({ ok: true, result: pausedResult }),
    }, {
      [upstreamName]: { mapping_ok: true },
    });
    assert.deepEqual(JSON.parse(JSON.stringify(paused.json)), {
      service_ok: true,
      engine_result: pausedResult,
      redacted_error: null,
    }, normalizerName);

    const selfCheckExhausted = {
      service_state: "blocked",
      blocked_code: "DEDUCTION_BLOCKED",
      chapters: [{
        candidate_plot_sim_json: {
          particles_records: [{
            particle_status: "blocked",
            self_check: { emotion: "fail", hook: "pass", pivot: "pass" },
          }],
        },
      }],
    };
    const [forwarded] = runCodeNode(source, {
      body: JSON.stringify({ ok: true, result: selfCheckExhausted }),
    }, {
      [upstreamName]: { mapping_ok: true },
    });
    assert.deepEqual(JSON.parse(JSON.stringify(forwarded.json)), {
      service_ok: true,
      engine_result: selfCheckExhausted,
      redacted_error: null,
    }, `${normalizerName} must send a third failed self-check to FP008-03`);
  }
});

test("a third failed self-check reaches FP008-03 and reuses the existing zero-write restart edge", async () => {
  const workflow = await readWorkflow();
  const node = name => workflow.nodes.find(candidate => candidate.name === name);
  const scope = {
    local_operator_id: "33333333-3333-4333-8333-333333333333",
    book_id: "44444444-4444-4444-8444-444444444444",
    l1a_unit_id: "55555555-5555-4555-8555-555555555555",
  };
  const initial = {
    mapping_ok: true,
    engine_request: {
      action: "resume",
      scope,
      chapters: [{
        chapter_id: "11111111-1111-4111-8111-111111111111",
        chapter_version_id: "22222222-2222-4222-8222-222222222222",
        checkpoint: { candidate_plot_sim_json: { particles_records: [] } },
      }],
    },
  };
  const engineResult = {
    service_state: "blocked",
    blocked_code: "DEDUCTION_BLOCKED",
    chapters: [{
      candidate_plot_sim_json: {
        particles_records: [{
          particle_status: "blocked",
          self_check: { emotion: false, hook: true, pivot: true },
        }],
      },
    }],
  };
  const riskHints = ["AUDIT-02", "AUDIT-03", "AUDIT-05", "AUDIT-06", "AUDIT-09"]
    .map(check_code => ({ check_code, outcome: "pass" }));

  for (const [normalizerName, serviceName, initialName, mapperName] of [
    ["JSON修复2", "JSON修复1", "JSON修复", null],
    ["JSON修复7", "JSON修复4", "JSON修复3", "JSON修复6"],
  ]) {
    const [audit] = runCodeNode(node(normalizerName).parameters.jsCode, {
      output_text: JSON.stringify({ ok: true, risk_hints: riskHints }),
    }, {
      [serviceName]: { service_ok: true, engine_result: engineResult, redacted_error: null },
      [initialName]: initial,
    });
    assert.equal(audit.json.self_check_exhausted, true, normalizerName);
    assert.equal(audit.json.p0_blocked, false, normalizerName);
    assert.equal(audit.json.audit_pass, false, normalizerName);
    assert.equal(audit.json.route_to_storage, false, normalizerName);
    assert.equal(audit.json.restart_required, true, normalizerName);

    const routed = mapperName
      ? runCodeNode(node(mapperName).parameters.jsCode, {}, {
        [normalizerName]: audit.json,
        [initialName]: initial,
      })[0].json
      : audit.json;
    assert.equal(routed.rpc_request, null, normalizerName);
    assert.equal(routed.mapping_ok, true, normalizerName);
    assert.equal(routed.engine_request.action, "restart", normalizerName);
    assert.equal(Object.hasOwn(routed.engine_request.chapters[0], "checkpoint"), false, normalizerName);
  }

  assert.match(node("If审计通过1").parameters.conditions.conditions[0].leftValue, /restart_required/);
  assert.match(node("If审计通过").parameters.conditions.conditions[0].leftValue, /restart_required/);
});

test("both FP008 service response normalizers retain the original mapping error over the placeholder request", async () => {
  const workflow = await readWorkflow();
  const node = name => workflow.nodes.find(candidate => candidate.name === name);
  const expected = {
    code: "CHECKPOINT_ACTION_MISMATCH",
    message: "Start and resume must match the persisted L1A checkpoint state.",
  };

  for (const [normalizer, mapper] of [["JSON修复1", "JSON修复"], ["JSON修复4", "JSON修复3"]]) {
    const [normalized] = runCodeNode(node(normalizer).parameters.jsCode, {
      body: JSON.stringify({ ok: false, redacted_error: { code: "INVALID_REQUEST", message: "placeholder" } }),
    }, {
      [mapper]: { mapping_ok: false, redacted_error: expected },
    });
    assert.deepEqual(JSON.parse(JSON.stringify(normalized.json)), {
      service_ok: false,
      engine_result: null,
      redacted_error: expected,
    });
  }
});

test("FP008-03 sends a complete P0 preaudit result back to the existing whole-L1A retry path", async () => {
  const workflow = await readWorkflow();
  const node = name => workflow.nodes.find(candidate => candidate.name === name);
  const scope = {
    local_operator_id: "33333333-3333-4333-8333-333333333333",
    book_id: "44444444-4444-4444-8444-444444444444",
    l1a_unit_id: "55555555-5555-4555-8555-555555555555",
  };
  const initial = {
    mapping_ok: true,
    engine_request: {
      action: "start",
      scope,
      token_budget: 3000000,
      token_budget_version: "mvp-fixed-3000000",
      chapters: [{
        chapter_id: "11111111-1111-4111-8111-111111111111",
        chapter_version_id: "22222222-2222-4222-8222-222222222222",
        checkpoint: { candidate_plot_sim_json: { particles_records: [] } },
      }],
      characters: [],
      world_state: [],
      relations: [],
      model_bindings: {},
    },
  };
  const p0Result = {
    ok: false,
    risk_hints: [
      { check_code: "AUDIT-02", outcome: "pass" },
      { check_code: "AUDIT-03", outcome: "risk" },
      { check_code: "AUDIT-05", outcome: "pass" },
      { check_code: "AUDIT-06", outcome: "pass" },
      { check_code: "AUDIT-09", outcome: "pass" },
    ],
  };

  for (const [normalizerName, serviceName, initialName, mapperName] of [
    ["JSON修复2", "JSON修复1", "JSON修复", null],
    ["JSON修复7", "JSON修复4", "JSON修复3", "JSON修复6"],
  ]) {
    const [audit] = runCodeNode(node(normalizerName).parameters.jsCode, {
      output_text: JSON.stringify(p0Result),
    }, {
      [serviceName]: { service_ok: true, engine_result: { chapters: [] } },
      [initialName]: initial,
    });

    assert.equal(audit.json.preaudit_valid, true, `${normalizerName} must accept complete P0 evidence`);
    assert.equal(audit.json.p0_blocked, true);
    assert.equal(audit.json.audit_pass, false);
    assert.equal(audit.json.route_to_storage, false);
    assert.equal(audit.json.redacted_error.code, "DEDUCTION_PREAUDIT_BLOCKED");

    const routed = mapperName
      ? runCodeNode(node(mapperName).parameters.jsCode, {}, {
        [normalizerName]: audit.json,
        [initialName]: initial,
      })[0].json
      : audit.json;
    assert.equal(routed.rpc_request, null, `${normalizerName} must not request FP008-04 persistence`);
    assert.equal(routed.mapping_ok, true, `${normalizerName} must feed the existing retry edge`);
    assert.equal(routed.engine_request.action, "restart");
    assert.deepEqual(routed.engine_request.scope, scope);
    assert.equal(Object.hasOwn(routed.engine_request, "creator_direction"), false);
    assert.equal(Object.hasOwn(routed.engine_request.chapters[0], "checkpoint"), false);
  }

  assert.match(node("If审计通过").parameters.conditions.conditions[0].leftValue, /restart_required/);
  assert.match(node("If审计通过1").parameters.conditions.conditions[0].leftValue, /restart_required/);
});

test("FP008-03 emits risk hints and routes both entry paths without a page approval gate", async () => {
  const workflow = await readWorkflow();
  const promptMaterial = await readFile(promptMaterialPath, "utf8");
  const node = name => workflow.nodes.find(candidate => candidate.name === name);
  const activePreaudit = workflow.nodes.find(candidate => candidate.id === "27389b02-a256-4603-9cba-84e9e65f7743");
  const activeNormalizer = workflow.nodes.find(candidate => candidate.id === "a30059fc-13f2-4fa5-a002-30e34b746b45");

  for (const name of ["FP008-03 阶段审计", "FP008-03 阶段审计1"]) {
    const preaudit = node(name);
    const parameters = JSON.stringify(preaudit.parameters);
    assert.match(parameters, /runtime_bindings/);
    assert.match(parameters, /FP008-03/);
    assert.match(parameters, /prompt_text/);
    assert.match(parameters, /provider_base_url/);
    assert.match(parameters, /temperature/);
    assert.match(parameters, /CONFIG_CONTRACT_BLOCKED/);
    assert.doesNotMatch(parameters, /deepseek-v4-flash-free/);
    assert.equal(preaudit.retryOnFail, true);
    assert.equal(preaudit.maxTries, 3);
    assert.equal(preaudit.onError, "continueRegularOutput");
  }
  for (const code of ["AUDIT-02", "AUDIT-03", "AUDIT-05", "AUDIT-06", "AUDIT-09"]) {
    assert.match(promptMaterial, new RegExp(code));
  }
  assert.equal(activePreaudit?.type, "n8n-nodes-base.httpRequest");
  assert.equal(activePreaudit?.typeVersion, 4.2);
  assert.equal(activePreaudit?.parameters.authentication, "predefinedCredentialType");
  assert.equal(activePreaudit?.parameters.nodeCredentialType, "openAiApi");
  assert.match(activePreaudit?.parameters.url ?? "", /provider_base_url/);
  assert.match(activePreaudit?.parameters.jsonBody ?? "", /runtime_bindings/);
  assert.match(activePreaudit?.parameters.jsonBody ?? "", /FP008-03/);
  assert.match(activePreaudit?.parameters.jsonBody ?? "", /prompt_text/);
  assert.match(activePreaudit?.parameters.jsonBody ?? "", /deduction_result/);
  assert.equal(activePreaudit?.parameters.options?.response?.response?.fullResponse, true);
  assert.equal(activePreaudit?.onError, "continueRegularOutput");
  assert.match(activeNormalizer?.parameters.jsCode ?? "", /choices\?\.\[0\]\?\.message\?\.content/);
  assert.equal(node("FP008-03 阶段审计2")?.type, "n8n-nodes-base.noOp");
  for (const name of ["FP008-04断章分析", "FP008-04断章分析1"]) {
    assert.equal(node(name)?.type, "n8n-nodes-base.noOp");
  }

  for (const required of [
    "运行时风险提示",
    "不产出 `audit_report` 或 `has_p0_blocker`",
    "不得审查小说正文",
  ]) {
    assert.match(promptMaterial, new RegExp(required));
  }

  for (const [name, serviceNode] of [["JSON修复2", "JSON修复1"], ["JSON修复7", "JSON修复4"]]) {
    const source = node(name).parameters.jsCode;
    assert.match(source, /const severityByCode = new Map/);
    assert.match(source, /\['AUDIT-02', 'P0'\]/);
    assert.match(source, /\['AUDIT-03', 'P0'\]/);
    assert.match(source, /\['AUDIT-05', 'P0'\]/);
    assert.match(source, /\['AUDIT-06', 'P1'\]/);
    assert.match(source, /\['AUDIT-09', 'P1'\]/);
    assert.match(source, /severity: severityByCode\.get\(hint\.check_code\)/);
    assert.match(source, /hint\.severity === 'P0'/);
    assert.match(source, /const self_check_exhausted = preaudit_valid/);
    assert.match(source, /const restart_required = p0_blocked \|\| self_check_exhausted/);
    assert.match(source, /const audit_pass = preaudit_valid && !restart_required/);
    assert.match(source, /const route_to_storage = audit_pass/);
    assert.match(source, /const p0HintPresent/);
    assert.match(source, /action: 'restart'/);
    assert.match(source, /creator_direction/);

    const [normalized] = runCodeNode(source, {
      output_text: JSON.stringify({
        ok: true,
        risk_hints: [
          { check_code: "AUDIT-02", severity: "P1", outcome: "risk" },
          { check_code: "AUDIT-03", severity: "P1", outcome: "pass" },
          { check_code: "AUDIT-05", severity: "P1", outcome: "pass" },
          { check_code: "AUDIT-06", severity: "P0", outcome: "pass" },
          { check_code: "AUDIT-09", severity: "P0", outcome: "pass" },
        ],
      }),
    }, {
      [serviceNode]: { service_ok: true, engine_result: {} },
    });
    assert.equal(normalized.json.preaudit_valid, true);
    assert.equal(normalized.json.p0_blocked, true);
    assert.equal(normalized.json.audit_pass, false);
    assert.equal(normalized.json.risk_hints.find(hint => hint.check_code === "AUDIT-02").severity, "P0");
    assert.equal(normalized.json.risk_hints.find(hint => hint.check_code === "AUDIT-06").severity, "P1");

    const completeRiskHints = [
      { check_code: "AUDIT-02", outcome: "pass" },
      { check_code: "AUDIT-03", outcome: "pass" },
      { check_code: "AUDIT-05", outcome: "pass" },
      { check_code: "AUDIT-06", outcome: "pass" },
      { check_code: "AUDIT-09", outcome: "pass" },
    ];
    const [missingEnvelope] = runCodeNode(source, {
      output_text: JSON.stringify({ risk_hints: completeRiskHints }),
    }, {
      [serviceNode]: { service_ok: true, engine_result: {} },
    });
    assert.equal(missingEnvelope.json.preaudit_valid, true);
    assert.equal(missingEnvelope.json.audit_pass, true);

    const [explicitRejection] = runCodeNode(source, {
      output_text: JSON.stringify({ ok: false, risk_hints: completeRiskHints }),
    }, {
      [serviceNode]: { service_ok: true, engine_result: {} },
    });
    assert.equal(explicitRejection.json.preaudit_valid, false);
    assert.equal(explicitRejection.json.audit_pass, false);
  }

  const manualContext = node("JSON修复6").parameters.jsCode;
  assert.match(manualContext, /rpc_request/);
  assert.match(manualContext, /candidate_version_id/);
  assert.match(manualContext, /l1a_unit_id/);
  assert.match(manualContext, /fp008-04:/);
  assert.match(manualContext, /\$execution\.id/);
  const [blocked] = runCodeNode(manualContext, {}, {
    "JSON修复7": {
      service_ok: false,
      preaudit_valid: false,
      audit_pass: false,
      redacted_error: { code: "DEDUCTION_SERVICE_FAILED" },
    },
    "JSON修复3": { engine_request: { scope: {} } },
  });
  assert.equal(blocked.json.rpc_request, null);
  assert.deepEqual(blocked.json.response, {
    ok: false,
    redacted_error: { code: "DEDUCTION_SERVICE_FAILED" },
  });

  assert.equal(node("FP008-03 阶段审计2").type, "n8n-nodes-base.noOp");
  assert.deepEqual(node("FP008-03 阶段审计2").parameters, {});
  assert.equal(node("FP008-03 阶段审计2").disabled, true);

  const autoConditions = node("If审计通过1").parameters.conditions.conditions;
  assert.equal(autoConditions.length, 1);
  assert.equal(
    autoConditions[0].leftValue,
    "={{ $json.route_to_storage === true || !($json.restart_required === true && $json.mapping_ok === true) }}",
  );

  const manualConditions = node("If审计通过").parameters.conditions.conditions;
  assert.equal(manualConditions.length, 1);
  assert.equal(
    manualConditions[0].leftValue,
    "={{ $json.route_to_storage === true || !($json.restart_required === true && $json.mapping_ok === true) }}",
  );
  assert.equal(manualConditions[0].rightValue, true);
});

test("FP008-03 receives each chapter's complete scene evidence and preserves the resource boundary", async () => {
  const workflow = await readWorkflow();
  const promptMaterial = await readFile(promptMaterialPath, "utf8");
  const preaudit = workflow.nodes.find(candidate => candidate.id === "27389b02-a256-4603-9cba-84e9e65f7743");
  const sceneConditionPackage = {
    scene_location: "maintenance well entrance",
    participant_chars: ["lead"],
    rule_locks: [{ rule_id: "R001", constraint: "authorization is required" }],
    scene_affordance: [{ item_code: "paper-ledger", available: true, functional: true, functions: ["CF-01"] }],
    available_resource_codes: ["paper-ledger"],
    info_reveal_candidates: [],
    chain_reaction_candidates: [],
    scene_constraints: ["the terminal remains authorization-bound"],
    forbid_lines_active: [],
    materialize_notes: [],
  };
  const context = {
    runtime_bindings: {
      "FP008-03": {
        model_name: "test-model",
        provider_base_url: "https://model.example/v1",
        prompt_text: "preaudit prompt",
        api_key_ref: "local-secure-ref:test",
        temperature: 0.2,
      },
    },
    chapters: [{
      chapter_id: "chapter-1",
      chapter_version_id: "version-1",
      target_snapshot_json: { goals: ["preserve the formal evidence boundary"] },
      scene_condition_package: sceneConditionPackage,
    }],
    characters: [{ character_id: "lead", knowledge_boundary_json: { knows: [], unknown: [], false_belief: [], reasonable_suspect: [] } }],
    world_state: [
      { atom_type: "geo", atom_key: "maintenance well", atom_value_jsonb: { summary: "registered facility" } },
      { atom_type: "job", atom_key: "maintenance operator", atom_value_jsonb: { summary: "registered terminal authorization" } },
    ],
  };

  const request = runExpressionWithNodes(preaudit.parameters.jsonBody, {
    service_ok: true,
    engine_result: { chapters: [] },
  }, {
    "读取拆解结果1": { context },
  });
  const input = JSON.parse(request.messages[0].content.split("\nINPUT=")[1]);

  assert.deepEqual(input.chapters, context.chapters);
  assert.match(promptMaterial, /available_resource_codes.*仅核验.*资源/u);
  assert.match(promptMaterial, /地理.*职业.*规则/u);
});

test("a resumed FP008-03 P0 returns the entire L1A to the existing restart branch", async () => {
  const workflow = await readWorkflow();
  const normalizer = workflow.nodes.find(candidate => candidate.id === "a30059fc-13f2-4fa5-a002-30e34b746b45");
  const scope = {
    local_operator_id: "11111111-1111-4111-8111-111111111111",
    book_id: "22222222-2222-4222-8222-222222222222",
    l1a_unit_id: "33333333-3333-4333-8333-333333333333",
  };
  const initial = {
    mapping_ok: true,
    engine_request: {
      action: "resume",
      scope,
      chapters: [{ chapter_id: "chapter-1", checkpoint: { current_particle_index: 2 } }],
    },
  };
  const riskHints = [
    { check_code: "AUDIT-02", outcome: "risk" },
    { check_code: "AUDIT-03", outcome: "pass" },
    { check_code: "AUDIT-05", outcome: "pass" },
    { check_code: "AUDIT-06", outcome: "pass" },
    { check_code: "AUDIT-09", outcome: "pass" },
  ];

  const [normalized] = runCodeNode(normalizer.parameters.jsCode, {
    output_text: JSON.stringify({ ok: false, risk_hints: riskHints }),
  }, {
    "JSON修复4": { service_ok: true, engine_result: {} },
    "JSON修复3": initial,
  });

  assert.equal(normalized.json.p0_blocked, true);
  assert.equal(normalized.json.mapping_ok, true);
  assert.equal(normalized.json.engine_request.action, "restart");
  assert.deepEqual(normalized.json.engine_request.scope, scope);
  assert.equal(Object.hasOwn(normalized.json.engine_request.chapters[0], "checkpoint"), false);
});

test("RPC-009 persists the whole released L1A automatically without a page approval gate", async () => {
  const workflow = await readWorkflow();
  const node = name => workflow.nodes.find(candidate => candidate.name === name);
  const persistence = workflow.nodes.filter(candidate => candidate.name.startsWith("推演结果断章入库"));
  const postgresNodes = workflow.nodes.filter(candidate => candidate.type === "n8n-nodes-base.postgres");

  assert.equal(workflow.active, false);
  assert.equal(persistence.length, 2);
  const scope = {
    local_operator_id: "33333333-3333-4333-8333-333333333333",
    book_id: "44444444-4444-4444-8444-444444444444",
    l1a_unit_id: "55555555-5555-4555-8555-555555555555",
  };
  const engineResult = {
    chapters: [{
      chapter_id: "11111111-1111-4111-8111-111111111111",
      candidate_version_id: "22222222-2222-4222-8222-222222222222",
      candidate_plot_sim_json: { particles_records: [], chapter_summary: {} },
      deduction_progress_json: {
        current_particle_index: 0, token_consumed: 0, remaining_particles: 1,
        deduction_complete: false, reject_count: 0,
      },
    }, {
      chapter_id: "66666666-6666-4666-8666-666666666666",
      candidate_version_id: "77777777-7777-4777-8777-777777777777",
      candidate_plot_sim_json: { particles_records: [], chapter_summary: {} },
      deduction_progress_json: {
        current_particle_index: 1, token_consumed: 32, remaining_particles: 0,
        deduction_complete: true, reject_count: 0,
      },
    }],
  };
  for (const [mapperName, auditName, initialName] of [
    ["JSON修复5", "JSON修复2", "JSON修复"],
    ["JSON修复6", "JSON修复7", "JSON修复3"],
  ]) {
    const source = node(mapperName).parameters.jsCode;
    const [mappedOutput] = runCodeNode(source, {}, {
      [auditName]: {
        service_ok: true,
        preaudit_valid: true,
        audit_pass: true,
        route_to_storage: true,
        engine_result: engineResult,
      },
      [initialName]: { engine_request: { scope } },
    });
    const mapped = mappedOutput.json.rpc_request;
    assert.deepEqual(
      mapped.chapters.map((chapter) => [chapter.chapter_id, chapter.chapter_version_id]),
      engineResult.chapters.map((chapter) => [chapter.chapter_id, chapter.candidate_version_id]),
    );
    assert.equal(mapped.local_operator_id, scope.local_operator_id);
    assert.equal(mapped.book_id, scope.book_id);
    assert.equal(mapped.l1a_unit_id, scope.l1a_unit_id);
    assert.match(mapped.idempotency_key, /^fp008-04:[A-Za-z0-9._:-]{1,118}$/);
  }
  for (const persistenceNode of persistence) {
    const serialized = JSON.stringify(persistenceNode.parameters);
    assert.match(serialized, /rpc_finalize_deduction_snapshot/);
    assert.doesNotMatch(persistenceNode.parameters.query, /\b(?:INSERT|UPDATE|DELETE|CALL)\b/i);
  }

  for (const postgresNode of postgresNodes) {
    assert.doesNotMatch(postgresNode.parameters.query, /\bl1a_chapters\b/);
  }
  for (const name of ["异常样本入库", "异常样本入库1"]) {
    assert.equal(node(name).disabled, true);
    assert.match(node(name).parameters.query, /ITERATION_SAMPLE_DISABLED/);
  }
  assert.equal(node("FP008-03 阶段审计2").disabled, true);
  assert.doesNotMatch(node("推演结果断章入库").parameters.query, /INVALID_REVIEW_DECISION|submitted,decision|return_direction/);
  assert.equal(node("推演结果断章入库").parameters.options.queryReplacement, "={{ [JSON.stringify($json)] }}");
  assert.match(JSON.stringify(workflow), /rpc_finalize_deduction_snapshot/);
});

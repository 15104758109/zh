import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workflowPath = path.join(root, "docs", "后端", "n8n", "ZH06-审计阶段.json");
const promptPath = path.join(root, "docs", "后端", "对齐版提示词.md");
const designPath = path.join(root, "docs", "v7设计文档_20260709_终版.md");
const agentsPath = path.join(root, "AGENTS.md");

function workflow() {
  return JSON.parse(readFileSync(workflowPath, "utf8"));
}

function fp012Prompt() {
  const source = readFileSync(promptPath, "utf8");
  const start = source.indexOf("### FP012-01 · 主编决策（路由裁决）");
  const end = source.indexOf("## FP013", start);
  assert.ok(start >= 0 && end > start, "missing FP012 prompt section");
  return source.slice(start, end);
}

function fp011ReaderPrompt() {
  const source = readFileSync(promptPath, "utf8");
  const start = source.indexOf("### FP011-01 · 读者体验审计");
  const end = source.indexOf("### FP011-02", start);
  assert.ok(start >= 0 && end > start, "missing FP011 reader prompt section");
  return source.slice(start, end);
}

function fp010Prompt() {
  const source = readFileSync(promptPath, "utf8");
  const start = source.indexOf("### FP010-01 · 客观审计（审查清单）");
  const end = source.indexOf("## FP011", start);
  assert.ok(start >= 0 && end > start, "missing FP010 prompt section");
  return source.slice(start, end);
}

function fp008Prompt() {
  const source = readFileSync(promptPath, "utf8");
  const start = source.indexOf("### FP008-02 · 导演分发与多角色循环推演");
  const end = source.indexOf("### FP008-03", start);
  assert.ok(start >= 0 && end > start, "missing FP008 prompt section");
  return source.slice(start, end);
}

function fp009Prompt() {
  const source = readFileSync(promptPath, "utf8");
  const start = source.indexOf("### FP009-01 · 文学呈现（忠实渲染器）");
  const end = source.indexOf("## FP010", start);
  assert.ok(start >= 0 && end > start, "missing FP009 prompt section");
  return source.slice(start, end);
}

function fp011CommercialPrompt() {
  const source = readFileSync(promptPath, "utf8");
  const start = source.indexOf("### FP011-02 · 商业审计");
  const end = source.indexOf("## FP012", start);
  assert.ok(start >= 0 && end > start, "missing FP011 commercial prompt section");
  return source.slice(start, end);
}

function fp009Spec() {
  const source = readFileSync(designPath, "utf8");
  const start = source.indexOf("### FP009-01 · 文学呈现");
  const end = source.indexOf("## FP010", start);
  assert.ok(start >= 0 && end > start, "missing FP009 V7 section");
  return source.slice(start, end);
}

function fp008Spec() {
  const source = readFileSync(designPath, "utf8");
  const start = source.indexOf("### FP008-02 · 导演分发与多角色循环推演");
  const end = source.indexOf("## FP009", start);
  assert.ok(start >= 0 && end > start, "missing FP008 V7 section");
  return source.slice(start, end);
}

function fp011CommercialSpec() {
  const source = readFileSync(designPath, "utf8");
  const start = source.indexOf("### FP011-02 · 商业审计");
  const end = source.indexOf("## FP012", start);
  assert.ok(start >= 0 && end > start, "missing FP011 commercial V7 section");
  return source.slice(start, end);
}

function runtimePrompt(section) {
  const start = section.indexOf("#### System Prompt");
  const end = section.indexOf("**数据契约", start);
  assert.ok(start >= 0 && end > start, "missing runtime prompt body");
  return section.slice(start, end);
}

function fp012Spec() {
  const source = readFileSync(designPath, "utf8");
  const start = source.indexOf("### FP012-01 · 主编决策（路由裁决）");
  const end = source.indexOf("### FP012-02", start);
  assert.ok(start >= 0 && end > start, "missing FP012 V7 section");
  return source.slice(start, end);
}

function node(value, name) {
  const result = value.nodes.find((candidate) => candidate.name === name);
  assert.ok(result, `missing ZH06 node: ${name}`);
  return result;
}

function modelRequestBody(value) {
  assert.equal(value.type, "n8n-nodes-base.httpRequest");
  assert.equal(typeof value.parameters.jsonBody, "string");
  return value.parameters.jsonBody;
}

function incomingSources(value, target) {
  return Object.entries(value.connections ?? {}).flatMap(([source, outputs]) => (
    (outputs.main ?? []).flatMap((edges) => (edges ?? [])
      .filter((edge) => edge.node === target)
      .map(() => source))
  ));
}

function incomingSourcesForInput(value, target, inputIndex) {
  return Object.entries(value.connections ?? {}).flatMap(([source, outputs]) => (
    (outputs.main ?? []).flatMap((edges) => (edges ?? [])
      .filter((edge) => edge.node === target && edge.index === inputIndex)
      .map(() => source))
  ));
}

function outputTargets(value, source, outputIndex) {
  return (value.connections?.[source]?.main?.[outputIndex] ?? []).map((edge) => edge.node);
}

function runCodeNode(source, context) {
  return vm.runInNewContext(`(() => { ${source} })()`, {
    $input: { first: () => ({ json: { output_text: "DATA_DEBT: DEDUCTION_SNAPSHOT_INCOMPLETE:particle-1" } }) },
    $: () => ({ first: () => ({ json: { context } }) }),
  });
}

function runPresentationParser(source, response, context) {
  return vm.runInNewContext(`(() => { ${source} })()`, {
    $input: { first: () => ({ json: response }) },
    $: () => ({ first: () => ({ json: { context } }) }),
  });
}

function runReviewParser(source, score, phase, response = { output_text: JSON.stringify(score) }) {
  const candidate = {
    local_operator_id: "11111111-1111-4111-8111-111111111111",
    book_id: "22222222-2222-4222-8222-222222222222",
    chapter_id: "33333333-3333-4333-8333-333333333333",
    chapter_version_id: "44444444-4444-4444-8444-444444444444",
    candidate_text: "同一候选版本正文",
  };
  const context = {
    request: { ...candidate, idempotency_key: `audit-${phase}` },
  };
  return vm.runInNewContext(`(() => { ${source} })()`, {
    $json: response,
    $: (name) => ({
      first: () => ({
        json: name === "JSON修复"
          ? { rpc_persist_candidate_text: candidate }
          : { context },
      }),
    }),
  });
}

function validReviewScore(phase) {
  if (phase === "reader") {
    return {
      阅读体验评分: { E1_沉浸感: { 得分: 0, 原文依据: "" } },
      心理共鸣评分: { D1_生存焦虑: { 得分: 0, 原文依据: "" } },
      风险预警指标: { R1_空心深刻: { 得分: 0, 原文依据: "" } },
      机器写作指纹: [],
      吐槽点预测: [],
      分数汇总: { 共鸣总分: 0, 体验总分: 0, 风险扣分: 0, 最终计算得分: 0 },
      全局综合评级: 0,
      建议修复行动: [],
    };
  }
  return {
    连载牵引力: { 末尾钩子强度: 0, 信息递进评级: "弱", 跳出风险点: [] },
    商业点兑现: {
      卖点兑现率: "0/0",
      类型眼情分布: { 爽点: 0, 虐点: 0, 甜点: 0, 燃点: 0 },
      精准语气实现: "未实现",
      原文依据: "未发现可核验的商业点兑现。",
    },
    节奏评估: { 情绪曲线匹配度: "偏离", 高潮间距合理性: "过疏", 缓冲章评价: "不适用" },
    可读性审计: [],
    综合商业评级: 0,
    商业修复建议: [],
  };
}

function runObjectiveParser(source, audit, response = null, candidateTruthLedger = {
  schema_version: 1,
  world_changes: [],
  character_live_state_changes: [],
  relation_changes: [],
  memories: [],
}) {
  const upstream = {
    request: {
      local_operator_id: "11111111-1111-4111-8111-111111111111",
      book_id: "22222222-2222-4222-8222-222222222222",
      chapter_id: "33333333-3333-4333-8333-333333333333",
      chapter_version_id: "44444444-4444-4444-8444-444444444444",
      idempotency_key: "audit-objective",
    },
    rpc_persist_candidate_text: {
      local_operator_id: "11111111-1111-4111-8111-111111111111",
      book_id: "22222222-2222-4222-8222-222222222222",
      chapter_id: "33333333-3333-4333-8333-333333333333",
      chapter_version_id: "44444444-4444-4444-8444-444444444444",
      candidate_text: "同一候选版本正文",
      idempotency_key: "audit-objective",
    },
    candidate_truth_ledger: candidateTruthLedger,
  };
  const failedChecks = Array.isArray(audit.checks) && audit.checks.some((check) => check?.pass === false);
  const payload = { ...audit };
  if (!Object.hasOwn(payload, "audited_handoff_package")) {
    payload.audited_handoff_package = {
      package_schema_version: 1,
      formalization_eligible: !failedChecks,
      world_changes: [],
      character_live_state_changes: [],
      relation_changes: [],
      memories: [],
      narrative_assets: [],
    };
  }
  if (!Object.hasOwn(payload, "assets")) payload.assets = [];
  const fullResponse = response ?? {
    statusCode: 200,
    data: JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
  };
  return vm.runInNewContext(`(() => { ${source} })()`, {
    $input: { first: () => ({ json: fullResponse }) },
    $: () => ({ first: () => ({ json: upstream }) }),
  });
}

function runResponseExpression(source, item, context) {
  const expression = source
    .replace(/^=\{\{\s*/u, "")
    .replace(/\s*\}\}$/u, "");
  return vm.runInNewContext(expression, {
    $json: item,
    $: () => ({ first: () => ({ json: { context } }) }),
  });
}

function runQueryReplacementExpression(source, item) {
  const expression = source
    .replace(/^=\{\{\s*/u, "")
    .replace(/\s*\}\}$/u, "");
  return vm.runInNewContext(expression, { $json: item });
}

function runModelRequestExpression(source, item, context) {
  const expression = source
    .replace(/^=\{\{\s*/u, "")
    .replace(/\s*\}\}$/u, "");
  return vm.runInNewContext(expression, {
    $json: item,
    $: () => ({ first: () => ({ json: { context } }) }),
  });
}

test("ZH06 delegates entry responses to its existing redacted response node", () => {
  const entry = workflow().nodes.find((candidate) => candidate.type === "n8n-nodes-base.webhook");

  assert.ok(entry, "missing ZH06 webhook entry");
  assert.equal(entry.parameters.httpMethod, "POST");
  assert.equal(entry.parameters.responseMode, "responseNode");
  assert.equal(
    node(workflow(), "Respond：审计与写回完成").type,
    "n8n-nodes-base.respondToWebhook",
  );
});

test("ZH06 does not issue an FP012-02 wait route before formal chapter commit", () => {
  const value = workflow();
  const editorialParser = node(value, "JSON修复 (2)3");
  const editorialStore = node(value, "FP012-01 主编证据入库");
  const wait = node(value, "FP012-02 前端闸门");

  assert.equal(wait.parameters.resume, "webhook");
  assert.equal(wait.parameters.httpMethod, "POST");
  assert.equal(wait.parameters.responseMode, "onReceived");
  assert.doesNotMatch(editorialParser.parameters.jsCode, /wait_route|\$execution\.resumeUrl|FP012_WAIT_ROUTE_UNAVAILABLE/u);
  assert.equal(editorialStore.parameters.options.queryReplacement, "={{ JSON.stringify($json) }}");
  assert.doesNotMatch(editorialStore.parameters.query, /wait_route/u);
});

test("ZH06 FP011 parsers construct scoped phase evidence without touching objective audit", () => {
  const value = workflow();
  const readerParser = node(value, "JSON修复 (2)2");
  const commercialParser = node(value, "JSON修复 (2)1");

  for (const [phase, parser] of [["reader", readerParser], ["commercial", commercialParser]]) {
    const source = parser.parameters.jsCode;
    assert.doesNotMatch(source, /TOPOLOGY_CONTRACT_BLOCKED/u);
    assert.match(source, /rpc_record_chapter_review_evidence/u);
    assert.match(source, new RegExp(`phase:\\s*["']${phase}["']`, "u"));
    assert.match(source, /local_operator_id/u);
    assert.match(source, /book_id/u);
    assert.match(source, /chapter_id/u);
    assert.match(source, /chapter_version_id/u);
    assert.match(source, /score_json:\s*score/u);
    assert.doesNotMatch(source, /rpc_confirm_audit_result|objective_audit|audit_findings_jsonb|p0_items_json/u);

    const output = runReviewParser(source, validReviewScore(phase), phase);
    assert.deepEqual(
      Object.keys(output[0].json.rpc_requests),
      ["rpc_record_chapter_review_evidence"],
    );
  }
});

test("ZH06 FP011 parsers consume Chat Completions choices from the HTTP adapter", () => {
  const value = workflow();

  for (const [phase, parserName] of [["reader", "JSON修复 (2)2"], ["commercial", "JSON修复 (2)1"]]) {
    const score = validReviewScore(phase);
    const response = { body: { choices: [{ message: { content: JSON.stringify(score) } }] } };
    const output = runReviewParser(node(value, parserName).parameters.jsCode, score, phase, response);
    assert.deepEqual(Object.keys(output[0].json.rpc_requests), ["rpc_record_chapter_review_evidence"]);
  }
});

test("ZH06 FP011 parsers reject provider failures before constructing review evidence", () => {
  const value = workflow();
  const failures = [
    { statusCode: 401, body: { error: { message: "unauthorized" } } },
    { statusCode: 429, body: { error: { message: "rate limited" } } },
    { statusCode: 500, body: { error: { message: "upstream failed" } } },
    { statusCode: 200, body: { error: { message: "provider returned an error envelope" } } },
  ];

  for (const [phase, parserName] of [["reader", "JSON修复 (2)2"], ["commercial", "JSON修复 (2)1"]]) {
    const parser = node(value, parserName);
    const errorCode = phase === "reader"
      ? /FP011_READER_UPSTREAM_FAILED/u
      : /FP011_COMMERCIAL_UPSTREAM_FAILED/u;
    for (const response of failures) {
      assert.throws(
        () => runReviewParser(parser.parameters.jsCode, {}, phase, response),
        errorCode,
      );
    }
  }
});

test("ZH06 FP011 parsers reject successful HTTP responses without their review structure", () => {
  const value = workflow();
  const malformedSuccess = {
    statusCode: 200,
    body: {
      choices: [{ message: { content: JSON.stringify({ message: "temporarily unavailable" }) } }],
    },
  };

  for (const [phase, parserName] of [["reader", "JSON修复 (2)2"], ["commercial", "JSON修复 (2)1"]]) {
    const errorCode = phase === "reader"
      ? /FP011_READER_OUTPUT_INVALID/u
      : /FP011_COMMERCIAL_OUTPUT_INVALID/u;
    assert.throws(
      () => runReviewParser(node(value, parserName).parameters.jsCode, {}, phase, malformedSuccess),
      errorCode,
    );
  }
});

test("ZH06 keeps objective evidence out of both subjective audit model inputs", () => {
  const value = workflow();
  const reader = node(value, "FP011-01读者审计");
  const commercial = node(value, "FP011-02 商业审计");

  for (const review of [reader, commercial]) {
    const input = modelRequestBody(review);
    assert.match(input, /candidate_text/u);
    assert.match(input, /book_context/u);
    assert.match(input, /\$\('JSON修复'\)\.first\(\)\.json/u);
    assert.doesNotMatch(input, /JSON\.stringify\(\$json\)/u);
    assert.doesNotMatch(input, /objective_audit|objective_gate|p0_items_json|audit_findings_jsonb|rpc_confirm_audit_result/u);
  }
});

test("ZH06 retries transient model transport failures before parsing", () => {
  const value = workflow();
  for (const name of [
    "FP009-01 文学呈现",
    "FP010-01客观审计",
    "FP011-01读者审计",
    "FP011-02 商业审计",
    "FP012-01 主编决策",
  ]) {
    const model = node(value, name);
    assert.equal(model.retryOnFail, true, name);
    assert.equal(model.maxTries, 3, name);
    assert.equal(model.waitBetweenTries, 5000, name);
  }
});

test("ZH06 lets the FP010 parser enforce JSON when the active provider rejects response_format", () => {
  const value = workflow();
  const subjectiveReviewNodes = [
    "FP011-01读者审计",
    "FP011-02 商业审计",
  ];
  for (const name of [
    ...subjectiveReviewNodes,
    "FP012-01 主编决策",
  ]) {
    const model = node(value, name);
    assert.match(modelRequestBody(model), /response_format[\s\S]*json_object/u, name);
    assert.equal(model.parameters.options.response.response.responseFormat, "json", name);
  }
  for (const name of subjectiveReviewNodes) {
    assert.match(
      modelRequestBody(node(value, name)),
      /reasoning:\s*\{\s*effort:\s*'none'\s*\}/u,
      `${name} must reserve its response budget for the V7 review DTO`,
    );
  }
  const objective = node(value, "FP010-01客观审计");
  assert.doesNotMatch(modelRequestBody(objective), /response_format/u);
  assert.equal(
    objective.parameters.options.response.response.responseFormat,
    "text",
    "FP010 must preserve the full Chat Completions envelope for its parser",
  );
  const presentation = node(value, "FP009-01 文学呈现");
  assert.doesNotMatch(modelRequestBody(presentation), /response_format/u);
  assert.match(
    modelRequestBody(presentation),
    /role:\s*'system'[\s\S]*role:\s*'user'/u,
    "FP009 must keep the active prompt separate from the locked user input",
  );
  assert.equal(
    presentation.parameters.options.response.response.responseFormat,
    "text",
    "FP009 prose must preserve the complete Chat Completions body for its text parser",
  );
  assert.match(
    presentation.parameters.options.timeout,
    /runtime_bindings\?\.\['FP009-01'\][\s\S]*parameters_jsonb\?\.timeout_ms/u,
    "FP009 must consume the active FP016 timeout instead of an n8n default",
  );
  assert.match(presentation.parameters.options.timeout, /CONFIG_CONTRACT_BLOCKED/u);
});

test("ZH06 rejects a non-zero reader score that has no evidence before persistence", () => {
  const parser = node(workflow(), "JSON修复 (2)2");
  const bareNonZeroScore = validReviewScore("reader");
  bareNonZeroScore.阅读体验评分.E1_沉浸感 = 2;

  assert.throws(
    () => runReviewParser(parser.parameters.jsCode, bareNonZeroScore, "reader"),
    /FP011_READER_OUTPUT_INVALID: every non-zero reader score needs evidence/u,
  );
});

test("FP011 reader prompt requires evidence-bearing score objects", () => {
  const source = runtimePrompt(fp011ReaderPrompt());

  assert.match(source, /"E1_沉浸感"\s*:\s*\{[\s\S]*?"得分"\s*:\s*[0-3][\s\S]*?"原文依据"\s*:\s*"/u);
  assert.doesNotMatch(source, /"E1_沉浸感"\s*:\s*2/u);
  assert.match(source, /非零.*(?:原文依据|证据)/u);
});

test("FP010 runtime prompt sends every failed P0/P1 check back to FP009 and emits all nine check results", () => {
  const source = runtimePrompt(fp010Prompt());

  assert.match(source, /P0\/P1.*FP010-02.*FP009-01/su);
  assert.match(source, /审查-01.*审查-09/su);
  assert.match(source, /全部通过.*return_route_suggestion_jsonb.*\{\}/su);
  assert.doesNotMatch(source, /P1[^\n]*FP012-01/u);
  assert.doesNotMatch(source, /回到 FP008|回 FP008/u);
});

test("FP008 distinguishes a runtime pre-audit restart from an objective prose rewrite", () => {
  const prompt = fp008Prompt();
  const spec = fp008Spec();

  assert.match(prompt, /只有 FP008-03 的运行时预检未放行.*从首颗粒重推/su);
  assert.match(prompt, /FP010 的 P0\/P1.*FP009-01.*重写正文/su);
  assert.doesNotMatch(prompt, /P0 从首颗粒重推/u);

  assert.match(spec, /FP010 的 P0\/P1.*FP009-01.*重写正文/su);
  assert.match(spec, /FP010 的 P0\/P1.*不产生影子/su);
  assert.doesNotMatch(spec, /写库后立即不可变，后续修改只可通过 is_shadow=true 版本覆盖/u);
});

test("FP012 keeps objective P0 as a read-only gate outside editorial aggregation", () => {
  const source = fp012Prompt();

  assert.match(source, /P0\/P1 已在 FP010-02 留痕后直接回 FP009-01/u);
  assert.match(source, /主编只综合(?:主观审计|读者\/商业主观审计)/u);
  assert.match(source, /fix_instruction_json.*不得复制或重述客观审计内容/u);
  assert.doesNotMatch(source, /客观审计报告_JSON/u);
  assert.doesNotMatch(source, /对客观审计和读者\/商业审计报告中的修改建议/u);
  assert.doesNotMatch(source, /建议来源.*客观审计/u);
});

test("FP012 runtime prompt receives only subjective evidence and emits the V7 decision fields", () => {
  const source = runtimePrompt(fp012Prompt());

  assert.match(source, /reader_evidence/u);
  assert.match(source, /commercial_evidence/u);
  assert.match(source, /target_snapshot_json/u);
  assert.match(source, /reject_count/u);
  assert.doesNotMatch(source, /has_p0_blocker|RETURN_(?:POLISH|TEXT|DEDUCTION)|system_iteration_alert/u);
  for (const field of ["verdict", "fix_instruction_json", "reject_count_observed", "force_manual"]) {
    assert.match(source, new RegExp(`"${field}"`, "u"));
  }
});

test("FP012 does not turn the third review count into an automatic rejection", () => {
  const source = runtimePrompt(fp012Prompt());

  assert.match(source, /非空的改进建议.*不等于.*实质问题/u);
  assert.match(source, /信息递进、情绪曲线、镜头履约和章末钩子总体成立/u);
  assert.match(source, /局部重复、句序重排、措辞替换、可选压缩.*非阻塞优化.*判 Y/su);
  assert.match(source, /不得以存在.*HIGH\/MEDIUM\/LOW.*建议标签作为 N 的依据/u);
  assert.match(source, /先独立判定 verdict.*再根据 reject_count.*设置 force_manual/su);
  assert.match(source, /只有.*verdict.*N.*reject_count\s*=\s*2.*force_manual.*true/su);
  assert.doesNotMatch(source, /若 reject_count\s*=\s*2[^\n]*输出 verdict:\s*"N"/u);
  assert.doesNotMatch(source, /当 reject_count\s*=\s*2 时，必须输出 verdict 为 N/u);
});

test("FP009 keeps unresolved facts unresolved instead of inventing a definite location or cause", () => {
  const source = runtimePrompt(fp009Prompt());

  assert.match(source, /FACT-FIDELITY-01/u);
  assert.match(source, /unknown/u);
  assert.match(source, /can_misjudge/u);
  assert.match(source, /未确认的地点、来源、动机、结果或因果/u);
});

test("FP009 rewrites from the current prose without using broad deletion as convergence", () => {
  const source = runtimePrompt(fp009Prompt());

  assert.match(source, /chapter_words.*book_context/u);
  assert.match(source, /candidate_text.*退回重写.*表达基线/u);
  assert.match(source, /保留.*叙事信息量.*章节丰满度/u);
  assert.match(source, /只删除真正同义重复.*不得通过整体删短/u);
});

test("V7 FP012 keeps objective P0 outside the chief-editor review content", () => {
  const source = fp012Spec();

  assert.match(source, /P0\/P1 已在 FP010-02 留痕后直接回 FP009-01/u);
  assert.match(source, /只可汇总读者\/商业体验审计/u);
  assert.match(source, /不进入主编审计内容或.*fix_instruction_json/u);
});

test("ZH06 loader reads one scoped, locked candidate before presentation", () => {
  const value = workflow();
  const loader = node(value, "读取章节推演结果 plot_sim_json / target_snapshot_json");

  // FP009/010/011 must all receive the same current, locked candidate version.
  assert.match(loader.parameters.query, /public\.chapter_version/u);
  assert.match(loader.parameters.query, /public\.chapter_header/u);
  assert.match(loader.parameters.query, /current_l1a_id/u);
  assert.match(loader.parameters.query, /version_state = 'candidate'/u);
  assert.match(loader.parameters.query, /deduction_locked/u);
  assert.match(loader.parameters.query, /candidate_plot_sim_json/u);
  assert.match(loader.parameters.query, /target_snapshot_json/u);
  assert.match(loader.parameters.query, /prose_text/u);
  assert.match(loader.parameters.query, /chapter_words/u);
  assert.match(loader.parameters.query, /exception_summary_jsonb/u);
  assert.match(loader.parameters.query, /SCOPE_REJECTED/u);
  assert.match(loader.parameters.query, /DEDUCTION_NOT_LOCKED/u);
  assert.match(node(value, "JSON修复").parameters.jsCode, /candidate_ready/u);
});

test("ZH06 rejects an incomplete locked snapshot before FP010 and renders its authoritative audit input", () => {
  const value = workflow();
  const loader = value.nodes.find((candidate) => candidate.name.includes("plot_sim_json"));
  const objectiveModel = value.nodes.find((candidate) => candidate.name.includes("FP010-01"));
  const baselinePlaceholder = "{{ \u6b63\u5f0f\u72b6\u6001\u57fa\u7ebf_JSON }}";
  const ledgerPlaceholder = "{{ candidate_truth_ledger_JSON }}";
  const placeholders = {
    prose: "{{ 待审故事正文_TEXT }}",
    plot: "{{ 推演结果_JSON }}",
    target: "{{ 目标快照_JSON }}",
    world: "{{ 世界设定包_JSON }}",
    characters: "{{ 角色档案_JSON }}",
    baseline: baselinePlaceholder,
    ledger: ledgerPlaceholder,
  };
  const promptText = Object.entries(placeholders)
    .map(([key, placeholder]) => `${key.toUpperCase()}=${placeholder}`)
    .join("\n");
  const ledger = {
    schema_version: 1,
    world_changes: [],
    character_live_state_changes: [],
    relation_changes: [],
    memories: [],
  };
  const item = {
    candidate_text: "candidate prose",
    candidate_plot_sim_json: { particles_records: [], candidate_truth_ledger: ledger },
    target_snapshot_json: { target: "chapter" },
    world_state_json: [{ world_state_id: "world-1" }],
    character_profiles_json: [{ id: "character-1" }],
    formal_state_baseline_json: {
      world_states: [{ world_state_id: "world-1" }],
      character_live_states: [{ id: "character-1" }],
      relation_states: [],
      memories: [],
    },
    candidate_truth_ledger: ledger,
  };
  const context = {
    runtime_bindings: {
      "FP010-01": {
        model_name: "test-model",
        provider_base_url: "https://example.invalid/v1",
        prompt_text: promptText,
        api_key_ref: "env:test",
        temperature: 0,
      },
    },
  };

  assert.ok(loader, "missing ZH06 candidate loader");
  assert.ok(objectiveModel, "missing FP010 model node");
  const nestedExpressionDelimiter = "\\{" + "\\{";
  assert.equal(
    (modelRequestBody(objectiveModel).match(new RegExp(nestedExpressionDelimiter, "g")) ?? []).length,
    1,
    "FP010 must construct prompt placeholders at runtime so n8n does not parse them as nested expressions",
  );
  assert.match(modelRequestBody(objectiveModel), /const placeholder = \(name\) =>/u);
  assert.match(loader.parameters.query, /candidate_truth_ledger_valid/u);
  assert.match(loader.parameters.query, /DEDUCTION_SNAPSHOT_INCOMPLETE/u);
  assert.throws(
    () => runModelRequestExpression(
      objectiveModel.parameters.jsonBody,
      { ...item, candidate_truth_ledger: undefined },
      context,
    ),
    /FP010_INPUT_INCOMPLETE/u,
  );

  const request = JSON.parse(runModelRequestExpression(
    objectiveModel.parameters.jsonBody,
    item,
    context,
  ));
  const content = request.messages[0].content;
  const expectedReplacements = {
    prose: item.candidate_text,
    plot: item.candidate_plot_sim_json,
    target: item.target_snapshot_json,
    world: item.world_state_json,
    characters: item.character_profiles_json,
    baseline: item.formal_state_baseline_json,
    ledger: item.candidate_truth_ledger,
  };
  for (const [key, placeholder] of Object.entries(placeholders)) {
    assert.ok(!content.includes(placeholder), `unreplaced FP010 placeholder: ${key}`);
    assert.ok(content.includes(JSON.stringify(expectedReplacements[key])), `missing FP010 input: ${key}`);
  }
  assert.doesNotMatch(content, /\nINPUT=/u, "FP010 must not append a duplicate full input snapshot");
});

test("ZH06 loader accepts only the current L1A's ordered next candidate", () => {
  const loader = node(workflow(), "读取章节推演结果 plot_sim_json / target_snapshot_json");

  // FP009-00 lets the browser name an L1A, never an arbitrary chapter. The
  // workflow must reject a candidate while any earlier chapter still lacks
  // the author's continue confirmation.
  assert.match(loader.parameters.query, /\{scope,l1a_unit_id\}/u);
  assert.match(loader.parameters.query, /requested_l1a_unit_id/u);
  assert.match(loader.parameters.query, /ORDER BY h\.chapter_index/u);
  assert.doesNotMatch(loader.parameters.query, /cv\.id = s\.chapter_version_id/u);
  assert.match(loader.parameters.query, /ordered_next_candidate/u);
  assert.match(loader.parameters.query, /confirmation_status IS DISTINCT FROM 'creator_confirmed'/u);
  assert.match(loader.parameters.query, /CHAPTER_ORDER_REJECTED/u);
});

test("ZH06 stops before another FP009 call after the third editorial return", () => {
  const value = workflow();
  const loader = node(value, "读取章节推演结果 plot_sim_json / target_snapshot_json");
  const editorialParser = node(value, "JSON修复 (2)3");

  assert.match(loader.parameters.query, /editorial_retry_limit_reached/u);
  assert.match(loader.parameters.query, /decision_json->>'force_manual'/u);
  assert.match(loader.parameters.query, /EDITORIAL_RETRY_LIMIT_REACHED/u);
  assert.match(
    loader.parameters.query,
    /candidate_ready[\s\S]*NOT COALESCE\(editorial_retry_limit_reached, false\)/u,
  );
  assert.match(
    editorialParser.parameters.jsCode,
    /forceManual\s*=\s*output\.verdict === 'N'\s*&&\s*rejectCount >= 2/u,
  );
});

test("ZH06 continuation unwraps the next presentation scope before re-entering FP009", () => {
  const loader = node(workflow(), "读取章节推演结果 plot_sim_json / target_snapshot_json");
  const presentationRequest = {
    local_operator_id: "11111111-1111-4111-8111-111111111111",
    book_id: "22222222-2222-4222-8222-222222222222",
    l1a_unit_id: "55555555-5555-4555-8555-555555555555",
    idempotency_key: "continue-next",
  };

  const replacement = runQueryReplacementExpression(
    loader.parameters.options.queryReplacement,
    {
      presentation_request: presentationRequest,
      rewrite_request: { book_id: "must-not-win" },
    },
  );

  assert.deepEqual(JSON.parse(replacement[0]), presentationRequest);
});

test("ZH06 sends a P0/P1 correction only into FP009's next rewrite", () => {
  const value = workflow();
  const loader = value.nodes.find((candidate) => candidate.name.includes("plot_sim_json"));
  const objectiveStore = value.nodes.find((candidate) => candidate.name.includes("FP010-02"));
  const presentation = value.nodes.find((candidate) => candidate.name.includes("FP009-01"));
  const presentationParser = value.nodes.find((candidate) => candidate.name === "JSON修复");
  const rewriteRequest = {
    scope: {
      local_operator_id: "11111111-1111-4111-8111-111111111111",
      book_id: "22222222-2222-4222-8222-222222222222",
      l1a_unit_id: "55555555-5555-4555-8555-555555555555",
    },
    return_route_suggestion_jsonb: { suggestion: "rewrite only the cited unsupported assertion" },
  };

  assert.ok(loader);
  assert.ok(objectiveStore);
  assert.ok(presentation);
  assert.ok(presentationParser);
  assert.deepEqual(
    JSON.parse(runQueryReplacementExpression(
      loader.parameters.options.queryReplacement,
      { rewrite_request: rewriteRequest },
    )[0]),
    rewriteRequest,
  );
  assert.match(objectiveStore.parameters.query, /AS rewrite_request/u);
  assert.match(objectiveStore.parameters.query, /objective_audit,return_route_suggestion_jsonb/u);
  assert.match(loader.parameters.query, /request->'return_route_suggestion_jsonb'/u);
  assert.match(modelRequestBody(presentation), /return_route_suggestion_jsonb/u);
  assert.match(fp009Prompt(), /return_route_suggestion_jsonb/u);
  assert.doesNotMatch(presentationParser.parameters.jsCode, /return_route_suggestion_jsonb/u);

  for (const review of value.nodes.filter((candidate) => (
    candidate.type === "n8n-nodes-base.httpRequest"
      && /FP011-0[12]|FP012-01/.test(candidate.name)
  ))) {
    assert.doesNotMatch(modelRequestBody(review), /return_route_suggestion_jsonb/u);
  }
});

test("ZH06 short-circuits FP009 before its LLM request when authoritative inputs are missing", () => {
  const value = workflow();
  const loader = node(value, "读取章节推演结果 plot_sim_json / target_snapshot_json");
  const presentationParser = node(value, "JSON修复");
  const presentationModel = node(value, "FP009-01 文学呈现");
  const modelInput = modelRequestBody(presentationModel);

  assert.match(loader.parameters.query, /world_state_json/u);
  assert.match(loader.parameters.query, /character_profiles_json/u);
  assert.match(modelInput, /formal_initial_world_state/u);
  assert.match(modelInput, /formal_active_character/u);
  assert.match(modelInput, /candidate_ready/u);
  assert.match(modelInput, /DATA_DEBT/u);
  assert.match(presentationParser.parameters.jsCode, /DATA_DEBT/u);
});

test("ZH06 FP009 preserves the loader's baseline and locked ledger for objective audit", () => {
  const parser = node(workflow(), "JSON修复");
  const baseline = { world_states: [{ world_state_id: "world-1" }] };
  const ledger = {
    schema_version: 1,
    world_changes: [],
    character_live_state_changes: [],
    relation_changes: [],
    memories: [],
  };
  const context = {
    candidate_ready: true,
    config_ready: true,
    request: { idempotency_key: "fp009-parser-fixture" },
    candidate: {
      world_state_json: [{ world_state_id: "world-1" }],
      character_profiles_json: [{ id: "character-1" }],
      formal_state_baseline_json: baseline,
      candidate_truth_ledger: ledger,
    },
  };
  const output = runPresentationParser(parser.parameters.jsCode, {
    body: { choices: [{ message: { content: "候选正文" } }] },
  }, context);

  assert.equal(output[0].json.candidate_text, "候选正文");
  assert.deepEqual(output[0].json.formal_state_baseline_json, baseline);
  assert.deepEqual(output[0].json.candidate_truth_ledger, ledger);
});

test("ZH06 FP009 unwraps the production full-response data envelope before parsing prose", () => {
  const parser = node(workflow(), "JSON修复");
  const context = {
    candidate_ready: true,
    config_ready: true,
    request: { idempotency_key: "fp009-full-response-fixture" },
    candidate: {
      world_state_json: [{ world_state_id: "world-1" }],
      character_profiles_json: [{ id: "character-1" }],
    },
  };
  const response = {
    statusCode: 200,
    data: JSON.stringify({ choices: [{ message: { content: "候选正文" } }] }),
  };

  const output = runPresentationParser(parser.parameters.jsCode, response, context);
  assert.equal(output[0].json.candidate_text, "候选正文");
  assert.throws(
    () => runPresentationParser(parser.parameters.jsCode, { statusCode: 502, data: response.data }, context),
    /FP009_UPSTREAM_FAILED/u,
  );
  assert.throws(
    () => runPresentationParser(parser.parameters.jsCode, { statusCode: 200, data: "{" }, context),
    /FP009_OUTPUT_INVALID/u,
  );
  assert.throws(
    () => runPresentationParser(parser.parameters.jsCode, {
      statusCode: 200,
      data: JSON.stringify({ choices: [{ message: { content: "I appreciate the comprehensive system prompt you've provided, but I can't process this request as specified." } }] }),
    }, context),
    /FP009_OUTPUT_INVALID: literary presentation returned model refusal text/u,
  );
  assert.throws(
    () => runPresentationParser(parser.parameters.jsCode, {
      statusCode: 200,
      data: JSON.stringify({ choices: [{ message: { content: "I cannot process this request.\n\nThe system prompt you've provided instructs me to render locked deductions." } }] }),
    }, context),
    /FP009_OUTPUT_INVALID: literary presentation returned model refusal text/u,
  );
});

test("ZH06 FP009 accepts the execution 3493 double-layer Chat Completions envelope", () => {
  const parser = node(workflow(), "JSON修复");
  const baseline = { world_states: [{ world_state_id: "world-1" }] };
  const ledger = {
    schema_version: 1,
    world_changes: [],
    character_live_state_changes: [],
    relation_changes: [],
    memories: [],
  };
  const context = {
    candidate_ready: true,
    config_ready: true,
    request: { idempotency_key: "fp009-execution-3493-fixture" },
    candidate: {
      world_state_json: [{ world_state_id: "world-1" }],
      character_profiles_json: [{ id: "character-1" }],
      formal_state_baseline_json: baseline,
      candidate_truth_ledger: ledger,
    },
  };
  const output = runPresentationParser(parser.parameters.jsCode, {
    statusCode: 200,
    data: JSON.stringify({ choices: [{ message: { content: "候选正文" } }] }),
  }, context);

  assert.equal(output[0].json.candidate_text, "候选正文");
  assert.deepEqual(output[0].json.formal_state_baseline_json, baseline);
  assert.deepEqual(output[0].json.candidate_truth_ledger, ledger);
  assert.equal(output[0].json.rpc_persist_candidate_text.candidate_text, "候选正文");
});

test("ZH06 FP009 reads each formal character together with its current live state", () => {
  const loader = node(workflow(), "读取章节推演结果 plot_sim_json / target_snapshot_json");
  const query = loader.parameters.query;

  assert.match(query, /FROM public\.v_character_active AS character/u);
  assert.doesNotMatch(query, /FROM public\.character AS character/u);
  for (const field of [
    "live_state_id",
    "philosophy_live_json",
    "emotion_state_json",
    "drive_live_json",
    "trigger_state_json",
    "goal_state_json",
    "pressure_level",
    "current_goal_txt",
    "current_emo_tag",
  ]) {
    assert.match(query, new RegExp(`'${field}'\\s*,\\s*character\\.${field}`, "u"), field);
  }
});

test("FP009 accepts supplied formal facts and locked L1A commitments without recasting them as scene resources", () => {
  const presentationModel = node(workflow(), "FP009-01 文学呈现");
  const modelInput = modelRequestBody(presentationModel);

  // The presentation prompt needs the same persisted facts that authorized
  // this candidate, but V7 does not require a formal world fact or a locked
  // L1A commitment to be duplicated in the scene-resource list.
  assert.match(modelInput, /deduction_locked:\s*candidate\.deduction_locked/u);
  assert.match(modelInput, /deduction_progress_json:\s*candidate\.deduction_progress_json/u);
  assert.match(modelInput, /scene_condition_package/u);
  assert.match(modelInput, /available_resource_codes/u);
  assert.match(modelInput, /world_state_json/u);
  assert.match(modelInput, /locked_future_l1a_commitments/u);
  assert.match(modelInput, /DATA_DEBT/u);
  assert.doesNotMatch(modelInput, /concrete props or facilities used to execute an event/u);
  assert.doesNotMatch(modelInput, /SCENE_RESOURCE_UNDECLARED/u);
});

test("ZH06 returns missing authoritative inputs through the existing FP009 error outlet", () => {
  const value = workflow();
  const presentation = node(value, "FP009-01 文学呈现");
  const response = node(value, "Respond：审计与写回完成");

  assert.equal(presentation.onError, "continueErrorOutput");
  assert.match(presentation.parameters.url, /candidate_ready/u);
  assert.match(presentation.parameters.url, /redacted_error/u);
  assert.match(modelRequestBody(presentation), /DATA_DEBT/u);
  assert.deepEqual(
    outputTargets(value, "FP009-01 文学呈现", 0),
    ["JSON修复"],
  );
  assert.deepEqual(
    outputTargets(value, "FP009-01 文学呈现", 1),
    ["Respond：审计与写回完成"],
  );
  assert.match(response.parameters.responseBody, /DATA_DEBT/u);
  assert.match(response.parameters.responseBody, /DEDUCTION_NOT_LOCKED/u);
});

test("ZH06 redacts preflight context before returning an FP009 error", () => {
  const response = node(workflow(), "Respond：审计与写回完成");
  const context = {
    candidate_ready: false,
    redacted_error: {
      code: "DEDUCTION_NOT_LOCKED",
      message: "A current locked candidate is required before audit processing can start.",
    },
    runtime_bindings: {
      "FP009-01": { prompt_text: "must never reach the browser" },
    },
  };

  const payload = runResponseExpression(response.parameters.responseBody, {
    context,
    runtime_bindings: context.runtime_bindings,
  }, context);

  assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
    ok: false,
    redacted_error: context.redacted_error,
  });
  assert.doesNotMatch(JSON.stringify(payload), /runtime_bindings|prompt_text/u);
});

test("ZH06 does not treat the recorded Chinese word count as a formal-write blocker", () => {
  const response = node(workflow(), "Respond：审计与写回完成");
  const context = {
    candidate_ready: true,
    candidate: { world_state_json: [{}], character_profiles_json: [{}] },
  };
  const payload = runResponseExpression(response.parameters.responseBody, {
    editorial_record: { ok: true },
    decision: { verdict: "Y", force_manual: false },
    scope: { book_id: "must-not-reach-browser" },
    candidate_context: { target_snapshot_json: { secret: true } },
    runtime_bindings: { "FP012-01": { prompt_text: "must-not-reach-browser" } },
  }, context);

  assert.deepEqual(JSON.parse(JSON.stringify(payload)), { ok: true });
  assert.doesNotMatch(JSON.stringify(payload), /WORD_COUNT_CONTRACT_UNRESOLVED/u);
  assert.doesNotMatch(JSON.stringify(payload), /wait_route/u);
  assert.doesNotMatch(JSON.stringify(payload), /scope|target_snapshot_json|runtime_bindings|prompt_text/u);
});

test("ZH06 keeps a主编 N inside the automatic rewrite loop", () => {
  const response = node(workflow(), "Respond：审计与写回完成");
  const context = {
    candidate_ready: true,
    candidate: { world_state_json: [{}], character_profiles_json: [{}] },
  };
  const payload = runResponseExpression(response.parameters.responseBody, {
    wait_route: "http://127.0.0.1:5678/webhook-waiting/2207?signature=same-run",
    decision: { verdict: "N", force_manual: false },
  }, context);

  assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
    ok: false,
    redacted_error: {
      code: "EDITORIAL_REWRITING",
      message: "The editor returned this candidate for automatic literary revision.",
    },
  });
});

test("ZH06 reports a persisted P0 blocker without opening the editorial wait", () => {
  const response = node(workflow(), "Respond：审计与写回完成");
  const context = {
    candidate_ready: true,
    candidate: { world_state_json: [{}], character_profiles_json: [{}] },
  };
  const payload = runResponseExpression(response.parameters.responseBody, {
    objective_gate: { has_p0_blocker: true },
  }, context);

  assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
    ok: false,
    redacted_error: {
      code: "P0_BLOCKED",
      message: "The objective audit blocked this candidate before editorial review.",
    },
  });
});

test("ZH06 never treats FP009 data debt output as candidate prose", () => {
  const source = node(workflow(), "JSON修复").parameters.jsCode;
  const context = {
    candidate_ready: true,
    config_ready: true,
    data_debt: [],
    request: {},
    candidate: {
      world_state_json: [{}],
      character_profiles_json: [{}],
    },
  };

  assert.throws(
    () => runCodeNode(source, context),
    /DATA_DEBT: DEDUCTION_SNAPSHOT_INCOMPLETE:particle-1/u,
  );
});

test("ZH06 returns FP009 semantic data debt through the existing response node", () => {
  const value = workflow();
  const parser = node(value, "JSON修复");
  const response = node(value, "Respond：审计与写回完成");
  const context = {
    candidate_ready: true,
    candidate: { world_state_json: [{}], character_profiles_json: [{}] },
  };

  assert.equal(parser.onError, "continueErrorOutput");
  assert.deepEqual(
    outputTargets(value, "JSON修复", 1),
    ["Respond：审计与写回完成"],
  );
  const payload = runResponseExpression(response.parameters.responseBody, {
    error: "DATA_DEBT: missing formal upstream fact",
  }, context);

  assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
    ok: false,
    redacted_error: {
      code: "DATA_DEBT",
      message: "Literary presentation requires declared upstream source facts.",
    },
  });
});

test("ZH06 persists the objective result before routing its P0 gate", () => {
  const value = workflow();
  const loader = node(value, "读取章节推演结果 plot_sim_json / target_snapshot_json");
  const presentation = node(value, "FP009-01 文学呈现");
  const presentationParser = node(value, "JSON修复");
  const objectiveAudit = node(value, "FP010-01客观审计");
  const objectiveParser = node(value, "JSON修复 (2)");
  const objectiveStore = node(value, "FP010-02 审计证据入库");
  const objectiveGate = node(value, "IF：客观审计通过？");
  const auditResponse = node(value, "Respond：审计与写回完成");

  assert.deepEqual(presentation.credentials.openAiApi, {
    id: "ktkbgOI2RQI4Y8QK",
    name: "OpenAI account",
  });
  assert.deepEqual(objectiveAudit.credentials.openAiApi, {
    id: "ktkbgOI2RQI4Y8QK",
    name: "OpenAI account",
  });

  // FP009, FP010, and both FP011 reviews need the same scoped candidate plus
  // the formal facts V7 assigns to their respective reads.
  for (const expected of [
    /chapter_implementation_json/u,
    /public\.world_state/u,
    /setting_layer = 'initial'/u,
    /public\.v_character_active/u,
    /previous_formal_prose_text/u,
    /book_context/u,
  ]) {
    assert.match(loader.parameters.query, expected);
  }
  for (const expected of [
    /candidate_plot_sim_json/u,
    /target_snapshot_json/u,
    /chapter_implementation_json/u,
    /world_state_json/u,
    /character_profiles_json/u,
    /book_context/u,
    /previous_formal_prose_text/u,
  ]) {
    assert.match(presentationParser.parameters.jsCode, expected);
  }

  // A subjective return rewrites the current prose snapshot in place. The
  // renderer therefore needs both the prose it is revising and the editor's
  // expression-only instruction; the locked deduction alone is insufficient.
  assert.match(
    presentation.parameters.jsonBody,
    /candidate_text:\s*candidate\.prose_text\s*\?\?\s*null.*fix_instruction_json:\s*candidate\.fix_instruction_json\s*\?\?\s*null/su,
  );

  // A completed objective review is not necessarily a passed review. Its
  // immutable evidence must exist before the branch decides whether the
  // subjective/editorial chain is allowed to start.
  assert.match(objectiveParser.parameters.jsCode, /audit_pass:\s*!objectiveRequiresRewrite/u);
  assert.match(objectiveParser.parameters.jsCode, /审查-01.*审查-09/su);
  assert.match(JSON.stringify(objectiveGate.parameters), /objective_gate\.has_p0_blocker/u);
  assert.doesNotMatch(JSON.stringify(objectiveGate.parameters), /objective_complete/u);
  assert.equal(objectiveGate.typeVersion, 2.3);
  assert.match(
    objectiveGate.parameters.conditions.conditions[0].leftValue,
    /objective_gate\.has_p0_blocker === false.*objective_gate\.requires_rewrite !== true/u,
  );
  assert.match(objectiveStore.parameters.query, /rpc_confirm_audit_result/u);
  assert.match(objectiveStore.parameters.query, /AS objective_gate/u);
  assert.match(objectiveStore.parameters.query, /objective_persistence_ok/u);
  assert.match(objectiveStore.parameters.query, /objective_persistence_error/u);
  // A P0/P1 return re-enters the existing loader. The loader accepts only an
  // L1A scope, so the persisted objective result must carry the L1A resolved
  // from the verified chapter rather than ask the browser for a chapter id.
  assert.match(objectiveStore.parameters.query, /h\.l1a_unit_id AS l1a_unit_id/u);
  assert.match(objectiveStore.parameters.query, /'l1a_unit_id', candidate\.l1a_unit_id/u);
  assert.match(objectiveStore.parameters.query, /audited\.result->'error'/u);
  assert.match(objectiveStore.parameters.query, /ELSE false\s+END AS objective_persistence_ok/u);
  assert.doesNotMatch(
    objectiveStore.parameters.query,
    /WHERE persisted\.result->>'ok' = 'true'[\s\S]*audited\.result->>'ok' = 'true'/u,
  );
  assert.doesNotMatch(
    objectiveGate.parameters.conditions.conditions[0].leftValue,
    /throw new Error/u,
  );
  assert.equal(
    runQueryReplacementExpression(
      objectiveGate.parameters.conditions.conditions[0].leftValue,
      {
        objective_persistence_ok: false,
        objective_gate: { has_p0_blocker: false, requires_rewrite: false },
      },
    ),
    false,
  );
  assert.equal(
    runQueryReplacementExpression(
      objectiveGate.parameters.conditions.conditions[0].leftValue,
      {
        objective_persistence_ok: true,
        objective_gate: { has_p0_blocker: false, requires_rewrite: false },
      },
    ),
    true,
  );
  assert.deepEqual(incomingSources(value, "FP010-02 审计证据入库"), ["JSON修复 (2)"]);
  assert.deepEqual(
    outputTargets(value, "FP010-02 审计证据入库", 0),
    ["IF：客观审计通过？"],
  );
  assert.equal(objectiveStore.onError, "continueErrorOutput");
  assert.match(
    objectiveStore.parameters.query,
    /persistence_guard AS \([\s\S]*SELECT persisted\.result->>'ok' = 'true'[\s\S]*AND audited\.result->>'ok' = 'true' AS asserted[\s\S]*FROM persisted, audited/su,
  );
  assert.doesNotMatch(objectiveStore.parameters.query, /SELECT 1 \/ CASE/u);
  assert.doesNotMatch(objectiveStore.parameters.query, /RPC_FAILED\[/u);
  assert.doesNotMatch(objectiveStore.parameters.query, /::integer/u);
  assert.match(
    auditResponse.parameters.responseBody,
    /source\.objective_persistence_ok === false/u,
  );
  assert.deepEqual(
    outputTargets(value, "FP010-02 审计证据入库", 1),
    ["Respond：审计与写回完成"],
  );
  assert.deepEqual(incomingSources(value, "IF：客观审计通过？"), ["FP010-02 审计证据入库"]);
  assert.deepEqual(
    outputTargets(value, "IF：客观审计通过？", 0),
    ["FP011-01读者审计", "FP011-02 商业审计", "三审计证据汇集"],
  );
  assert.deepEqual(
    outputTargets(value, "IF：客观审计通过？", 1),
    ["读取章节推演结果 plot_sim_json / target_snapshot_json"],
  );
  assert.deepEqual(
    incomingSourcesForInput(value, "三审计证据汇集", 0),
    ["IF：客观审计通过？"],
  );
});

test("ZH06 routes objective audit from the nine check results, not from a non-empty no-return note", () => {
  const value = workflow();
  const parser = node(value, "JSON修复 (2)");
  const store = node(value, "FP010-02 审计证据入库");
  const checks = Array.from({ length: 9 }, (_, index) => ({
    check_id: `审查-${String(index + 1).padStart(2, "0")}`,
    severity: index < 5 ? "P0" : "P1",
    pass: true,
    findings: "通过",
    evidence: {},
  }));
  const passed = runObjectiveParser(parser.parameters.jsCode, {
    has_p0_blocker: false,
    checks,
    p0_items_json: [],
    audit_findings_jsonb: { summary: "九项均通过" },
    return_route_suggestion_jsonb: { suggestion: "无需退回", reason: "九项均通过" },
  });

  assert.equal(passed[0].json.audit_pass, true);
  assert.equal(passed[0].json.objective_requires_rewrite, false);

  const mappedFindings = runObjectiveParser(parser.parameters.jsCode, {
    has_p0_blocker: false,
    checks,
    p0_items_json: [],
    audit_findings_jsonb: {},
    return_route_suggestion_jsonb: {},
  });
  assert.equal(
    mappedFindings[0].json.rpc_requests.rpc_confirm_audit_result.audit.audit_findings_jsonb.checks.length,
    9,
  );

  checks[8] = { ...checks[8], pass: false, findings: "节奏目标未完成" };
  const p1Return = runObjectiveParser(parser.parameters.jsCode, {
    has_p0_blocker: false,
    checks,
    p0_items_json: [],
    audit_findings_jsonb: { summary: "审查-09 未通过" },
    return_route_suggestion_jsonb: { suggestion: "回 FP009-01", reason: "修正文学呈现" },
  });

  assert.equal(p1Return[0].json.audit_pass, false);
  assert.equal(p1Return[0].json.objective_requires_rewrite, true);
  assert.match(store.parameters.query, /objective_requires_rewrite/u);
  assert.doesNotMatch(
    store.parameters.query,
    /return_route_suggestion_jsonb[^\n]+<> '\{\}'::jsonb/u,
  );
});

test("ZH06 FP010 parser requires the canonical P0 evidence-list invariant", () => {
  const parser = node(workflow(), "JSON修复 (2)");
  const passingChecks = Array.from({ length: 9 }, (_, index) => ({
    check_id: `审查-${String(index + 1).padStart(2, "0")}`,
    severity: index < 5 ? "P0" : "P1",
    pass: true,
    findings: "通过",
    evidence: {},
  }));
  const baseAudit = {
    has_p0_blocker: false,
    checks: passingChecks,
    p0_items_json: [],
    audit_findings_jsonb: { summary: "九项均通过" },
    return_route_suggestion_jsonb: {},
  };

  const passed = runObjectiveParser(parser.parameters.jsCode, baseAudit);
  assert.deepEqual(
    JSON.parse(JSON.stringify(passed[0].json.rpc_requests.rpc_confirm_audit_result.audit.p0_items_json)),
    [],
  );

  const p0Items = [{ provider_owned_evidence: "opaque" }];
  const p0Audit = {
    ...baseAudit,
    has_p0_blocker: true,
    checks: passingChecks.map((check, index) => index === 0 ? { ...check, pass: false } : check),
    p0_items_json: p0Items,
    audit_findings_jsonb: { summary: "审查-01 未通过" },
    return_route_suggestion_jsonb: { suggestion: "回 FP009-01", reason: "修正正文事实" },
  };
  const blocked = runObjectiveParser(parser.parameters.jsCode, p0Audit);
  assert.deepEqual(
    JSON.parse(JSON.stringify(blocked[0].json.rpc_requests.rpc_confirm_audit_result.audit.p0_items_json)),
    p0Items,
  );

  for (const invalidAudit of [
    { ...baseAudit, p0_items_json: {} },
    { ...baseAudit, p0_items_json: [{ unexpected: "must stay empty without P0" }] },
    { ...p0Audit, p0_items_json: [] },
    (() => {
      const missing = { ...p0Audit };
      delete missing.p0_items_json;
      return missing;
    })(),
  ]) {
    assert.throws(
      () => runObjectiveParser(parser.parameters.jsCode, invalidAudit),
      /FP010_OUTPUT_INVALID/u,
    );
  }
});

test("ZH06 FP010 parser consumes only the full Chat Completions response envelope", () => {
  const parser = workflow().nodes.find(
    (candidate) => candidate.id === "0e329fca-f483-4ec1-aaf3-4812e88d4239",
  );
  assert.ok(parser, "missing FP010 parser node");
  const checkPrefix = "\u5ba1\u67e5-";
  const checks = Array.from({ length: 9 }, (_, index) => ({
    check_id: `${checkPrefix}${String(index + 1).padStart(2, "0")}`,
    severity: index < 5 ? "P0" : "P1",
    pass: true,
    findings: "通过",
    evidence: {},
  }));
  const audit = {
    has_p0_blocker: false,
    checks,
    p0_items_json: [],
    audit_findings_jsonb: { summary: "九项均通过" },
    return_route_suggestion_jsonb: {},
    audited_handoff_package: {
      package_schema_version: 1,
      formalization_eligible: true,
      world_changes: [],
      character_live_state_changes: [],
      relation_changes: [],
      memories: [],
      narrative_assets: [],
    },
    assets: [],
  };
  const response = {
    statusCode: 200,
    data: JSON.stringify({
      choices: [{
        message: { content: JSON.stringify(audit) },
        reasoning: "this is not the objective audit DTO",
      }],
    }),
  };

  const output = runObjectiveParser(parser.parameters.jsCode, audit, response);
  assert.equal(output[0].json.audit_pass, true);
  assert.equal(output[0].json.objective_audit.audit_findings_jsonb.summary, "九项均通过");
  assert.match(parser.parameters.jsCode, /source\.data/u);
  assert.match(parser.parameters.jsCode, /provider\.choices\?\.\[0\]\?\.message\?\.content/u);
  assert.doesNotMatch(parser.parameters.jsCode, /output_text|reasoning|source\.body/u);

  for (const failedResponse of [
    { statusCode: 401, data: response.data },
    { statusCode: 429, data: response.data },
    { statusCode: 500, data: response.data },
    { statusCode: 200, data: JSON.stringify({ error: { message: "provider failure" } }) },
  ]) {
    assert.throws(
      () => runObjectiveParser(parser.parameters.jsCode, audit, failedResponse),
      /FP010_UPSTREAM_FAILED/u,
    );
  }
  for (const failedResponse of [
    { statusCode: 200, data: "{" },
    { statusCode: 200, data: "" },
    { statusCode: 200, data: JSON.stringify({ choices: [{ reasoning: JSON.stringify(audit) }] }) },
  ]) {
    assert.throws(
      () => runObjectiveParser(parser.parameters.jsCode, audit, failedResponse),
      /FP010_OUTPUT_INVALID/u,
    );
  }
});

test("ZH06 FP010 validates a well-formed multi-string audit before repair fallback", () => {
  const parser = workflow().nodes.find(
    (candidate) => candidate.id === "0e329fca-f483-4ec1-aaf3-4812e88d4239",
  );
  assert.ok(parser, "missing FP010 parser node");
  const checkPrefix = String.fromCodePoint(0x5ba1, 0x67e5, 0x2d);
  const audit = {
    has_p0_blocker: true,
    checks: [{
      check_id: `${checkPrefix}01`,
      severity: "P0",
      pass: false,
      findings: "objective failure",
      evidence: {},
    }],
    p0_items_json: [],
    audit_findings_jsonb: {
      preset_emotion_nodes: ["pressure", "resolve"],
      actual_realized_nodes: ["pressure"],
    },
    return_route_suggestion_jsonb: {},
    audited_handoff_package: {
      package_schema_version: 1,
      formalization_eligible: false,
      world_changes: [],
      character_live_state_changes: [],
      relation_changes: [],
      memories: [],
      narrative_assets: [],
    },
    assets: [],
  };
  const response = {
    statusCode: 200,
    data: JSON.stringify({ choices: [{ message: { content: JSON.stringify(audit, null, 2) } }] }),
  };

  assert.throws(
    () => runObjectiveParser(parser.parameters.jsCode, audit, response),
    /all objective checks 01-09 require a P0\/P1 label and boolean pass result/u,
  );
  assert.match(parser.parameters.jsCode, /return JSON\.parse\(text\)/u);
});

test("ZH06 FP010 repairs only the isolated structural noise observed in execution 3578", () => {
  const parser = node(workflow(), "JSON修复 (2)");
  const checks = Array.from({ length: 9 }, (_, index) => ({
    check_id: `审查-${String(index + 1).padStart(2, "0")}`,
    severity: index < 5 ? "P0" : "P1",
    pass: true,
    findings: "通过",
    evidence: index === 8 ? {
      text_excerpt: "潮汐回声管廊的墙面沥青泛着潮湿的暗光。",
      deduction_reference: "章节目标快照 emotion_goals：E101 营造压抑氛围；E102 引导好奇探索。",
      field: "情绪目标实现",
    } : {},
  }));
  const audit = {
    has_p0_blocker: false,
    checks,
    p0_items_json: [],
    audit_findings_jsonb: {},
    return_route_suggestion_jsonb: {},
    audited_handoff_package: {
      package_schema_version: 1,
      formalization_eligible: true,
      world_changes: [],
      character_live_state_changes: [],
      relation_changes: [],
      memories: [],
      narrative_assets: [],
    },
    assets: [],
  };
  const wellFormed = JSON.stringify(audit, null, 2);
  const missingCheckCloser = '\n    }\n  ],\n  "p0_items_json"';
  const omission = wellFormed.lastIndexOf(missingCheckCloser);
  assert.ok(omission >= 0, "fixture must retain execution 3578's check-array shape");
  const execution3578Content = `${wellFormed.slice(0, omission)}\n  ],\n  "p0_items_json"${wellFormed.slice(omission + missingCheckCloser.length)}\n}`;
  const envelope = (content) => ({
    statusCode: 200,
    data: JSON.stringify({ choices: [{ message: { content } }] }),
  });

  const recovered = runObjectiveParser(
    parser.parameters.jsCode,
    audit,
    envelope(execution3578Content),
  );
  assert.equal(recovered[0].json.audit_pass, true);
  assert.equal(recovered[0].json.objective_audit.checks.length, 9);
  assert.equal(recovered[0].json.objective_audit.checks.at(-1).check_id, "审查-09");
  assert.deepEqual(
    JSON.parse(JSON.stringify(recovered[0].json.rpc_requests.rpc_confirm_audit_result.audit.p0_items_json)),
    [],
  );

  for (const content of [
    wellFormed.slice(0, -1),
    `${wellFormed}\n${wellFormed}`,
    `${wellFormed}\n}`,
  ]) {
    assert.throws(
      () => runObjectiveParser(parser.parameters.jsCode, audit, envelope(content)),
      /FP010_OUTPUT_INVALID: objective audit must be JSON/u,
    );
  }
});

test("ZH06 FP010 repairs the unescaped evidence citation observed in execution 3751", () => {
  const parser = node(workflow(), "JSON修复 (2)");
  const checks = Array.from({ length: 9 }, (_, index) => ({
    check_id: `审查-${String(index + 1).padStart(2, "0")}`,
    severity: index < 5 ? "P0" : "P1",
    pass: true,
    findings: "通过",
    evidence: {},
  }));
  const citation = `world_setting":"${String.fromCodePoint(0x566c, 0x58f0, 0x85fb, 0x7fa4)}`;
  checks[0] = { ...checks[0], evidence: { deduction_reference: citation } };
  const audit = {
    has_p0_blocker: false,
    checks,
    p0_items_json: [],
    audit_findings_jsonb: {},
    return_route_suggestion_jsonb: {},
    audited_handoff_package: {
      package_schema_version: 1,
      formalization_eligible: true,
      world_changes: [],
      character_live_state_changes: [],
      relation_changes: [],
      memories: [],
      narrative_assets: [],
    },
    assets: [],
  };
  const wellFormed = JSON.stringify(audit, null, 2);
  const escapedCitation = JSON.stringify(citation).slice(1, -1);
  const execution3751Content = wellFormed.replace(escapedCitation, citation);
  const envelope = {
    statusCode: 200,
    data: JSON.stringify({ choices: [{ message: { content: execution3751Content } }] }),
  };

  const recovered = runObjectiveParser(parser.parameters.jsCode, audit, envelope);
  assert.equal(recovered[0].json.audit_pass, true);
  assert.equal(
    recovered[0].json.objective_audit.checks[0].evidence.deduction_reference,
    citation,
  );
});

test("ZH06 FP010 derives handoff eligibility from the complete objective pass tuple", () => {
  const parser = node(workflow(), "JSON修复 (2)");
  const checks = Array.from({ length: 9 }, (_, index) => ({
    check_id: `审查-${String(index + 1).padStart(2, "0")}`,
    severity: index < 5 ? "P0" : "P1",
    pass: true,
    findings: "通过",
    evidence: {},
  }));
  const audit = {
    has_p0_blocker: false,
    checks,
    p0_items_json: [],
    audit_findings_jsonb: {},
    return_route_suggestion_jsonb: {},
    audited_handoff_package: {
      package_schema_version: 1,
      formalization_eligible: false,
      world_changes: [],
      character_live_state_changes: [],
      relation_changes: [],
      memories: [],
      narrative_assets: [],
    },
    assets: [],
  };

  const output = runObjectiveParser(parser.parameters.jsCode, audit);
  assert.equal(output[0].json.audit_pass, true);
  assert.equal(output[0].json.objective_audit.audited_handoff_package.formalization_eligible, true);
});

test("ZH06 FP010 derives fixed check severity from the V7 check ID when execution 3581 mislabels it", () => {
  const parser = node(workflow(), "JSON修复 (2)");
  const checks = Array.from({ length: 9 }, (_, index) => ({
    check_id: `审查-${String(index + 1).padStart(2, "0")}`,
    severity: index === 0 || index === 1 ? "P0" : "P1",
    pass: index !== 1,
    findings: index === 1 ? "正文出现未定义仪器。" : "通过",
    evidence: {},
  }));
  const audit = {
    has_p0_blocker: true,
    checks,
    p0_items_json: [{ check_id: "审查-02", reason: "正文出现未定义仪器。" }],
    audit_findings_jsonb: {},
    return_route_suggestion_jsonb: { suggestion: "回 FP009-01", reason: "修正文学呈现" },
    audited_handoff_package: {
      package_schema_version: 1,
      formalization_eligible: false,
      world_changes: [],
      character_live_state_changes: [],
      relation_changes: [],
      memories: [],
      narrative_assets: [],
    },
    assets: [],
  };

  const output = runObjectiveParser(parser.parameters.jsCode, audit);
  assert.equal(output[0].json.audit_pass, false);
  assert.deepEqual(
    JSON.parse(JSON.stringify(output[0].json.objective_audit.checks.slice(0, 5).map((check) => check.severity))),
    ["P0", "P0", "P0", "P0", "P0"],
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(output[0].json.rpc_requests.rpc_confirm_audit_result.audit.p0_items_json)),
    audit.p0_items_json,
  );

  const invalidSeverity = {
    ...audit,
    checks: checks.map((check, index) => index === 2 ? { ...check, severity: "P2" } : check),
  };
  assert.throws(
    () => runObjectiveParser(parser.parameters.jsCode, invalidSeverity),
    /FP010_OUTPUT_INVALID/u,
  );
});

test("ZH06 persists the FP010 audited handoff package and returns a real boolean persistence gate", () => {
  const value = workflow();
  const parser = node(value, "JSON修复 (2)");
  const store = node(value, "FP010-02 审计证据入库");
  const checks = Array.from({ length: 9 }, (_, index) => ({
    check_id: `审查-${String(index + 1).padStart(2, "0")}`,
    severity: index < 5 ? "P0" : "P1",
    pass: true,
    findings: "通过",
    evidence: {},
  }));
  const handoff = {
    package_schema_version: 1,
    formalization_eligible: true,
    world_changes: [],
    character_live_state_changes: [],
    relation_changes: [],
    memories: [],
    narrative_assets: [{ asset_ref: "hook-1", asset_type: "hook" }],
  };
  const assets = [{
    asset_ref: "hook-1",
    asset_type: "hook",
    asset_name: "候选钩子",
    asset_description: "本章事件留下的候选钩子。",
    countdown_deadline: 2,
  }];

  const output = runObjectiveParser(parser.parameters.jsCode, {
    has_p0_blocker: false,
    checks,
    p0_items_json: [],
    audit_findings_jsonb: { summary: "九项均通过" },
    return_route_suggestion_jsonb: {},
    audited_handoff_package: handoff,
    assets,
  });

  assert.deepEqual(
    JSON.parse(JSON.stringify(output[0].json.rpc_requests.rpc_confirm_audit_result.audit.audited_handoff_package_jsonb)),
    handoff,
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(output[0].json.rpc_requests.rpc_confirm_audit_result.assets)),
    assets,
  );
  assert.throws(
    () => runObjectiveParser(parser.parameters.jsCode, {
      has_p0_blocker: false,
      checks,
      p0_items_json: [],
      audit_findings_jsonb: { summary: "九项均通过" },
      return_route_suggestion_jsonb: {},
      audited_handoff_package: handoff,
      assets: [],
    }),
    /FP010_OUTPUT_INVALID: narrative asset metadata/u,
  );
  for (const invalidAssets of [
    [{
      asset_ref: "hook-1",
      asset_type: "hook",
      asset_name: "候选钩子",
      asset_description: "本章事件留下的候选钩子。",
    }],
    [{
      asset_ref: "hook-1",
      asset_type: "foreshadow",
      asset_name: "候选伏笔",
      asset_description: "本章事件留下的候选伏笔。",
    }],
  ]) {
    assert.throws(
      () => runObjectiveParser(parser.parameters.jsCode, {
        has_p0_blocker: false,
        checks,
        p0_items_json: [],
        audit_findings_jsonb: { summary: "九项均通过" },
        return_route_suggestion_jsonb: {},
        audited_handoff_package: {
          ...handoff,
          narrative_assets: [{ asset_ref: "hook-1", asset_type: invalidAssets[0].asset_type }],
        },
        assets: invalidAssets,
      }),
      /FP010_OUTPUT_INVALID: narrative asset metadata/u,
    );
  }
  assert.match(fp010Prompt(), /asset_type 为 hook 时必须提供整数 countdown_deadline/u);
  assert.match(fp010Prompt(), /asset_type 为 foreshadow 时必须提供非空 fulfillment_window/u);
  assert.match(
    fp010Prompt(),
    /"asset_type": "hook", "asset_name": "资产名称", "asset_description": "资产内容与事件依据", "countdown_deadline": 12/u,
  );
  assert.match(
    fp010Prompt(),
    /"asset_type": "foreshadow", "asset_name": "资产名称", "asset_description": "资产内容与事件依据", "fulfillment_window": "第12-15章"/u,
  );
  assert.match(store.parameters.query, /ELSE false\s+END AS objective_persistence_ok/u);
  assert.doesNotMatch(store.parameters.query, /\)::boolean\s+END AS objective_persistence_ok/u);
});

test("ZH06 projects locked candidate truth into the FP010 handoff", () => {
  const parser = node(workflow(), "JSON修复 (2)");
  const checks = Array.from({ length: 9 }, (_, index) => ({
    check_id: `审查-${String(index + 1).padStart(2, "0")}`,
    severity: index < 5 ? "P0" : "P1",
    pass: true,
    findings: "通过",
    evidence: {},
  }));
  const ledger = {
    schema_version: 1,
    world_changes: [{ world_state_id: "world-1", before: { fuel: 2 }, after: { fuel: 1 }, event_ids: ["event-1"] }],
    character_live_state_changes: [{ character_id: "character-1", change_type: "shift", change_layer: 1, before: {}, after: { focus: "escape" }, event_ids: ["event-1"] }],
    relation_changes: [{ relation_state_id: "relation-1", char_a_id: "character-1", char_b_id: "character-2", before: {}, after: { trust: 1 }, change_event: {}, event_ids: ["event-1"] }],
    memories: [{ character_id: "character-1", memory_type: "event", memory_content: "locked event", truth_status: "true", importance: 0.5, decay_rate: 0.1, event_ids: ["event-1"] }],
  };
  const modelHandoff = {
    package_schema_version: 1,
    formalization_eligible: true,
    world_changes: [{ world_state_id: "invented-world" }],
    character_live_state_changes: [{ character_id: "invented-character" }],
    relation_changes: [{ relation_state_id: "invented-relation" }],
    memories: [{ character_id: "invented-character" }],
    narrative_assets: [{ asset_ref: "hook-1", asset_type: "hook" }],
  };
  const assets = [{
    asset_ref: "hook-1",
    asset_type: "hook",
    asset_name: "候选钩子",
    asset_description: "本章事件留下的候选钩子。",
    countdown_deadline: 2,
  }];

  const output = runObjectiveParser(parser.parameters.jsCode, {
    has_p0_blocker: false,
    checks,
    p0_items_json: [],
    audit_findings_jsonb: { summary: "九项均通过" },
    return_route_suggestion_jsonb: {},
    audited_handoff_package: modelHandoff,
    assets,
  }, null, ledger);
  const handoff = output[0].json.rpc_requests.rpc_confirm_audit_result.audit.audited_handoff_package_jsonb;

  assert.deepEqual(JSON.parse(JSON.stringify({
    world_changes: handoff.world_changes,
    character_live_state_changes: handoff.character_live_state_changes,
    relation_changes: handoff.relation_changes,
    memories: handoff.memories,
  })), {
    world_changes: ledger.world_changes,
    character_live_state_changes: ledger.character_live_state_changes,
    relation_changes: ledger.relation_changes,
    memories: ledger.memories,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(handoff.narrative_assets)), modelHandoff.narrative_assets);
});

test("ZH06 gives FP010 only stable formal world and relation baselines for a handoff", () => {
  const value = workflow();
  const loader = node(value, "读取章节推演结果 plot_sim_json / target_snapshot_json");
  const presentationParser = node(value, "JSON修复");

  assert.match(loader.parameters.query, /'world_state_id', ws\.id/u);
  assert.match(loader.parameters.query, /relation_state_json/u);
  assert.match(loader.parameters.query, /FROM public\.relation_state AS relation/u);
  assert.match(loader.parameters.query, /'relation_state_id', relation\.id/u);
  assert.match(loader.parameters.query, /relation\.is_formal/u);
  assert.match(loader.parameters.query, /relation\.is_valid/u);
  assert.match(loader.parameters.query, /NOT relation\.is_shadow/u);
  assert.match(presentationParser.parameters.jsCode, /relation_state_json/u);
});

test("ZH06 enters FP012-02 only after the formal-write node", () => {
  const value = workflow();
  const editorialStore = node(value, "FP012-01 主编证据入库");
  const editorialGate = node(value, "If闸门放行");
  const formalWrite = node(value, "FP013-02正文入库");
  const targets = outputTargets(value, "FP012-01 主编证据入库", 0);

  assert.doesNotMatch(editorialStore.parameters.query, /wait_route/u);
  assert.deepEqual(targets, [
    "If闸门放行",
    "Respond：审计与写回完成",
  ]);
  assert.match(editorialGate.parameters.conditions.conditions[0].leftValue, /decision\?\.verdict === 'Y'/u);
  assert.deepEqual(outputTargets(value, "If闸门放行", 0), ["FP013-01 文风增强"]);
  assert.deepEqual(outputTargets(value, "FP013-02正文入库", 0), ["FP012-02 前端闸门"]);
  assert.deepEqual(incomingSources(value, "FP012-02 前端闸门"), ["FP013-02正文入库"]);
  assert.match(formalWrite.parameters.query, /public\.rpc_commit_chapter\(\$1::jsonb\)/u);
  assert.doesNotMatch(formalWrite.parameters.query, /WORD_COUNT_CONTRACT_UNRESOLVED|rpc_enhance_prose/u);
});

test("ZH06 commits the audited candidate without making optional enhancement a formal-write gate", () => {
  const value = workflow();
  const formalWrites = [
    node(value, "FP013-02正文入库"),
    node(value, "FP013-02正文入库1"),
  ];

  for (const formalWrite of formalWrites) {
    // n8n Postgres v2.6 only preserves an empty result for SQL that begins
    // with SELECT; a top-level WITH is otherwise converted to { success: true }.
    assert.match(formalWrite.parameters.query, /^SELECT\s+/u);
    assert.match(formalWrite.parameters.query, /public\.rpc_commit_chapter\(\$1::jsonb\)/u);
    assert.match(
      formalWrite.parameters.query,
      /WHERE\s+COALESCE\(\(formal_attempt\.result->>'ok'\)::boolean,\s*false\)/u,
    );
    assert.doesNotMatch(
      formalWrite.parameters.query,
      /rpc_enhance_prose|WORD_COUNT_CONTRACT_UNRESOLVED/u,
    );
  }
});

test("ZH06 editorial parser creates a scoped evidence request without objective fields", () => {
  const source = node(workflow(), "JSON修复 (2)3").parameters.jsCode;

  assert.match(source, /phase:\s*["']editorial["']/u);
  assert.match(source, /fix_instruction_json/u);
  assert.match(source, /local_operator_id/u);
  assert.match(source, /book_id/u);
  assert.match(source, /chapter_id/u);
  assert.match(source, /chapter_version_id/u);
  assert.match(source, /idempotency_key:\s*idempotencyKey/u);
  assert.match(source, /:editorial/u);
  assert.doesNotMatch(source, /rpc_confirm_audit_result|objective_audit|audit_findings_jsonb|p0_items_json/u);
});

test("ZH06 gives FP012 only subjective evidence and reserves FP012-02 for formal continuation", () => {
  const value = workflow();
  const editorialModel = node(value, "FP012-01 主编决策");
  const editorialStore = node(value, "FP012-01 主编证据入库");
  const confirmation = node(value, "FP012-02 确认与归档");

  const modelInput = modelRequestBody(editorialModel);
  assert.match(modelInput, /reader_evidence/u);
  assert.match(modelInput, /commercial_evidence/u);
  assert.match(modelInput, /target_snapshot_json/u);
  assert.doesNotMatch(modelInput, /objective_gate|objective_audit|audit_findings_jsonb|p0_items_json/u);

  assert.match(editorialStore.parameters.query, /rpc_record_chapter_review_evidence/u);
  assert.deepEqual(incomingSources(value, "FP012-01 主编证据入库"), ["JSON修复 (2)3"]);
  assert.deepEqual(incomingSources(value, "FP012-02 前端闸门"), ["FP013-02正文入库"]);

  // The browser does not repeat the editorial verdict or write a candidate.
  // The Wait continuation accepts only an explicit formal-state intent and
  // delegates all version and P0 checks to the matching RPC.
  assert.match(confirmation.parameters.query, /action_name = 'continue_next_chapter'/u);
  assert.match(confirmation.parameters.query, /action_name = 'return_current_chapter'/u);
  assert.match(confirmation.parameters.query, /rpc_continue_chapter/u);
  assert.match(confirmation.parameters.query, /rpc_archive_shadow_version/u);
  assert.match(confirmation.parameters.query, /return_reason/u);
  assert.doesNotMatch(confirmation.parameters.query, /rpc_record_chapter_review_evidence/u);
  assert.match(confirmation.parameters.query, /next_action/u);
  assert.deepEqual(incomingSources(value, "FP012-02 确认与归档"), ["FP012-02 前端闸门"]);
});

test("FP012 evaluates the chapter against locked future L1A commitments", () => {
  const value = workflow();
  const loaderQuery = node(value, "读取章节推演结果 plot_sim_json / target_snapshot_json").parameters.query;
  const modelInput = modelRequestBody(node(value, "FP012-01 主编决策"));
  const prompt = fp012Prompt();

  assert.match(fp012Spec(), /当前章节之后已锁定的 L1A 承诺/u);
  assert.match(loaderQuery, /locked_future_l1a_commitments/u);
  assert.match(loaderQuery, /future_l1a\.is_locked/u);
  assert.match(loaderQuery, /future_l1a\.is_formal/u);
  assert.match(loaderQuery, /future_l1a\.is_valid/u);
  assert.match(loaderQuery, /NOT future_l1a\.is_shadow/u);
  assert.match(modelInput, /locked_future_l1a_commitments/u);
  assert.match(prompt, /locked_future_l1a_commitments/u);
  assert.match(prompt, /不得写回、重排或补造/u);
});

test("FP009 receives locked future L1A commitments before a chief-editor rewrite", () => {
  const value = workflow();
  const modelInput = modelRequestBody(node(value, "FP009-01 文学呈现"));
  const prompt = runtimePrompt(fp009Prompt());

  assert.match(fp009Spec(), /校验不影响后续 L1A 承诺/u);
  assert.match(modelInput, /locked_future_l1a_commitments/u);
  assert.match(prompt, /locked_future_l1a_commitments/u);
  assert.match(prompt, /不得写回、重排或补造/u);
});

test("FP011 commercial audit consumes only its V7 prose and book inputs", () => {
  const modelInput = modelRequestBody(node(workflow(), "FP011-02 商业审计"));
  const prompt = runtimePrompt(fp011CommercialPrompt());

  assert.match(fp011CommercialSpec(), /chapter_version\.prose_text/u);
  assert.match(fp011CommercialSpec(), /book_project/u);
  assert.match(modelInput, /candidate_text/u);
  assert.match(modelInput, /book_context/u);
  assert.doesNotMatch(modelInput, /target_snapshot_json\s*:/u);
  assert.doesNotMatch(prompt, /目标快照|target_snapshot/u);
});

test("FP012 rejects an objective blocker before creating editorial evidence", () => {
  const parser = node(workflow(), "JSON修复 (2)3").parameters.jsCode;

  assert.match(parser, /if \(p0Blocked\) throw new Error\(['"]OBJECTIVE_GATE_BLOCKED/u);
  assert.doesNotMatch(parser, /manual_review_required/u);
  assert.doesNotMatch(parser, /if \(p0Blocked\)[\s\S]*decision\s*=\s*\{\s*verdict:\s*['"]N['"]/u);
});

test("ZH06 keeps one locked candidate through all three reviews, then routes P0 and chief-editor N back to FP009", () => {
  const value = workflow();
  const readerParser = node(value, "JSON修复 (2)2");
  const commercialParser = node(value, "JSON修复 (2)1");
  const objectiveStore = node(value, "FP010-02 审计证据入库");
  const readerStore = node(value, "FP011-01 读者证据入库");
  const commercialStore = node(value, "FP011-02 商业证据入库");
  const collector = node(value, "三审计证据汇集");
  const editorialParser = node(value, "JSON修复 (2)3");
  const confirmation = node(value, "FP012-02 确认与归档");
  const resultRouter = node(value, "FP012-02 结果路由");

  // FP009 persists prose before the independent reviews begin. FP011 only
  // records its scoped evidence and must not replay a presentation write.
  assert.doesNotMatch(readerParser.parameters.jsCode, /TOPOLOGY_CONTRACT_BLOCKED/u);
  assert.match(readerParser.parameters.jsCode, /phase:\s*["']reader["']/u);
  assert.doesNotMatch(commercialParser.parameters.jsCode, /TOPOLOGY_CONTRACT_BLOCKED/u);
  assert.match(commercialParser.parameters.jsCode, /phase:\s*["']commercial["']/u);

  // Every completed model output is persisted first. The existing merge node
  // has three real inputs, so FP012-01 cannot be triggered by fan-in alone.
  assert.match(objectiveStore.parameters.query, /rpc_confirm_audit_result/u);
  assert.match(objectiveStore.parameters.query, /rpc_requests,rpc_confirm_audit_result/u);
  assert.match(objectiveStore.parameters.options.queryReplacement, /JSON\.stringify\(\$json\)/u);
  for (const store of [readerStore, commercialStore]) {
    assert.match(store.parameters.query, /rpc_record_chapter_review_evidence/u);
    assert.doesNotMatch(store.parameters.query, /rpc_persist_candidate_text/u);
    // The SQL consumes the complete parser payload so the named subjective
    // evidence remains available to the existing three-input merge.
    assert.match(store.parameters.options.queryReplacement, /JSON\.stringify\(\$json\)/u);
    assert.doesNotMatch(store.parameters.options.queryReplacement, /\$json\.rpc_requests/u);
  }
  assert.equal(collector.type, "n8n-nodes-base.merge");
  assert.equal(collector.parameters.numberInputs, 3);
  assert.deepEqual(incomingSourcesForInput(value, "三审计证据汇集", 0), ["IF：客观审计通过？"]);
  assert.deepEqual(incomingSourcesForInput(value, "三审计证据汇集", 1), ["FP011-01 读者证据入库"]);
  assert.deepEqual(incomingSourcesForInput(value, "三审计证据汇集", 2), ["FP011-02 商业证据入库"]);

  assert.deepEqual(incomingSources(value, "FP012-01 主编决策"), ["三审计证据汇集"]);
  assert.match(editorialParser.parameters.jsCode, /topology_ready:\s*true/u);

  // Objective evidence is a read-only P0 gate. The editorial write may record
  // only the chief-editor decision and its subjective revision instruction;
  // it must never rewrite or fold FP010 fields into that review record.
  assert.match(editorialParser.parameters.jsCode, /phase:\s*["']editorial["']/u);
  assert.match(editorialParser.parameters.jsCode, /creator_confirmed:\s*false/u);
  assert.match(editorialParser.parameters.jsCode, /fix_instruction_json/u);
  assert.match(editorialParser.parameters.jsCode, /local_operator_id/u);
  assert.match(editorialParser.parameters.jsCode, /book_id/u);
  assert.match(editorialParser.parameters.jsCode, /chapter_id/u);
  assert.match(editorialParser.parameters.jsCode, /chapter_version_id/u);
  assert.match(editorialParser.parameters.jsCode, /idempotency_key:\s*idempotencyKey/u);
  assert.match(editorialParser.parameters.jsCode, /:editorial/u);
  assert.doesNotMatch(editorialParser.parameters.jsCode, /rpc_confirm_audit_result|objective_audit|audit_findings_jsonb|p0_items_json/u);

  // P0/P1 and a chief-editor N preserve the current candidate and return to
  // the existing scoped loader, which is the only entry back into FP009.
  assert.deepEqual(
    outputTargets(value, "IF：客观审计通过？", 1),
    ["读取章节推演结果 plot_sim_json / target_snapshot_json"],
  );
  assert.deepEqual(incomingSources(value, "If闸门放行"), ["FP012-01 主编证据入库"]);
  assert.match(node(value, "If闸门放行").parameters.conditions.conditions[0].leftValue, /EDITORIAL_RETRY_LIMIT_REACHED/u);
  assert.deepEqual(
    outputTargets(value, "If闸门放行", 1),
    ["读取章节推演结果 plot_sim_json / target_snapshot_json"],
  );
  assert.match(confirmation.parameters.query, /rpc_continue_chapter/u);
  assert.match(confirmation.parameters.query, /rpc_archive_shadow_version/u);
  assert.doesNotMatch(confirmation.parameters.query, /rpc_record_chapter_review_evidence/u);
  assert.deepEqual(
    outputTargets(value, "FP012-02 结果路由", 0),
    ["读取章节推演结果 plot_sim_json / target_snapshot_json"],
  );
});

test("ZH06 accepts only continuation or a scoped return of the current formal chapter", () => {
  const value = workflow();
  const confirmation = node(value, "FP012-02 确认与归档");
  const resultRouter = node(value, "FP012-02 结果路由");
  const query = confirmation.parameters.query;

  assert.match(query, /CONTINUATION_REJECTED/u);
  assert.match(query, /rpc_continue_chapter/u);
  assert.match(query, /rpc_archive_shadow_version/u);
  assert.match(query, /present_rewrite_candidate/u);
  assert.doesNotMatch(query, /FORMAL_ROLLBACK_CONTRACT_INCOMPLETE|rpc_record_chapter_review_evidence/u);

  assert.equal(resultRouter.parameters.options.fallbackOutput, "extra");
  assert.deepEqual(
    outputTargets(value, "FP012-02 结果路由", 1),
    ["读取章节推演结果 plot_sim_json / target_snapshot_json"],
  );
});

test("V7 keeps candidate prose hidden until chief-editor Y is formally committed", () => {
  const source = readFileSync(designPath, "utf8");
  const presentation = source.slice(
    source.indexOf("### FP009-01 · 文学呈现"),
    source.indexOf("## FP010", source.indexOf("### FP009-01 · 文学呈现")),
  );
  const confirmation = source.slice(
    source.indexOf("### FP012-02 · 前端确认与状态路由闸门"),
    source.indexOf("### FP012-03", source.indexOf("### FP012-02 · 前端确认与状态路由闸门")),
  );
  const enhancement = source.slice(
    source.indexOf("### FP013-01 · 文风增强"),
    source.indexOf("### FP013-02", source.indexOf("### FP013-01 · 文风增强")),
  );

  assert.match(presentation, /主编 Y.*RPC-015.*正式化前不展示正文/su);
  assert.match(presentation, /只展示生成、审计、重写或受控停止状态/u);
  assert.match(presentation, /不展示候选正文/u);
  assert.match(confirmation, /只在.*RPC-015.*正式写入后.*展示正式正文/su);
  assert.match(enhancement, /不展示原候选正文或运行时增强结果/u);
  assert.match(enhancement, /正式正文仍只在 RPC-015 成功后由 FP012-02 展示/u);
});

test("V7 formalization summaries require the complete D-031 pass contract", () => {
  const source = readFileSync(designPath, "utf8");
  const formalization = source.slice(source.indexOf("### FP013-02"), source.indexOf("## FP014"));

  for (const requirement of [
    /has_p0_blocker=false/u,
    /p0_items_json.*为空/u,
    /return_route_suggestion_jsonb.*为空/u,
    /formalization_eligible=true/u,
    /candidate_text_snapshot.*当前正文/u,
    /当前有效候选/u,
    /同版本最新主编 Y/u,
    /P0\/P1 均阻断正式化/u,
  ]) assert.match(formalization, requirement);
  assert.doesNotMatch(source, /仅无 P0 的同一候选可进入/u);
  assert.doesNotMatch(source, /写入前必须再次读 `has_p0_blocker` 确认为 false（二次穿透读/u);
});

test("V7 D-003 names every existing chapter progress manager without adding states", () => {
  const source = readFileSync(designPath, "utf8");
  const row = source.split("\n").find((line) => line.startsWith("| D-003 |"));

  assert.ok(row, "missing D-003 data-flow row");
  for (const owner of [
    "FP007-01 / RPC-007",
    "FP008-04 / RPC-009",
    "FP013-02 / RPC-015",
    "rpc_continue_chapter",
    "FP012-04 / RPC-013",
  ]) {
    assert.match(row, new RegExp(owner.replaceAll("/", "\\/"), "u"));
  }
  assert.doesNotMatch(row, /rolled_back|abandoned_by_user/u);
});

test("V7 governance registers the existing chapter continuation RPC", () => {
  const source = readFileSync(designPath, "utf8");
  const governance = source.slice(source.indexOf("## §7.4"), source.indexOf("## §7.5"));

  assert.match(governance, /治理\/读取支持接口（8 个/u);
  assert.match(governance, /`rpc_continue_chapter`/u);
  assert.match(governance, /confirmation_status=creator_confirmed/u);
  assert.match(governance, /顺序下一章.*FP009-01|本 L1A.*完成/su);
});

test("V7 binds subjective evidence to the latest matching objective audit", () => {
  const source = readFileSync(designPath, "utf8");
  const editorLog = source.slice(source.indexOf("#### D-030"), source.indexOf("#### D-031"));
  const editorial = fp012Spec();

  assert.match(editorLog, /chapter_version_id.*created_at >=.*最新.*客观审计/su);
  assert.match(editorLog, /正文重写后.*旧.*reader.*commercial.*不得复用/su);
  assert.match(editorial, /最新匹配客观审计之后产生.*phase = reader/su);
  assert.match(editorial, /最新匹配客观审计之后产生.*phase = commercial/su);
});

test("V7 three-state rules name the sole candidate-period shadow exception", () => {
  const source = readFileSync(designPath, "utf8");
  const threeStates = source.slice(source.indexOf("## §3.2"), source.indexOf("## §3.3"));

  assert.match(threeStates, /唯一候选期影子例外.*RPC-009.*非空方向.*整段 L1A 重推/su);
  assert.match(threeStates, /尚无候选正文和客观审计/u);
  assert.match(threeStates, /不触碰正式正文、正式写回/u);
});

test("AGENTS compares n8n semantics and constrains historical worktree cleanup", () => {
  const source = readFileSync(agentsPath, "utf8");

  assert.match(source, /node[、,]\s*connection[、,]\s*business-parameter semantics.*activeVersionId/su);
  assert.match(source, /export-only.*versionId.*volatile metadata.*(?:可不同|do not trigger a duplicate import)/su);
  assert.match(source, /candidate prose snapshot.*latest chief-editor Y/su);
  assert.match(source, /(?:Both P0 and P1 block formalization|P0 和 P1 都阻止 formalization)/u);
  assert.match(source, /has_p0_blocker=false.*(?:insufficient|不能只检查)/su);
  assert.match(source, /历史 worktree.*exact absolute path.*clean.*active task\/process/su);
  assert.match(source, /(?:terminate|stop|kill|终止)[\s\S]{0,80}(?:unknown\s+process|未知 process)/iu);
  assert.match(source, /(?:bulk|mass|批量)[\s\S]{0,80}(?:executable|process name|未知 process)/iu);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workflowDirectory = path.join(root, "docs/后端/n8n");

function workflow(name) {
  return JSON.parse(readFileSync(path.join(workflowDirectory, name), "utf8"));
}

function node(value, name) {
  const result = value.nodes.find((candidate) => candidate.name === name);
  assert.ok(result, `missing node: ${name}`);
  return result;
}

function serialized(value) {
  return JSON.stringify(value);
}

test("ZH00 tests each allowlisted backend model configuration through its controlled credential", () => {
  const value = workflow("ZH00-统一配置.json");
  const validate = node(value, "Validate workbench command").parameters.jsCode;
  const postgres = node(value, "Workbench PostgreSQL RPC");
  const request = node(value, "Test OpenAI credential");
  const relayCove = node(value, "Test RelayCove credential");
  const credentialRoute = node(value, "Route approved model credential");
  const evidence = node(value, "Redact and record credential test evidence");

  assert.doesNotMatch(validate, /api\.tryallai\.net|gpt-5\.6-luna/);
  const testValidation = validate.match(/if \(input\.action === 'test_connection'\)[\s\S]*?(?=\nreturn fail)/)?.[0] ?? "";
  assert.match(testValidation, /provider_base_url/);
  assert.match(testValidation, /model_name/);
  assert.match(testValidation, /input\.api_key_ref/);
  assert.doesNotMatch(testValidation, /input\.api_key(?!_ref)/);
  assert.match(postgres.parameters.query, /FROM public\.model_connection_test_evidence AS e/);
  assert.match(postgres.parameters.query, /e\.test_succeeded/);
  assert.match(postgres.parameters.query, /api_key_ref/);
  assert.match(request.parameters.url, /Workbench PostgreSQL RPC/);
  assert.match(request.parameters.jsonBody, /result\.request\.model_name/);
  assert.equal(relayCove.parameters.nodeCredentialType, "openAiApi");
  assert.match(serialized(credentialRoute), /relaycove-v1/);
  assert.match(evidence.parameters.options.queryReplacement, /result\.request\.api_key_ref/);
  assert.doesNotMatch(serialized(value), /Bearer\s+|api_key\s*:/i);
});

test("ZH01 treats both parallel model calls as required configured results", () => {
  const value = workflow("ZH01-新书创建.json");
  const commercial = node(value, "FP001-05 商业潜力评价");
  const normalize = node(value, "JSON 修复 / 输出校验").parameters.jsCode;

  assert.match(commercial.parameters.url, /commercial_model/u);
  assert.match(commercial.parameters.url, /provider_base_url/u);
  assert.equal(commercial.onError, "continueRegularOutput");
  assert.equal(value.connections[commercial.name].main.length, 1);
  assert.match(normalize, /commercial_potential:commercial/);
  assert.doesNotMatch(normalize, /blocked\('COMMERCIAL_OUTPUT_INVALID'/);
  assert.doesNotMatch(normalize, /catch\s*\{\s*\}/);
});

test("ZH04 uses its existing LLM nodes and persists the execution plan through RPC-007", () => {
  const value = workflow("ZH04-生产拆解.json");
  for (const name of [
    "FP005-01 世界物化",
    "FP006-01 章节目标与读者情绪弧度拆解方案",
    "FP007-01 短期爽点、目标执行拆解",
    "FP007-01 短期爽点、目标执行拆解1",
  ]) {
    assert.notEqual(node(value, name).disabled, true, name);
  }
  for (const name of ["FP007-02章节拆解方案保存1", "FP007-02章节拆解方案保存2"]) {
    const persistence = node(value, name);
    assert.match(persistence.parameters.query, /rpc_persist_chapter_execution_plan/);
    assert.doesNotMatch(persistence.parameters.query, /PLAN_INCOMPLETE/);
  }
});

test("ZH05 blocks a failed pre-audit and never hardcodes the pre-audit model", () => {
  const value = workflow("ZH05-正文推演.json");
  for (const name of ["FP008-03 阶段审计", "FP008-03 阶段审计1"]) {
    const audit = node(value, name);
    assert.doesNotMatch(serialized(audit), /deepseek-v4-flash-free/);
    assert.match(serialized(audit), /runtime_bindings/);
  }
  for (const name of ["JSON修复2", "JSON修复7"]) {
    const source = node(value, name).parameters.jsCode;
    assert.match(source, /route_to_storage\s*=\s*audit_pass/);
    assert.doesNotMatch(source, /route_to_storage\s*=\s*true/);
  }
  assert.match(serialized(value), /rpc_finalize_deduction_snapshot/);
  assert.equal(value.active, false);
});

test("ZH06 follows V7's candidate-to-formal and author-return routes", () => {
  const value = workflow("ZH06-审计阶段.json");
  const text = serialized(value);

  for (const rpc of [
    "rpc_persist_candidate_text",
    "rpc_confirm_audit_result",
    "rpc_record_chapter_review_evidence",
    "rpc_commit_chapter",
    "rpc_continue_chapter",
    "rpc_archive_shadow_version",
  ]) {
    assert.match(text, new RegExp(rpc));
  }
  // FP013-01 enhancement is optional. A formal candidate can continue to
  // RPC-015 using the recorded Chinese count, while FP012-04 owns a scoped
  // author return after formalization.
  assert.doesNotMatch(text, /FORMAL_ROLLBACK_CONTRACT_INCOMPLETE/);
  assert.doesNotMatch(text, /CHANGE_LIMIT_UNRESOLVED/);
  assert.doesNotMatch(text, /WORD_COUNT_CONTRACT_UNRESOLVED/);
  const objectiveGate = node(value, "IF：客观审计通过？");
  assert.equal(objectiveGate.typeVersion, 2.3);
  assert.match(JSON.stringify(objectiveGate.parameters.conditions), /objective_gate\.has_p0_blocker/);
  assert.doesNotMatch(text, /TOPOLOGY_CONTRACT_BLOCKED/);
  assert.doesNotMatch(text, /"parameters":\{\}/);
  assert.equal(value.active, false);
});

test("ZH07 consumes the canonical iteration and prompt RPCs without unscoped legacy writes", () => {
  const value = workflow("ZH07-迭代阶段.json");
  const text = serialized(value);

  for (const rpc of [
    "rpc_classify_iteration_sample",
    "rpc_save_prompt_candidate",
    "rpc_promote_prompt_config",
  ]) {
    assert.match(text, new RegExp(rpc));
  }
  assert.match(text, /ITERATION_RETRY_CONTRACT_UNRESOLVED/);
  assert.doesNotMatch(text, /result_status|INSERT INTO prompt_iteration_log/);
  assert.ok(value.connections["读取当前版本"], "the scoped runtime reader must be connected");
  assert.equal(value.active, false);
});

test("model behavior material follows the V7 budget, freeze, and char-task ownership", () => {
  const prompt = readFileSync(path.join(root, "docs/后端/对齐版提示词.md"), "utf8");
  const fp008Start = prompt.indexOf("### FP008-02 · 导演分发与多角色循环推演");
  const f1Start = prompt.indexOf("#### §F1 · 导演信息发放", fp008Start);
  const f1End = prompt.indexOf("#### §F2 · 角色推演代理", f1Start);
  const f3Start = prompt.indexOf("#### §F3/F4 · 导演真值选择与状态收束", f1End);
  const f3End = prompt.indexOf("#### §F5 · 下颗粒指派 + 上下文组装", f3Start);
  const charTasksStart = prompt.indexOf("char_tasks", f1Start);
  const f1 = prompt.slice(f1Start, f1End);
  const f2 = prompt.slice(f1End, f3Start);
  const f3 = prompt.slice(f3Start, f3End);

  assert.match(prompt, /固定\s*10000000/);
  assert.match(prompt, /FP004-04[^\n]*冻结/);
  assert.ok(
    fp008Start >= 0 && f1Start > fp008Start && charTasksStart > f1Start,
    "FP008-02 F1 must define the char_tasks responsibility",
  );
  for (const field of [
    "char_tasks", "char_code", "task", "particle_id", "isolation_confirmed",
    "dramatic_enhancement", "supporting_staged_goal", "antagonist_control_intent",
    "ensemble_pressure_direction", "peak_conflict_moment", "enhancement_feedback",
    "visible_situation", "emotion_phase_hint", "last_round_summary",
    "newly_perceivable_particles", "long_term_promise", "staged_goal_injected",
    "sartre_dilemma_anchor",
  ]) {
    assert.match(f1, new RegExp(`"${field}"`, "u"), `F1 output must provide ${field}`);
  }
  assert.doesNotMatch(f1, /"角色任务包"|"角色代码"|"信息隔离确认"/u);
  assert.match(f2, /唯一机器输出合同/u);
  for (const field of [
    "char_code", "knowledge_snapshot", "info_gap_exploited", "l3_activation", "trigger_check",
    "real_intent", "hidden_goal", "misread", "misread_impact", "dual_spiral", "candidate_actions",
    "baseline_comparison", "chain_reaction_risk", "unresolved_risk", "internal_drive_tension",
    "hidden_resistance", "amplification_type", "sartre_anchor_used",
  ]) {
    assert.match(f2, new RegExp(`"${field}"`, "u"), `F2 output must provide ${field}`);
  }
  for (const field of [
    "action_id", "action_type", "surface_action", "tactic_ref", "deep_motivation", "root_basis",
    "boundary_check", "audit_block", "audit_block_reason", "memory_evidence", "scene_coupling",
    "utilized_conditions",
  ]) {
    assert.match(f2, new RegExp(`"${field}"`, "u"), `F2 candidate action must provide ${field}`);
  }
  for (const field of [
    "particle_id", "particle_status", "p0_precheck", "events_in_round", "dual_spiral_verdict",
    "rebellion_record", "emotion_band", "state_diff", "relation_diff", "particles_completed",
    "particle_completion_evidence", "remaining_particles", "retry_required", "deduction_complete",
    "hook_signals", "alt_paths", "chain_reaction_candidates", "self_check", "next_round_focus",
    "token_budget_exceeded",
  ]) {
    assert.match(f3, new RegExp(`"${field}"`, "u"), `F3/F4 output must provide ${field}`);
  }
  assert.doesNotMatch(f3, /"颗粒ID"|"选定事件"|"token已消耗"/u);
  assert.match(f3, /particle_sequence/u, "F3/F4 must receive the backend-assigned particle counters");
  assert.match(prompt, /change_limit_status[^\n]*UNRESOLVED/);
  assert.match(prompt, /persistence_allowed[^\n]*false/);
  assert.doesNotMatch(prompt, /安全默认预算已经可见、可修改/);
  assert.doesNotMatch(prompt, /一旦 FP004-01[^\n]*冻结/);
});

test("FP013-01 applies FR-087 as model guidance without defining the server change limit", () => {
  const prompt = readFileSync(path.join(root, "docs/后端/对齐版提示词.md"), "utf8");
  const fp013 = prompt.match(/### FP013-01 · 文风增强[\s\S]*?(?=\n---\n)/u)?.[0] ?? "";

  assert.ok(fp013, "the FP013-01 prompt material must exist");
  assert.match(fp013, /polish_level[^\n]*为空[^\n]*用词润色[^\n]*≤1%/u);
  for (const phrase of ["允许节奏微调", "意象深化", "结构重排", "哲学升华"]) {
    assert.match(fp013, new RegExp(`edit_instructions[^\\n]*${phrase}`, "u"), phrase);
  }
  for (const pattern of [
    /用词润色[^\n]*≤1%/u,
    /节奏微调[^\n]*≤3%/u,
    /意象深化[^\n]*5%/u,
    /结构重排[^\n]*8%/u,
    /哲学升华[^\n]*15%/u,
  ]) assert.match(fp013, pattern);

  const foreshadow = fp013.indexOf("foreshadowing_injections");
  const fingerprints = fp013.indexOf("reader_audit.ai_fingerprints", foreshadow + 1);
  const stop = fp013.indexOf("立即停止", fingerprints + 1);
  assert.ok(foreshadow >= 0 && foreshadow < fingerprints && fingerprints < stop, "FR-087 must preserve its three-step order");
  assert.match(fp013, /foreshadowing_injections[^\n]*每处[^\n]*≤30[^\n]*不计入/u);
  assert.match(fp013, /戏剧[^\n]*beat/u);
  assert.match(fp013, /不得[^\n]*对话[^\n]*tag[^\n]*插入/u);
  assert.match(fp013, /revelation_plan\.layers\.philosophical[^\n]*非\s*null[^\n]*触发/u);
  assert.match(fp013, /只(?:处理|能处理)[^\n]*reader_audit\.ai_fingerprints/u);
  assert.match(fp013, /百分比[^\n]*只[^\n]*约束[^\n]*模型生成/u);
  assert.match(fp013, /不(?:定义|作为)[^\n]*服务端[^\n]*change_limit/u);
  assert.match(fp013, /change_limit_status[^\n]*UNRESOLVED/u);
  assert.match(fp013, /persistence_allowed[^\n]*false/u);
  assert.match(fp013, /不得自动写入/u);

  assert.doesNotMatch(fp013, /1%\s*[-–—]\s*3%|3%\s*[-–—]\s*7%|7%\s*[-–—]\s*12%|12%\s*[-–—]\s*15%/u);
  assert.doesNotMatch(fp013, /0\.15|total_modification_rate|exceeded_limit/u);
  assert.doesNotMatch(fp013, /允许自动写入|自动写入(?:资格|门禁)[^\n]*(?:通过|满足|启用)/u);
});

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const container = process.env.ZH_V7_POSTGRES_CONTAINER ?? "n8n-pgvector";
const database = "zh_narrative";

function sql(statement) {
  return execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-q", "-U", "n8n", "-d", database, "-At", "-c", statement], { encoding: "utf8" }).trim();
}

function rpc(name, payload) {
  const literal = JSON.stringify(payload).replaceAll("'", "''");
  return JSON.parse(sql(`SELECT public.${name}('${literal}'::jsonb)`));
}

function uuid() {
  return sql("SELECT gen_random_uuid()") || "00000000-0000-0000-0000-000000000000";
}

let operator;
let book;
let worldVersion;
let characterVersion;
let candidateL1a;

test("V7 contracts are closed JSON schemas", () => {
  for (const name of ["rpc-envelope", "create-book-request", "world-request", "character-request", "l1a-request"]) {
    const schema = JSON.parse(readFileSync(`packages/contracts/src/v7-data-rpc/${name}.schema.json`, "utf8"));
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
    assert.equal(typeof schema.properties, "object");
    assert.equal(schema.additionalProperties, name === "l1a-request");
  }
});

test("local operator is stable and scoped", () => {
  const first = rpc("rpc_get_local_operator", { correlation_id: "operator-1" });
  const second = rpc("rpc_get_local_operator", { correlation_id: "operator-2" });
  operator = first.result.local_operator_id;
  assert.equal(first.ok, true);
  assert.equal(operator, second.result.local_operator_id);
});

function bookPayload(idempotencyKey = "book-1") {
  return {
    local_operator_id: operator,
    correlation_id: "book-create",
    idempotency_key: idempotencyKey,
    title: "边界验收书",
    intent_json: { genre: "科幻", core: "边界" },
    forbid_json: { lines: ["无凭空能力"] },
    selling_points_json: ["信息边界"],
    target_words: 100000,
    chapter_words: 2000,
    commercial_score: 8,
    characters: [
      { client_ref: "p1", char_name: "主角", char_type: "protagonist", five_layers_json: { L0: {}, L1: {}, L2: {}, L3: {} }, knowledge_boundary_json: { knows: [], unknown: [], false_belief: [], reasonable_suspect: [] }, arc_json: {} },
      { client_ref: "a1", char_name: "对手", char_type: "antagonist", five_layers_json: { L0: {}, L1: {}, L2: {}, L3: {} }, knowledge_boundary_json: { knows: [], unknown: [], false_belief: [], reasonable_suspect: [] }, arc_json: {} },
    ],
    relations: [{ from_ref: "p1", to_ref: "a1", trust: -10, intimacy: 0, power_balance: 5, dependence: 0, hostility: 40, common_goal: 10, secret_known: 0, emotional_bond: -5, relation_type: "敌对", relation_hierarchy: "平等", change_event: "初始冲突" }],
    world_atoms: [
      { client_ref: "rule1", board_type: "rule", atom_type: "rule", atom_key: "rule.energy", atom_value_jsonb: { title: "能量守恒", description: "有代价" }, affordance_dims: ["技术阻力"], knowledge_boundary_json: {}, apply_scope_json: {}, violate_cost_json: {} },
      { client_ref: "geo1", board_type: "geography", atom_type: "geo", atom_key: "geo.station", atom_value_jsonb: { title: "空间站" }, affordance_dims: ["场景"], apply_scope_json: {} },
    ],
    world_bindings: [{ from_ref: "rule1", to_ref: "geo1", binding_type: "管辖", binding_strength: "中" }],
    initial_memories: [{ char_ref: "p1", memory_type: "knowledge", memory_content: "知道能量规则", truth_status: "true" }],
    initial_l1a: [{ l1a_index: 1, l1a_name: "第一段", conflict_background: "规则与欲望冲突", escalation_path: "代价上升", stakes: "选择代价", irreversible_consequence: "关系破裂", plot_emotion_commit: {}, arc_requirement: {}, info_reveal_boundary: {}, role_arc_json: {}, role_arcs: {} }],
  };
}

test("book creation is atomic, idempotent, complete, and rejects bad scope", () => {
  const created = rpc("rpc_create_book_project", bookPayload());
  assert.equal(created.ok, true, JSON.stringify(created));
  book = created.result.book_id;
  worldVersion = created.result.world_version_id;
  characterVersion = created.result.character_version_id;
  const replay = rpc("rpc_create_book_project", bookPayload());
  assert.equal(replay.idempotent, true);
  assert.equal(replay.result.book_id, book);
  const duplicate = rpc("rpc_create_book_project", { ...bookPayload("book-duplicate"), correlation_id: "duplicate" });
  assert.equal(duplicate.redacted_error.code, "DUPLICATE_TITLE");
  const before = Number(sql("SELECT count(*) FROM public.book_project"));
  const invalid = rpc("rpc_create_book_project", { ...bookPayload("book-invalid"), title: "原子失败书", world_atoms: [{ client_ref: "bad", board_type: "rule", atom_type: "rule", atom_key: "bad", atom_value_jsonb: {}, affordance_dims: [] }] });
  assert.equal(invalid.redacted_error.code, "WRITE_FAILED");
  assert.equal(Number(sql("SELECT count(*) FROM public.book_project")), before);
  const foreign = rpc("rpc_create_book_project", { ...bookPayload("book-foreign"), local_operator_id: uuid() });
  assert.equal(foreign.redacted_error.code, "INVALID_REQUEST");
});

test("world candidate, binding validation, confirm, read, and restore", () => {
  const candidate = rpc("rpc_commit_world_settings", {
    action: "save_candidate", local_operator_id: operator, book_id: book, correlation_id: "world-save", atoms: [
      { client_ref: "r2", board_type: "resource", atom_type: "resource", atom_key: "resource.core", atom_value_jsonb: { title: "核心资源" }, affordance_dims: ["资源门槛"] },
      { client_ref: "g2", board_type: "geography", atom_type: "geo", atom_key: "geo.core", atom_value_jsonb: { title: "核心地点" }, affordance_dims: ["制度代价"] },
    ], bindings: [{ from_ref: "r2", to_ref: "g2", binding_type: "产出", binding_strength: "强" }],
  });
  assert.equal(candidate.result.status, "candidate_saved", JSON.stringify(candidate));
  const invalid = rpc("rpc_commit_world_settings", {
    action: "save_candidate", local_operator_id: operator, book_id: book, correlation_id: "world-invalid", atoms: [], bindings: [{ from_ref: "r2", to_ref: "g2", binding_type: "产出", strength: 0.9 }],
  });
  assert.equal(invalid.redacted_error.code, "WRITE_FAILED");
  const confirmed = rpc("rpc_commit_world_settings", { action: "confirm", local_operator_id: operator, book_id: book, correlation_id: "world-confirm", idempotency_key: "world-confirm-1", version_id: candidate.result.version_id });
  assert.equal(confirmed.result.status, "confirmed", JSON.stringify(confirmed));
  const replay = rpc("rpc_commit_world_settings", { action: "confirm", local_operator_id: operator, book_id: book, correlation_id: "world-confirm-replay", idempotency_key: "world-confirm-1", version_id: candidate.result.version_id });
  assert.equal(replay.idempotent, true);
  const versions = rpc("rpc_commit_world_settings", { action: "read_versions", local_operator_id: operator, book_id: book, correlation_id: "world-read" });
  assert.ok(versions.result.versions.length >= 2);
  const restored = rpc("rpc_commit_world_settings", { action: "restore", local_operator_id: operator, book_id: book, correlation_id: "world-restore", version_id: worldVersion });
  assert.equal(restored.result.status, "candidate_saved");
  const afterRestore = rpc("rpc_commit_world_settings", { action: "confirm", local_operator_id: operator, book_id: book, correlation_id: "world-confirm-restore", idempotency_key: "world-confirm-restore", version_id: restored.result.version_id });
  assert.equal(afterRestore.result.status, "confirmed");
});

test("character, relation, and initial memory confirmation is atomic", () => {
  const snapshot = {
    characters: [{ client_ref: "p2", char_name: "新主角", char_type: "protagonist", five_layers_json: { L0: {}, L1: {}, L2: {}, L3: {} }, knowledge_boundary_json: { knows: [], unknown: [], false_belief: [], reasonable_suspect: [] }, arc_json: {} }],
    relations: [],
    initial_memories: [{ char_ref: "p2", memory_type: "event", memory_content: "初始事件", truth_status: "true" }],
  };
  const candidate = rpc("rpc_commit_character_settings", { action: "save_candidate", local_operator_id: operator, book_id: book, correlation_id: "char-save", snapshot });
  assert.equal(candidate.result.status, "candidate_saved", JSON.stringify(candidate));
  const confirmed = rpc("rpc_commit_character_settings", { action: "confirm", local_operator_id: operator, book_id: book, correlation_id: "char-confirm", idempotency_key: "char-confirm-1", version_id: candidate.result.version_id });
  assert.equal(confirmed.result.status, "confirmed", JSON.stringify(confirmed));
  assert.equal(Number(sql("SELECT count(*) FROM public.character_memory WHERE book_id='" + book + "' AND chapter_id IS NULL")), 2);
});

test("L1A traversal freezes design and finalization writes future state atomically", () => {
  const generated = rpc("rpc_generate_l1a_conflicts", {
    local_operator_id: operator, book_id: book, correlation_id: "l1a-generate", idempotency_key: "l1a-generate-1", generated_candidates: [{ l1a_index: 2, l1a_name: "第二段", conflict_background: "世界阻力", escalation_path: "代价增加", stakes: "资源", irreversible_consequence: "断裂", plot_emotion_commit: {}, arc_requirement: {}, info_reveal_boundary: {}, role_arc_json: {}, role_arcs: {}, future_setting_seeds: [], world_resistance_refs: [], participant_chars_json: [] }],
  });
  assert.equal(generated.result.status, "candidates_saved", JSON.stringify(generated));
  candidateL1a = generated.result.candidate_ids[0];
  const blockedWorld = rpc("rpc_commit_world_settings", { action: "save_candidate", local_operator_id: operator, book_id: book, correlation_id: "world-frozen", atoms: [], bindings: [] });
  assert.equal(blockedWorld.redacted_error.code, "FROZEN");
  const finalized = rpc("rpc_finalize_l1a", { local_operator_id: operator, book_id: book, correlation_id: "l1a-finalize", idempotency_key: "l1a-finalize-1", l1a_ids: [candidateL1a], future_world_atoms: [{ client_ref: "future1", board_type: "chronicle", atom_type: "event", atom_key: "event.future", atom_value_jsonb: { title: "未来事件" }, affordance_dims: ["升级触发"], origin_l1a_id: candidateL1a, inherit_status: "inheritable", conflict_with_initial: [] }], future_world_bindings: [] });
  assert.equal(finalized.result.status, "finalized", JSON.stringify(finalized));
  assert.equal(Number(sql(`SELECT count(*) FROM public.l1a_unit WHERE id='${candidateL1a}' AND is_locked AND is_formal AND status='finalized'`)), 1);
  assert.equal(Number(sql(`SELECT count(*) FROM public.world_state WHERE setting_layer='l1a_generated' AND origin_l1a_id='${candidateL1a}' AND is_formal`)), 1);
});

test("failure pool, evidence-backed classification, prompt promotion, and rollback", () => {
  const sample = rpc("rpc_record_iteration_sample", { local_operator_id: operator, book_id: book, correlation_id: "sample", source_fp: "FP009-01", iter_type: "prompt", failure_count: 3, snapshot_jsonb: { error: "P0" } });
  assert.equal(sample.result.status, "pooled");
  const classified = rpc("rpc_classify_iteration_sample", { local_operator_id: operator, correlation_id: "classify", sample_id: sample.result.sample_id, disposition: "pending_review", root_debt_type: "prompt", attribution_evidence_json: { field: "candidate_text", reason: "表达越过推演" } });
  assert.equal(classified.result.status, "pending_review");
  const prompt = rpc("rpc_save_prompt_candidate", { local_operator_id: operator, book_id: book, correlation_id: "prompt-save", fp_target: "FP009-01", prompt_text: "只表达已锁定事实" });
  const promoted = rpc("rpc_promote_prompt_config", { local_operator_id: operator, book_id: book, correlation_id: "prompt-promote", idempotency_key: "prompt-promote-1", candidate_prompt_id: prompt.result.prompt_config_id, sample_results: [{ sample_id: sample.result.sample_id, accepted: true }] });
  assert.equal(promoted.result.status, "active", JSON.stringify(promoted));
  assert.equal(Number(sql("SELECT count(*) FROM public.prompt_config WHERE fp_target='FP009-01' AND is_active")), 1);
  const failed = rpc("rpc_promote_prompt_config", { local_operator_id: operator, book_id: book, correlation_id: "prompt-promote-failed", idempotency_key: "prompt-promote-2", candidate_prompt_id: uuid(), sample_results: [] });
  assert.equal(failed.redacted_error.code, "STATE_REJECTED");
});

test("builtin skills are seeded idempotently and user skills stay scoped", () => {
  const builtinCount = Number(sql("SELECT count(*) FROM public.skill WHERE source_type='system_builtin'"));
  assert.equal(builtinCount, 72);
  const created = rpc("rpc_manage_skill", { action: "create_version", local_operator_id: operator, correlation_id: "skill-create", skill_name: "本地技能", stable_slug: "local-boundary", skill_category: "章节展开", skill_description: "只在已验证事实内展开", applicable_stages: ["production"], applicable_scopes: { genre: "科幻" }, constraint_fields: ["no_new_facts"], template_fields: ["arc"], skill_config_jsonb: {} });
  assert.equal(created.result.status, "active", JSON.stringify(created));
  const preference = rpc("rpc_manage_skill", { action: "set_preference", local_operator_id: operator, book_id: book, correlation_id: "skill-disable", skill_id: created.result.skill_id, status: "disabled" });
  assert.equal(preference.result.status, "disabled");
  const list = rpc("rpc_manage_skill", { action: "list", local_operator_id: operator, book_id: book, correlation_id: "skill-list" });
  assert.equal(list.result.skills.some((skill) => skill.skill_id === created.result.skill_id), false);
  const builtinDelete = rpc("rpc_manage_skill", { action: "delete", local_operator_id: operator, correlation_id: "skill-builtin-delete", skill_id: sql("SELECT skill_id FROM public.skill WHERE source_type='system_builtin' LIMIT 1") });
  assert.equal(builtinDelete.redacted_error.code, "BUILTIN_READ_ONLY");
  const deleted = rpc("rpc_manage_skill", { action: "delete", local_operator_id: operator, correlation_id: "skill-delete", skill_id: created.result.skill_id });
  assert.equal(deleted.result.status, "deleted");
  assert.equal(Number(sql("SELECT count(*) FROM public.skill WHERE skill_id='" + created.result.skill_id + "'")), 0);
});

test("workbench reports the unresolved V7 configuration contract without inventing a budget", () => {
  const result = rpc("rpc_workbench", { correlation_id: "workbench" });
  assert.equal(result.redacted_error.code, "CONFIG_CONTRACT_BLOCKED");
  assert.equal(result.result.automation_defaults.auto_production, false);
});

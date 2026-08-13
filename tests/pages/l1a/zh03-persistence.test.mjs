import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { docker, dockerLong, isDockerUnavailable, runtimeUnavailableMessage } from "../../support/docker-runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const container = process.env.ZH_V7_POSTGRES_CONTAINER ?? "n8n-pgvector";
const database = `zh_zh03_${process.pid}_${randomUUID().replaceAll("-", "")}`;
const installer = readFileSync(path.join(root, "db/install/v7-data-rpc-contract.sql"), "utf8");
const workflow = JSON.parse(readFileSync(path.join(root, "docs/后端/n8n/ZH03-三线排序.json"), "utf8"));
const persistenceSql = workflow.nodes.find((item) => item.id === "418a1592-eba4-4187-a4b6-afe55b867309").parameters.query;

let postgresUser;
let operatorId;
let databaseCreated = false;
let runtimeAvailable = true;
let runtimeUnavailableReason = "";

function adminSql(statement) {
  return dockerLong(["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-q", "-U", postgresUser, "-d", "postgres", "-c", statement]);
}

function sql(statement) {
  return docker(["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-q", "-U", postgresUser, "-d", database, "-At", "-c", statement]).trim();
}

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlJson(value) {
  return `${sqlText(JSON.stringify(value))}::jsonb`;
}

function rpc(name, payload) {
  return JSON.parse(sql(`SELECT public.${name}(${sqlJson(payload)})`));
}

function dropDatabase() {
  adminSql(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  databaseCreated = false;
}

function createBookRequest(label) {
  const character = (client_ref, char_name, char_type) => ({
    client_ref, char_name, char_type,
    five_layers_json: {
      L0: { agency: "acts" },
      L1: { desire: "protect", fear: "loss", core_motivation: "truth" },
      L2: { abilities: [], costs: [], resources: [] },
      L3: { alliances: [], oppositions: [], entanglements: [], relation_summary: {} },
    },
    knowledge_boundary_json: { knows: [], unknown: [], false_belief: [], reasonable_suspect: [] },
    arc_json: { direction: "growth", progress: 0 },
  });
  const world = (board_type, atom_type) => {
    const l1 = {
      rule: { violate_cost: "resource loss", apply_scope: "the district", rule_type: "rationing" },
      geography: { danger_level: "high", location_text: "the district checkpoint" },
      resource: { scarcity_level: "scarce", usability: "identity evidence" },
      faction: { faction_status: "stable", stance: "defensive" },
      profession: { cost_mechanism: "credibility", is_system: false },
      monster: { threat_level: "high", counter_text: "sealed filters" },
      event: { event_era: "opening" },
    };
    return {
      board_type, atom_type, atom_key: `${board_type}.initial`, atom_value_jsonb: { board_type, ...l1[board_type] },
      affordance_dims: ["initial-design"], knowledge_boundary_json: {}, apply_scope_json: {}, violate_cost_json: {},
    };
  };
  return {
    local_operator_id: operatorId,
    correlation_id: `create-${label}`,
    idempotency_key: `create-${label}`,
    title: `ZH03 isolated ${label}`,
    intent_json: {
      genre_main: "科幻",
      premise: "A complete initial design package.",
      target_emotion: "A documented emotional direction",
    },
    forbid_json: { lines: [] }, selling_points_json: ["bounded conflict"],
    target_words: 100000, chapter_words: 2000, commercial_score: 8,
    characters: [character("lead", "Lead", "protagonist"), character("rival", "Rival", "antagonist")],
    relations: [{
      char_a_ref: "lead", char_b_ref: "rival", trust: -10, intimacy: 0, power_balance: 0, dependence: 0,
      hostility: 50, common_goal: 0, secret_known: 0, emotional_bond: -5,
      relation_type: "rivals", relation_hierarchy: "peers", change_event_json: { event: "initial conflict" },
    }],
    world_states: [
      world("rule", "rule"), world("geography", "geo"), world("resource", "resource"), world("faction", "faction"),
      world("profession", "job"), world("monster", "monster"), world("event", "event"),
    ],
    world_bindings: [{
      from_ref_type: "world", from_ref_id: "rule.initial", to_ref_type: "world", to_ref_id: "geography.initial",
      binding_type: "governs", binding_strength: "strong",
    }],
    initial_memories: [{ char_ref: "lead", memory_type: "knowledge", memory_content: "The rule is known.", truth_status: "true" }],
    initial_l1a: {
      l1a_index: 1, l1a_name: "Initial conflict", scene_location: "Rule chamber",
      conflict_background: "The formal world resists the lead.", escalation_path: "The cost compounds.", stakes: "A relationship changes.",
      irreversible_consequence: "The first choice cannot be undone.",
      plot_emotion_commit: { plot: "Pay the cost", emotion: "Resolve fear" }, arc_requirement: { direction: "growth" },
      info_reveal_boundary: { boundary: "Only visible facts." }, role_arc_json: { lead: "growth", rival: "stable" },
      role_arcs: [], participant_char_refs: ["lead", "rival"],
    },
  };
}

function createBook(label) {
  const result = rpc("rpc_create_book_project", createBookRequest(label));
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.book_id;
}

function addTraversalCandidate(bookId, label) {
  const characters = JSON.parse(sql(`SELECT jsonb_agg(id ORDER BY id) FROM public.character WHERE book_id=${sqlText(bookId)} AND is_formal AND is_valid AND NOT is_shadow`));
  const atomKey = sql(`SELECT atom_key FROM public.world_state WHERE book_id=${sqlText(bookId)} AND is_formal AND is_valid AND NOT is_shadow ORDER BY atom_key LIMIT 1`);
  const result = rpc("rpc_generate_l1a_conflicts", {
    local_operator_id: operatorId, book_id: bookId, correlation_id: `generate-${label}`, idempotency_key: `generate-${label}`,
    candidates: [{
      l1a_name: `Traversal ${label}`, scene_location: "Formal conflict site", conflict_background: "The formal world resists formal characters.",
      escalation_path: "The documented cost compounds.", stakes: "The confirmed design.", irreversible_consequence: "The choice cannot be undone.",
      plot_emotion_commit: { plot: "Escalate conflict", emotion: "Pay cost" }, arc_requirement: { direction: "growth" },
      info_reveal_boundary: { boundary: "Keep formal knowledge limits." }, role_arc_json: { lead: "growth" }, role_arcs: [],
      world_resistance_refs: [{ atom_key: atomKey }], participant_chars_json: characters, future_setting_seeds: [],
    }],
  });
  assert.equal(result.ok, true, JSON.stringify(result));
}

function candidates(bookId) {
  return JSON.parse(sql(`SELECT COALESCE(jsonb_agg(to_jsonb(l)-'created_at'-'updated_at' ORDER BY l.id), '[]'::jsonb)
    FROM public.l1a_unit l WHERE l.book_id=${sqlText(bookId)} AND NOT l.is_formal AND l.is_valid AND NOT l.is_shadow AND NOT l.is_locked`));
}

function candidateFingerprint(bookId) {
  return sql(`SELECT encode(digest(convert_to(COALESCE(jsonb_agg(to_jsonb(l)-'created_at'-'updated_at' ORDER BY l.id), '[]'::jsonb)::text, 'UTF8'), 'sha256'), 'hex')
    FROM public.l1a_unit l WHERE l.book_id=${sqlText(bookId)} AND NOT l.is_formal AND l.is_valid AND NOT l.is_shadow AND NOT l.is_locked`);
}

function sortPayload(bookId, key, fingerprint = candidateFingerprint(bookId)) {
  const rows = candidates(bookId);
  const revisions = [...rows].sort((left, right) => String(right.id).localeCompare(String(left.id))).map((row, index) => ({
    l1a_id: row.id, l1a_index: index + 1, plot_emotion_commit: row.plot_emotion_commit,
    arc_requirement: row.arc_requirement, participant_chars_json: row.participant_chars_json,
  }));
  const request = { action: "sort", local_operator_id: operatorId, book_id: bookId, correlation_id: `sort-${key}`, idempotency_key: key };
  const sort_result = {
    ordered_l1a_ids: revisions.map((item) => item.l1a_id), candidate_revisions: revisions, gaps: [],
    design_fingerprint: sql(`SELECT public.v7_formal_design_fingerprint(${sqlText(bookId)}::uuid)`), candidate_fingerprint: fingerprint,
  };
  return ["sort_lock", "sort_prepare", "sort_shift", "sort_apply", "sort_commit"].map((stage) => ({ stage, request, sort_result }));
}

function finalizePayload(bookId, key, fingerprint = candidateFingerprint(bookId)) {
  const ordered_l1a_ids = JSON.parse(sql(`SELECT COALESCE(jsonb_agg(id ORDER BY l1a_index, id), '[]'::jsonb)
    FROM public.l1a_unit WHERE book_id=${sqlText(bookId)} AND NOT is_formal AND is_valid AND NOT is_shadow AND NOT is_locked`));
  const request = {
    action: "finalize", local_operator_id: operatorId, book_id: bookId,
    correlation_id: `finalize-${key}`, idempotency_key: key,
    ordered_l1a_ids, design_fingerprint: sql(`SELECT public.v7_formal_design_fingerprint(${sqlText(bookId)}::uuid)`),
    candidate_fingerprint: fingerprint,
  };
  const { action, candidate_fingerprint, ...rpc_request } = request;
  return ["finalize_lock", "finalize_apply"].map((stage) => ({ stage, request, rpc_request }));
}

function runBatch(payloads) {
  const statements = payloads.map((payload) => `EXECUTE zh03_step(${sqlJson(payload)});`).join("\n");
  const output = sql(`BEGIN; PREPARE zh03_step(jsonb) AS ${persistenceSql}; ${statements} COMMIT;`);
  const responses = output.split(/\r?\n/).filter((line) => line.startsWith("{"));
  return responses.length ? JSON.parse(responses.at(-1)) : null;
}

function stableIndexes(bookId) {
  return JSON.parse(sql(`SELECT jsonb_agg(l1a_index ORDER BY l1a_index) FROM public.l1a_unit
    WHERE book_id=${sqlText(bookId)} AND NOT is_formal AND is_valid AND NOT is_shadow AND NOT is_locked`));
}

function errorCode(response) {
  return response?.redacted_error?.code ?? response?.error?.code;
}

test.before(() => {
  try {
    postgresUser = docker(["exec", container, "sh", "-lc", "printf '%s' \"$POSTGRES_USER\""]).trim();
    if (!postgresUser) throw new Error("PostgreSQL runtime unavailable: POSTGRES_USER missing");
    adminSql(`CREATE DATABASE "${database}"`);
    databaseCreated = true;
    dockerLong(["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-q", "-U", postgresUser, "-d", database], { input: installer });
    operatorId = rpc("rpc_get_local_operator", { correlation_id: "zh03-operator" }).local_operator_id;
  } catch (error) {
    if (!isDockerUnavailable(error)) throw error;
    runtimeAvailable = false;
    runtimeUnavailableReason = runtimeUnavailableMessage(error, "PostgreSQL");
  }
});

test.after(() => {
  if (databaseCreated) dropDatabase();
});

test("ZH03 sort persists a stable full candidate set, replays, rejects stale state, and rolls back invalid writes", (t) => {
  if (!runtimeAvailable) return t.skip(runtimeUnavailableReason);
  const bookId = createBook("primary");
  addTraversalCandidate(bookId, "primary");

  const failedWorkflow = sortPayload(bookId, "zh03-sort-model-failed");
  failedWorkflow.forEach((payload) => {
    payload.workflow_error = { code: "SORT_FAILED", message: "The L1A sort model did not complete." };
    payload.sort_result = {
      ordered_l1a_ids: [], candidate_revisions: [], gaps: [],
      design_fingerprint: payload.sort_result.design_fingerprint,
      candidate_fingerprint: payload.sort_result.candidate_fingerprint,
    };
  });
  const beforeFailedWorkflow = JSON.stringify(candidates(bookId));
  const failedWorkflowResult = runBatch(failedWorkflow);
  assert.equal(failedWorkflowResult?.ok, false, JSON.stringify(failedWorkflowResult));
  assert.equal(errorCode(failedWorkflowResult), "SORT_FAILED");
  assert.equal(JSON.stringify(candidates(bookId)), beforeFailedWorkflow, "model failure must leave every candidate unchanged");
  assert.equal(Number(sql(`SELECT count(*) FROM public.product_request_log WHERE operation='fp004_02_sort_l1a' AND book_id=${sqlText(bookId)}`)), 0);

  const first = runBatch(sortPayload(bookId, "zh03-sort-first"));
  assert.equal(first?.ok, true, JSON.stringify(first));
  assert.deepEqual(stableIndexes(bookId), [1, 2]);
  assert.equal(Number(sql(`SELECT count(*) FROM public.product_request_log WHERE operation='fp004_02_sort_l1a' AND book_id=${sqlText(bookId)}`)), 1);

  const replay = runBatch(sortPayload(bookId, "zh03-sort-first", first.result.candidate_fingerprint));
  assert.equal(replay?.ok, true, JSON.stringify(replay));
  assert.equal(replay.idempotent_replay, true, JSON.stringify(replay));
  assert.equal(Number(sql(`SELECT count(*) FROM public.product_request_log WHERE operation='fp004_02_sort_l1a' AND book_id=${sqlText(bookId)}`)), 1);

  const secondBookId = createBook("conflict");
  addTraversalCandidate(secondBookId, "conflict");
  const conflict = runBatch(sortPayload(secondBookId, "zh03-sort-first"));
  assert.equal(conflict?.ok, false, JSON.stringify(conflict));
  assert.equal(errorCode(conflict), "IDEMPOTENCY_CONFLICT");

  const staleFingerprint = candidateFingerprint(bookId);
  const changedId = candidates(bookId)[0].id;
  sql(`UPDATE api.v_l1a_candidate_write SET l1a_name='Changed after read' WHERE id=${sqlText(changedId)}::uuid`);
  const beforeStaleAttempt = JSON.stringify(candidates(bookId));
  const stale = runBatch(sortPayload(bookId, "zh03-sort-stale", staleFingerprint));
  assert.equal(stale?.ok, false, JSON.stringify(stale));
  assert.equal(errorCode(stale), "DESIGN_STATE_CHANGED");
  assert.equal(JSON.stringify(candidates(bookId)), beforeStaleAttempt, "stale sort must leave candidates unchanged");

  const invalidPayloads = sortPayload(bookId, "zh03-sort-invalid");
  invalidPayloads.forEach((payload) => { payload.sort_result.candidate_revisions[0].l1a_index = 2; });
  const beforeInvalidAttempt = JSON.stringify(candidates(bookId));
  const invalid = runBatch(invalidPayloads);
  assert.equal(invalid?.ok, false, JSON.stringify(invalid));
  assert.equal(errorCode(invalid), "SORT_WRITE_REJECTED");
  assert.equal(JSON.stringify(candidates(bookId)), beforeInvalidAttempt, "invalid full-set sort must roll back every staged write");

  const second = runBatch(sortPayload(bookId, "zh03-sort-second"));
  assert.equal(second?.ok, true, JSON.stringify(second));
  assert.deepEqual(stableIndexes(bookId), [1, 2], "repeat sorting must normalize indexes instead of drifting them");

  const finalizeRequest = finalizePayload(bookId, "zh03-finalize");
  const finalize = runBatch(finalizeRequest);
  assert.equal(finalize?.ok, true, JSON.stringify(finalize));
  assert.equal(finalize?.state?.design_locked, true, JSON.stringify(finalize));
  assert.equal(Number(sql(`SELECT count(*) FROM public.l1a_unit WHERE book_id=${sqlText(bookId)} AND is_formal AND is_locked`)), 2);
  const finalizeReplay = runBatch(finalizeRequest);
  assert.equal(finalizeReplay?.ok, true, JSON.stringify(finalizeReplay));
  assert.equal(finalizeReplay?.idempotent_replay, true, JSON.stringify(finalizeReplay));
  assert.equal(Number(sql(`SELECT count(*) FROM public.product_request_log WHERE operation='rpc_finalize_l1a' AND book_id=${sqlText(bookId)}`)), 1);
});

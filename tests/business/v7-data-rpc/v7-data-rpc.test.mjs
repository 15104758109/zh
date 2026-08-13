import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { docker, dockerLong, isDockerUnavailable, runtimeUnavailableMessage } from "../../support/docker-runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const container = process.env.ZH_V7_POSTGRES_CONTAINER ?? "n8n-pgvector";
const database = `zh_v7_rpc_${process.pid}_${randomUUID().replaceAll("-", "")}`;
const installer = readFileSync(path.join(root, "db/install/v7-data-rpc-contract.sql"), "utf8");
const worldRequestSchema = JSON.parse(readFileSync(
  path.join(root, "packages/contracts/src/v7-data-rpc/world-request.schema.json"),
  "utf8",
));

assert.match(database, /^zh_v7_rpc_[a-zA-Z0-9_]+$/);
assert.notEqual(database, "zh_narrative", "business tests must never target the live product database");

let databaseCreated = false;
let postgresUser;
let operatorId;
let createdBookId;
let initialL1aId;
let secondaryBookId;
let creationRequest;
let runtimeAvailable = true;
let runtimeUnavailableReason = "";

function runtimeTest(name, options, callback) {
  if (typeof options === "function") {
    callback = options;
    options = undefined;
  }
  const run = (t) => runtimeAvailable ? callback(t) : t.skip(runtimeUnavailableReason);
  return options ? test(name, options, run) : test(name, run);
}

function adminSql(statement) {
  return dockerLong([
    "exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-q",
    "-U", postgresUser, "-d", "postgres", "-c", statement,
  ]);
}

function sql(statement) {
  return docker([
    "exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-q",
    "-U", postgresUser, "-d", database, "-At", "-c", statement,
  ]).trim();
}

function rpc(name, payload) {
  const literal = JSON.stringify(payload).replaceAll("'", "''");
  return JSON.parse(sql(`SELECT public.${name}('${literal}'::jsonb)`));
}

function count(table, predicate = "true") {
  return Number(sql(`SELECT count(*) FROM public.${table} WHERE ${predicate}`));
}

function errorCode(response) {
  return response.error?.code;
}

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlJson(value) {
  return `${sqlText(JSON.stringify(value))}::jsonb`;
}

function dropTemporaryDatabase() {
  adminSql(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  databaseCreated = false;
}

function character(clientRef, name, charType) {
  return {
    client_ref: clientRef,
    char_name: name,
    char_type: charType,
    five_layers_json: {
      L0: { "主体能动性": 0 },
      L1: { desire: "Protect the promise", fear: "Lose the truth", core_motivation: "Choose responsibly" },
      L2: { abilities: [], costs: [], resources: [] },
      L3: { alliances: [], oppositions: [], entanglements: [], relation_summary: {} },
    },
    knowledge_boundary_json: { knows: [], unknown: [], false_belief: [], reasonable_suspect: [] },
    arc_json: { direction: "growth", progress: 0 },
  };
}

function worldState(boardType, atomType) {
  const values = {
    rule: { violate_cost: "resource loss", apply_scope: "the district", rule_type: "rationing" },
    geography: { danger_level: "high", location_text: "the district checkpoint" },
    resource: { scarcity_level: "scarce", usability: "identity evidence" },
    faction: { faction_status: "stable", stance: "defensive" },
    profession: { cost_mechanism: "credibility", is_system: false },
    monster: { threat_level: "high", counter_text: "sealed filters" },
    event: { event_era: "opening" },
  };
  return {
    board_type: boardType,
    atom_type: atomType,
    atom_key: `${boardType}.initial`,
    atom_value_jsonb: { name: boardType, ...values[boardType] },
    affordance_dims: ["initial-design"],
    knowledge_boundary_json: {},
    apply_scope_json: {},
    violate_cost_json: {},
  };
}

function createBookRequest(label = randomUUID()) {
  return {
    local_operator_id: operatorId,
    correlation_id: `create:${label}`,
    idempotency_key: `create-${label}`,
    title: `V7 isolated book ${label}`,
    intent_json: {
      genre_main: "\u79d1\u5e7b",
      premise: "A documented initial package",
      target_emotion: "A documented emotional direction",
    },
    forbid_json: { lines: [] },
    selling_points_json: ["bounded conflict"],
    target_words: 100000,
    chapter_words: 2000,
    commercial_score: 8,
    characters: [
      character("hero", "Hero", "protagonist"),
      character("rival", "Rival", "antagonist"),
    ],
    relations: [{
      char_a_ref: "hero",
      char_b_ref: "rival",
      trust: -10,
      intimacy: 0,
      power_balance: 0,
      dependence: 0,
      hostility: 50,
      common_goal: 0,
      secret_known: 0,
      emotional_bond: -5,
      relation_type: "rivals",
      relation_hierarchy: "peers",
      change_event_json: { event: "initial-conflict" },
    }],
    world_states: [
      worldState("rule", "rule"),
      worldState("geography", "geo"),
      worldState("resource", "resource"),
      worldState("faction", "faction"),
      worldState("profession", "job"),
      worldState("monster", "monster"),
      worldState("event", "event"),
    ],
    world_bindings: [{
      from_ref_type: "world",
      from_ref_id: "rule.initial",
      to_ref_type: "world",
      to_ref_id: "geography.initial",
      binding_type: "governs",
      binding_strength: "strong",
    }],
    initial_memories: [{
      char_ref: "hero",
      memory_type: "knowledge",
      memory_content: "The initial rule is known.",
      truth_status: "true",
    }],
    initial_l1a: {
      l1a_index: 1,
      l1a_name: "Initial conflict",
      scene_location: "Initial rule chamber",
      conflict_background: "The initial world resists the protagonist.",
      escalation_path: "The documented cost increases.",
      stakes: "The initial relationship.",
      irreversible_consequence: "The first choice cannot be undone.",
      plot_emotion_commit: { plot: "Pay the documented cost", emotion: "Resolve the initial fear" },
      arc_requirement: { direction: "growth" },
      info_reveal_boundary: { boundary: "Reveal only what the lead can perceive" },
      role_arc_json: { hero: "growth", rival: "stable" },
      role_arcs: [],
      participant_char_refs: ["hero", "rival"],
    },
  };
}

function createBook(label = randomUUID()) {
  const request = createBookRequest(label);
  const response = rpc("rpc_create_book_project", request);
  assert.equal(response.ok, true, JSON.stringify(response));
  return { request, response, bookId: response.book_id, initialL1aId: response.ids.initial_l1a_id };
}

function insertWorldCandidate(bookId, label, { atomKey = `rule.candidate.${label}`, supersedesId = null } = {}) {
  const id = randomUUID();
  sql(`INSERT INTO api.v_world_candidate_write (
    id, book_id, supersedes_id, board_type, atom_type, atom_key,
    atom_value_jsonb, affordance_dims, source_type, setting_layer,
    knowledge_boundary_json, apply_scope_json, violate_cost_json, local_operator_id
  ) VALUES (
    ${sqlText(id)}, ${sqlText(bookId)}, ${supersedesId ? sqlText(supersedesId) : "NULL"},
    'rule', 'rule', ${sqlText(atomKey)}, ${sqlJson({ label })}, ${sqlJson(["cost"])},
    'manual', 'initial', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, ${sqlText(operatorId)}
  ) RETURNING id`);
  return id;
}

function insertCharacterCandidate(bookId, supersedesId, label, charType) {
  const id = randomUUID();
  sql(`INSERT INTO api.v_character_candidate_write (
    id, book_id, supersedes_id, char_name, five_layers_json,
    knowledge_boundary_json, arc_json, is_active, char_type, local_operator_id
  ) VALUES (
    ${sqlText(id)}, ${sqlText(bookId)}, ${sqlText(supersedesId)}, ${sqlText(label)},
    ${sqlJson({
      L0: { "主体能动性": 0 },
      L1: { desire: "Protect the promise", fear: "Lose the truth", core_motivation: "Choose responsibly" },
      L2: { abilities: [], costs: [], resources: [] },
      L3: { alliances: [], oppositions: [], entanglements: [], relation_summary: {} },
    })},
    ${sqlJson({ knows: [], unknown: [], false_belief: [], reasonable_suspect: [] })},
    ${sqlJson({ direction: "growth", progress: 0 })}, true, ${sqlText(charType)}, ${sqlText(operatorId)}
  ) RETURNING id`);
  return id;
}

function insertWorldBindingCandidate(bookId, label, {
  supersedesId = null,
  fromRefType = "world",
  fromRefId = "rule.initial",
  toRefType = "world",
  toRefId = "geography.initial",
  bindingType = "governs",
  bindingStrength = "weak",
} = {}) {
  const id = randomUUID();
  sql(`INSERT INTO api.v_world_binding_candidate_write (
    id, book_id, supersedes_id, from_ref_type, from_ref_id, to_ref_type,
    to_ref_id, binding_type, binding_strength, setting_layer, local_operator_id
  ) VALUES (
    ${sqlText(id)}, ${sqlText(bookId)}, ${supersedesId ? sqlText(supersedesId) : "NULL"},
    ${sqlText(fromRefType)}, ${sqlText(fromRefId)}, ${sqlText(toRefType)},
    ${sqlText(toRefId)}, ${sqlText(bindingType)}, ${sqlText(bindingStrength)},
    'initial', ${sqlText(operatorId)}
  ) RETURNING id`);
  return id;
}

function insertRelationCandidate(bookId, charAId, charBId, label) {
  const id = randomUUID();
  sql(`INSERT INTO api.v_relation_candidate_write (
    id, book_id, char_a_id, char_b_id, trust, intimacy, power_balance,
    dependence, hostility, common_goal, secret_known, emotional_bond,
    relation_type, relation_hierarchy, change_event_json, local_operator_id
  ) VALUES (
    ${sqlText(id)}, ${sqlText(bookId)}, ${sqlText(charAId)}, ${sqlText(charBId)},
    -5, 0, 0, 0, 55, 0, 0, -5, 'rivals', 'peers',
    ${sqlJson({ event: label })}, ${sqlText(operatorId)}
  ) RETURNING id`);
  return id;
}

function formalCharacterIds(bookId) {
  return JSON.parse(sql(`SELECT COALESCE(jsonb_agg(id ORDER BY id), '[]'::jsonb)
    FROM public.character
    WHERE book_id=${sqlText(bookId)} AND is_formal AND is_active AND is_valid AND NOT is_shadow`));
}

function traversalCandidate(bookId, label, overrides = {}) {
  return {
    l1a_name: `Traversal ${label}`,
    scene_location: "Formal conflict site",
    conflict_background: "The formal world resists the formal characters.",
    escalation_path: "The documented cost compounds.",
    stakes: "The confirmed design.",
    irreversible_consequence: "The choice cannot be undone.",
    plot_emotion_commit: { plot: "Escalate the formal conflict", emotion: "Pay the promised cost" },
    arc_requirement: { direction: "growth" },
    info_reveal_boundary: { boundary: "Preserve the formal knowledge limits" },
    role_arc_json: { lead: "growth" },
    role_arcs: [],
    world_resistance_refs: [{ atom_key: sql(`SELECT atom_key FROM public.world_state
      WHERE book_id=${sqlText(bookId)} AND is_formal AND is_active AND is_valid AND NOT is_shadow
      ORDER BY atom_key LIMIT 1`) }],
    participant_chars_json: formalCharacterIds(bookId),
    future_setting_seeds: [],
    ...overrides,
  };
}

function generateTraversal(bookId, label, candidate = traversalCandidate(bookId, label)) {
  return rpc("rpc_generate_l1a_conflicts", {
    local_operator_id: operatorId,
    book_id: bookId,
    correlation_id: `generate:${label}`,
    idempotency_key: `generate-${label}`,
    candidates: [candidate],
  });
}

function beginRpcAndHold(name, payload, seconds = 2) {
  const applicationName = `v7-hold-${randomUUID()}`;
  const statement = `BEGIN; SELECT public.${name}(${sqlJson(payload)}); SELECT pg_sleep(${seconds}); COMMIT;`;
  return {
    applicationName,
    child: spawn("docker", [
      "exec", "-i", "-e", `PGAPPNAME=${applicationName}`, container,
      "psql", "-X", "-v", "ON_ERROR_STOP=1", "-q", "-U", postgresUser,
      "-d", database, "-At", "-c", statement,
    ], { stdio: ["ignore", "pipe", "pipe"] }),
  };
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`held RPC failed (${code}): ${stderr}`)));
  });
}

async function waitForHeldTransaction(held) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (Number(sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name=${sqlText(held.applicationName)}`)) === 1) {
      await new Promise(resolve => setTimeout(resolve, 150));
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("the held V7 RPC did not start its transaction");
}

test.before(() => {
  try {
    postgresUser = docker(["exec", container, "sh", "-lc", "printf '%s' \"$POSTGRES_USER\""]).trim();
    if (!postgresUser) throw new Error("PostgreSQL runtime unavailable: POSTGRES_USER missing");
    adminSql(`CREATE DATABASE "${database}"`);
    databaseCreated = true;
    dockerLong([
      "exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-q",
      "-U", postgresUser, "-d", database,
    ], { input: installer });
    operatorId = rpc("rpc_get_local_operator", { correlation_id: "isolated:operator" }).local_operator_id;
  } catch (setupError) {
    if (!databaseCreated) {
      if (isDockerUnavailable(setupError)) {
        runtimeAvailable = false;
        runtimeUnavailableReason = runtimeUnavailableMessage(setupError, "PostgreSQL");
        return;
      }
      throw setupError;
    }
    try {
      dropTemporaryDatabase();
    } catch (cleanupError) {
      throw new AggregateError([setupError, cleanupError], `temporary database setup and cleanup both failed: ${database}`);
    }
    if (isDockerUnavailable(setupError)) {
      runtimeAvailable = false;
      runtimeUnavailableReason = runtimeUnavailableMessage(setupError, "PostgreSQL");
      return;
    }
    throw setupError;
  }
});

test.after(() => {
  if (databaseCreated) dropTemporaryDatabase();
});

runtimeTest("world board wire contract accepts event and rejects chronicle", () => {
  const boardTypeConstraint = sql(`
    SELECT pg_get_constraintdef(oid)
    FROM pg_constraint
    WHERE conrelid = 'public.world_state'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%board_type%'
  `);
  assert.match(boardTypeConstraint, /'event'/, "the canonical PostgreSQL contract must accept the V7 event board code");
  assert.doesNotMatch(boardTypeConstraint, /'chronicle'/, "chronicle is not a V7 world board wire code");
});

runtimeTest("RPC-002 request schema supports confirm, delete, or one atomic combined transaction", () => {
  assert.equal(worldRequestSchema.$id, "urn:zhreplan:contract:rpc-commit-world-settings:3");
  assert.deepEqual(worldRequestSchema.required, ["local_operator_id", "book_id", "idempotency_key"]);
  assert.equal(worldRequestSchema.properties.world_candidate_ids.minItems, 1);
  assert.equal(worldRequestSchema.properties.delete_world_ids.minItems, 1);
  assert.equal(worldRequestSchema.properties.delete_world_binding_ids.minItems, 1);
  assert.deepEqual(worldRequestSchema.anyOf, [
    { required: ["world_candidate_ids"] },
    { required: ["delete_world_ids"] },
    { required: ["delete_world_binding_ids"] },
  ]);
});

runtimeTest("local operator is stable inside the isolated installation", () => {
  const second = rpc("rpc_get_local_operator", { correlation_id: "isolated:operator:again" });
  assert.equal(second.ok, true);
  assert.equal(second.local_operator_id, operatorId);
  assert.equal(count("local_operator"), 1);
});

runtimeTest("FP016 workbench uses the documented semantic idempotency error", () => {
  const key = `workbench-prompt-${randomUUID()}`;
  const request = {
    action: "save_prompt_active",
    local_operator_id: operatorId,
    fp_target: "FP016-IDEMPOTENCY-QA",
    prompt_text: "Stable workbench prompt",
    idempotency_key: key,
  };

  const saved = rpc("rpc_workbench", request);
  assert.equal(saved.ok, true, JSON.stringify(saved));

  const replay = rpc("rpc_workbench", request);
  assert.equal(replay.ok, true, JSON.stringify(replay));
  assert.equal(replay.idempotent_replay, true, JSON.stringify(replay));

  const conflict = rpc("rpc_workbench", { ...request, prompt_text: "Different prompt under the same key" });
  assert.equal(errorCode(conflict), "IDEMPOTENCY_KEY_REUSED", JSON.stringify(conflict));
  assert.equal(count("prompt_config", "fp_target='FP016-IDEMPOTENCY-QA'"), 1);
  assert.equal(count("product_request_log", `operation='rpc_workbench' AND idempotency_key=${sqlText(key)}`), 1);
});

runtimeTest("B1 atomically creates and replays the complete formal initial package", () => {
  creationRequest = createBookRequest();
  const created = rpc("rpc_create_book_project", creationRequest);

  assert.equal(created.ok, true, JSON.stringify(created));
  assert.match(created.book_id, /^[0-9a-f-]{36}$/i);
  assert.equal(created.state.stage_code, "design");
  assert.equal(created.state.token_budget, 3000000);
  createdBookId = created.book_id;
  initialL1aId = created.ids.initial_l1a_id;

  assert.equal(count("book_project", `id='${createdBookId}' AND token_budget=3000000 AND token_budget_version='mvp-fixed-3000000'`), 1);
  assert.equal(count("character", `book_id='${createdBookId}' AND is_formal AND is_active AND is_valid AND NOT is_shadow`), 2);
  assert.equal(count("world_state", `book_id='${createdBookId}' AND setting_layer='initial' AND is_formal AND is_active AND is_valid AND NOT is_shadow`), 7);
  assert.equal(Number(sql(`SELECT count(DISTINCT board_type) FROM public.world_state WHERE book_id='${createdBookId}'`)), 7);
  assert.equal(count("world_state", `book_id='${createdBookId}' AND board_type='event'`), 1);
  assert.equal(count("world_binding", `book_id='${createdBookId}' AND is_formal AND is_valid AND NOT is_shadow`), 1);
  assert.equal(count("relation_state", `book_id='${createdBookId}' AND is_formal AND is_valid AND NOT is_shadow`), 1);
  assert.equal(sql(`SELECT char_code FROM public.character WHERE book_id=${sqlText(createdBookId)} AND char_name='Hero'`), "hero");
  assert.equal(sql(`SELECT char_code FROM public.character WHERE book_id=${sqlText(createdBookId)} AND char_name='Rival'`), "rival");
  assert.equal(count("character_memory", `book_id='${createdBookId}' AND chapter_id IS NULL AND is_valid AND NOT is_shadow`), 1);
  assert.equal(count("l1a_unit", `book_id='${createdBookId}' AND source_type='initial' AND status='candidate' AND confirmation_status='unconfirmed' AND NOT is_formal AND NOT is_locked`), 1);
  assert.equal(count("product_request_log", `operation='rpc_create_book_project' AND book_id='${createdBookId}'`), 1);

  const replay = rpc("rpc_create_book_project", { ...creationRequest, correlation_id: "create:replay" });
  assert.equal(replay.ok, true, JSON.stringify(replay));
  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.book_id, createdBookId);

  const keyConflict = rpc("rpc_create_book_project", {
    ...creationRequest,
    correlation_id: "create:conflict",
    title: `${creationRequest.title} changed`,
  });
  assert.equal(errorCode(keyConflict), "IDEMPOTENCY_CONFLICT", JSON.stringify(keyConflict));
  assert.equal(count("book_project"), 1);
  assert.equal(count("world_state"), 7);
  assert.equal(count("product_request_log", "operation='rpc_create_book_project'"), 1);
});

runtimeTest("invalid or non-V7 world packages are rejected without partial data", () => {
  const beforeBooks = count("book_project");
  const beforeLedger = count("product_request_log");

  const missingEvent = createBookRequest();
  missingEvent.world_states = missingEvent.world_states.filter(item => item.board_type !== "event");
  const missingResult = rpc("rpc_create_book_project", missingEvent);
  assert.equal(errorCode(missingResult), "INITIAL_DATA_INCOMPLETE", JSON.stringify(missingResult));

  const chronicle = createBookRequest();
  chronicle.world_states = chronicle.world_states.map(item => item.board_type === "event"
    ? { ...item, board_type: "chronicle", atom_key: "chronicle.initial" }
    : item);
  const chronicleResult = rpc("rpc_create_book_project", chronicle);
  assert.equal(errorCode(chronicleResult), "INITIAL_DATA_INCOMPLETE", JSON.stringify(chronicleResult));

  assert.equal(count("book_project"), beforeBooks);
  assert.equal(count("product_request_log"), beforeLedger);
  assert.equal(count("world_state", "board_type='event'"), 1);
});

runtimeTest("FP001 rejects incomplete inner data and unresolved binding endpoints with zero writes", () => {
  const before = {
    books: count("book_project"),
    characters: count("character"),
    worlds: count("world_state"),
    relations: count("relation_state"),
    bindings: count("world_binding"),
    l1a: count("l1a_unit"),
    ledger: count("product_request_log"),
  };
  const cases = [];

  const missingTargetEmotion = createBookRequest(`missing-target-emotion-${randomUUID()}`);
  delete missingTargetEmotion.intent_json.target_emotion;
  cases.push(missingTargetEmotion);

  const emptyLayer = createBookRequest(`empty-layer-${randomUUID()}`);
  emptyLayer.characters[0].five_layers_json.L1 = {};
  cases.push(emptyLayer);

  const missingRelationDimension = createBookRequest(`relation-dimension-${randomUUID()}`);
  delete missingRelationDimension.relations[0].trust;
  cases.push(missingRelationDimension);

  const malformedRelationDimension = createBookRequest(`relation-format-${randomUUID()}`);
  malformedRelationDimension.relations[0].trust = "not-a-number";
  cases.push(malformedRelationDimension);

  const malformedMemoryRate = createBookRequest(`memory-format-${randomUUID()}`);
  malformedMemoryRate.initial_memories[0].decay_rate = "not-a-rate";
  cases.push(malformedMemoryRate);

  const emptyAffordance = createBookRequest(`empty-affordance-${randomUUID()}`);
  emptyAffordance.world_states[0].affordance_dims = [];
  cases.push(emptyAffordance);

  const missingWorldL1 = createBookRequest(`missing-world-l1-${randomUUID()}`);
  delete missingWorldL1.world_states.find((item) => item.board_type === "resource").atom_value_jsonb.scarcity_level;
  cases.push(missingWorldL1);

  const unresolvedBinding = createBookRequest(`binding-endpoint-${randomUUID()}`);
  unresolvedBinding.world_bindings[0].to_ref_id = "geography.does-not-exist";
  cases.push(unresolvedBinding);

  const unboundCharacterResource = createBookRequest(`unbound-character-resource-${randomUUID()}`);
  unboundCharacterResource.characters[0].five_layers_json.L2.resources = ["resource.initial"];
  cases.push(unboundCharacterResource);

  const emptyCommitment = createBookRequest(`empty-commitment-${randomUUID()}`);
  emptyCommitment.initial_l1a.plot_emotion_commit = {};
  cases.push(emptyCommitment);

  const missingSceneLocation = createBookRequest(`missing-scene-${randomUUID()}`);
  delete missingSceneLocation.initial_l1a.scene_location;
  cases.push(missingSceneLocation);

  const noParticipants = createBookRequest(`no-participants-${randomUUID()}`);
  noParticipants.initial_l1a.participant_char_refs = [];
  cases.push(noParticipants);

  for (const request of cases) {
    const rejected = rpc("rpc_create_book_project", request);
    assert.equal(errorCode(rejected), "INITIAL_DATA_INCOMPLETE", JSON.stringify(rejected));
  }

  assert.deepEqual({
    books: count("book_project"),
    characters: count("character"),
    worlds: count("world_state"),
    relations: count("relation_state"),
    bindings: count("world_binding"),
    l1a: count("l1a_unit"),
    ledger: count("product_request_log"),
  }, before);
});

runtimeTest("FP002 confirmation makes the candidate formal, stays editable, and is scoped and idempotent", () => {
  const secondary = createBook(`secondary-${randomUUID()}`);
  secondaryBookId = secondary.bookId;
  const baselineId = sql(`SELECT id FROM public.world_state
    WHERE book_id=${sqlText(createdBookId)} AND atom_key='rule.initial'
      AND is_formal AND is_valid AND NOT is_shadow`);
  const candidateId = insertWorldCandidate(createdBookId, "fp002", {
    atomKey: "rule.initial",
    supersedesId: baselineId,
  });
  const baselineBindingId = sql(`SELECT id FROM public.world_binding
    WHERE book_id=${sqlText(createdBookId)} AND from_ref_type='world'
      AND from_ref_id='rule.initial' AND to_ref_type='world'
      AND to_ref_id='geography.initial' AND binding_type='governs'
      AND is_formal AND is_valid AND NOT is_shadow`);
  const replacementBindingId = insertWorldBindingCandidate(createdBookId, "fp002-world", {
    supersedesId: baselineBindingId,
  });
  const heroLogicalId = sql(`SELECT logical_character_id FROM public.character
    WHERE book_id=${sqlText(createdBookId)} AND char_name='Hero'
      AND is_formal AND is_valid AND NOT is_shadow`);
  const characterWorldBindingId = insertWorldBindingCandidate(createdBookId, "fp002-character", {
    fromRefType: "character",
    fromRefId: heroLogicalId,
    toRefType: "world",
    toRefId: "rule.initial",
    bindingType: "constrained-by",
    bindingStrength: "strong",
  });
  const key = `world-confirm-${randomUUID()}`;
  const payload = {
    local_operator_id: operatorId,
    book_id: createdBookId,
    correlation_id: "fp002:confirm",
    idempotency_key: key,
    world_candidate_ids: [candidateId],
    binding_candidate_ids: [replacementBindingId, characterWorldBindingId],
  };

  const wrongBook = rpc("rpc_commit_world_settings", {
    ...payload,
    book_id: secondaryBookId,
    idempotency_key: `world-cross-book-${randomUUID()}`,
  });
  assert.equal(errorCode(wrongBook), "CANDIDATE_REJECTED", JSON.stringify(wrongBook));
  assert.equal(count("world_state", `id=${sqlText(candidateId)} AND NOT is_formal AND is_valid AND NOT is_shadow`), 1);

  const confirmed = rpc("rpc_commit_world_settings", payload);
  assert.equal(confirmed.ok, true, JSON.stringify(confirmed));
  assert.equal(confirmed.state.design_editable, true);
  assert.deepEqual(confirmed.ids.world_ids, [candidateId]);
  assert.equal(count("world_state", `id=${sqlText(candidateId)} AND is_formal AND is_active AND is_valid AND NOT is_shadow`), 1);
  assert.equal(count("world_state", `id=${sqlText(baselineId)} AND is_shadow AND NOT is_valid AND NOT is_active`), 1);
  assert.equal(count("world_binding", `id IN (${sqlText(replacementBindingId)},${sqlText(characterWorldBindingId)}) AND is_formal AND is_valid AND NOT is_shadow`), 2);
  assert.equal(count("world_binding", `id=${sqlText(baselineBindingId)} AND NOT is_formal AND is_shadow AND NOT is_valid`), 1);

  const replay = rpc("rpc_commit_world_settings", { ...payload, correlation_id: "fp002:replay" });
  assert.equal(replay.idempotent_replay, true, JSON.stringify(replay));
  assert.equal(count("product_request_log", `operation='rpc_commit_world_settings' AND idempotency_key=${sqlText(key)}`), 1);
});

runtimeTest("FP002 deletion removes one active world truth and all related bindings atomically", () => {
  const isolated = createBook(`world-delete-${randomUUID()}`);
  const other = createBook(`world-delete-other-${randomUUID()}`);
  const deletedWorldId = sql(`SELECT id FROM public.world_state
    WHERE book_id=${sqlText(isolated.bookId)} AND atom_key='rule.initial'
      AND setting_layer='initial' AND is_active AND is_formal AND is_valid AND NOT is_shadow`);
  const relatedFormalBindingId = sql(`SELECT id FROM public.world_binding
    WHERE book_id=${sqlText(isolated.bookId)}
      AND from_ref_type='world' AND from_ref_id='rule.initial'
      AND to_ref_type='world' AND to_ref_id='geography.initial'
      AND is_formal AND is_valid AND NOT is_shadow`);
  const relatedCandidateBindingId = insertWorldBindingCandidate(isolated.bookId, "delete-related", {
    supersedesId: relatedFormalBindingId,
  });
  const unrelatedCandidateBindingId = insertWorldBindingCandidate(isolated.bookId, "delete-unrelated", {
    fromRefId: "geography.initial",
    toRefId: "resource.initial",
    bindingType: "contains",
  });
  const beforeWrongScopeLedger = count("product_request_log", `book_id=${sqlText(other.bookId)}`);
  const wrongScope = rpc("rpc_commit_world_settings", {
    local_operator_id: operatorId,
    book_id: other.bookId,
    idempotency_key: `world-delete-wrong-scope-${randomUUID()}`,
    delete_world_ids: [deletedWorldId],
  });
  assert.equal(errorCode(wrongScope), "DELETE_TARGET_REJECTED", JSON.stringify(wrongScope));
  assert.equal(count("world_state", `id=${sqlText(deletedWorldId)} AND is_active AND is_formal AND is_valid AND NOT is_shadow`), 1);
  assert.equal(count("world_binding", `id IN (${sqlText(relatedFormalBindingId)},${sqlText(relatedCandidateBindingId)}) AND is_valid AND NOT is_shadow`), 2);
  assert.equal(count("product_request_log", `book_id=${sqlText(other.bookId)}`), beforeWrongScopeLedger);

  const key = `world-delete-${randomUUID()}`;
  const payload = {
    local_operator_id: operatorId,
    book_id: isolated.bookId,
    correlation_id: "fp002:delete",
    idempotency_key: key,
    delete_world_ids: [deletedWorldId],
  };
  const deleted = rpc("rpc_commit_world_settings", payload);
  assert.equal(deleted.ok, true, JSON.stringify(deleted));
  assert.deepEqual(deleted.ids.world_ids, []);
  assert.deepEqual(deleted.ids.world_binding_ids, []);
  assert.deepEqual(deleted.ids.deleted_world_ids, [deletedWorldId]);
  assert.deepEqual(deleted.ids.deleted_world_binding_ids, []);
  assert.deepEqual(
    [...deleted.ids.invalidated_world_binding_ids].sort(),
    [relatedFormalBindingId, relatedCandidateBindingId].sort(),
  );
  assert.equal(count("world_state", `id=${sqlText(deletedWorldId)} AND NOT is_active AND NOT is_formal AND is_shadow AND NOT is_valid`), 1);
  assert.equal(count("world_state", `book_id=${sqlText(isolated.bookId)} AND atom_key='rule.initial' AND is_formal AND is_valid AND NOT is_shadow`), 0);
  assert.equal(count("world_binding", `id IN (${sqlText(relatedFormalBindingId)},${sqlText(relatedCandidateBindingId)}) AND NOT is_formal AND is_shadow AND NOT is_valid`), 2);
  assert.equal(count("world_binding", `id=${sqlText(unrelatedCandidateBindingId)} AND NOT is_formal AND is_valid AND NOT is_shadow`), 1);

  const replay = rpc("rpc_commit_world_settings", { ...payload, correlation_id: "fp002:delete-replay" });
  assert.equal(replay.idempotent_replay, true, JSON.stringify(replay));
  assert.deepEqual(replay.ids.deleted_world_ids, [deletedWorldId]);
  assert.equal(count("product_request_log", `operation='rpc_commit_world_settings' AND idempotency_key=${sqlText(key)}`), 1);

  const differentWorldId = sql(`SELECT id FROM public.world_state
    WHERE book_id=${sqlText(isolated.bookId)} AND atom_key='geography.initial'
      AND setting_layer='initial' AND is_active AND is_formal AND is_valid AND NOT is_shadow`);
  const conflict = rpc("rpc_commit_world_settings", { ...payload, delete_world_ids: [differentWorldId] });
  assert.equal(errorCode(conflict), "IDEMPOTENCY_CONFLICT", JSON.stringify(conflict));
  assert.equal(count("world_state", `id=${sqlText(differentWorldId)} AND is_active AND is_formal AND is_valid AND NOT is_shadow`), 1);
});

runtimeTest("FP002 can remove one formal binding without deleting either endpoint", () => {
  const isolated = createBook(`binding-delete-${randomUUID()}`);
  const other = createBook(`binding-delete-other-${randomUUID()}`);
  const bindingId = sql(`SELECT id FROM public.world_binding
    WHERE book_id=${sqlText(isolated.bookId)}
      AND from_ref_type='world' AND from_ref_id='rule.initial'
      AND to_ref_type='world' AND to_ref_id='geography.initial'
      AND is_formal AND is_valid AND NOT is_shadow`);
  const beforeWrongScopeLedger = count("product_request_log", `book_id=${sqlText(other.bookId)}`);
  const wrongScope = rpc("rpc_commit_world_settings", {
    local_operator_id: operatorId,
    book_id: other.bookId,
    idempotency_key: `binding-delete-wrong-scope-${randomUUID()}`,
    delete_world_binding_ids: [bindingId],
  });
  assert.equal(errorCode(wrongScope), "DELETE_BINDING_TARGET_REJECTED", JSON.stringify(wrongScope));
  assert.equal(count("world_binding", `id=${sqlText(bindingId)} AND is_formal AND is_valid AND NOT is_shadow`), 1);
  assert.equal(count("product_request_log", `book_id=${sqlText(other.bookId)}`), beforeWrongScopeLedger);

  const key = `binding-delete-${randomUUID()}`;
  const payload = {
    local_operator_id: operatorId,
    book_id: isolated.bookId,
    correlation_id: "fp002:binding-delete",
    idempotency_key: key,
    delete_world_binding_ids: [bindingId],
  };
  const deleted = rpc("rpc_commit_world_settings", payload);
  assert.equal(deleted.ok, true, JSON.stringify(deleted));
  assert.deepEqual(deleted.ids.world_ids, []);
  assert.deepEqual(deleted.ids.world_binding_ids, []);
  assert.deepEqual(deleted.ids.deleted_world_ids, []);
  assert.deepEqual(deleted.ids.deleted_world_binding_ids, [bindingId]);
  assert.deepEqual(deleted.ids.invalidated_world_binding_ids, []);
  assert.equal(count("world_binding", `id=${sqlText(bindingId)} AND NOT is_formal AND is_shadow AND NOT is_valid`), 1);
  assert.equal(count("world_state", `book_id=${sqlText(isolated.bookId)} AND atom_key IN ('rule.initial','geography.initial') AND is_active AND is_formal AND is_valid AND NOT is_shadow`), 2);

  const replay = rpc("rpc_commit_world_settings", { ...payload, correlation_id: "fp002:binding-delete-replay" });
  assert.equal(replay.idempotent_replay, true, JSON.stringify(replay));
  assert.deepEqual(replay.ids.deleted_world_binding_ids, [bindingId]);
  assert.equal(count("product_request_log", `operation='rpc_commit_world_settings' AND idempotency_key=${sqlText(key)}`), 1);
});

runtimeTest("FP002 combines candidate confirmation and both delete intents with all-or-nothing writes", () => {
  const isolated = createBook(`world-combined-${randomUUID()}`);
  const other = createBook(`world-combined-other-${randomUUID()}`);
  const candidateWorldId = insertWorldCandidate(isolated.bookId, "combined", {
    atomKey: `rule.combined.${randomUUID()}`,
  });
  const candidateBindingId = insertWorldBindingCandidate(isolated.bookId, "combined", {
    fromRefId: "geography.initial",
    toRefId: "resource.initial",
    bindingType: "contains",
  });
  const deleteWorldId = sql(`SELECT id FROM public.world_state
    WHERE book_id=${sqlText(isolated.bookId)} AND atom_key='event.initial'
      AND setting_layer='initial' AND is_active AND is_formal AND is_valid AND NOT is_shadow`);
  const deleteBindingId = sql(`SELECT id FROM public.world_binding
    WHERE book_id=${sqlText(isolated.bookId)} AND is_formal AND is_valid AND NOT is_shadow`);
  const wrongBindingId = sql(`SELECT id FROM public.world_binding
    WHERE book_id=${sqlText(other.bookId)} AND is_formal AND is_valid AND NOT is_shadow`);
  const beforeLedger = count("product_request_log", `book_id=${sqlText(isolated.bookId)}`);
  const base = {
    local_operator_id: operatorId,
    book_id: isolated.bookId,
    world_candidate_ids: [candidateWorldId],
    binding_candidate_ids: [candidateBindingId],
    delete_world_ids: [deleteWorldId],
  };
  const rejected = rpc("rpc_commit_world_settings", {
    ...base,
    idempotency_key: `world-combined-rejected-${randomUUID()}`,
    delete_world_binding_ids: [wrongBindingId],
  });
  assert.equal(errorCode(rejected), "DELETE_BINDING_TARGET_REJECTED", JSON.stringify(rejected));
  assert.equal(count("world_state", `id=${sqlText(candidateWorldId)} AND NOT is_formal AND is_valid AND NOT is_shadow`), 1);
  assert.equal(count("world_binding", `id=${sqlText(candidateBindingId)} AND NOT is_formal AND is_valid AND NOT is_shadow`), 1);
  assert.equal(count("world_state", `id=${sqlText(deleteWorldId)} AND is_active AND is_formal AND is_valid AND NOT is_shadow`), 1);
  assert.equal(count("world_binding", `id=${sqlText(deleteBindingId)} AND is_formal AND is_valid AND NOT is_shadow`), 1);
  assert.equal(count("product_request_log", `book_id=${sqlText(isolated.bookId)}`), beforeLedger);

  const committed = rpc("rpc_commit_world_settings", {
    ...base,
    correlation_id: "fp002:combined",
    idempotency_key: `world-combined-${randomUUID()}`,
    delete_world_binding_ids: [deleteBindingId],
  });
  assert.equal(committed.ok, true, JSON.stringify(committed));
  assert.deepEqual(committed.ids.world_ids, [candidateWorldId]);
  assert.deepEqual(committed.ids.world_binding_ids, [candidateBindingId]);
  assert.deepEqual(committed.ids.deleted_world_ids, [deleteWorldId]);
  assert.deepEqual(committed.ids.deleted_world_binding_ids, [deleteBindingId]);
  assert.deepEqual(committed.ids.invalidated_world_binding_ids, []);
  assert.equal(count("world_state", `id=${sqlText(candidateWorldId)} AND is_active AND is_formal AND is_valid AND NOT is_shadow`), 1);
  assert.equal(count("world_binding", `id=${sqlText(candidateBindingId)} AND is_formal AND is_valid AND NOT is_shadow`), 1);
  assert.equal(count("world_state", `id=${sqlText(deleteWorldId)} AND NOT is_active AND NOT is_formal AND is_shadow AND NOT is_valid`), 1);
  assert.equal(count("world_binding", `id=${sqlText(deleteBindingId)} AND NOT is_formal AND is_shadow AND NOT is_valid`), 1);
});

runtimeTest("FP003 confirmation atomically formalizes character, relation, and memory data without locking design", () => {
  const oldHero = sql(`SELECT id FROM public.character
    WHERE book_id=${sqlText(createdBookId)} AND char_name='Hero'
      AND is_formal AND is_valid AND NOT is_shadow`);
  const oldRival = sql(`SELECT id FROM public.character
    WHERE book_id=${sqlText(createdBookId)} AND char_name='Rival'
      AND is_formal AND is_valid AND NOT is_shadow`);
  const oldRelation = sql(`SELECT id FROM public.relation_state
    WHERE book_id=${sqlText(createdBookId)} AND is_formal AND is_valid AND NOT is_shadow`);
  const oldCharacterWorldBinding = sql(`SELECT id FROM public.world_binding
    WHERE book_id=${sqlText(createdBookId)} AND from_ref_type='character'
      AND binding_type='constrained-by' AND is_formal AND is_valid AND NOT is_shadow`);
  const oldCharacterLogicalId = sql(`SELECT from_ref_id FROM public.world_binding
    WHERE id=${sqlText(oldCharacterWorldBinding)}`);
  const hero = insertCharacterCandidate(createdBookId, oldHero, "Hero confirmed", "protagonist");
  const rival = insertCharacterCandidate(createdBookId, oldRival, "Rival confirmed", "antagonist");
  const relation = insertRelationCandidate(createdBookId, hero, rival, "fp003-confirmed");
  const characterWorldBinding = insertWorldBindingCandidate(createdBookId, "fp003-character", {
    supersedesId: oldCharacterWorldBinding,
    fromRefType: "character",
    fromRefId: oldCharacterLogicalId,
    toRefType: "world",
    toRefId: "rule.initial",
    bindingType: "constrained-by",
    bindingStrength: "weak",
  });
  const key = `character-confirm-${randomUUID()}`;
  const payload = {
    local_operator_id: operatorId,
    book_id: createdBookId,
    correlation_id: "fp003:confirm",
    idempotency_key: key,
    character_candidate_ids: [hero, rival],
    relation_candidate_ids: [relation],
    binding_candidate_ids: [characterWorldBinding],
    initial_memories: [{
      char_id: hero,
      memory_type: "knowledge",
      memory_content: "The confirmed design is known.",
      truth_status: "true",
    }],
  };

  const confirmed = rpc("rpc_commit_character_settings", payload);
  assert.equal(confirmed.ok, true, JSON.stringify(confirmed));
  assert.equal(confirmed.state.design_editable, true);
  assert.equal(count("character", `id IN (${sqlText(hero)},${sqlText(rival)}) AND status='active' AND is_formal AND is_active AND is_valid AND NOT is_shadow`), 2);
  assert.equal(count("character", `id IN (${sqlText(oldHero)},${sqlText(oldRival)}) AND is_shadow AND NOT is_valid AND NOT is_active`), 2);
  assert.equal(count("relation_state", `id=${sqlText(relation)} AND is_formal AND is_valid AND NOT is_shadow`), 1);
  assert.equal(count("relation_state", `id=${sqlText(oldRelation)} AND is_shadow AND NOT is_valid`), 1);
  assert.equal(count("world_binding", `id=${sqlText(characterWorldBinding)} AND is_formal AND is_valid AND NOT is_shadow`), 1);
  assert.equal(count("world_binding", `id=${sqlText(oldCharacterWorldBinding)} AND NOT is_formal AND is_shadow AND NOT is_valid`), 1);
  assert.equal(count("character_memory", `book_id=${sqlText(createdBookId)} AND char_id=${sqlText(hero)} AND memory_content='The confirmed design is known.' AND is_valid AND NOT is_shadow`), 1);

  const replay = rpc("rpc_commit_character_settings", { ...payload, correlation_id: "fp003:replay" });
  assert.equal(replay.idempotent_replay, true, JSON.stringify(replay));
  assert.equal(count("product_request_log", `operation='rpc_commit_character_settings' AND idempotency_key=${sqlText(key)}`), 1);
});

runtimeTest("FP003 rejects an incomplete candidate without replacing formal character truth", () => {
  const isolated = createBook(`invalid-character-${randomUUID()}`);
  const baseline = sql(`SELECT id FROM public.character
    WHERE book_id=${sqlText(isolated.bookId)} AND char_name='Hero'
      AND is_formal AND is_valid AND NOT is_shadow`);
  const candidate = insertCharacterCandidate(
    isolated.bookId,
    baseline,
    "Incomplete candidate",
    "protagonist",
  );
  sql(`UPDATE api.v_character_candidate_write
    SET five_layers_json=jsonb_set(five_layers_json, '{L1}', '{}'::jsonb),
        local_operator_id=${sqlText(operatorId)}
    WHERE id=${sqlText(candidate)} AND local_operator_id=${sqlText(operatorId)}`);
  const beforeLedger = count("product_request_log", `book_id=${sqlText(isolated.bookId)}`);
  const rejected = rpc("rpc_commit_character_settings", {
    local_operator_id: operatorId,
    book_id: isolated.bookId,
    idempotency_key: `invalid-character-confirm-${randomUUID()}`,
    character_candidate_ids: [candidate],
    relation_candidate_ids: [],
    binding_candidate_ids: [],
    initial_memories: [],
  });
  assert.equal(errorCode(rejected), "CANDIDATE_REJECTED", JSON.stringify(rejected));
  assert.equal(count("character", `id=${sqlText(baseline)} AND is_formal AND is_valid AND NOT is_shadow`), 1);
  assert.equal(count("character", `id=${sqlText(candidate)} AND NOT is_formal AND is_valid AND NOT is_shadow`), 1);
  assert.equal(count("product_request_log", `book_id=${sqlText(isolated.bookId)}`), beforeLedger);
});

runtimeTest("world confirmations serialize per book while another book remains independent", async () => {
  const sameBook = createBook(`serialization-same-${randomUUID()}`);
  const otherBook = createBook(`serialization-other-${randomUUID()}`);
  const first = insertWorldCandidate(sameBook.bookId, `same-a-${randomUUID()}`);
  const second = insertWorldCandidate(sameBook.bookId, `same-b-${randomUUID()}`);
  const firstPayload = {
    local_operator_id: operatorId,
    book_id: sameBook.bookId,
    correlation_id: "serialization:first",
    idempotency_key: `serialization-first-${randomUUID()}`,
    world_candidate_ids: [first],
    binding_candidate_ids: [],
  };
  const held = beginRpcAndHold("rpc_commit_world_settings", firstPayload, 4);
  await waitForHeldTransaction(held);
  const started = Date.now();
  const secondResult = rpc("rpc_commit_world_settings", {
    ...firstPayload,
    correlation_id: "serialization:second",
    idempotency_key: `serialization-second-${randomUUID()}`,
    world_candidate_ids: [second],
  });
  const elapsed = Date.now() - started;
  await waitForExit(held.child);
  assert.equal(secondResult.ok, true, JSON.stringify(secondResult));
  assert.ok(elapsed >= 3000, `same-book confirmation did not wait for the held transaction (${elapsed}ms)`);
  assert.equal(count("world_state", `id IN (${sqlText(first)},${sqlText(second)}) AND is_formal AND is_valid AND NOT is_shadow`), 2);

  const heldCandidate = insertWorldCandidate(sameBook.bookId, `other-held-${randomUUID()}`);
  const independentCandidate = insertWorldCandidate(otherBook.bookId, `other-free-${randomUUID()}`);
  const otherHeld = beginRpcAndHold("rpc_commit_world_settings", {
    ...firstPayload,
    correlation_id: "serialization:other-held",
    idempotency_key: `serialization-other-held-${randomUUID()}`,
    world_candidate_ids: [heldCandidate],
  }, 4);
  await waitForHeldTransaction(otherHeld);
  const independentStarted = Date.now();
  const independent = rpc("rpc_commit_world_settings", {
    ...firstPayload,
    book_id: otherBook.bookId,
    correlation_id: "serialization:independent",
    idempotency_key: `serialization-independent-${randomUUID()}`,
    world_candidate_ids: [independentCandidate],
  });
  const independentElapsed = Date.now() - independentStarted;
  await waitForExit(otherHeld.child);
  assert.equal(independent.ok, true, JSON.stringify(independent));
  assert.ok(independentElapsed < 3000, `different-book confirmation was blocked (${independentElapsed}ms)`);
});

runtimeTest("FP004 rejects an invalid future setting before mutating any design state", () => {
  const isolated = createBook(`invalid-lock-${randomUUID()}`);
  const candidate = traversalCandidate(isolated.bookId, "invalid-future", {
    future_setting_seeds: [{
      inherit_status: "inheritable",
      proposed_atom: {
        board_type: "event",
        atom_type: "event",
        atom_key: "event.invalid-future",
        atom_value_jsonb: { name: "invalid" },
        affordance_dims: ["future"],
        conflict_with_initial: { has_conflict: true },
      },
      proposed_bindings: [],
    }],
  });
  const generated = generateTraversal(isolated.bookId, `invalid-future-${randomUUID()}`, candidate);
  assert.equal(generated.ok, true, JSON.stringify(generated));
  const generatedId = generated.ids.l1a_candidate_ids[0];
  const result = rpc("rpc_finalize_l1a", {
    local_operator_id: operatorId,
    book_id: isolated.bookId,
    correlation_id: "fp004:invalid-future",
    idempotency_key: `invalid-finalize-${randomUUID()}`,
    ordered_l1a_ids: [isolated.initialL1aId, generatedId],
    design_fingerprint: generated.state.design_fingerprint,
  });
  assert.equal(errorCode(result), "FUTURE_SETTING_REJECTED", JSON.stringify(result));
  assert.equal(count("l1a_unit", `book_id=${sqlText(isolated.bookId)} AND (is_formal OR is_locked)`), 0);
  assert.equal(count("book_project", `id=${sqlText(isolated.bookId)} AND stage_code='design' AND current_l1a_id IS NULL`), 1);
  assert.equal(count("product_request_log", `operation='rpc_finalize_l1a' AND book_id=${sqlText(isolated.bookId)}`), 0);
});

runtimeTest("FP004 rejects a stale sort when formal design changed after traversal generation", () => {
  const isolated = createBook(`stale-sort-${randomUUID()}`);
  const generated = generateTraversal(isolated.bookId, `stale-sort-${randomUUID()}`);
  assert.equal(generated.ok, true, JSON.stringify(generated));
  const baseline = sql(`SELECT id FROM public.world_state
    WHERE book_id=${sqlText(isolated.bookId)} AND atom_key='rule.initial'
      AND is_formal AND is_valid AND NOT is_shadow`);
  const replacement = insertWorldCandidate(isolated.bookId, `stale-sort-${randomUUID()}`, {
    atomKey: "rule.initial",
    supersedesId: baseline,
  });
  const changed = rpc("rpc_commit_world_settings", {
    local_operator_id: operatorId,
    book_id: isolated.bookId,
    idempotency_key: `stale-world-${randomUUID()}`,
    world_candidate_ids: [replacement],
    binding_candidate_ids: [],
  });
  assert.equal(changed.ok, true, JSON.stringify(changed));
  const rejected = rpc("rpc_finalize_l1a", {
    local_operator_id: operatorId,
    book_id: isolated.bookId,
    idempotency_key: `stale-lock-${randomUUID()}`,
    ordered_l1a_ids: [isolated.initialL1aId, generated.ids.l1a_candidate_ids[0]],
    design_fingerprint: generated.state.design_fingerprint,
  });
  assert.equal(errorCode(rejected), "DESIGN_STATE_CHANGED", JSON.stringify(rejected));
  assert.equal(count("l1a_unit", `book_id=${sqlText(isolated.bookId)} AND is_locked`), 0);
  assert.equal(count("product_request_log", `operation='rpc_finalize_l1a' AND book_id=${sqlText(isolated.bookId)}`), 0);
});

runtimeTest("FP004 is the sole design lock and requires the complete active L1A plan", () => {
  const pendingWorld = insertWorldCandidate(createdBookId, `pending-lock-${randomUUID()}`);
  const currentFormalCharacter = formalCharacterIds(createdBookId)[0];
  const pendingCharacter = insertCharacterCandidate(
    createdBookId,
    currentFormalCharacter,
    "Pending after lock",
    "protagonist",
  );
  const invalidReference = generateTraversal(
    createdBookId,
    `bad-ref-${randomUUID()}`,
    traversalCandidate(createdBookId, "bad-ref", { world_resistance_refs: [{ atom_key: "missing.world.atom" }] }),
  );
  assert.equal(errorCode(invalidReference), "WORLD_REFERENCE_REJECTED", JSON.stringify(invalidReference));

  const generated = generateTraversal(createdBookId, `valid-${randomUUID()}`);
  assert.equal(generated.ok, true, JSON.stringify(generated));
  assert.match(generated.state.design_fingerprint, /^[0-9a-f]{64}$/);
  const generatedId = generated.ids.l1a_candidate_ids[0];
  const incomplete = rpc("rpc_finalize_l1a", {
    local_operator_id: operatorId,
    book_id: createdBookId,
    correlation_id: "fp004:incomplete",
    idempotency_key: `incomplete-finalize-${randomUUID()}`,
    ordered_l1a_ids: [generatedId],
    design_fingerprint: generated.state.design_fingerprint,
  });
  assert.equal(errorCode(incomplete), "L1A_PLAN_INCOMPLETE", JSON.stringify(incomplete));
  assert.equal(count("l1a_unit", `book_id=${sqlText(createdBookId)} AND is_locked`), 0);

  const unsortedLegacyRequest = rpc("rpc_finalize_l1a", {
    local_operator_id: operatorId,
    book_id: createdBookId,
    correlation_id: "fp004:unsorted-legacy",
    idempotency_key: `unsorted-legacy-${randomUUID()}`,
    l1a_ids: [initialL1aId, generatedId],
    current_l1a_id: generatedId,
  });
  assert.equal(errorCode(unsortedLegacyRequest), "INVALID_REQUEST", JSON.stringify(unsortedLegacyRequest));

  const key = `finalize-${randomUUID()}`;
  const payload = {
    local_operator_id: operatorId,
    book_id: createdBookId,
    correlation_id: "fp004:finalize",
    idempotency_key: key,
    ordered_l1a_ids: [generatedId, initialL1aId],
    design_fingerprint: generated.state.design_fingerprint,
  };
  const finalized = rpc("rpc_finalize_l1a", payload);
  assert.equal(finalized.ok, true, JSON.stringify(finalized));
  assert.equal(finalized.state.design_locked, true);
  assert.equal(Object.hasOwn(finalized.state, "current_l1a_id"), false);
  assert.deepEqual(finalized.ids.l1a_ids, [generatedId, initialL1aId]);
  assert.equal(count("l1a_unit", `id IN (${sqlText(initialL1aId)},${sqlText(generatedId)}) AND status='finalized' AND confirmation_status='creator_confirmed' AND is_formal AND is_locked AND is_valid AND NOT is_shadow`), 2);
  assert.deepEqual(
    JSON.parse(sql(`SELECT jsonb_object_agg(id, l1a_index) FROM public.l1a_unit WHERE id IN (${sqlText(initialL1aId)},${sqlText(generatedId)})`)),
    { [generatedId]: 1, [initialL1aId]: 2 },
  );
  assert.equal(count("book_project", `id=${sqlText(createdBookId)} AND stage_code='production' AND run_status='l1a_confirmed' AND current_l1a_id IS NULL`), 1);

  const worldBlocked = rpc("rpc_commit_world_settings", {
    local_operator_id: operatorId,
    book_id: createdBookId,
    correlation_id: "fp004:world-blocked",
    idempotency_key: `world-blocked-${randomUUID()}`,
    world_candidate_ids: [pendingWorld],
    binding_candidate_ids: [],
  });
  assert.equal(errorCode(worldBlocked), "DESIGN_LOCKED", JSON.stringify(worldBlocked));
  const lockedWorldId = sql(`SELECT id FROM public.world_state
    WHERE book_id=${sqlText(createdBookId)} AND setting_layer='initial'
      AND is_active AND is_formal AND is_valid AND NOT is_shadow
    ORDER BY id LIMIT 1`);
  const deleteBlocked = rpc("rpc_commit_world_settings", {
    local_operator_id: operatorId,
    book_id: createdBookId,
    correlation_id: "fp004:world-delete-blocked",
    idempotency_key: `world-delete-blocked-${randomUUID()}`,
    delete_world_ids: [lockedWorldId],
  });
  assert.equal(errorCode(deleteBlocked), "DESIGN_LOCKED", JSON.stringify(deleteBlocked));
  assert.equal(count("world_state", `id=${sqlText(lockedWorldId)} AND is_active AND is_formal AND is_valid AND NOT is_shadow`), 1);
  const lockedBindingId = sql(`SELECT id FROM public.world_binding
    WHERE book_id=${sqlText(createdBookId)} AND is_formal AND is_valid AND NOT is_shadow
    ORDER BY id LIMIT 1`);
  const bindingDeleteBlocked = rpc("rpc_commit_world_settings", {
    local_operator_id: operatorId,
    book_id: createdBookId,
    correlation_id: "fp004:world-binding-delete-blocked",
    idempotency_key: `world-binding-delete-blocked-${randomUUID()}`,
    delete_world_binding_ids: [lockedBindingId],
  });
  assert.equal(errorCode(bindingDeleteBlocked), "DESIGN_LOCKED", JSON.stringify(bindingDeleteBlocked));
  assert.equal(count("world_binding", `id=${sqlText(lockedBindingId)} AND is_formal AND is_valid AND NOT is_shadow`), 1);
  const characterBlocked = rpc("rpc_commit_character_settings", {
    local_operator_id: operatorId,
    book_id: createdBookId,
    correlation_id: "fp004:character-blocked",
    idempotency_key: `character-blocked-${randomUUID()}`,
    character_candidate_ids: [pendingCharacter],
    relation_candidate_ids: [],
    binding_candidate_ids: [],
    initial_memories: [],
  });
  assert.equal(errorCode(characterBlocked), "DESIGN_LOCKED", JSON.stringify(characterBlocked));
  assert.equal(errorCode(generateTraversal(createdBookId, `after-lock-${randomUUID()}`)), "L1A_LOCKED");
  assert.throws(
    () => insertWorldCandidate(createdBookId, `api-after-lock-${randomUUID()}`),
    /V7_DESIGN_LOCKED_AFTER_L1A_CONFIRMATION/,
  );

  const replay = rpc("rpc_finalize_l1a", { ...payload, correlation_id: "fp004:replay" });
  assert.equal(replay.idempotent_replay, true, JSON.stringify(replay));
  assert.equal(count("product_request_log", `operation='rpc_finalize_l1a' AND idempotency_key=${sqlText(key)}`), 1);
});

runtimeTest("FP005-00 selects one finalized L1A as the persisted production scope", () => {
  const isolated = createBook(`fp005-select-${randomUUID()}`);
  const generated = generateTraversal(isolated.bookId, `fp005-select-${randomUUID()}`);
  assert.equal(generated.ok, true, JSON.stringify(generated));
  const finalized = rpc("rpc_finalize_l1a", {
    local_operator_id: operatorId,
    book_id: isolated.bookId,
    idempotency_key: `fp005-finalize-${randomUUID()}`,
    ordered_l1a_ids: [isolated.initialL1aId, generated.ids.l1a_candidate_ids[0]],
    design_fingerprint: generated.state.design_fingerprint,
  });
  assert.equal(finalized.ok, true, JSON.stringify(finalized));
  const l1aIds = JSON.parse(sql(`SELECT jsonb_agg(id ORDER BY l1a_index) FROM public.l1a_unit
    WHERE book_id=${sqlText(isolated.bookId)} AND status='finalized' AND is_formal AND is_locked AND is_valid AND NOT is_shadow`));
  assert.equal(l1aIds.length, 2);
  const key = `select-production-${randomUUID()}`;
  const payload = {
    local_operator_id: operatorId,
    book_id: isolated.bookId,
    l1a_id: l1aIds[0],
    correlation_id: "fp005:select",
    idempotency_key: key,
  };
  const selected = rpc("rpc_select_l1a_for_production", payload);
  assert.equal(selected.ok, true, JSON.stringify(selected));
  assert.equal(selected.ids.l1a_id, l1aIds[0]);
  assert.equal(selected.state.current_l1a_id, l1aIds[0]);
  assert.equal(count("book_project", `id=${sqlText(isolated.bookId)} AND current_l1a_id=${sqlText(l1aIds[0])}`), 1);
  assert.equal(count("l1a_unit", `book_id=${sqlText(isolated.bookId)} AND status='locked_for_deduction'`), 0);

  const replay = rpc("rpc_select_l1a_for_production", { ...payload, correlation_id: "fp005:select-replay" });
  assert.equal(replay.idempotent_replay, true, JSON.stringify(replay));
  const conflict = rpc("rpc_select_l1a_for_production", { ...payload, l1a_id: l1aIds[1] });
  assert.equal(errorCode(conflict), "IDEMPOTENCY_CONFLICT", JSON.stringify(conflict));

  const changed = rpc("rpc_select_l1a_for_production", {
    ...payload,
    l1a_id: l1aIds[1],
    idempotency_key: `select-production-${randomUUID()}`,
  });
  assert.equal(changed.ok, true, JSON.stringify(changed));
  assert.equal(count("book_project", `id=${sqlText(isolated.bookId)} AND current_l1a_id=${sqlText(l1aIds[1])}`), 1);
  assert.equal(count("product_request_log", `operation='rpc_select_l1a_for_production' AND book_id=${sqlText(isolated.bookId)}`), 2);
});

runtimeTest("approved builtin skills are installed once and remain active", () => {
  assert.equal(count("skill", "source_type='system_builtin' AND lifecycle_status='active' AND owner_local_operator_id IS NULL"), 72);
  assert.equal(count("skill", "source_type='system_builtin' AND lifecycle_status='active' AND skill_category='题材组合'"), 54);
  assert.equal(count("skill", "source_type='system_builtin' AND lifecycle_status='active' AND skill_category='章节展开'"), 8);
  assert.equal(count("skill", "source_type='system_builtin' AND lifecycle_status='active' AND skill_category='艺术呈现'"), 6);
  assert.equal(count("skill", "source_type='system_builtin' AND lifecycle_status='active' AND skill_category='镜头语言'"), 4);
  assert.equal(count("skill", "source_type='system_builtin' AND lifecycle_status='active' AND skill_category='题材组合' AND genre_main->>'primary' IN ('科幻','玄幻')"), 25);
  assert.equal(count("skill", "source_type='system_builtin' AND lifecycle_status='active' AND skill_category='题材组合' AND genre_main IS NULL"), 29);
  assert.equal(count("v7_install_metadata", "install_key='v7-skill-default-data-sha256'"), 1);
});

runtimeTest("FP015 import overwrite is atomic, preserves identity and preference, and detects semantic key reuse", () => {
  const slug = `isolated-import-${randomUUID()}`;
  const created = rpc("rpc_manage_skill", {
    action: "create_version",
    local_operator_id: operatorId,
    idempotency_key: `skill-create-${randomUUID()}`,
    stable_slug: slug,
    skill_name: "Original personal skill",
    skill_description: "A complete personal skill used by the isolated import journey.",
    skill_category: "\u7ae0\u8282\u5c55\u5f00",
    genre_main: null,
    skill_tags_jsonb: ["isolated"],
    applicable_stages: ["production"],
    applicable_scopes: {},
    constraint_fields: {},
    template_fields: {},
    skill_config_jsonb: { version: "before-import" },
    ai_rating: "S",
  });
  assert.equal(created.ok, true, JSON.stringify(created));
  const skillId = created.ids.skill_id;
  const versionId = created.ids.skill_version_id;
  const preferred = rpc("rpc_manage_skill", {
    action: "set_preference",
    local_operator_id: operatorId,
    book_id: createdBookId,
    skill_id: skillId,
    status: "disabled",
    idempotency_key: `skill-preference-${randomUUID()}`,
  });
  assert.equal(preferred.ok, true, JSON.stringify(preferred));

  const exported = JSON.parse(sql(`SELECT to_jsonb(s) FROM public.skill AS s WHERE s.id=${sqlText(versionId)}`));
  const importedItem = {
    ...exported,
    skill_name: "Imported personal skill",
    skill_description: "The imported content replaced the active version in place.",
    skill_tags_jsonb: ["isolated", "imported"],
    skill_config_jsonb: { version: "after-import" },
  };
  const importKey = `skill-import-${randomUUID()}`;
  const importPayload = {
    action: "import_overwrite",
    local_operator_id: operatorId,
    book_id: createdBookId,
    idempotency_key: importKey,
    skills: [importedItem],
  };
  const imported = rpc("rpc_manage_skill", importPayload);
  assert.equal(imported.ok, true, JSON.stringify(imported));
  assert.equal(imported.state.versions_changed, false);
  assert.equal(imported.state.preferences_changed, false);
  assert.equal(count("skill", `skill_id=${sqlText(skillId)} AND id=${sqlText(versionId)} AND version=1 AND lifecycle_status='active' AND skill_name='Imported personal skill'`), 1);
  assert.equal(count("skill", `skill_id=${sqlText(skillId)}`), 1);
  assert.equal(count("skill_identity", `skill_id=${sqlText(skillId)} AND stable_slug=${sqlText(slug)}`), 1);
  assert.equal(count("book_skill_preference", `book_id=${sqlText(createdBookId)} AND skill_id=${sqlText(skillId)} AND status='disabled'`), 1);

  const beforeReplay = sql(`SELECT updated_at FROM public.skill WHERE id=${sqlText(versionId)}`);
  const replay = rpc("rpc_manage_skill", importPayload);
  const afterReplay = sql(`SELECT updated_at FROM public.skill WHERE id=${sqlText(versionId)}`);
  assert.equal(replay.idempotent_replay, true, JSON.stringify(replay));
  assert.equal(afterReplay, beforeReplay);

  const semanticConflict = rpc("rpc_manage_skill", {
    ...importPayload,
    skills: [{ ...importedItem, skill_name: "Different content under the same key" }],
  });
  assert.equal(errorCode(semanticConflict), "IDEMPOTENCY_CONFLICT", JSON.stringify(semanticConflict));
  assert.equal(sql(`SELECT skill_name FROM public.skill WHERE id=${sqlText(versionId)}`), "Imported personal skill");

  const invalidIdentity = {
    ...importedItem,
    skill_id: randomUUID(),
    stable_slug: `missing-${randomUUID()}`,
  };
  const atomicFailure = rpc("rpc_manage_skill", {
    action: "import_overwrite",
    local_operator_id: operatorId,
    book_id: createdBookId,
    idempotency_key: `skill-import-atomic-${randomUUID()}`,
    skills: [
      { ...importedItem, skill_name: "This partial update must roll back" },
      invalidIdentity,
    ],
  });
  assert.equal(errorCode(atomicFailure), "SKILL_IMPORT_IDENTITY_REJECTED", JSON.stringify(atomicFailure));
  assert.equal(sql(`SELECT skill_name FROM public.skill WHERE id=${sqlText(versionId)}`), "Imported personal skill");
  assert.equal(count("book_skill_preference", `book_id=${sqlText(createdBookId)} AND skill_id=${sqlText(skillId)} AND status='disabled'`), 1);
});

runtimeTest("FP014 prompt promotion requires real sample outcomes and persisted before/after experiment evidence", () => {
  const activePromptId = randomUUID();
  const candidatePromptId = randomUUID();
  const sampleId = randomUUID();
  const beforePrompt = "Use only the documented candidate facts.";
  const afterPrompt = "Use only documented candidate facts and cite the evidence.";

  sql(`BEGIN;
    SELECT public.v7_enable_internal_write();
    INSERT INTO public.prompt_config(id, local_operator_id, fp_target, version, prompt_text, status, is_active)
    VALUES (${sqlText(activePromptId)}, ${sqlText(operatorId)}, 'FP009-01', 1, ${sqlText(beforePrompt)}, 'active', true);
    INSERT INTO public.prompt_config(id, local_operator_id, fp_target, version, prompt_text, status, is_active)
    VALUES (${sqlText(candidatePromptId)}, ${sqlText(operatorId)}, 'FP009-01', 2, ${sqlText(afterPrompt)}, 'candidate', false);
    INSERT INTO public.model_runtime_binding(local_operator_id, node_code, prompt_config_id, prompt_version, template_type)
    VALUES (${sqlText(operatorId)}, 'FP009-01', ${sqlText(activePromptId)}, 1, '感性文字');
    INSERT INTO public.iteration_log(
      id, book_id, local_operator_id, source_fp, iter_type, review_status,
      exec_result, root_debt_type, attribution_evidence_json, snapshot_jsonb
    ) VALUES (
      ${sqlText(sampleId)}, ${sqlText(createdBookId)}, ${sqlText(operatorId)}, 'FP009-01',
      'prompt', 'pending_review', 'success', 'prompt', ${sqlJson({ field: "prompt_text" })},
      ${sqlJson({ sample: "documented failure" })}
    );
    COMMIT;`);

  const empty = rpc("rpc_promote_prompt_config", {
    local_operator_id: operatorId,
    prompt_config_id: candidatePromptId,
    creator_confirmed: true,
    idempotency_key: `prompt-empty-${randomUUID()}`,
    sample_outcomes: [],
  });
  assert.equal(errorCode(empty), "PROMPT_EXPERIMENT_INCOMPLETE", JSON.stringify(empty));

  const withoutMetrics = rpc("rpc_promote_prompt_config", {
    local_operator_id: operatorId,
    prompt_config_id: candidatePromptId,
    creator_confirmed: true,
    idempotency_key: `prompt-no-metrics-${randomUUID()}`,
    sample_outcomes: [{ iteration_id: sampleId, review_status: "confirmed" }],
  });
  assert.equal(errorCode(withoutMetrics), "PROMPT_EXPERIMENT_INCOMPLETE", JSON.stringify(withoutMetrics));

  sql(`BEGIN;
    SELECT public.v7_enable_internal_write();
    UPDATE public.iteration_log
    SET before_metric_json=${sqlJson({ p0_rate: 1, audit_pass_rate: 0 })},
        after_metric_json=${sqlJson({ p0_rate: 0, audit_pass_rate: 1 })},
        before_prompt=${sqlText(beforePrompt)},
        after_prompt=${sqlText(afterPrompt)}
    WHERE id=${sqlText(sampleId)};
    COMMIT;`);

  const key = `prompt-promote-${randomUUID()}`;
  const payload = {
    local_operator_id: operatorId,
    prompt_config_id: candidatePromptId,
    creator_confirmed: true,
    idempotency_key: key,
    sample_outcomes: [{ iteration_id: sampleId, review_status: "confirmed" }],
  };
  const promoted = rpc("rpc_promote_prompt_config", payload);
  assert.equal(promoted.ok, true, JSON.stringify(promoted));
  assert.equal(count("prompt_config", `id=${sqlText(candidatePromptId)} AND status='active' AND is_active`), 1);
  assert.equal(count("iteration_log", `id=${sqlText(sampleId)} AND review_status='confirmed' AND confirmed_by=${sqlText(operatorId)}`), 1);

  const conflict = rpc("rpc_promote_prompt_config", {
    ...payload,
    sample_outcomes: [{ iteration_id: sampleId, review_status: "discarded" }],
  });
  assert.equal(errorCode(conflict), "IDEMPOTENCY_CONFLICT", JSON.stringify(conflict));
});

runtimeTest("formal word count includes Han characters and punctuation without treating the target as a gate", () => {
  assert.equal(sql("SELECT public.v7_count_han_and_punctuation('你好，世界！A1')"), "6");
  assert.equal(sql("SELECT public.v7_count_han_and_punctuation('A-1...')"), "4");
});

runtimeTest("deferred writes and an incomplete formal request fail closed without ledger writes", () => {
  const beforeLedger = count("product_request_log");
  const scope = { local_operator_id: operatorId, book_id: createdBookId };

  assert.equal(errorCode(rpc("rpc_enhance_prose", scope)), "CHANGE_LIMIT_CONTRACT_UNRESOLVED");
  const incompleteFormalCommit = rpc("rpc_commit_chapter", { ...scope, idempotency_key: "commit-unresolved" });
  assert.equal(errorCode(incompleteFormalCommit), "SCOPE_REJECTED");
  assert.notEqual(errorCode(incompleteFormalCommit), "FORMAL_WRITEBACK_CONTRACT_INCOMPLETE");
  assert.equal(errorCode(rpc("rpc_record_iteration_sample", scope)), "ITERATION_RETRY_CONTRACT_UNRESOLVED");
  assert.equal(count("product_request_log"), beforeLedger);
});

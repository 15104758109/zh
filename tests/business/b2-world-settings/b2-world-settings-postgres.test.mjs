import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { docker, dockerLong, isDockerUnavailable, runtimeUnavailableMessage } from "../../support/docker-runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const container = process.env.ZH_V7_POSTGRES_CONTAINER ?? "n8n-pgvector";
const database = `zh_v7_world_${process.pid}_${randomUUID().replaceAll("-", "")}`;
const installer = readFileSync(path.join(root, "db/install/v7-data-rpc-contract.sql"), "utf8");
const workflow = JSON.parse(readFileSync(path.join(root, "docs/后端/n8n/世界设定生成助手.json"), "utf8"));
const workflowQuery = workflow.nodes.find((node) => node.name === "Call World RPC")?.parameters?.query;

assert.match(database, /^zh_v7_world_[a-zA-Z0-9_]+$/);
assert.notEqual(database, "zh_narrative");
assert.equal(typeof workflowQuery, "string");

let databaseCreated = false;
let postgresUser;
let operatorId;
let runtimeAvailable = true;
let runtimeUnavailableReason = "";

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

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function rpc(name, payload) {
  return JSON.parse(sql(`SELECT public.${name}(${sqlText(JSON.stringify(payload))}::jsonb)`));
}

function workflowCall(payload) {
  const statement = workflowQuery
    .replace("$1::jsonb", `${sqlText(JSON.stringify(payload))}::jsonb`)
    .replace(/;\s*$/, "");
  return JSON.parse(sql(statement));
}

function character(clientRef, name, charType) {
  return {
    client_ref: clientRef,
    char_name: name,
    char_type: charType,
    five_layers_json: {
      L0: { agency: 0 },
      L1: { desire: "Protect the promise", fear: "Lose the truth", core_motivation: "Choose responsibly" },
      L2: { abilities: [], costs: [], resources: [] },
      L3: { alliances: [], oppositions: [], entanglements: [], relation_summary: {} },
    },
    knowledge_boundary_json: { knows: [], unknown: [], false_belief: [], reasonable_suspect: [] },
    arc_json: { direction: "growth", progress: 0 },
  };
}

function initialWorld(boardType, atomType) {
  return {
    board_type: boardType,
    atom_type: atomType,
    atom_key: `${boardType}.initial`,
    atom_value_jsonb: { title: `${boardType} initial` },
    affordance_dims: ["initial-design"],
    knowledge_boundary_json: {},
    apply_scope_json: {},
    violate_cost_json: {},
  };
}

function createBook() {
  const label = randomUUID();
  return rpc("rpc_create_book_project", {
    local_operator_id: operatorId,
    correlation_id: `world:create:${label}`,
    idempotency_key: `world-create-${label}`,
    title: `World module ${label}`,
    intent_json: {
      genre_main: "\u79d1\u5e7b",
      premise: "A complete initial world",
      target_emotion: "A documented emotional direction",
    },
    forbid_json: { lines: [] },
    selling_points_json: ["bounded conflict"],
    target_words: 100000,
    chapter_words: 2000,
    commercial_score: 8,
    characters: [character("hero", "Hero", "protagonist"), character("rival", "Rival", "antagonist")],
    relations: [{
      char_a_ref: "hero", char_b_ref: "rival", trust: -10, intimacy: 0,
      power_balance: 0, dependence: 0, hostility: 50, common_goal: 0,
      secret_known: 0, emotional_bond: -5, relation_type: "rivals",
      relation_hierarchy: "peers", change_event_json: { event: "initial-conflict" },
    }],
    world_states: [
      initialWorld("rule", "rule"), initialWorld("geography", "geo"),
      initialWorld("resource", "resource"), initialWorld("faction", "faction"),
      initialWorld("profession", "job"), initialWorld("monster", "monster"),
      initialWorld("event", "event"),
    ],
    world_bindings: [{
      from_ref_type: "world", from_ref_id: "rule.initial", to_ref_type: "world",
      to_ref_id: "geography.initial", binding_type: "governs", binding_strength: "strong",
    }],
    initial_memories: [{ char_ref: "hero", memory_type: "knowledge", memory_content: "The initial rule is known.", truth_status: "true" }],
    initial_l1a: {
      l1a_index: 1, l1a_name: "Initial conflict", scene_location: "Initial rule chamber",
      conflict_background: "The initial world resists the protagonist.",
      escalation_path: "The documented cost increases.", stakes: "The initial relationship.",
      irreversible_consequence: "The first choice cannot be undone.",
      plot_emotion_commit: { plot: "Pay the cost", emotion: "Resolve the fear" },
      arc_requirement: { direction: "growth" },
      info_reveal_boundary: { boundary: "Lead perception only" },
      role_arc_json: { hero: "growth", rival: "stable" },
      role_arcs: [], participant_char_refs: ["hero", "rival"],
    },
  });
}

function candidateAtoms(suffix = "candidate") {
  return [
    ["rule", "rule"], ["geography", "geo"], ["resource", "resource"],
    ["faction", "faction"], ["profession", "job"], ["monster", "monster"], ["event", "event"],
  ].map(([board_type, atom_type]) => ({
    client_ref: `${board_type}-ref`, board_type, atom_type,
    atom_key: `${board_type}.initial`,
    atom_value_jsonb: { title: `${board_type} ${suffix}`, detail: suffix },
    affordance_dims: ["documented-use"], source_type: "manual", setting_layer: "initial",
  }));
}

function dropTemporaryDatabase() {
  adminSql(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  databaseCreated = false;
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
    operatorId = rpc("rpc_get_local_operator", { correlation_id: "world:isolated:operator" }).local_operator_id;
  } catch (setupError) {
    if (databaseCreated) dropTemporaryDatabase();
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

test("WORLD workflow persists, edits, deletes, confirms, and rejects writes after lock", (t) => {
  if (!runtimeAvailable) return t.skip(runtimeUnavailableReason);
  const created = createBook();
  assert.equal(created.ok, true, JSON.stringify(created));

  const bookId = created.book_id;
  const worldAtoms = [...candidateAtoms(), {
    client_ref: "resource-secondary-ref", board_type: "resource", atom_type: "resource",
    atom_key: "resource.secondary", atom_value_jsonb: { title: "secondary resource", detail: "candidate" },
    affordance_dims: ["documented-use"], source_type: "manual", setting_layer: "initial",
  }];
  const worldBindings = [
    {
      client_ref: "binding-governs-ref",
      from_ref: "rule.initial", to_ref: "geography.initial",
      binding_type: "governs", binding_strength: "strong", setting_layer: "initial",
    },
    {
      client_ref: "binding-located-ref",
      from_ref: "resource.secondary", to_ref: "geography.initial",
      binding_type: "located-in", binding_strength: "medium", setting_layer: "initial",
    },
  ];
  const saveRequest = {
    action: "save_candidate",
    local_operator_id: operatorId,
    book_id: bookId,
    correlation_id: "world:save:one",
    atoms: worldAtoms,
    bindings: worldBindings,
  };
  const saved = workflowCall(saveRequest);
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(saved.result.status, "candidate_saved");
  assert.equal(saved.result.world_candidate_ids.length, 8);
  assert.equal(saved.result.binding_candidate_ids.length, 2);

  const editedAtoms = structuredClone(worldAtoms);
  editedAtoms.find((atom) => atom.atom_key === "rule.initial").atom_value_jsonb.detail = "edited-before-confirm";
  const editedBindings = structuredClone(worldBindings);
  editedBindings.find((binding) => binding.binding_type === "located-in").binding_strength = "weak";
  const edited = workflowCall({ ...saveRequest, correlation_id: "world:save:edited", atoms: editedAtoms, bindings: editedBindings });
  assert.equal(edited.ok, true, JSON.stringify(edited));
  assert.deepEqual(edited.result.world_candidate_ids.toSorted(), saved.result.world_candidate_ids.toSorted());
  assert.deepEqual(edited.result.binding_candidate_ids.toSorted(), saved.result.binding_candidate_ids.toSorted());
  assert.equal(Number(sql(`SELECT count(*) FROM public.world_state WHERE book_id=${sqlText(bookId)} AND NOT is_formal AND is_valid AND NOT is_shadow`)), 8);
  assert.equal(Number(sql(`SELECT count(*) FROM public.world_binding WHERE book_id=${sqlText(bookId)} AND NOT is_formal AND is_valid AND NOT is_shadow`)), 2);

  const candidateRead = workflowCall({
    action: "read_versions", local_operator_id: operatorId, book_id: bookId, correlation_id: "world:read:candidate",
  });
  const candidate = candidateRead.result.versions.find((version) => version.state === "candidate");
  assert.ok(candidate);
  assert.equal(candidate.atoms.length, 8);
  assert.equal(candidate.atoms.find((atom) => atom.atom_key === "rule.initial").atom_value_jsonb.detail, "edited-before-confirm");
  assert.equal(candidate.bindings.find((binding) => binding.binding_type === "located-in").binding_strength, "weak");
  assert.deepEqual(candidate.world_candidate_ids.toSorted(), edited.result.world_candidate_ids.toSorted());

  const confirmed = workflowCall({
    action: "confirm", local_operator_id: operatorId, book_id: bookId,
    correlation_id: "world:confirm:one", idempotency_key: "world-confirm-one",
    world_candidate_ids: candidate.world_candidate_ids,
    binding_candidate_ids: candidate.binding_candidate_ids,
  });
  assert.equal(confirmed.ok, true, JSON.stringify(confirmed));
  assert.equal(confirmed.result.ids.world_ids.length, 8);

  const formalRead = workflowCall({
    action: "read_versions", local_operator_id: operatorId, book_id: bookId, correlation_id: "world:read:formal",
  });
  assert.equal(formalRead.result.current_snapshot_key, "formal:current");
  const firstFormal = formalRead.result.versions.find((version) => version.state === "formal");
  assert.equal(firstFormal.atoms.length, 8);
  const priorFormalHistory = formalRead.result.versions.filter((version) => version.state === "history");
  assert.equal(priorFormalHistory.length, 1);
  assert.equal(priorFormalHistory[0].atoms.length, 7);

  const deletedWorldId = firstFormal.atoms.find((atom) => atom.atom_key === "resource.secondary").id;
  const automaticallyInvalidatedBindingId = firstFormal.bindings.find((binding) => binding.binding_type === "located-in").id;
  const remainingAtoms = editedAtoms.filter((atom) => atom.atom_key !== "resource.secondary");
  const remainingBindings = editedBindings.filter((binding) => binding.binding_type !== "located-in");
  const deletionSaved = workflowCall({
    ...saveRequest,
    correlation_id: "world:save:delete-world",
    atoms: remainingAtoms,
    bindings: remainingBindings,
  });
  assert.equal(deletionSaved.ok, true, JSON.stringify(deletionSaved));
  const deletionRead = workflowCall({
    action: "read_versions", local_operator_id: operatorId, book_id: bookId, correlation_id: "world:read:delete-world",
  });
  const deletionCandidate = deletionRead.result.versions.find((version) => version.state === "candidate");
  assert.deepEqual(deletionCandidate.delete_world_ids, [deletedWorldId]);
  assert.deepEqual(deletionCandidate.delete_world_binding_ids, []);
  assert.equal(deletionCandidate.atoms.some((atom) => atom.atom_key === "resource.secondary"), false);

  const deletionConfirmed = workflowCall({
    action: "confirm", local_operator_id: operatorId, book_id: bookId,
    correlation_id: "world:confirm:delete-world", idempotency_key: "world-confirm-delete-world",
    world_candidate_ids: deletionCandidate.world_candidate_ids,
    binding_candidate_ids: deletionCandidate.binding_candidate_ids,
    delete_world_ids: deletionCandidate.delete_world_ids,
  });
  assert.equal(deletionConfirmed.ok, true, JSON.stringify(deletionConfirmed));
  assert.deepEqual(deletionConfirmed.result.ids.deleted_world_ids, [deletedWorldId]);
  assert.deepEqual(deletionConfirmed.result.ids.invalidated_world_binding_ids, [automaticallyInvalidatedBindingId]);

  const bindingRemovalSaved = workflowCall({
    ...saveRequest,
    correlation_id: "world:save:delete-binding",
    atoms: remainingAtoms,
    bindings: [],
  });
  assert.equal(bindingRemovalSaved.ok, true, JSON.stringify(bindingRemovalSaved));
  const bindingRemovalRead = workflowCall({
    action: "read_versions", local_operator_id: operatorId, book_id: bookId, correlation_id: "world:read:delete-binding",
  });
  const bindingRemovalCandidate = bindingRemovalRead.result.versions.find((version) => version.state === "candidate");
  assert.equal(bindingRemovalCandidate.delete_world_ids.length, 0);
  assert.equal(bindingRemovalCandidate.delete_world_binding_ids.length, 1);
  const bindingRemovalConfirmed = workflowCall({
    action: "confirm", local_operator_id: operatorId, book_id: bookId,
    correlation_id: "world:confirm:delete-binding", idempotency_key: "world-confirm-delete-binding",
    world_candidate_ids: bindingRemovalCandidate.world_candidate_ids,
    binding_candidate_ids: bindingRemovalCandidate.binding_candidate_ids,
    delete_world_binding_ids: bindingRemovalCandidate.delete_world_binding_ids,
  });
  assert.equal(bindingRemovalConfirmed.ok, true, JSON.stringify(bindingRemovalConfirmed));
  assert.deepEqual(bindingRemovalConfirmed.result.ids.deleted_world_binding_ids, bindingRemovalCandidate.delete_world_binding_ids);
  assert.equal(Number(sql(`SELECT count(*) FROM public.world_binding WHERE book_id=${sqlText(bookId)} AND is_formal AND is_valid AND NOT is_shadow`)), 0);

  const beforeLockedSave = Number(sql(`SELECT count(*) FROM public.world_state WHERE book_id=${sqlText(bookId)} AND NOT is_formal AND is_valid AND NOT is_shadow`));
  sql(`SELECT public.v7_enable_internal_write(); UPDATE public.l1a_unit SET status='finalized', confirmation_status='creator_confirmed', is_formal=true, is_locked=true WHERE id=${sqlText(created.ids.initial_l1a_id)}`);
  const locked = workflowCall({ ...saveRequest, correlation_id: "world:save:locked", atoms: candidateAtoms("locked-attempt") });
  assert.equal(locked.ok, false);
  assert.equal(locked.redacted_error.code, "DESIGN_LOCKED");
  const afterLockedSave = Number(sql(`SELECT count(*) FROM public.world_state WHERE book_id=${sqlText(bookId)} AND NOT is_formal AND is_valid AND NOT is_shadow`));
  assert.equal(afterLockedSave, beforeLockedSave);
});

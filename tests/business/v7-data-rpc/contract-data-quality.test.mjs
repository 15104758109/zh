import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { docker, dockerLong, isDockerUnavailable, runtimeUnavailableMessage } from "../../support/docker-runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const container = process.env.ZH_V7_POSTGRES_CONTAINER ?? "n8n-pgvector";
const database = `zh_v7_contract_quality_${process.pid}_${randomUUID().replaceAll("-", "")}`;
const installer = readFileSync(path.join(root, "db/install/v7-data-rpc-contract.sql"), "utf8");
const CASES = Object.freeze([
  "p0-empty",
  "p0-null",
  "p0-route-empty",
  "p0-valid",
  "p0-rewrite",
  "continuation",
  "reader-evidence",
  "commercial-evidence",
  "editorial-boundary",
  "editorial-empty-fix",
  "editorial-null-fix",
  "archive-candidate-n",
]);

assert.match(database, /^zh_v7_contract_quality_[a-zA-Z0-9_]+$/);
assert.notEqual(database, "zh_narrative", "contract regression tests must never target the live database");

let postgresUser;
let databaseCreated = false;

function key(label) {
  return `${label}-${randomUUID()}`;
}

function adminSql(statement) {
  return dockerLong([
    "exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-q",
    "-U", postgresUser, "-d", "postgres",
  ], { input: statement });
}

function sql(statement) {
  return docker([
    "exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-q",
    "-U", postgresUser, "-d", database, "-At",
  ], { input: statement }).trim();
}

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function rpc(name, payload) {
  return JSON.parse(sql(`SELECT public.${name}(${sqlText(JSON.stringify(payload))}::jsonb)`));
}

function errorCode(response) {
  return response?.error?.code;
}

function expectError(response, code) {
  assert.equal(response?.ok, false, JSON.stringify(response));
  if (code) assert.equal(errorCode(response), code, JSON.stringify(response));
}

function expectOk(response) {
  assert.equal(response?.ok, true, JSON.stringify(response));
  return response;
}

function dropTemporaryDatabase() {
  adminSql(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  databaseCreated = false;
}

function initialBookRequest(operatorId) {
  const requiredWorldFields = {
    rule: { violate_cost: "A documented cost applies.", apply_scope: "The initial threshold.", rule_type: "constraint" },
    geography: { danger_level: "medium", location_text: "The documented threshold." },
    resource: { scarcity_level: "limited", usability: "available" },
    faction: { faction_status: "active", stance: "neutral" },
    profession: { cost_mechanism: "documented cost", is_system: false },
    monster: { threat_level: "low", counter_text: "Use the documented resource." },
    event: { event_era: "initial" },
  };
  const worldStates = [
    ["rule", "rule"], ["geography", "geo"], ["resource", "resource"],
    ["faction", "faction"], ["profession", "job"], ["monster", "monster"], ["event", "event"],
  ].map(([boardType, atomType]) => ({
    board_type: boardType,
    atom_type: atomType,
    atom_key: `${boardType}.initial`,
    atom_value_jsonb: { name: `${boardType} initial fact`, ...requiredWorldFields[boardType] },
    affordance_dims: ["documented-use"],
  }));
  return {
    local_operator_id: operatorId,
    correlation_id: key("create"),
    idempotency_key: key("create"),
    title: "Contract quality fixture",
    intent_json: {
      genre_main: "\u79d1\u5e7b",
      premise: "A bounded contract regression fixture",
      target_emotion: "A documented emotional direction",
    },
    forbid_json: { lines: [] },
    selling_points_json: ["A bounded contract regression fixture"],
    target_words: 100000,
    chapter_words: 2000,
    characters: [{
      client_ref: "lead",
      char_name: "Lead",
      char_type: "protagonist",
      five_layers_json: {
        L0: { "\u4e3b\u4f53\u80fd\u52a8\u6027": 0 },
        L1: { desire: "Protect the promise", fear: "Lose the truth", core_motivation: "Choose responsibly" },
        L2: { abilities: [], costs: [], resources: [] },
        L3: { alliances: [], oppositions: [], entanglements: [], relation_summary: {} },
      },
      knowledge_boundary_json: { knows: [], unknown: [], false_belief: [], reasonable_suspect: [] },
      arc_json: { direction: "growth", progress: 0 },
    }],
    relations: [],
    world_states: worldStates,
    world_bindings: [],
    initial_l1a: {
      l1a_index: 1,
      l1a_name: "The first bounded choice",
      scene_location: "The documented threshold",
      conflict_background: "The documented world resists the lead.",
      escalation_path: "The cost becomes visible.",
      stakes: "The lead can lose the only safe route.",
      irreversible_consequence: "The old route cannot be restored.",
      plot_emotion_commit: { promise: "pressure then choice" },
      arc_requirement: { direction: "growth" },
      info_reveal_boundary: { boundary: "Only reveal perceived facts" },
      role_arc_json: { lead: "growth" },
      participant_char_refs: ["lead"],
    },
  };
}

function particle(id, leadId) {
  return {
    particle_id: id,
    content: "The lead encounters the documented cost.",
    type: "truth",
    emotion_phase: "pressure",
    staged_task: "Resolve the documented choice",
    reveal_to: [leadId],
    assigned_to_role_type: "protagonist",
    involved_chars: ["lead"],
    required_chars: ["lead"],
    source_field: "plot_emotion_commit",
    purpose: "Complete the chapter target",
    lead_id: leadId,
  };
}

function chapterPlan(index, leadId) {
  const first = `particle-${index}-1`;
  const second = `particle-${index}-2`;
  return {
    chapter_index: index,
    title: `Contract chapter ${index}`,
    target_snapshot_json: {
      core_plot_tasks: [{ task_id: `plot-task-${index}`, description: "Complete both particles" }],
      emotion_goals: [{ goal_id: `emotion-goal-${index}`, description: "Pressure then choice" }],
      hook_tasks: [],
      pov_declaration: {
        pov_char: "lead",
        switch_rule: "无",
        pov_boundaries: { can_perceive: [], can_misjudge: [], must_ignore: [] },
      },
      forbid_content: [],
      scene_condition_package: {
        scene_location: "The documented threshold",
        participant_chars: [leadId],
        rule_locks: [],
        scene_affordance: [{ item_code: "resource.initial", available: true, functional: true, functions: ["documented-use"] }],
        available_resource_codes: ["resource.initial"],
        info_reveal_candidates: [],
        chain_reaction_candidates: [],
        scene_constraints: [],
        forbid_lines_active: [],
        materialize_notes: [],
      },
      particles_json: [particle(first, leadId), particle(second, leadId)],
    },
    chapter_implementation_json: {
      execution_steps: [{ step_id: `scene-${index}`, core_particles: [first, second] }],
      lens_order: [{ pov: "lead", sensory: "视觉" }],
      dialogue_plan: [
        { unit_id: `dialogue-${index}-1`, speaker: "lead", listener: "lead", primary_function: "D-01", secondary_function: "无" },
        { unit_id: `dialogue-${index}-2`, speaker: "lead", listener: "lead", primary_function: "D-02", secondary_function: "无" },
        { unit_id: `dialogue-${index}-3`, speaker: "lead", listener: "lead", primary_function: "D-03", secondary_function: "无" },
      ],
      dialogue_coverage: { "D-01": 1, "D-02": 1, "D-03": 1, "D-04": 0, "D-05": 0, "D-06": 0, "D-07": 0, "D-08": 0 },
    },
    exception_summary_jsonb: { deferred_tasks: [], data_debt: [], conflict_deadlocks: [] },
  };
}

function convergence(id, completed) {
  return {
    particle_id: id,
    particle_status: "completed",
    events_in_round: [{ event_id: `${id}-event`, description: "The documented event occurred." }],
    particle_completion_evidence: [{ evidence_id: `${id}-evidence`, fact: "The target event occurred." }],
    particles_completed: completed,
    remaining_particles: completed === 2 ? 0 : 1,
    deduction_complete: completed === 2,
  };
}

function emptyCandidateTruthLedger() {
  return {
    schema_version: 1,
    world_changes: [],
    character_live_state_changes: [],
    relation_changes: [],
    memories: [],
  };
}

function plotSnapshot(index, leadId) {
  return {
    deduction_input_snapshot: {
      particles: [
        particle(`particle-${index}-1`, leadId),
        particle(`particle-${index}-2`, leadId),
      ],
      participating_chars: [leadId],
    },
    particles_records: [convergence(`particle-${index}-1`, 1), convergence(`particle-${index}-2`, 2)],
    candidate_truth_ledger: emptyCandidateTruthLedger(),
    chapter_summary: { completed_particles: 2, summary: "Both documented particles completed." },
  };
}

function createFixture() {
  const operatorId = expectOk(rpc("rpc_get_local_operator", { correlation_id: key("operator") })).local_operator_id;
  const created = expectOk(rpc("rpc_create_book_project", initialBookRequest(operatorId)));
  const bookId = created.book_id;
  const initialL1aId = created.ids.initial_l1a_id;
  const leadId = sql(`SELECT id FROM public.character WHERE book_id=${sqlText(bookId)} AND char_name='Lead'`);
  const generated = expectOk(rpc("rpc_generate_l1a_conflicts", {
    local_operator_id: operatorId,
    book_id: bookId,
    idempotency_key: key("generate"),
    candidates: [{
      l1a_name: "A bounded generated choice",
      scene_location: "The documented threshold",
      conflict_background: "The same formal design produces a bounded conflict.",
      escalation_path: "The visible cost increases.",
      stakes: "The lead must preserve the documented promise.",
      irreversible_consequence: "The alternative route closes.",
      plot_emotion_commit: { promise: "pressure then responsible choice" },
      arc_requirement: { direction: "growth" },
      info_reveal_boundary: { boundary: "Only perceived facts" },
      role_arc_json: { lead: "growth" },
      world_resistance_refs: [],
      participant_chars_json: [leadId],
    }],
  }));
  expectOk(rpc("rpc_finalize_l1a", {
    local_operator_id: operatorId,
    book_id: bookId,
    ordered_l1a_ids: [initialL1aId, generated.ids.l1a_candidate_ids[0]],
    design_fingerprint: generated.state.design_fingerprint,
    idempotency_key: key("finalize-l1a"),
  }));

  const persisted = expectOk(rpc("rpc_persist_chapter_execution_plan", {
    local_operator_id: operatorId,
    book_id: bookId,
    l1a_id: initialL1aId,
    idempotency_key: key("chapter-plan"),
    chapter_plans: CASES.map((_, index) => chapterPlan(index + 1, leadId)),
  }));
  const candidates = persisted.ids.chapter_versions.map((version, index) => ({
    chapterId: persisted.ids.chapter_ids[index],
    versionId: version.chapter_version_id,
    index: index + 1,
  }));
  expectOk(rpc("rpc_finalize_deduction_snapshot", {
    local_operator_id: operatorId,
    book_id: bookId,
    l1a_unit_id: initialL1aId,
    idempotency_key: key("deduction-snapshot"),
    chapters: candidates.map((candidate) => ({
      chapter_id: candidate.chapterId,
      chapter_version_id: candidate.versionId,
      candidate_plot_sim_json: plotSnapshot(candidate.index, leadId),
      deduction_progress_json: {
        current_particle_index: 2,
        token_consumed: 100,
        remaining_particles: 0,
        deduction_complete: true,
        reject_count: 0,
      },
    })),
  }));
  for (const candidate of candidates) {
    expectOk(rpc("rpc_persist_candidate_text", {
      local_operator_id: operatorId,
      book_id: bookId,
      chapter_id: candidate.chapterId,
      chapter_version_id: candidate.versionId,
      candidate_text: `Candidate text for contract case ${candidate.index}.`,
      idempotency_key: key(`candidate-text-${candidate.index}`),
    }));
  }
  return { operatorId, bookId, l1aUnitId: initialL1aId, candidates };
}

function objectivePayload(fixture, candidate, label, audit) {
  return {
    local_operator_id: fixture.operatorId,
    book_id: fixture.bookId,
    chapter_id: candidate.chapterId,
    chapter_version_id: candidate.versionId,
    idempotency_key: key(label),
    audit,
    assets: [],
  };
}

function auditedHandoff(formalizationEligible) {
  return {
    package_schema_version: 1,
    formalization_eligible: formalizationEligible,
    world_changes: [],
    character_live_state_changes: [],
    relation_changes: [],
    memories: [],
    narrative_assets: [],
  };
}

function validObjective(fixture, candidate, label) {
  return objectivePayload(fixture, candidate, label, {
    has_p0_blocker: false,
    p0_items_json: [],
    audit_findings_jsonb: { consistency: "pass" },
    return_route_suggestion_jsonb: {},
    audited_handoff_package_jsonb: auditedHandoff(true),
  });
}

function validP0Objective(fixture, candidate, label) {
  return objectivePayload(fixture, candidate, label, {
    has_p0_blocker: true,
    p0_items_json: [{
      dimension: "consistency",
      evidence: "The candidate diverges from the locked particle fact.",
      affected_entities: ["particle-1"],
    }],
    audit_findings_jsonb: { consistency: { pass: false, evidence: "The candidate diverges." } },
    return_route_suggestion_jsonb: {
      reason: "Rewrite the candidate to preserve the locked particle fact.",
      particle_id: "particle-1",
    },
    audited_handoff_package_jsonb: auditedHandoff(false),
  });
}

function reviewPayload(fixture, candidate, phase, label, score) {
  return {
    local_operator_id: fixture.operatorId,
    book_id: fixture.bookId,
    chapter_id: candidate.chapterId,
    chapter_version_id: candidate.versionId,
    phase,
    score_json: score,
    idempotency_key: key(label),
  };
}

function validScore() {
  return { immersion: { score: 8, evidence: "The scene remains clear and emotionally grounded." } };
}

function prepareReturnCandidate(fixture, candidate, label) {
  expectOk(rpc("rpc_confirm_audit_result", validObjective(fixture, candidate, `${label}-objective`)));
  expectOk(rpc("rpc_record_chapter_review_evidence", reviewPayload(fixture, candidate, "reader", `${label}-reader`, validScore())));
  expectOk(rpc("rpc_record_chapter_review_evidence", reviewPayload(fixture, candidate, "commercial", `${label}-commercial`, validScore())));
  return expectOk(rpc("rpc_record_chapter_review_evidence", {
    local_operator_id: fixture.operatorId,
    book_id: fixture.bookId,
    chapter_id: candidate.chapterId,
    chapter_version_id: candidate.versionId,
    phase: "editorial",
    decision_json: { verdict: "N", force_manual: false, reject_count_observed: 0 },
    fix_instruction_json: { instruction: "Rewrite expression without changing locked facts." },
    creator_confirmed: false,
    idempotency_key: key(`${label}-editorial`),
  }));
}

test("V7 latest-record selectors resolve created_at ties by id", () => {
  const nondeterministic = [
    ...installer.matchAll(/ORDER BY created_at DESC(?!\s*,\s*id DESC)/g),
  ];
  assert.equal(nondeterministic.length, 0, "every latest-record selector needs created_at DESC, id DESC");
});

test("V7 B5-B8 data-quality gates reject malformed audit and return evidence", { timeout: 120_000 }, async (t) => {
  try {
    postgresUser = docker(["exec", container, "sh", "-lc", "printf '%s' \"$POSTGRES_USER\""]).trim();
    if (!postgresUser) throw new Error("PostgreSQL runtime unavailable: POSTGRES_USER missing");
    adminSql(`CREATE DATABASE "${database}"`);
    databaseCreated = true;
    dockerLong([
      "exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-q",
      "-U", postgresUser, "-d", database,
    ], { input: installer });
    const fixture = createFixture();
    const candidate = (label) => fixture.candidates[CASES.indexOf(label)];

    await t.test("objective P0 details must be non-empty", () => {
      const empty = rpc("rpc_confirm_audit_result", objectivePayload(fixture, candidate("p0-empty"), "p0-empty", {
        has_p0_blocker: true,
        p0_items_json: [],
        audit_findings_jsonb: { consistency: { pass: false, evidence: "A P0 exists." } },
        return_route_suggestion_jsonb: { reason: "Rewrite the candidate.", particle_id: "particle-1" },
      }));
      expectError(empty, "AUDIT_INCOMPLETE");

      const nullable = rpc("rpc_confirm_audit_result", objectivePayload(fixture, candidate("p0-null"), "p0-null", {
        has_p0_blocker: true,
        p0_items_json: null,
        audit_findings_jsonb: { consistency: { pass: false, evidence: "A P0 exists." } },
        return_route_suggestion_jsonb: { reason: "Rewrite the candidate.", particle_id: "particle-1" },
      }));
      expectError(nullable, "AUDIT_INCOMPLETE");
    });

    await t.test("objective P0 return suggestion must be non-empty and linked", () => {
      const emptyRoute = rpc("rpc_confirm_audit_result", objectivePayload(fixture, candidate("p0-route-empty"), "p0-route-empty", {
        has_p0_blocker: true,
        p0_items_json: [{ dimension: "consistency", evidence: "A P0 exists.", affected_entities: ["particle-1"] }],
        audit_findings_jsonb: { consistency: { pass: false, evidence: "A P0 exists." } },
        return_route_suggestion_jsonb: {},
      }));
      expectError(emptyRoute, "AUDIT_INCOMPLETE");
      expectOk(rpc("rpc_confirm_audit_result", validP0Objective(fixture, candidate("p0-valid"), "p0-valid")));
    });

    await t.test("objective audit result accepts only the V7 P0, P1, or passing tuple", () => {
      const target = candidate("p0-empty");
      const base = {
        audit_findings_jsonb: { consistency: { pass: true, evidence: "The candidate matches the locked facts." } },
        audited_handoff_package_jsonb: auditedHandoff(true),
      };
      const stringBoolean = rpc("rpc_confirm_audit_result", objectivePayload(fixture, target, "tuple-string-boolean", {
        ...base,
        has_p0_blocker: "false",
        p0_items_json: [],
        return_route_suggestion_jsonb: {},
      }));
      expectError(stringBoolean, "AUDIT_INCOMPLETE");

      const passingWithP0Items = rpc("rpc_confirm_audit_result", objectivePayload(fixture, target, "tuple-pass-p0-items", {
        ...base,
        has_p0_blocker: false,
        p0_items_json: [{ opaque: "P0 still exists" }],
        return_route_suggestion_jsonb: {},
      }));
      expectError(passingWithP0Items, "AUDIT_INCOMPLETE");

      const passingWithoutRouteObject = rpc("rpc_confirm_audit_result", objectivePayload(fixture, target, "tuple-pass-missing-route", {
        ...base,
        has_p0_blocker: false,
        p0_items_json: [],
      }));
      expectError(passingWithoutRouteObject, "AUDIT_INCOMPLETE");

      const p1WithP0Items = rpc("rpc_confirm_audit_result", objectivePayload(fixture, target, "tuple-p1-p0-items", {
        ...base,
        has_p0_blocker: false,
        p0_items_json: [{ opaque: "P0 item cannot accompany P1" }],
        return_route_suggestion_jsonb: { reason: "Rewrite through FP009-01." },
        audited_handoff_package_jsonb: auditedHandoff(false),
      }));
      expectError(p1WithP0Items, "AUDIT_INCOMPLETE");

      const p0MarkedEligible = rpc("rpc_confirm_audit_result", objectivePayload(fixture, target, "tuple-p0-eligible", {
        ...base,
        has_p0_blocker: true,
        p0_items_json: [{ opaque: "P0 exists" }],
        return_route_suggestion_jsonb: { reason: "Rewrite through FP009-01." },
      }));
      expectError(p0MarkedEligible, "AUDIT_HANDOFF_ELIGIBILITY_REJECTED");

      const p1MarkedEligible = rpc("rpc_confirm_audit_result", objectivePayload(fixture, target, "tuple-p1-eligible", {
        ...base,
        has_p0_blocker: false,
        p0_items_json: [],
        return_route_suggestion_jsonb: { reason: "Rewrite through FP009-01." },
      }));
      expectError(p1MarkedEligible, "AUDIT_HANDOFF_ELIGIBILITY_REJECTED");

      const passingMarkedIneligible = rpc("rpc_confirm_audit_result", objectivePayload(fixture, target, "tuple-pass-ineligible", {
        ...base,
        has_p0_blocker: false,
        p0_items_json: [],
        return_route_suggestion_jsonb: {},
        audited_handoff_package_jsonb: auditedHandoff(false),
      }));
      expectError(passingMarkedIneligible, "AUDIT_HANDOFF_ELIGIBILITY_REJECTED");

      const validP1 = rpc("rpc_confirm_audit_result", objectivePayload(fixture, target, "tuple-valid-p1", {
        ...base,
        has_p0_blocker: false,
        p0_items_json: [],
        return_route_suggestion_jsonb: { reason: "Rewrite through FP009-01." },
        audited_handoff_package_jsonb: auditedHandoff(false),
      }));
      expectOk(validP1);
    });

    await t.test("objective return rewrites the same candidate and keeps prior evidence out of the next audit", () => {
      const target = candidate("p0-rewrite");
      const originalText = sql(`SELECT prose_text FROM public.chapter_version WHERE id=${sqlText(target.versionId)}`);
      expectOk(rpc("rpc_confirm_audit_result", validP0Objective(fixture, target, "p0-rewrite-blocked")));

      const rewrittenText = "Rewritten candidate prose still follows the same locked deduction facts.";
      expectOk(rpc("rpc_persist_candidate_text", {
        local_operator_id: fixture.operatorId,
        book_id: fixture.bookId,
        chapter_id: target.chapterId,
        chapter_version_id: target.versionId,
        candidate_text: rewrittenText,
        idempotency_key: key("p0-rewrite-prose"),
      }));
      expectOk(rpc("rpc_confirm_audit_result", validObjective(fixture, target, "p0-rewrite-passed")));

      assert.equal(Number(sql(`SELECT count(*) FROM public.chapter_version WHERE id=${sqlText(target.versionId)} AND version_state='candidate' AND is_valid AND NOT is_shadow`)), 1);
      assert.equal(sql(`SELECT prose_text FROM public.chapter_version WHERE id=${sqlText(target.versionId)}`), rewrittenText);
      assert.equal(Number(sql(`SELECT count(*) FROM public.audit_attempt_log WHERE chapter_version_id=${sqlText(target.versionId)} AND audit_type='objective' AND is_valid AND NOT is_shadow AND candidate_text_snapshot=${sqlText(originalText)}`)), 1);
      assert.equal(Number(sql(`SELECT count(*) FROM public.audit_attempt_log WHERE chapter_version_id=${sqlText(target.versionId)} AND audit_type='objective' AND is_valid AND NOT is_shadow AND candidate_text_snapshot=${sqlText(rewrittenText)} AND NOT has_p0_blocker`)), 1);
    });

    await t.test("objective prose snapshot and return route are immutable evidence", () => {
      const target = candidate("p0-valid");
      const auditId = sql(`SELECT id FROM public.audit_attempt_log
        WHERE chapter_version_id=${sqlText(target.versionId)} AND audit_type='objective'
        ORDER BY created_at DESC, id DESC LIMIT 1`);
      assert.throws(() => sql(`BEGIN;
        SELECT public.v7_enable_internal_write();
        UPDATE public.audit_attempt_log
        SET candidate_text_snapshot = candidate_text_snapshot || ' tampered'
        WHERE id=${sqlText(auditId)};
        ROLLBACK;`), /V7_P0_AUDIT_IMMUTABLE/);
      assert.throws(() => sql(`BEGIN;
        SELECT public.v7_enable_internal_write();
        UPDATE public.audit_attempt_log
        SET return_route_suggestion_jsonb = '{}'::jsonb
        WHERE id=${sqlText(auditId)};
        ROLLBACK;`), /V7_P0_AUDIT_IMMUTABLE/);
    });

    await t.test("a formal chapter continuation records only the ordered next presentation request", () => {
      const target = candidate("continuation");
      expectOk(rpc("rpc_confirm_audit_result", validObjective(fixture, target, "continuation-objective")));
      for (const phase of ["reader", "commercial"]) {
        expectOk(rpc("rpc_record_chapter_review_evidence", reviewPayload(
          fixture,
          target,
          phase,
          `continuation-${phase}`,
          validScore(),
        )));
      }
      expectOk(rpc("rpc_record_chapter_review_evidence", {
        local_operator_id: fixture.operatorId,
        book_id: fixture.bookId,
        chapter_id: target.chapterId,
        chapter_version_id: target.versionId,
        phase: "editorial",
        decision_json: { verdict: "Y", force_manual: false, reject_count_observed: 0 },
        creator_confirmed: false,
        idempotency_key: key("continuation-editorial"),
      }));
      expectOk(rpc("rpc_commit_chapter", {
        local_operator_id: fixture.operatorId,
        book_id: fixture.bookId,
        chapter_id: target.chapterId,
        chapter_version_id: target.versionId,
        idempotency_key: key("continuation-formalize"),
      }));

      const continued = expectOk(rpc("rpc_continue_chapter", {
        local_operator_id: fixture.operatorId,
        book_id: fixture.bookId,
        chapter_id: target.chapterId,
        chapter_version_id: target.versionId,
        idempotency_key: key("continuation"),
      }));
      assert.equal(continued.state.action, "continue_next_chapter");
      assert.equal(continued.state.next_action, "present_next_chapter");
      assert.equal(continued.next_presentation_request.l1a_unit_id, fixture.l1aUnitId);
      assert.equal(continued.next_presentation_request.chapter_id, fixture.candidates[CASES.indexOf("reader-evidence")].chapterId);
      assert.equal(continued.next_presentation_request.chapter_version_id, fixture.candidates[CASES.indexOf("reader-evidence")].versionId);
      assert.equal(Number(sql(`SELECT count(*) FROM public.chapter_header WHERE id=${sqlText(target.chapterId)} AND status='confirmed' AND confirmation_status='creator_confirmed'`)), 1);
    });

    await t.test("reader evidence must include non-empty evidence text", () => {
      expectOk(rpc("rpc_confirm_audit_result", validObjective(fixture, candidate("reader-evidence"), "reader-objective")));
      const response = rpc("rpc_record_chapter_review_evidence", reviewPayload(
        fixture,
        candidate("reader-evidence"),
        "reader",
        "reader-empty-evidence",
        { immersion: { score: 8, evidence: "" } },
      ));
      expectError(response, "REVIEW_INCOMPLETE");
    });

    await t.test("commercial evidence must include non-empty evidence text", () => {
      expectOk(rpc("rpc_confirm_audit_result", validObjective(fixture, candidate("commercial-evidence"), "commercial-objective")));
      const response = rpc("rpc_record_chapter_review_evidence", reviewPayload(
        fixture,
        candidate("commercial-evidence"),
        "commercial",
        "commercial-empty-evidence",
        { commercial_fit: { score: 7, evidence: "" } },
      ));
      expectError(response, "REVIEW_INCOMPLETE");
    });

    await t.test("reader and commercial non-zero scalar scores cannot bypass evidence", () => {
      const reader = rpc("rpc_record_chapter_review_evidence", reviewPayload(
        fixture,
        candidate("reader-evidence"),
        "reader",
        "reader-scalar-evidence",
        { immersion: 8 },
      ));
      expectError(reader, "REVIEW_INCOMPLETE");
      const commercial = rpc("rpc_record_chapter_review_evidence", reviewPayload(
        fixture,
        candidate("commercial-evidence"),
        "commercial",
        "commercial-scalar-evidence",
        { commercial_fit: 7 },
      ));
      expectError(commercial, "REVIEW_INCOMPLETE");
    });

    await t.test("internal review evidence cannot write creator confirmation", () => {
      const response = rpc("rpc_record_chapter_review_evidence", {
        ...reviewPayload(
          fixture,
          candidate("reader-evidence"),
          "reader",
          "reader-creator-confirmed",
          validScore(),
        ),
        creator_confirmed: true,
      });
      expectError(response, "REVIEW_INCOMPLETE");
    });

    await t.test("editorial N must include a non-empty fix instruction", () => {
      const emptyCandidate = candidate("editorial-empty-fix");
      prepareReturnCandidate(fixture, emptyCandidate, "editorial-empty");
      const empty = rpc("rpc_record_chapter_review_evidence", {
        local_operator_id: fixture.operatorId,
        book_id: fixture.bookId,
        chapter_id: emptyCandidate.chapterId,
        chapter_version_id: emptyCandidate.versionId,
        phase: "editorial",
        decision_json: { verdict: "N", force_manual: false, reject_count_observed: 0 },
        fix_instruction_json: {},
        creator_confirmed: false,
        idempotency_key: key("editorial-empty-fix-retry"),
      });
      expectError(empty, "EDITORIAL_DECISION_INCOMPLETE");

      const nullCandidate = candidate("editorial-null-fix");
      prepareReturnCandidate(fixture, nullCandidate, "editorial-null");
      const nullable = rpc("rpc_record_chapter_review_evidence", {
        local_operator_id: fixture.operatorId,
        book_id: fixture.bookId,
        chapter_id: nullCandidate.chapterId,
        chapter_version_id: nullCandidate.versionId,
        phase: "editorial",
        decision_json: { verdict: "N", force_manual: false, reject_count_observed: 0 },
        fix_instruction_json: null,
        creator_confirmed: false,
        idempotency_key: key("editorial-null-fix-retry"),
      });
      expectError(nullable, "EDITORIAL_DECISION_INCOMPLETE");
    });

    await t.test("editorial writes preserve objective evidence and cannot override a P0", () => {
      const target = candidate("editorial-boundary");
      expectOk(rpc("rpc_confirm_audit_result", validObjective(fixture, target, "editorial-boundary-objective")));
      expectOk(rpc("rpc_record_chapter_review_evidence", reviewPayload(
        fixture,
        target,
        "reader",
        "editorial-boundary-reader",
        validScore(),
      )));
      expectOk(rpc("rpc_record_chapter_review_evidence", reviewPayload(
        fixture,
        target,
        "commercial",
        "editorial-boundary-commercial",
        validScore(),
      )));

      const editorialPayload = (label, decision) => ({
        local_operator_id: fixture.operatorId,
        book_id: fixture.bookId,
        chapter_id: target.chapterId,
        chapter_version_id: target.versionId,
        phase: "editorial",
        decision_json: decision,
        fix_instruction_json: decision.verdict === "N"
          ? { instruction: "Rewrite expression without changing locked facts." }
          : undefined,
        creator_confirmed: false,
        idempotency_key: key(label),
      });
      expectError(rpc("rpc_record_chapter_review_evidence", editorialPayload(
        "editorial-y-force-manual",
        { verdict: "Y", force_manual: true, reject_count_observed: 0 },
      )), "EDITORIAL_DECISION_INCOMPLETE");
      expectError(rpc("rpc_record_chapter_review_evidence", editorialPayload(
        "editorial-early-force-manual",
        { verdict: "N", force_manual: true, reject_count_observed: 0 },
      )), "EDITORIAL_DECISION_INCOMPLETE");
      expectError(rpc("rpc_record_chapter_review_evidence", editorialPayload(
        "editorial-third-return-without-stop",
        { verdict: "N", force_manual: false, reject_count_observed: 2 },
      )), "EDITORIAL_DECISION_INCOMPLETE");
      expectError(rpc("rpc_record_chapter_review_evidence", editorialPayload(
        "editorial-out-of-range-count",
        { verdict: "Y", force_manual: false, reject_count_observed: 3 },
      )), "EDITORIAL_DECISION_INCOMPLETE");
      expectError(rpc("rpc_record_chapter_review_evidence", editorialPayload(
        "editorial-valid-third-return-shape",
        { verdict: "N", force_manual: true, reject_count_observed: 2 },
      )), "REVIEW_STATE_STALE");

      const objectiveBefore = sql(`SELECT jsonb_build_object(
        'has_p0_blocker', has_p0_blocker,
        'p0_items_json', p0_items_json,
        'audit_findings_jsonb', audit_findings_jsonb,
        'return_route_suggestion_jsonb', return_route_suggestion_jsonb
      )::text FROM public.audit_attempt_log
      WHERE chapter_version_id=${sqlText(target.versionId)}
        AND audit_type='objective' AND is_valid AND NOT is_shadow
      ORDER BY created_at DESC, id DESC LIMIT 1`);
      const editorial = expectOk(rpc("rpc_record_chapter_review_evidence", {
        local_operator_id: fixture.operatorId,
        book_id: fixture.bookId,
        chapter_id: target.chapterId,
        chapter_version_id: target.versionId,
        phase: "editorial",
        decision_json: { verdict: "Y", force_manual: false, reject_count_observed: 0 },
        creator_confirmed: false,
        idempotency_key: key("editorial-boundary-editorial"),
      }));
      const objectiveAfter = sql(`SELECT jsonb_build_object(
        'has_p0_blocker', has_p0_blocker,
        'p0_items_json', p0_items_json,
        'audit_findings_jsonb', audit_findings_jsonb,
        'return_route_suggestion_jsonb', return_route_suggestion_jsonb
      )::text FROM public.audit_attempt_log
      WHERE chapter_version_id=${sqlText(target.versionId)}
        AND audit_type='objective' AND is_valid AND NOT is_shadow
      ORDER BY created_at DESC, id DESC LIMIT 1`);
      assert.equal(objectiveAfter, objectiveBefore);

      const editorialRow = JSON.parse(sql(`SELECT jsonb_build_object(
        'phase', phase,
        'decision_json', decision_json,
        'score_json', score_json,
        'fix_instruction_json', fix_instruction_json
      )::text FROM public.editor_log WHERE id=${sqlText(editorial.ids.editor_log_id)}`));
      assert.equal(editorialRow.phase, "editorial");
      assert.deepEqual(editorialRow.decision_json, {
        verdict: "Y",
        force_manual: false,
        reject_count_observed: 0,
      });
      assert.equal(editorialRow.score_json, null);
      assert.equal(editorialRow.fix_instruction_json, null);

      const p0Candidate = candidate("p0-valid");
      const p0Reader = rpc("rpc_record_chapter_review_evidence", reviewPayload(
        fixture,
        p0Candidate,
        "reader",
        "editorial-boundary-p0-reader",
        validScore(),
      ));
      expectError(p0Reader, "P0_BLOCKED");
      const blocked = rpc("rpc_record_chapter_review_evidence", {
        local_operator_id: fixture.operatorId,
        book_id: fixture.bookId,
        chapter_id: p0Candidate.chapterId,
        chapter_version_id: p0Candidate.versionId,
        phase: "editorial",
        decision_json: { verdict: "Y", force_manual: false, reject_count_observed: 0 },
        creator_confirmed: false,
        idempotency_key: key("editorial-boundary-p0-editorial"),
      });
      expectError(blocked, "P0_BLOCKED");
    });

    await t.test("candidate editorial N never shadows the candidate or its evidence", () => {
      const target = candidate("archive-candidate-n");
      prepareReturnCandidate(fixture, target, "archive-candidate-n");
      const before = JSON.parse(sql(`SELECT jsonb_build_object(
        'version_state', version_state,
        'is_valid', is_valid,
        'is_shadow', is_shadow,
        'prose_text', prose_text,
        'audit_evidence', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', id, 'is_valid', is_valid, 'is_shadow', is_shadow
        ) ORDER BY id), '[]'::jsonb) FROM public.audit_attempt_log
          WHERE chapter_version_id=${sqlText(target.versionId)}),
        'editorial_evidence', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', id, 'is_valid', is_valid, 'is_shadow', is_shadow
        ) ORDER BY id), '[]'::jsonb) FROM public.editor_log
          WHERE chapter_version_id=${sqlText(target.versionId)})
      )::text FROM public.chapter_version WHERE id=${sqlText(target.versionId)}`));
      const response = rpc("rpc_archive_shadow_version", {
        local_operator_id: fixture.operatorId,
        book_id: fixture.bookId,
        chapter_id: target.chapterId,
        chapter_version_id: target.versionId,
        idempotency_key: key("archive-candidate-n"),
      });
      expectError(response, "FORMAL_RETURN_REJECTED");
      const after = JSON.parse(sql(`SELECT jsonb_build_object(
        'version_state', version_state,
        'is_valid', is_valid,
        'is_shadow', is_shadow,
        'prose_text', prose_text,
        'audit_evidence', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', id, 'is_valid', is_valid, 'is_shadow', is_shadow
        ) ORDER BY id), '[]'::jsonb) FROM public.audit_attempt_log
          WHERE chapter_version_id=${sqlText(target.versionId)}),
        'editorial_evidence', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', id, 'is_valid', is_valid, 'is_shadow', is_shadow
        ) ORDER BY id), '[]'::jsonb) FROM public.editor_log
          WHERE chapter_version_id=${sqlText(target.versionId)})
      )::text FROM public.chapter_version WHERE id=${sqlText(target.versionId)}`));
      assert.deepEqual(after, before);
    });
  } catch (error) {
    if (!isDockerUnavailable(error)) throw error;
    return t.skip(runtimeUnavailableMessage(error, "PostgreSQL"));
  } finally {
    if (databaseCreated) dropTemporaryDatabase();
  }
});

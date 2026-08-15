import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { docker, dockerLong, isDockerUnavailable, runtimeUnavailableMessage } from "../../support/docker-runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const container = process.env.ZH_V7_POSTGRES_CONTAINER ?? "n8n-pgvector";
const database = `zh_v7_b5_b8_${process.pid}_${randomUUID().replaceAll("-", "")}`;
const installer = readFileSync(path.join(root, "db/install/v7-data-rpc-contract.sql"), "utf8");

assert.match(database, /^zh_v7_b5_b8_[a-zA-Z0-9_]+$/);
assert.notEqual(database, "zh_narrative", "the B5-B8 journey must never target the live product database");

let postgresUser;
let databaseCreated = false;

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

function count(table, predicate = "true") {
  return Number(sql(`SELECT count(*) FROM public.${table} WHERE ${predicate}`));
}

function errorCode(response) {
  return response.error?.code;
}

function dropTemporaryDatabase() {
  adminSql(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  databaseCreated = false;
}

function initialBookRequest(operatorId) {
  const valuesByBoard = {
    rule: { violate_cost: "resource loss", apply_scope: "the district", rule_type: "rationing" },
    geography: { danger_level: "high", location_text: "the documented threshold" },
    resource: { scarcity_level: "scarce", usability: "documented evidence" },
    faction: { faction_status: "stable", stance: "defensive" },
    profession: { cost_mechanism: "credibility", is_system: false },
    monster: { threat_level: "high", counter_text: "documented safeguards" },
    event: { event_era: "opening" },
  };
  const worldStates = [
    ["rule", "rule"],
    ["geography", "geo"],
    ["resource", "resource"],
    ["faction", "faction"],
    ["profession", "job"],
    ["monster", "monster"],
    ["event", "event"],
  ].map(([boardType, atomType]) => ({
      board_type: boardType,
      atom_type: atomType,
      atom_key: `${boardType}.initial`,
      atom_value_jsonb: { name: `${boardType} initial fact`, ...valuesByBoard[boardType] },
      affordance_dims: ["documented-use"],
    }));
  return {
    local_operator_id: operatorId,
    correlation_id: "b5-b8-create",
    idempotency_key: "b5-b8-create",
    title: "B5 B8 isolated journey",
    intent_json: {
      genre_main: "科幻",
      premise: "One documented single-chapter journey",
      target_emotion: "A documented emotional direction",
    },
    forbid_json: { lines: [] },
    selling_points_json: ["A causally closed single-chapter journey"],
    target_words: 100000,
    chapter_words: 2000,
    characters: [{
      client_ref: "lead",
      char_name: "Lead",
      char_type: "protagonist",
      five_layers_json: {
        L0: { "主体能动性": 0 },
        L1: { desire: "Protect the promise", fear: "Lose the truth", core_motivation: "Choose responsibly" },
        L2: { abilities: [], costs: [], resources: [] },
        L3: { alliances: [], oppositions: [], entanglements: [], relation_summary: {} },
      },
      knowledge_boundary_json: { knows: [], unknown: [], false_belief: [], reasonable_suspect: [] },
      arc_json: { direction: "growth", progress: 0 },
    }, {
      client_ref: "support",
      char_name: "Support",
      char_type: "supporting",
      five_layers_json: {
        L0: { "主体能动性": 0 },
        L1: { desire: "Keep the agreement", fear: "Lose the lead", core_motivation: "Protect the documented alliance" },
        L2: { abilities: [], costs: [], resources: [] },
        L3: { alliances: ["lead"], oppositions: [], entanglements: [], relation_summary: {} },
      },
      knowledge_boundary_json: { knows: [], unknown: [], false_belief: [], reasonable_suspect: [] },
      arc_json: { direction: "growth", progress: 0 },
    }],
    relations: [{
      char_a_ref: "lead",
      char_b_ref: "support",
      trust: 10,
      intimacy: 0,
      power_balance: 0,
      dependence: 0,
      hostility: 0,
      common_goal: 20,
      secret_known: 0,
      emotional_bond: 5,
      relation_type: "allies",
      relation_hierarchy: "peers",
      change_event_json: { event: "initial-alliance" },
    }],
    world_states: worldStates,
    world_bindings: [],
    initial_l1a: {
      l1a_index: 1,
      l1a_name: "The first irreversible choice",
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

test("B5-B8 existing RPCs preserve the documented single-chapter candidate journey", { timeout: 120_000 }, async (t) => {
  try {
    postgresUser = docker(["exec", container, "sh", "-lc", "printf '%s' \"$POSTGRES_USER\""]).trim();
    if (!postgresUser) throw new Error("PostgreSQL runtime unavailable: POSTGRES_USER missing");
    adminSql(`CREATE DATABASE "${database}"`);
    databaseCreated = true;
    dockerLong([
      "exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-q",
      "-U", postgresUser, "-d", database,
    ], { input: installer });

    const operatorId = rpc("rpc_get_local_operator", { correlation_id: "b5-b8-operator" }).local_operator_id;
    const created = rpc("rpc_create_book_project", initialBookRequest(operatorId));
    assert.equal(created.ok, true, JSON.stringify(created));
    const bookId = created.book_id;
    const l1aId = created.ids.initial_l1a_id;
    const leadId = sql(`SELECT id FROM public.character WHERE book_id=${sqlText(bookId)} AND char_name='Lead'`);
    const supportId = sql(`SELECT id FROM public.character WHERE book_id=${sqlText(bookId)} AND char_name='Support'`);
    const relationId = sql(`SELECT id FROM public.relation_state WHERE book_id=${sqlText(bookId)} AND char_a_id=${sqlText(leadId)} AND char_b_id=${sqlText(supportId)}`);
    const relationBefore = JSON.parse(sql(`SELECT jsonb_build_object(
      'trust', trust, 'intimacy', intimacy, 'power_balance', power_balance,
      'dependence', dependence, 'hostility', hostility, 'common_goal', common_goal,
      'secret_known', secret_known, 'emotional_bond', emotional_bond,
      'relation_type', relation_type, 'relation_hierarchy', relation_hierarchy,
      'relation_origin', relation_origin, 'relation_overview', relation_overview,
      'change_event_json', change_event_json
    ) FROM public.relation_state WHERE id=${sqlText(relationId)}`));
    const resourceWorldId = sql(`SELECT id FROM public.world_state WHERE book_id=${sqlText(bookId)} AND atom_key='resource.initial' AND is_formal AND is_valid AND NOT is_shadow`);
    const resourceWorldBefore = JSON.parse(sql(`SELECT atom_value_jsonb FROM public.world_state WHERE id=${sqlText(resourceWorldId)}`));
    const leadInitialProjection = JSON.parse(sql(`SELECT jsonb_build_object(
      'source', 'initial_live_state_projection',
      'five_layers_json', five_layers_json,
      'knowledge_boundary_json', knowledge_boundary_json
    ) FROM public.character WHERE id=${sqlText(leadId)}`));
    const generated = rpc("rpc_generate_l1a_conflicts", {
      local_operator_id: operatorId,
      book_id: bookId,
      idempotency_key: "b5-b8-generate-l1a",
      candidates: [{
        l1a_name: "A second documented choice",
        scene_location: "The documented threshold",
        conflict_background: "The same formal design produces another bounded conflict.",
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
    });
    assert.equal(generated.ok, true, JSON.stringify(generated));
    const generatedL1aId = generated.ids.l1a_candidate_ids[0];
    const finalized = rpc("rpc_finalize_l1a", {
      local_operator_id: operatorId,
      book_id: bookId,
      ordered_l1a_ids: [l1aId, generatedL1aId],
      design_fingerprint: generated.state.design_fingerprint,
      idempotency_key: "b5-b8-finalize-l1a",
    });
    assert.equal(finalized.ok, true, JSON.stringify(finalized));

    let chapterId;
    let candidateVersionId;
    let chapterId2;
    let candidateVersionId2;
    const particle = (id, content) => ({
      particle_id: id,
      content,
      type: "truth",
      emotion_phase: "pressure",
      staged_task: "Resolve the documented choice",
      reveal_to: [leadId],
      assigned_to_role_type: "protagonist",
      involved_chars: ["lead"],
      required_chars: ["lead"],
      source_field: "plot_emotion_commit",
      purpose: "Complete the chapter target",
    });
    const convergence = (id, completed, remaining) => ({
      particle_id: id,
      particle_status: "completed",
      events_in_round: [{ event_id: `event-${completed}`, description: `Documented completion ${completed}.` }],
      particle_completion_evidence: [{ evidence_id: `evidence-${completed}`, fact: "The target event occurred." }],
      particles_completed: completed,
      remaining_particles: remaining,
      deduction_complete: remaining === 0,
    });
    const emptyCandidateTruthLedger = () => ({
      schema_version: 1,
      world_changes: [],
      character_live_state_changes: [],
      relation_changes: [],
      memories: [],
    });
    const sceneConditionPackage = {
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
    };
    const deductionInputSnapshot = (prefix = "") => ({
      particles: [
        particle(`${prefix}particle-1`, `The ${prefix || "first "}documented pressure is deduced.`),
        particle(`${prefix}particle-2`, `The ${prefix || "first "}documented choice is deduced.`),
        particle(`${prefix}particle-3`, `The ${prefix || "first "}documented consequence is deduced.`),
      ],
      participating_chars: [{
        char_id: leadId,
        char_code: "lead",
        role_type: "protagonist",
        activation_reason: "required",
      }],
    });
    const plotSnapshot = {
      deduction_input_snapshot: deductionInputSnapshot(),
      particles_records: [convergence("particle-1", 1, 2), convergence("particle-2", 2, 1), convergence("particle-3", 3, 0)],
      candidate_truth_ledger: emptyCandidateTruthLedger(),
      chapter_summary: { completed_particles: 3, summary: "All three documented particles completed." },
    };
    const plotSnapshot2 = {
      deduction_input_snapshot: deductionInputSnapshot("chapter-2-"),
      particles_records: [convergence("chapter-2-particle-1", 1, 2), convergence("chapter-2-particle-2", 2, 1), convergence("chapter-2-particle-3", 3, 0)],
      candidate_truth_ledger: emptyCandidateTruthLedger(),
      chapter_summary: { completed_particles: 3, summary: "All three documented particles completed." },
    };
    const firstCandidateText = "候选正文只表达已锁定推演中发生的事实。";
    const candidateTruthLedger = () => ({
      schema_version: 1,
      world_changes: [{
        world_state_id: resourceWorldId,
        before: resourceWorldBefore,
        after: { ...resourceWorldBefore, last_formal_handoff: "stable" },
        event_ids: ["event-2"],
      }],
      character_live_state_changes: [{
        character_id: leadId,
        change_type: "goal_update",
        change_layer: 1,
        before: leadInitialProjection,
        after: {
          philosophy_live_json: { responsibility: "active" },
          emotion_state_json: { state: "resolute" },
          drive_live_json: { drive: "protect" },
          trigger_state_json: { trigger: "documented-cost" },
          goal_state_json: { goal: "preserve-route" },
          pressure_level: 3,
          current_goal_txt: "Preserve the documented route.",
          current_emo_tag: "resolute",
        },
        event_ids: ["event-2"],
        change_reason: "The locked second particle completed.",
      }],
      relation_changes: [{
        relation_state_id: relationId,
        char_a_id: leadId,
        char_b_id: supportId,
        before: relationBefore,
        after: { ...relationBefore, trust: relationBefore.trust + 5 },
        change_event: { event_id: "event-2", reason: "The alliance held under cost." },
        event_ids: ["event-2"],
      }],
      memories: [{
        character_id: leadId,
        memory_type: "event",
        memory_content: "The documented route held.",
        truth_status: "true",
        importance: 0.8,
        decay_rate: 0.1,
        event_ids: ["event-2"],
      }],
    });
    const auditedHandoff = (label) => ({
      package_schema_version: 1,
      formalization_eligible: true,
      world_changes: candidateTruthLedger().world_changes,
      character_live_state_changes: candidateTruthLedger().character_live_state_changes.map((entry) => ({
        ...entry,
        baseline_live_state_id: supportId,
      })),
      relation_changes: candidateTruthLedger().relation_changes,
      memories: candidateTruthLedger().memories,
      narrative_assets: [{ asset_ref: `${label}-asset` }],
    });
    plotSnapshot.candidate_truth_ledger = candidateTruthLedger();

    await t.test("B8 counts Han characters and punctuation without treating the chapter target as a gate", () => {
      assert.equal(Number(sql("SELECT public.v7_count_han_and_punctuation('重写只调整表达方式，仍然保持同一条锁定推演事实。')")), 24);
      assert.equal(Number(sql("SELECT public.v7_count_han_and_punctuation('ABC 123')")), 0);
    });

    await t.test("B5 produces one scoped chapter identity and candidate execution version atomically", () => {
      const beforeHeaders = count("chapter_header");
      const beforeVersions = count("chapter_version");
      const beforeLedger = count("product_request_log");
      const rejected = rpc("rpc_persist_chapter_execution_plan", {
        local_operator_id: randomUUID(),
        book_id: bookId,
        l1a_id: l1aId,
        idempotency_key: "b5-wrong-operator",
        chapter_plans: [{ chapter_index: 1, target_snapshot_json: {}, chapter_implementation_json: {} }],
      });
      assert.equal(errorCode(rejected), "SCOPE_REJECTED", JSON.stringify(rejected));
      assert.equal(count("chapter_header"), beforeHeaders);
      assert.equal(count("chapter_version"), beforeVersions);
      assert.equal(count("product_request_log"), beforeLedger);

      const emptyPlan = rpc("rpc_persist_chapter_execution_plan", {
        local_operator_id: operatorId,
        book_id: bookId,
        l1a_id: l1aId,
        idempotency_key: "b5-empty-plan",
        chapter_plans: [{ chapter_index: 1, target_snapshot_json: {}, chapter_implementation_json: {} }],
      });
      assert.equal(errorCode(emptyPlan), "PLAN_INCOMPLETE", JSON.stringify(emptyPlan));

      const unresolvedParticle = particle("particle-invalid", "Incomplete particle");
      delete unresolvedParticle.purpose;
      const incompleteParticle = rpc("rpc_persist_chapter_execution_plan", {
        local_operator_id: operatorId,
        book_id: bookId,
        l1a_id: l1aId,
        idempotency_key: "b5-incomplete-particle",
        chapter_plans: [{
          chapter_index: 1,
          target_snapshot_json: {
            core_plot_tasks: [], emotion_goals: [], hook_tasks: [], forbid_content: [],
            pov_declaration: { pov_char: "lead", switch_rule: "无", pov_boundaries: { can_perceive: [], can_misjudge: [], must_ignore: [] } },
            particles_json: [unresolvedParticle],
          },
          chapter_implementation_json: {
            execution_steps: [{ step_id: "scene-invalid", core_particles: ["particle-invalid"] }],
            lens_order: ["particle-invalid"],
            dialogue_plan: [],
          },
        }],
      });
      assert.equal(errorCode(incompleteParticle), "PLAN_INCOMPLETE", JSON.stringify(incompleteParticle));

      const payload = {
        local_operator_id: operatorId,
        book_id: bookId,
        l1a_id: l1aId,
        idempotency_key: "b5-plan-1",
        chapter_plans: [{
          chapter_index: 1,
          title: "第一章",
          target_snapshot_json: {
            core_plot_tasks: [{ task_id: "plot-task-1", description: "Complete all three particles" }],
            emotion_goals: [{ goal_id: "emotion-goal-1", description: "Pressure then choice" }],
            hook_tasks: [],
            pov_declaration: { pov_char: "lead", switch_rule: "无", pov_boundaries: { can_perceive: [], can_misjudge: [], must_ignore: [] } },
            forbid_content: [],
            scene_condition_package: sceneConditionPackage,
            particles_json: [
              particle("particle-1", "The lead encounters the documented cost."),
              particle("particle-2", "The lead makes the irreversible choice."),
              particle("particle-3", "The lead accepts the documented consequence."),
            ],
          },
          chapter_implementation_json: {
            execution_steps: [{ step_id: "scene-1", core_particles: ["particle-1", "particle-2", "particle-3"] }],
            lens_order: [{ pov: "lead", sensory: "视觉" }],
            dialogue_plan: [
              { unit_id: "dialogue-1", speaker: "lead", listener: "lead", primary_function: "D-01", secondary_function: "无" },
              { unit_id: "dialogue-2", speaker: "lead", listener: "lead", primary_function: "D-02", secondary_function: "无" },
              { unit_id: "dialogue-3", speaker: "lead", listener: "lead", primary_function: "D-03", secondary_function: "无" },
            ],
            dialogue_coverage: { "D-01": 1, "D-02": 1, "D-03": 1, "D-04": 0, "D-05": 0, "D-06": 0, "D-07": 0, "D-08": 0 },
          },
          exception_summary_jsonb: { deferred_tasks: [], data_debt: [], conflict_deadlocks: [] },
        }, {
          chapter_index: 2,
          title: "第二章",
          target_snapshot_json: {
            core_plot_tasks: [{ task_id: "plot-task-2", description: "Complete all three second-chapter particles" }],
            emotion_goals: [{ goal_id: "emotion-goal-2", description: "Escalate then choose" }],
            hook_tasks: [],
            pov_declaration: { pov_char: "lead", switch_rule: "无", pov_boundaries: { can_perceive: [], can_misjudge: [], must_ignore: [] } },
            forbid_content: [],
            scene_condition_package: sceneConditionPackage,
            particles_json: [
              particle("chapter-2-particle-1", "The pressure reaches the second chapter."),
              particle("chapter-2-particle-2", "The lead makes the next documented choice."),
              particle("chapter-2-particle-3", "The next documented consequence becomes unavoidable."),
            ],
          },
          chapter_implementation_json: {
            execution_steps: [{ step_id: "scene-2", core_particles: ["chapter-2-particle-1", "chapter-2-particle-2", "chapter-2-particle-3"] }],
            lens_order: [{ pov: "lead", sensory: "视觉" }],
            dialogue_plan: [
              { unit_id: "dialogue-1", speaker: "lead", listener: "lead", primary_function: "D-01", secondary_function: "无" },
              { unit_id: "dialogue-2", speaker: "lead", listener: "lead", primary_function: "D-02", secondary_function: "无" },
              { unit_id: "dialogue-3", speaker: "lead", listener: "lead", primary_function: "D-03", secondary_function: "无" },
            ],
            dialogue_coverage: { "D-01": 1, "D-02": 1, "D-03": 1, "D-04": 0, "D-05": 0, "D-06": 0, "D-07": 0, "D-08": 0 },
          },
          exception_summary_jsonb: { deferred_tasks: [], data_debt: [], conflict_deadlocks: [] },
        }],
      };
      payload.chapter_plans[0].target_snapshot_json.particles_json[0].reveal_to = "all";
      payload.chapter_plans[0].target_snapshot_json.particles_json[1].reveal_to = "reader";

      const foreignBook = rpc("rpc_create_book_project", {
        ...initialBookRequest(operatorId),
        correlation_id: "b5-b8-foreign-book",
        idempotency_key: "b5-b8-foreign-book",
        title: "B5 B8 foreign character scope",
      });
      assert.equal(foreignBook.ok, true, JSON.stringify(foreignBook));
      const foreignLeadId = sql(`SELECT id FROM public.character WHERE book_id=${sqlText(foreignBook.book_id)} AND char_name='Lead'`);
      assert.match(foreignLeadId, /^[0-9a-f-]{36}$/u);

      const revealScopeBeforeHeaders = count("chapter_header", `book_id=${sqlText(bookId)}`);
      const revealScopeBeforeVersions = count("chapter_version", `book_id=${sqlText(bookId)}`);
      const revealScopeBeforeLedger = count("product_request_log", `book_id=${sqlText(bookId)} AND operation='rpc_persist_chapter_execution_plan'`);
      for (const [label, revealTo] of [
        ["legacy-all", "全员"],
        ["legacy-reader", "仅读者"],
        ["legacy-specific", "特定角色"],
        ["empty-array", []],
        ["char-code", ["lead"]],
        ["unknown-uuid", ["00000000-0000-4000-8000-000000000000"]],
        ["foreign-book-uuid", [foreignLeadId]],
        ["sentinel-array", ["all"]],
      ]) {
        const invalid = structuredClone(payload);
        invalid.idempotency_key = `b5-reveal-${label}`;
        invalid.chapter_plans[0].target_snapshot_json.particles_json[0].reveal_to = revealTo;
        const rejectedRevealScope = rpc("rpc_persist_chapter_execution_plan", invalid);
        assert.equal(errorCode(rejectedRevealScope), "PLAN_INCOMPLETE", JSON.stringify(rejectedRevealScope));
        assert.equal(count("chapter_header", `book_id=${sqlText(bookId)}`), revealScopeBeforeHeaders);
        assert.equal(count("chapter_version", `book_id=${sqlText(bookId)}`), revealScopeBeforeVersions);
        assert.equal(count("product_request_log", `book_id=${sqlText(bookId)} AND operation='rpc_persist_chapter_execution_plan'`), revealScopeBeforeLedger);
      }
      const missingScenePackage = rpc("rpc_persist_chapter_execution_plan", {
        ...payload,
        idempotency_key: "b5-missing-scene-package",
        chapter_plans: [{
          ...payload.chapter_plans[0],
          target_snapshot_json: { ...payload.chapter_plans[0].target_snapshot_json, scene_condition_package: undefined },
        }],
      });
      assert.equal(errorCode(missingScenePackage), "PLAN_INCOMPLETE", JSON.stringify(missingScenePackage));
      const inventedMapping = rpc("rpc_persist_chapter_execution_plan", {
        ...payload,
        idempotency_key: "b5-invented-particle",
        chapter_plans: [{
          ...payload.chapter_plans[0],
          chapter_implementation_json: {
            ...payload.chapter_plans[0].chapter_implementation_json,
            execution_steps: [{ step_id: "scene-1", core_particles: ["particle-1", "particle-invented"] }],
          },
        }],
      });
      assert.equal(errorCode(inventedMapping), "PLAN_INCOMPLETE", JSON.stringify(inventedMapping));
      const unswitchedPov = rpc("rpc_persist_chapter_execution_plan", {
        ...payload,
        idempotency_key: "b5-unswitched-pov",
        chapter_plans: [{
          ...payload.chapter_plans[0],
          chapter_implementation_json: {
            ...payload.chapter_plans[0].chapter_implementation_json,
            lens_order: [{ pov: "other", sensory: "听觉" }],
          },
        }],
      });
      assert.equal(errorCode(unswitchedPov), "PLAN_INCOMPLETE", JSON.stringify(unswitchedPov));
      const forbiddenFromScene = rpc("rpc_persist_chapter_execution_plan", {
        ...payload,
        idempotency_key: "b5-forbidden-from-scene",
        chapter_plans: [{
          ...payload.chapter_plans[0],
          target_snapshot_json: {
            ...payload.chapter_plans[0].target_snapshot_json,
            forbid_content: ["The scene outline must not become chapter prohibition."],
          },
        }],
      });
      assert.equal(errorCode(forbiddenFromScene), "PLAN_INCOMPLETE", JSON.stringify(forbiddenFromScene));
      const missingDialogueCore = rpc("rpc_persist_chapter_execution_plan", {
        ...payload,
        idempotency_key: "b5-missing-dialogue-core",
        chapter_plans: [{
          ...payload.chapter_plans[0],
          chapter_implementation_json: {
            ...payload.chapter_plans[0].chapter_implementation_json,
            dialogue_plan: payload.chapter_plans[0].chapter_implementation_json.dialogue_plan.filter((item) => item.primary_function !== "D-02"),
            dialogue_coverage: { ...payload.chapter_plans[0].chapter_implementation_json.dialogue_coverage, "D-02": 0 },
          },
        }],
      });
      assert.equal(errorCode(missingDialogueCore), "PLAN_INCOMPLETE", JSON.stringify(missingDialogueCore));
      const spoofedCanReveal = rpc("rpc_persist_chapter_execution_plan", {
        ...payload,
        idempotency_key: "b5-spoofed-can-reveal",
        chapter_plans: [{
          ...payload.chapter_plans[0],
          target_snapshot_json: {
            ...payload.chapter_plans[0].target_snapshot_json,
            particles_json: [{
              ...payload.chapter_plans[0].target_snapshot_json.particles_json[0],
              content: "A scene candidate must not be relabeled as a locked L1A revelation.",
              source_field: "info_reveal_boundary.can_reveal[0]",
            }, ...payload.chapter_plans[0].target_snapshot_json.particles_json.slice(1)],
          },
        }],
      });
      assert.equal(errorCode(spoofedCanReveal), "PLAN_INCOMPLETE", JSON.stringify(spoofedCanReveal));
      const persisted = rpc("rpc_persist_chapter_execution_plan", payload);
      assert.equal(persisted.ok, true, JSON.stringify(persisted));
      assert.equal(persisted.state.l1a_status, "locked_for_deduction");
      chapterId = persisted.ids.chapter_ids[0];
      candidateVersionId = persisted.ids.chapter_versions[0].chapter_version_id;
      chapterId2 = persisted.ids.chapter_ids[1];
      candidateVersionId2 = persisted.ids.chapter_versions[1].chapter_version_id;
      assert.equal(count("chapter_header", `id=${sqlText(chapterId)} AND book_id=${sqlText(bookId)} AND l1a_unit_id=${sqlText(l1aId)} AND chapter_index=1 AND NOT is_finalized`), 1);
      assert.equal(count("chapter_version", `id=${sqlText(candidateVersionId)} AND chapter_id=${sqlText(chapterId)} AND version_state='candidate' AND is_valid AND NOT is_shadow AND NOT is_formal`), 1);
      assert.equal(count("l1a_unit", `id=${sqlText(l1aId)} AND status='locked_for_deduction' AND is_locked AND is_formal`), 1);
      assert.equal(count("book_project", `id=${sqlText(bookId)} AND current_l1a_id=${sqlText(l1aId)}`), 1);

      const projection = JSON.parse(sql(`SELECT jsonb_build_object(
        'operator_id', local_operator_id,
        'candidate_version_id', candidate_version_id,
        'target', target_snapshot_json,
        'implementation', chapter_implementation_json
      ) FROM public.chapter WHERE id=${sqlText(chapterId)}`));
      assert.equal(projection.operator_id, operatorId);
      assert.equal(projection.candidate_version_id, candidateVersionId);
      assert.deepEqual(projection.target.particles_json.map((item) => item.particle_id), ["particle-1", "particle-2", "particle-3"]);
      assert.deepEqual(projection.target.scene_condition_package, sceneConditionPackage);
      assert.deepEqual(projection.implementation.execution_steps, [{ step_id: "scene-1", core_particles: ["particle-1", "particle-2", "particle-3"] }]);

      const replay = rpc("rpc_persist_chapter_execution_plan", payload);
      assert.equal(replay.idempotent_replay, true, JSON.stringify(replay));
      assert.equal(count("chapter_header", `book_id=${sqlText(bookId)}`), 2);
      assert.equal(count("chapter_version", `book_id=${sqlText(bookId)}`), 2);
      assert.equal(count("product_request_log", "operation='rpc_persist_chapter_execution_plan'"), 1);

      const conflict = rpc("rpc_persist_chapter_execution_plan", {
        ...payload,
        chapter_plans: [{ ...payload.chapter_plans[0], title: "A different plan under the same key" }],
      });
      assert.equal(errorCode(conflict), "IDEMPOTENCY_CONFLICT", JSON.stringify(conflict));
    });

    await t.test("B6 atomically stores every current L1A chapter checkpoint and injects the fixed L1A budget", () => {
      const prematureText = rpc("rpc_persist_candidate_text", {
        local_operator_id: operatorId,
        book_id: bookId,
        chapter_id: chapterId,
        chapter_version_id: candidateVersionId,
        candidate_text: firstCandidateText,
        idempotency_key: "b7-before-deduction",
      });
      assert.equal(errorCode(prematureText), "DEDUCTION_NOT_LOCKED", JSON.stringify(prematureText));
      assert.equal(count("chapter_version", `id=${sqlText(candidateVersionId)} AND prose_text IS NULL`), 1);
      assert.equal(count("product_request_log", "operation='rpc_persist_candidate_text'"), 0);

      const snapshot = (chapter_id, chapter_version_id, candidate_plot_sim_json, deduction_progress_json) => ({
        chapter_id,
        chapter_version_id,
        candidate_plot_sim_json,
        deduction_progress_json,
      });
      const zeroCheckpoint = (inputSnapshot = deductionInputSnapshot(), remaining_particles = 3) => ({
        candidate_plot_sim_json: {
          deduction_input_snapshot: inputSnapshot,
          particles_records: [],
          candidate_truth_ledger: emptyCandidateTruthLedger(),
          chapter_summary: null,
        },
        deduction_progress_json: {
          current_particle_index: 0,
          token_consumed: 0,
          remaining_particles,
          deduction_complete: false,
          reject_count: 0,
        },
      });
      const basePayload = {
        local_operator_id: operatorId,
        book_id: bookId,
        l1a_unit_id: l1aId,
      };
      const inconsistent = rpc("rpc_finalize_deduction_snapshot", {
        ...basePayload,
        idempotency_key: "b6-inconsistent",
        chapters: [
          snapshot(chapterId, candidateVersionId, {
            deduction_input_snapshot: deductionInputSnapshot(),
            particles_records: [],
            candidate_truth_ledger: emptyCandidateTruthLedger(),
            chapter_summary: {},
          }, {
            current_particle_index: 0, token_consumed: 0, remaining_particles: 0, deduction_complete: true, reject_count: 0,
          }),
          snapshot(chapterId2, candidateVersionId2, zeroCheckpoint(deductionInputSnapshot("chapter-2-")).candidate_plot_sim_json, zeroCheckpoint(deductionInputSnapshot("chapter-2-")).deduction_progress_json),
        ],
      });
      assert.equal(errorCode(inconsistent), "DEDUCTION_PROGRESS_INCONSISTENT", JSON.stringify(inconsistent));
      assert.equal(count("chapter_version", `id=${sqlText(candidateVersionId)} AND candidate_plot_sim_json IS NULL AND NOT deduction_locked`), 1);
      assert.equal(count("chapter_version", `id=${sqlText(candidateVersionId2)} AND candidate_plot_sim_json IS NULL AND NOT deduction_locked`), 1);
      assert.equal(count("product_request_log", "operation='rpc_finalize_deduction_snapshot'"), 0);

      const missingCandidateTruthLedger = structuredClone(plotSnapshot);
      delete missingCandidateTruthLedger.candidate_truth_ledger;
      const missingLedger = rpc("rpc_finalize_deduction_snapshot", {
        ...basePayload,
        idempotency_key: "b6-missing-candidate-truth-ledger",
        chapters: [
          snapshot(chapterId, candidateVersionId, missingCandidateTruthLedger, {
            current_particle_index: 3, token_consumed: 321, remaining_particles: 0, deduction_complete: true, reject_count: 0,
          }),
          snapshot(chapterId2, candidateVersionId2, plotSnapshot2, {
            current_particle_index: 3, token_consumed: 456, remaining_particles: 0, deduction_complete: true, reject_count: 0,
          }),
        ],
      });
      assert.equal(errorCode(missingLedger), "DEDUCTION_SNAPSHOT_INCOMPLETE", JSON.stringify(missingLedger));
      assert.equal(count("chapter_version", `id=${sqlText(candidateVersionId)} AND candidate_plot_sim_json IS NULL AND NOT deduction_locked`), 1);
      assert.equal(count("chapter_version", `id=${sqlText(candidateVersionId2)} AND candidate_plot_sim_json IS NULL AND NOT deduction_locked`), 1);

      const missingEvidenceRecord = convergence("particle-1", 1, 2);
      delete missingEvidenceRecord.particle_completion_evidence;
      const missingEvidence = rpc("rpc_finalize_deduction_snapshot", {
        ...basePayload,
        idempotency_key: "b6-missing-evidence",
        chapters: [
          snapshot(chapterId, candidateVersionId, {
            deduction_input_snapshot: deductionInputSnapshot(),
            particles_records: [missingEvidenceRecord],
            candidate_truth_ledger: emptyCandidateTruthLedger(),
            chapter_summary: null,
          }, {
            current_particle_index: 1, token_consumed: 100, remaining_particles: 2, deduction_complete: false, reject_count: 0,
          }),
          snapshot(chapterId2, candidateVersionId2, zeroCheckpoint(deductionInputSnapshot("chapter-2-")).candidate_plot_sim_json, zeroCheckpoint(deductionInputSnapshot("chapter-2-")).deduction_progress_json),
        ],
      });
      assert.equal(errorCode(missingEvidence), "DEDUCTION_SNAPSHOT_INCOMPLETE", JSON.stringify(missingEvidence));

      let partialPayload = {
        ...basePayload,
        idempotency_key: "b6-checkpoint-partial",
        chapters: [
          snapshot(chapterId, candidateVersionId, {
            deduction_input_snapshot: deductionInputSnapshot(),
            particles_records: [convergence("particle-1", 1, 2)],
            candidate_truth_ledger: emptyCandidateTruthLedger(),
            chapter_summary: null,
          }, {
            current_particle_index: 1, token_consumed: 120, remaining_particles: 2, deduction_complete: false, reject_count: 0,
          }),
          snapshot(chapterId2, candidateVersionId2, zeroCheckpoint(deductionInputSnapshot("chapter-2-")).candidate_plot_sim_json, zeroCheckpoint(deductionInputSnapshot("chapter-2-")).deduction_progress_json),
        ],
      };
      const partial = rpc("rpc_finalize_deduction_snapshot", partialPayload);
      assert.equal(partial.ok, true, JSON.stringify(partial));
      assert.equal(partial.state.deduction_locked, false);
      assert.equal(count("chapter_version", `id=${sqlText(candidateVersionId)} AND candidate_plot_sim_json IS NOT NULL AND NOT deduction_locked`), 1);
      assert.equal(count("chapter_version", `id=${sqlText(candidateVersionId2)} AND candidate_plot_sim_json IS NOT NULL AND NOT deduction_locked`), 1);

      const missingDirection = rpc("rpc_finalize_deduction_snapshot", {
        ...basePayload,
        action: "replan",
        return_direction: "   ",
        idempotency_key: "b6-replan-empty-direction",
      });
      assert.equal(errorCode(missingDirection), "RETURN_DIRECTION_REQUIRED", JSON.stringify(missingDirection));
      assert.equal(count("chapter_version", `id=${sqlText(candidateVersionId)} AND version_state='candidate' AND is_valid AND NOT is_shadow`), 1);
      assert.equal(count("chapter_version", `id=${sqlText(candidateVersionId2)} AND version_state='candidate' AND is_valid AND NOT is_shadow`), 1);

      const previousCandidateVersionId = candidateVersionId;
      const previousCandidateVersionId2 = candidateVersionId2;
      const replanPayload = {
        ...basePayload,
        action: "replan",
        return_direction: "Keep the discovery concealed until the final particle.",
        idempotency_key: "b6-replan-direction-1",
      };
      const replanned = rpc("rpc_finalize_deduction_snapshot", replanPayload);
      assert.equal(replanned.ok, true, JSON.stringify(replanned));
      assert.equal(replanned.state.action, "replan");
      assert.equal(replanned.state.token_budget, 10000000);
      assert.equal(replanned.ids.chapter_versions.length, 2);
      const successorByChapter = new Map(replanned.ids.chapter_versions.map((entry) => [entry.chapter_id, entry]));
      const successor1 = successorByChapter.get(chapterId);
      const successor2 = successorByChapter.get(chapterId2);
      assert.equal(successor1.archived_chapter_version_id, previousCandidateVersionId);
      assert.equal(successor2.archived_chapter_version_id, previousCandidateVersionId2);
      candidateVersionId = successor1.successor_chapter_version_id;
      candidateVersionId2 = successor2.successor_chapter_version_id;
      assert.equal(count("chapter_version", `id=${sqlText(previousCandidateVersionId)} AND version_state='shadow' AND is_shadow AND NOT is_valid`), 1);
      assert.equal(count("chapter_version", `id=${sqlText(previousCandidateVersionId2)} AND version_state='shadow' AND is_shadow AND NOT is_valid`), 1);
      assert.equal(count("chapter_version", `id=${sqlText(candidateVersionId)} AND version_state='candidate' AND predecessor_version_id=${sqlText(previousCandidateVersionId)} AND candidate_plot_sim_json IS NULL AND deduction_progress_json IS NULL AND NOT deduction_locked AND prose_text IS NULL`), 1);
      assert.equal(count("chapter_version", `id=${sqlText(candidateVersionId2)} AND version_state='candidate' AND predecessor_version_id=${sqlText(previousCandidateVersionId2)} AND candidate_plot_sim_json IS NULL AND deduction_progress_json IS NULL AND NOT deduction_locked AND prose_text IS NULL`), 1);
      assert.equal(count("chapter_header", `id IN (${sqlText(chapterId)}, ${sqlText(chapterId2)}) AND status='plan_ready' AND run_status='plan_ready'`), 2);
      assert.equal(
        count("product_request_log", `operation='rpc_finalize_deduction_snapshot' AND intent->>'return_direction'='Keep the discovery concealed until the final particle.'`),
        1,
      );
      const replanReplay = rpc("rpc_finalize_deduction_snapshot", replanPayload);
      assert.equal(replanReplay.idempotent_replay, true, JSON.stringify(replanReplay));
      assert.equal(count("chapter_version", `chapter_id IN (${sqlText(chapterId)}, ${sqlText(chapterId2)}) AND version_state='candidate' AND is_valid AND NOT is_shadow`), 2);
      const withoutCheckpoint = rpc("rpc_finalize_deduction_snapshot", {
        ...replanPayload,
        idempotency_key: "b6-replan-without-checkpoint",
      });
      assert.equal(errorCode(withoutCheckpoint), "DEDUCTION_REPLAN_NOT_AVAILABLE", JSON.stringify(withoutCheckpoint));
      assert.equal(count("chapter_version", `chapter_id IN (${sqlText(chapterId)}, ${sqlText(chapterId2)}) AND version_state='candidate' AND is_valid AND NOT is_shadow`), 2);

      partialPayload = {
        ...basePayload,
        idempotency_key: "b6-successor-checkpoint-partial",
        chapters: [
          snapshot(chapterId, candidateVersionId, {
            deduction_input_snapshot: deductionInputSnapshot(),
            particles_records: [convergence("particle-1", 1, 2)],
            candidate_truth_ledger: emptyCandidateTruthLedger(),
            chapter_summary: null,
          }, {
            current_particle_index: 1, token_consumed: 120, remaining_particles: 2, deduction_complete: false, reject_count: 0,
          }),
          snapshot(chapterId2, candidateVersionId2, zeroCheckpoint(deductionInputSnapshot("chapter-2-")).candidate_plot_sim_json, zeroCheckpoint(deductionInputSnapshot("chapter-2-")).deduction_progress_json),
        ],
      };
      const successorPartial = rpc("rpc_finalize_deduction_snapshot", partialPayload);
      assert.equal(successorPartial.ok, true, JSON.stringify(successorPartial));

      const inputDriftPayload = structuredClone(partialPayload);
      inputDriftPayload.idempotency_key = "b6-checkpoint-input-drift";
      inputDriftPayload.chapters[0].candidate_plot_sim_json.deduction_input_snapshot.particles[1].content = "A different resume decomposition.";
      const inputDrift = rpc("rpc_finalize_deduction_snapshot", inputDriftPayload);
      assert.equal(errorCode(inputDrift), "CHECKPOINT_REGRESSION", JSON.stringify(inputDrift));

      const regression = rpc("rpc_finalize_deduction_snapshot", {
        ...partialPayload,
        idempotency_key: "b6-checkpoint-regression",
        chapters: [
          snapshot(chapterId, candidateVersionId, {
            deduction_input_snapshot: deductionInputSnapshot(),
            particles_records: [],
            candidate_truth_ledger: emptyCandidateTruthLedger(),
            chapter_summary: null,
          }, {
            current_particle_index: 0, token_consumed: 100, remaining_particles: 3, deduction_complete: false, reject_count: 0,
          }),
          partialPayload.chapters[1],
        ],
      });
      assert.equal(errorCode(regression), "CHECKPOINT_REGRESSION", JSON.stringify(regression));

      const payload = {
        ...basePayload,
        idempotency_key: "b6-checkpoint-1",
        chapters: [
          snapshot(chapterId, candidateVersionId, plotSnapshot, {
            current_particle_index: 3, token_consumed: 321, remaining_particles: 0, deduction_complete: true, reject_count: 0,
          }),
          snapshot(chapterId2, candidateVersionId2, plotSnapshot2, {
            current_particle_index: 3, token_consumed: 456, remaining_particles: 0, deduction_complete: true, reject_count: 0,
          }),
        ],
      };
      const persisted = rpc("rpc_finalize_deduction_snapshot", payload);
      assert.equal(persisted.ok, true, JSON.stringify(persisted));
      assert.equal(persisted.state.deduction_locked, true);
      assert.equal(persisted.state.token_budget, 10000000);
      const stored = JSON.parse(sql(`SELECT jsonb_build_object(
        'plot', candidate_plot_sim_json,
        'progress', deduction_progress_json,
        'locked', deduction_locked
      ) FROM public.chapter_version WHERE id=${sqlText(candidateVersionId)}`));
      assert.deepEqual(stored.plot, plotSnapshot);
      assert.equal(stored.locked, true);
      assert.equal(stored.progress.token_consumed, 321);
      assert.equal(stored.progress.token_budget, 10000000);
      assert.equal(stored.progress.token_budget_version, "mvp-fixed-10000000");
      assert.equal(stored.progress.l1a_token_consumed, 777);
      assert.equal(count("chapter_header", `id=${sqlText(chapterId)} AND status='deduction_complete' AND run_status='deduction_complete'`), 1);
      assert.equal(count("chapter_header", `id=${sqlText(chapterId2)} AND status='deduction_complete' AND run_status='deduction_complete'`), 1);

      const replay = rpc("rpc_finalize_deduction_snapshot", payload);
      assert.equal(replay.idempotent_replay, true, JSON.stringify(replay));
      assert.equal(count("product_request_log", "operation='rpc_finalize_deduction_snapshot'"), 4);
    });

    await t.test("B7 writes prose only to the locked current candidate and replays without duplication", () => {
      const payload = {
        local_operator_id: operatorId,
        book_id: bookId,
        chapter_id: chapterId,
        chapter_version_id: candidateVersionId,
        candidate_text: firstCandidateText,
        idempotency_key: "b7-prose-1",
      };
      const persisted = rpc("rpc_persist_candidate_text", payload);
      assert.equal(persisted.ok, true, JSON.stringify(persisted));
      assert.equal(persisted.state.status, "auditing");
      assert.equal(sql(`SELECT prose_text FROM public.chapter_version WHERE id=${sqlText(candidateVersionId)}`), firstCandidateText);
      assert.equal(count("chapter_header", `id=${sqlText(chapterId)} AND status='auditing' AND run_status='auditing'`), 1);
      assert.equal(count("chapter_version", `book_id=${sqlText(bookId)} AND version_state='formal'`), 0);

      const replay = rpc("rpc_persist_candidate_text", payload);
      assert.equal(replay.idempotent_replay, true, JSON.stringify(replay));
      assert.equal(count("product_request_log", "operation='rpc_persist_candidate_text'"), 1);
    });

    await t.test("B8 keeps the current candidate on chief-editor N without creating another shadow before a formal return", () => {
      const audited = rpc("rpc_confirm_audit_result", {
        local_operator_id: operatorId,
        book_id: bookId,
        chapter_id: chapterId,
        chapter_version_id: candidateVersionId,
        idempotency_key: "b8-audit-1",
        audit: {
          has_p0_blocker: false,
          p0_items_json: [],
          audit_findings_jsonb: { consistency: "pass" },
          return_route_suggestion_jsonb: {},
          audited_handoff_package_jsonb: auditedHandoff("b8-editorial-n"),
        },
        assets: [{
          asset_ref: "b8-editorial-n-asset",
          asset_type: "foreshadow",
          asset_name: "可追溯伏笔",
          asset_description: "来自本候选正文的审计识别结果",
          fulfillment_window: "第2-3章",
          status: "planted",
        }],
      });
      assert.equal(audited.ok, true, JSON.stringify(audited));
      const auditId = audited.ids.audit_id;
      assert.equal(count("audit_attempt_log", `id=${sqlText(auditId)} AND candidate_text_snapshot=${sqlText(firstCandidateText)} AND NOT has_p0_blocker AND is_valid AND NOT is_shadow`), 1);
      assert.equal(count("audit_attempt_log", `id=${sqlText(auditId)} AND frozen_deduction_result_jsonb=${sqlText(JSON.stringify(plotSnapshot))}::jsonb`), 1);
      assert.equal(count("narrative_asset", `chapter_version_id=${sqlText(candidateVersionId)} AND NOT is_formal AND is_valid AND NOT is_shadow`), 1);
      assert.equal(sql(`SELECT audited_handoff_package_jsonb #>> '{character_live_state_changes,0,baseline_live_state_id}' FROM public.audit_attempt_log WHERE id=${sqlText(auditId)}`), "");

      const prematureEditorial = rpc("rpc_record_chapter_review_evidence", {
        local_operator_id: operatorId,
        book_id: bookId,
        chapter_id: chapterId,
        chapter_version_id: candidateVersionId,
        phase: "editorial",
        decision_json: { verdict: "N", force_manual: false, reject_count_observed: 0 },
        fix_instruction_json: { instruction: "Wait for both experience reviews." },
        creator_confirmed: false,
        idempotency_key: "b8-editorial-before-experience-evidence",
      });
      assert.equal(errorCode(prematureEditorial), "REVIEW_EVIDENCE_INCOMPLETE", JSON.stringify(prematureEditorial));

      for (const [phase, score] of [
        ["reader", { experience: { score: 8, evidence: "The candidate sustains readable scene continuity." } }],
        ["commercial", { potential: { score: 7, evidence: "The candidate delivers the documented selling point." } }],
      ]) {
        const evidence = rpc("rpc_record_chapter_review_evidence", {
          local_operator_id: operatorId,
          book_id: bookId,
          chapter_id: chapterId,
          chapter_version_id: candidateVersionId,
          phase,
          score_json: score,
          idempotency_key: `b8-${phase}-1`,
        });
        assert.equal(evidence.ok, true, JSON.stringify(evidence));
      }

      const staleCount = rpc("rpc_record_chapter_review_evidence", {
        local_operator_id: operatorId,
        book_id: bookId,
        chapter_id: chapterId,
        chapter_version_id: candidateVersionId,
        phase: "editorial",
        decision_json: { verdict: "N", force_manual: false, reject_count_observed: 1 },
        fix_instruction_json: { instruction: "This count was claimed by the caller." },
        creator_confirmed: false,
        idempotency_key: "b8-editorial-stale-count",
      });
      assert.equal(errorCode(staleCount), "REVIEW_STATE_STALE", JSON.stringify(staleCount));

      const editorial = rpc("rpc_record_chapter_review_evidence", {
        local_operator_id: operatorId,
        book_id: bookId,
        chapter_id: chapterId,
        chapter_version_id: candidateVersionId,
        phase: "editorial",
        decision_json: { verdict: "N", force_manual: false, reject_count_observed: 0 },
        fix_instruction_json: { instruction: "按创作者方向重写表达，不改变推演事实。" },
        creator_confirmed: false,
        idempotency_key: "b8-editorial-return-1",
      });
      assert.equal(editorial.ok, true, JSON.stringify(editorial));
      assert.equal(count("editor_log", `id=${sqlText(editorial.ids.editor_log_id)} AND decision_json->>'reject_count_observed'='0' AND NOT creator_confirmed`), 1);
      assert.equal(sql(`SELECT deduction_progress_json->>'reject_count' FROM public.chapter_version WHERE id=${sqlText(candidateVersionId)}`), "1");

      const archivePayload = {
        local_operator_id: operatorId,
        book_id: bookId,
        chapter_id: chapterId,
        chapter_version_id: candidateVersionId,
        editor_log_id: editorial.ids.editor_log_id,
        idempotency_key: "b8-archive-1",
      };
      const archived = rpc("rpc_archive_shadow_version", archivePayload);
      assert.equal(errorCode(archived), "FORMAL_RETURN_REJECTED", JSON.stringify(archived));
      assert.equal(count("chapter_version", `id=${sqlText(candidateVersionId)} AND version_state='candidate' AND is_valid AND NOT is_shadow AND NOT is_formal`), 1);
      assert.equal(count("chapter_version", `chapter_id=${sqlText(chapterId)} AND version_state='shadow'`), 1);
      assert.equal(count("audit_attempt_log", `chapter_version_id=${sqlText(candidateVersionId)} AND is_valid AND NOT is_shadow`), 1);
      assert.equal(count("editor_log", `chapter_version_id=${sqlText(candidateVersionId)} AND is_valid AND NOT is_shadow`), 3);
      assert.equal(count("narrative_asset", `chapter_version_id=${sqlText(candidateVersionId)} AND is_valid AND NOT is_shadow`), 1);
      const current = JSON.parse(sql(`SELECT jsonb_build_object(
        'candidate_version_id', candidate_version_id,
        'deduction_locked', deduction_locked,
        'candidate_text', candidate_text,
        'status', status,
        'run_status', run_status
      ) FROM public.chapter WHERE id=${sqlText(chapterId)} AND local_operator_id=${sqlText(operatorId)}`));
      assert.equal(current.candidate_version_id, candidateVersionId);
      assert.equal(current.deduction_locked, true);
      assert.equal(current.candidate_text, firstCandidateText);
      assert.equal(current.status, "auditing");
      assert.equal(current.run_status, "auditing");

      const replay = rpc("rpc_archive_shadow_version", archivePayload);
      assert.equal(errorCode(replay), "FORMAL_RETURN_REJECTED", JSON.stringify(replay));
      assert.equal(count("chapter_version", `chapter_id=${sqlText(chapterId)} AND version_state='candidate'`), 1);
      assert.equal(count("product_request_log", "operation='rpc_archive_shadow_version'"), 0);
    });

    await t.test("B8 rewrites the same candidate and requires fresh subjective evidence before a new decision", () => {
      const rewrittenText = "重写只调整表达方式，仍然保持同一条锁定推演事实。";
      const rewritten = rpc("rpc_persist_candidate_text", {
        local_operator_id: operatorId,
        book_id: bookId,
        chapter_id: chapterId,
        chapter_version_id: candidateVersionId,
        candidate_text: rewrittenText,
        idempotency_key: "b8-rewrite-prose-1",
      });
      assert.equal(rewritten.ok, true, JSON.stringify(rewritten));
      const currentHandoff = auditedHandoff("b8-current-y");
      const audited = rpc("rpc_confirm_audit_result", {
        local_operator_id: operatorId,
        book_id: bookId,
        chapter_id: chapterId,
        chapter_version_id: candidateVersionId,
        idempotency_key: "b8-rewrite-audit-1",
        audit: {
          has_p0_blocker: false,
          p0_items_json: [],
          audit_findings_jsonb: { consistency: "pass" },
          return_route_suggestion_jsonb: {},
          audited_handoff_package_jsonb: currentHandoff,
        },
        assets: [{
          asset_ref: "b8-current-y-asset",
          asset_type: "critical_event",
          asset_name: "当前候选关键事件",
          asset_description: "只有当前通过主编的候选可提升该资产。",
          status: "planted",
        }],
      });
      assert.equal(audited.ok, true, JSON.stringify(audited));
      assert.equal(count("audit_attempt_log", `chapter_version_id=${sqlText(candidateVersionId)} AND candidate_text_snapshot=${sqlText(rewrittenText)} AND is_valid AND NOT is_shadow`), 1);
      const storedHandoff = JSON.parse(sql(`SELECT audited_handoff_package_jsonb
        FROM public.audit_attempt_log WHERE id=${sqlText(audited.ids.audit_id)}`));
      assert.equal(storedHandoff.chapter_version_id, candidateVersionId);
      assert.equal(storedHandoff.audit_attempt_id, audited.ids.audit_id);
      assert.equal(storedHandoff.world_changes[0].after.last_formal_handoff, "stable");
      assert.match(storedHandoff.narrative_assets[0].candidate_asset_id, /^[0-9a-f-]{36}$/u);

      const staleEditorial = rpc("rpc_record_chapter_review_evidence", {
        local_operator_id: operatorId,
        book_id: bookId,
        chapter_id: chapterId,
        chapter_version_id: candidateVersionId,
        phase: "editorial",
        decision_json: { verdict: "Y", force_manual: false, reject_count_observed: 1 },
        creator_confirmed: false,
        idempotency_key: "b8-rewrite-editorial-before-fresh-subjective-evidence",
      });
      assert.equal(errorCode(staleEditorial), "REVIEW_EVIDENCE_INCOMPLETE", JSON.stringify(staleEditorial));

      for (const [phase, score] of [
        ["reader", { experience: { score: 8, evidence: "The rewritten candidate remains clear and immersive." } }],
        ["commercial", { potential: { score: 7, evidence: "The rewritten candidate preserves the intended appeal." } }],
      ]) {
        const evidence = rpc("rpc_record_chapter_review_evidence", {
          local_operator_id: operatorId,
          book_id: bookId,
          chapter_id: chapterId,
          chapter_version_id: candidateVersionId,
          phase,
          score_json: score,
          idempotency_key: `b8-rewrite-${phase}-1`,
        });
        assert.equal(evidence.ok, true, JSON.stringify(evidence));
      }
      const approved = rpc("rpc_record_chapter_review_evidence", {
        local_operator_id: operatorId,
        book_id: bookId,
        chapter_id: chapterId,
        chapter_version_id: candidateVersionId,
        phase: "editorial",
        decision_json: { verdict: "Y", force_manual: false, reject_count_observed: 1 },
        creator_confirmed: false,
        idempotency_key: "b8-rewrite-approve-1",
      });
      assert.equal(approved.ok, true, JSON.stringify(approved));
      assert.equal(count("editor_log", `id=${sqlText(approved.ids.editor_log_id)} AND NOT creator_confirmed`), 1);

      const mutateObjectiveAudit = (assignment) => sql(`BEGIN;
        ALTER TABLE public.audit_attempt_log DISABLE TRIGGER USER;
        UPDATE public.audit_attempt_log SET ${assignment}
        WHERE id=${sqlText(audited.ids.audit_id)};
        ALTER TABLE public.audit_attempt_log ENABLE TRIGGER USER;
        COMMIT;`);
      const expectFormalBlocked = (idempotencyKey, code) => {
        const blocked = rpc("rpc_commit_chapter", {
          local_operator_id: operatorId,
          book_id: bookId,
          chapter_id: chapterId,
          chapter_version_id: candidateVersionId,
          idempotency_key: idempotencyKey,
        });
        assert.equal(errorCode(blocked), code, JSON.stringify(blocked));
        assert.equal(count("chapter_version", `id=${sqlText(candidateVersionId)} AND version_state='formal'`), 0);
        assert.equal(count("writeback_log", `chapter_version_id=${sqlText(candidateVersionId)} AND status='success'`), 0);
      };

      mutateObjectiveAudit(`p0_items_json='[{"dimension":"consistency","evidence":"Backdoor P0."}]'::jsonb`);
      expectFormalBlocked("b8-commit-reject-p0-items", "OBJECTIVE_AUDIT_REJECTED");
      mutateObjectiveAudit("p0_items_json='[]'::jsonb");

      mutateObjectiveAudit(`return_route_suggestion_jsonb='{"reason":"Backdoor return route."}'::jsonb`);
      expectFormalBlocked("b8-commit-reject-return-route", "OBJECTIVE_AUDIT_REJECTED");
      mutateObjectiveAudit("return_route_suggestion_jsonb='{}'::jsonb");

      mutateObjectiveAudit("audited_handoff_package_jsonb=jsonb_set(audited_handoff_package_jsonb, '{formalization_eligible}', 'false'::jsonb)");
      expectFormalBlocked("b8-commit-reject-ineligible-handoff", "AUDIT_HANDOFF_REJECTED");
      mutateObjectiveAudit("audited_handoff_package_jsonb=jsonb_set(audited_handoff_package_jsonb, '{formalization_eligible}', 'true'::jsonb)");

      assert.equal(errorCode(rpc("rpc_enhance_prose", {
        local_operator_id: operatorId,
        book_id: bookId,
        chapter_id: chapterId,
        chapter_version_id: candidateVersionId,
      })), "CHANGE_LIMIT_CONTRACT_UNRESOLVED");
      const committed = rpc("rpc_commit_chapter", {
        local_operator_id: operatorId,
        book_id: bookId,
        chapter_id: chapterId,
        chapter_version_id: candidateVersionId,
        idempotency_key: "b8-commit-current-y",
      });
      assert.equal(committed.ok, true, JSON.stringify(committed));
      assert.equal(committed.ids.audit_attempt_id, audited.ids.audit_id);
      assert.equal(count("chapter_version", `id=${sqlText(candidateVersionId)} AND version_state='formal' AND is_formal AND is_valid AND NOT is_shadow AND prose_text=${sqlText(rewrittenText)}`), 1);
      assert.equal(count("chapter_header", `id=${sqlText(chapterId)} AND is_finalized AND confirmation_status='unconfirmed'`), 1);
      assert.equal(
        sql(`SELECT atom_value_jsonb->>'last_formal_handoff' FROM public.world_state WHERE id=${sqlText(resourceWorldId)}`),
        "stable",
      );
      assert.equal(count("character_live_state", `book_id=${sqlText(bookId)} AND character_id=${sqlText(leadId)} AND is_formal AND is_valid AND NOT is_shadow AND current_goal_txt='Preserve the documented route.'`), 1);
      assert.equal(Number(sql(`SELECT trust FROM public.relation_state WHERE id=${sqlText(relationId)}`)), relationBefore.trust + 5);
      assert.equal(count("character_memory", `book_id=${sqlText(bookId)} AND char_id=${sqlText(leadId)} AND memory_content='The documented route held.' AND is_valid AND NOT is_shadow`), 1);
      assert.equal(count("narrative_asset", `chapter_version_id=${sqlText(candidateVersionId)} AND asset_name='当前候选关键事件' AND is_formal AND is_valid AND NOT is_shadow`), 1);
      assert.equal(count("writeback_log", `chapter_version_id=${sqlText(candidateVersionId)} AND status='success' AND writeback_scope_jsonb->>'audit_attempt_id'=${sqlText(audited.ids.audit_id)}`), 1);
      assert.equal(errorCode(rpc("rpc_record_iteration_sample", {
        local_operator_id: operatorId,
        book_id: bookId,
      })), "ITERATION_RETRY_CONTRACT_UNRESOLVED");

      const replay = rpc("rpc_commit_chapter", {
        local_operator_id: operatorId,
        book_id: bookId,
        chapter_id: chapterId,
        chapter_version_id: candidateVersionId,
        idempotency_key: "b8-commit-current-y",
      });
      assert.equal(replay.idempotent_replay, true, JSON.stringify(replay));

      const returned = rpc("rpc_archive_shadow_version", {
        local_operator_id: operatorId,
        book_id: bookId,
        chapter_id: chapterId,
        chapter_version_id: candidateVersionId,
        return_reason: "The creator returned the current formal chapter.",
        idempotency_key: "b8-return-current-y",
      });
      assert.equal(returned.ok, true, JSON.stringify(returned));
      const successorVersionId = returned.ids.successor_chapter_version_id;
      assert.match(successorVersionId, /^[0-9a-f-]{36}$/u);
      assert.equal(count("chapter_version", `id=${sqlText(candidateVersionId)} AND version_state='shadow' AND is_shadow AND NOT is_valid`), 1);
      assert.equal(count("chapter_version", `id=${sqlText(successorVersionId)} AND version_state='candidate' AND predecessor_version_id=${sqlText(candidateVersionId)} AND deduction_locked AND prose_text IS NULL AND prose_summary IS NULL`), 1);
      assert.deepEqual(
        JSON.parse(sql(`SELECT candidate_plot_sim_json FROM public.chapter_version WHERE id=${sqlText(successorVersionId)}`)),
        plotSnapshot,
      );
      assert.deepEqual(
        JSON.parse(sql(`SELECT atom_value_jsonb::text FROM public.world_state WHERE id=${sqlText(resourceWorldId)}`)),
        resourceWorldBefore,
      );
      assert.equal(count("character_live_state", `book_id=${sqlText(bookId)} AND character_id=${sqlText(leadId)} AND is_formal AND is_valid AND NOT is_shadow`), 0);
      assert.equal(Number(sql(`SELECT trust FROM public.relation_state WHERE id=${sqlText(relationId)}`)), relationBefore.trust);
      assert.equal(count("character_memory", `book_id=${sqlText(bookId)} AND char_id=${sqlText(leadId)} AND memory_content='The documented route held.' AND is_shadow AND NOT is_valid`), 1);
      assert.equal(count("narrative_asset", `chapter_version_id=${sqlText(candidateVersionId)} AND asset_name='当前候选关键事件' AND is_shadow AND NOT is_valid`), 1);
      assert.equal(count("audit_attempt_log", `id=${sqlText(audited.ids.audit_id)} AND is_shadow AND NOT is_valid`), 1);
      assert.equal(count("writeback_log", `chapter_version_id=${sqlText(candidateVersionId)} AND status='rolled_back'`), 1);
    });
  } catch (error) {
    if (!isDockerUnavailable(error)) throw error;
    return t.skip(runtimeUnavailableMessage(error, "PostgreSQL"));
  } finally {
    if (databaseCreated) dropTemporaryDatabase();
  }
});

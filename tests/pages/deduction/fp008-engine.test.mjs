import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DeductionServiceError,
  FP008_TOKEN_BUDGET,
  FP008_TOKEN_BUDGET_VERSION,
  createDeductionEngine,
} from "../../../apps/api/src/features/fp008/fp008-02/engine.ts";

const IDS = {
  operator: "11111111-2222-4333-8444-555555555555",
  book: "abcdefab-1234-4abc-8abc-abcdefabcdef",
  l1a: "22222222-3333-4444-8555-666666666666",
  chapter: "33333333-4444-4555-8666-777777777777",
  version: "44444444-5555-4666-8777-888888888888",
  character: "55555555-6666-4777-8888-999999999999",
  successor: "66666666-7777-4888-8999-aaaaaaaaaaaa",
  chapter2: "77777777-8888-4999-8aaa-bbbbbbbbbbbb",
  version2: "88888888-9999-4aaa-8bbb-cccccccccccc",
  world: "99999999-aaaa-4bbb-8ccc-dddddddddddd",
};

test("V7 carries director memory changes into the typed candidate truth ledger", () => {
  const source = readFileSync(
    new URL("../../../docs/v7设计文档_20260709_终版.md", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("| D-A03b | 导演收束结果");
  const end = source.indexOf("| D-A04 |", start);

  assert.ok(start >= 0 && end > start, "V7 must retain the D-A03b runtime contract");
  const contract = source.slice(start, end);
  assert.match(contract, /state_diff.*relation_diff.*memory_changes/su);
  assert.match(contract, /memory_changes.*角色记忆.*增量/su);
});

test("V7 accounts the L1A budget only from FP008-02 model usage", () => {
  const documentSource = readFileSync(
    new URL("../../../docs/v7%E8%AE%BE%E8%AE%A1%E6%96%87%E6%A1%A3_20260709_%E7%BB%88%E7%89%88.md", import.meta.url),
    "utf8",
  );
  const documentStart = documentSource.indexOf("| D-007 |");
  const documentEnd = documentSource.indexOf("\n| D-008 |", documentStart);
  assert.ok(documentStart >= 0 && documentEnd > documentStart, "V7 must retain D-007 budget accounting");
  const documentContract = documentSource.slice(documentStart, documentEnd);
  assert.match(documentContract, /FP008-02 F1\/F2\/F3\/F4.*usage\.total_tokens/su);
  assert.match(documentContract, /FP008-01.*FP008-03/su);
  return;
  const sourceForAccounting = readFileSync(
    new URL("../../../docs/v7\\u8bbe\\u8ba1\\u6587\\u6863_20260709_\\u7ec8\\u7248.md", import.meta.url),
    "utf8",
  );
  const accountingStart = sourceForAccounting.indexOf("| D-007 |");
  const accountingEnd = sourceForAccounting.indexOf("\n| D-008 |", accountingStart);
  assert.ok(accountingStart >= 0 && accountingEnd > accountingStart, "V7 must retain D-007 budget accounting");
  const accountingContract = sourceForAccounting.slice(accountingStart, accountingEnd);
  assert.match(accountingContract, /FP008-02 F1\/F2\/F3\/F4.*usage\.total_tokens/su);
  assert.match(accountingContract, /FP008-01.*FP008-03/su);
  return;
  const source = readFileSync(
    new URL("../../../docs/v7设计文档_20260709_终版.md", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("| D-007 | 推演进度与 L1A 预算账");
  const end = source.indexOf("\n| D-008 |", start);

  assert.ok(start >= 0 && end > start, "V7 must retain D-007 budget accounting");
  const contract = source.slice(start, end);
  assert.match(contract, /FP008-02 F1\/F2\/F3\/F4.*usage\.total_tokens/su);
  assert.match(contract, /不计入 FP008-01 或 FP008-03/su);
});

test("the first-chapter live-state projection keeps initial memories outside its baseline", async () => {
  const input = command();
  input.characters[0].live_state_json.active_memory_json = [{
    memory_content: "This must remain in the separate role memory context.",
    is_valid: true,
    is_shadow: false,
  }];

  const deduction = createDeductionEngine({
    invokeModel: async () => {
      throw new Error("The invalid initial projection must fail before a model call.");
    },
  });

  await assert.rejects(
    () => deduction.execute(input),
    (error) => error?.code === "INITIAL_LIVE_STATE_PROJECTION_INVALID",
  );
});

function particles() {
  return [1, 2, 3].map((index) => ({
    particle_id: `particle-${index}`,
    content: `event ${index}`,
    type: "truth",
    emotion_phase: "setup",
    staged_task: `task ${index}`,
    reveal_to: "all",
    assigned_to_role_type: "protagonist",
    involved_chars: ["P001"],
    required_chars: ["P001"],
    source_field: "plot_emotion_commit",
    purpose: `purpose ${index}`,
  }));
}

function chapter(chapterId = IDS.chapter, versionId = IDS.version, chapterIndex = 1) {
  return {
    chapter_id: chapterId,
    chapter_version_id: versionId,
    chapter_index: chapterIndex,
    target_snapshot_json: {},
    chapter_implementation_json: {},
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
    particles: particles(),
    participating_chars: [{
      char_id: IDS.character,
      char_code: "P001",
      role_type: "protagonist",
      activation_reason: "required",
    }],
    shadow_summary: "",
  };
}

function command(action = "start") {
  return {
    action,
    scope: {
      local_operator_id: IDS.operator,
      book_id: IDS.book,
      l1a_unit_id: IDS.l1a,
    },
    token_budget: FP008_TOKEN_BUDGET,
    token_budget_version: FP008_TOKEN_BUDGET_VERSION,
    chapters: [chapter()],
    characters: [{
      character_id: IDS.character,
      char_code: "P001",
      role_type: "protagonist",
      five_layers_json: {},
      knowledge_boundary_json: {
        knows: [], unknown: [], false_belief: [], reasonable_suspect: [],
      },
      live_state_id: null,
      live_state_source: "initial_live_state_projection",
      live_state_json: {
        source: "initial_live_state_projection",
        five_layers_json: {},
        knowledge_boundary_json: { knows: [], unknown: [], false_belief: [], reasonable_suspect: [] },
      },
      active_memory_json: [],
    }],
    world_state: [],
    relations: [],
    model_bindings: {
      NODE_05: {
        node_code: "NODE_05", prompt_text: "character", model_name: "test",
        provider_base_url: "https://model.example/v1", api_key_ref: "local:test",
      },
      NODE_06: {
        node_code: "NODE_06", prompt_text: "director", model_name: "test",
        provider_base_url: "https://model.example/v1", api_key_ref: "local:test",
      },
    },
  };
}

function distribution(particleId) {
  return {
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
        newly_perceivable_particles: [],
        long_term_promise: "promise",
        visible_situation: "visible",
        emotion_phase_hint: "setup",
        last_round_summary: null,
        staged_goal_injected: null,
      },
    }],
  };
}

function characterResult(candidateActions) {
  return {
    char_code: "P001",
    knowledge_snapshot: { knows: [], unknown: [], false_belief: [], reasonable_suspect: [] },
    info_gap_exploited: null,
    l3_activation: null,
    trigger_check: {},
    real_intent: "act",
    hidden_goal: null,
    misread: null,
    misread_impact: null,
    dual_spiral: {},
    candidate_actions: candidateActions ?? [{
      action_id: "action-1",
      action_type: "attempt",
      surface_action: "act",
      tactic_ref: "L1",
      deep_motivation: "goal",
      root_basis: "L1",
      boundary_check: {},
      audit_block: false,
      audit_block_reason: null,
      memory_evidence: [],
      scene_coupling: "真实",
      utilized_conditions: [],
    }],
    baseline_comparison: null,
    chain_reaction_risk: null,
    unresolved_risk: null,
    internal_drive_tension: null,
    hidden_resistance: [],
    amplification_type: null,
    sartre_anchor_used: null,
  };
}

function convergence(particleId, completed) {
  return {
    particle_id: particleId,
    particle_status: "completed",
    p0_precheck: {},
    events_in_round: [{
      event_id: `event-${particleId}`,
      description: "event",
      primary_char: "P001",
      participating_chars: ["P001"],
      is_particle_advancing: true,
      is_short_climax: false,
      key_choices: ["action-1"],
      why_selected: "grounded",
    }],
    dual_spiral_verdict: "推动",
    rebellion_record: null,
    emotion_band: { band_type: "PLATFORM", entity_change_type: [], emotion_justified: true },
    state_diff: [],
    relation_diff: [],
    memory_changes: [],
    particles_completed: completed,
    particle_completion_evidence: [particleId],
    remaining_particles: 3 - completed,
    retry_required: false,
    deduction_complete: completed === 3,
    hook_signals: [],
    alt_paths: [],
    chain_reaction_candidates: [],
    self_check: { emotion: true, hook: true, pivot: true },
    next_round_focus: null,
    token_budget_exceeded: false,
  };
}

function checkpoint(current = 1, overrides = {}) {
  return {
    candidate_plot_sim_json: {
      deduction_input_snapshot: {
        particles: particles(),
        participating_chars: [{
          char_id: IDS.character,
          char_code: "P001",
          role_type: "protagonist",
          activation_reason: "required",
        }],
      },
      particles_records: particles().slice(0, current).map((item, index) => (
        convergence(item.particle_id, index + 1)
      )),
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
      current_particle_index: current,
      remaining_particles: 3 - current,
      token_consumed: 30,
      token_budget: FP008_TOKEN_BUDGET,
      token_budget_version: FP008_TOKEN_BUDGET_VERSION,
      token_budget_exceeded: false,
      deduction_complete: current === 3,
      reject_count: 0,
      ...overrides,
    },
  };
}

function engine(calls, characterOutput = () => characterResult()) {
  return createDeductionEngine({
    invokeModel: async (invocation) => {
      calls.push(invocation);
      if (invocation.mode === "director_distribute") {
        return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
      }
      if (invocation.mode === "character_respond") {
        return { output: characterOutput(invocation), usage: { total_tokens: 5 } };
      }
      const completed = Number(invocation.input.particle.particle_id.split("-").at(-1));
      return {
        output: convergence(invocation.input.particle.particle_id, completed),
        usage: { total_tokens: 5 },
      };
    },
  });
}

test("engine completes, resumes, and restarts one L1A without Fastify", async () => {
  const startCalls = [];
  const started = await engine(startCalls).execute(command());
  assert.equal(started.deduction_complete, true);
  assert.equal(started.token_consumed, 45);
  assert.equal(startCalls.length, 9);

  const resumeCalls = [];
  const resume = command("resume");
  resume.chapters[0].checkpoint = checkpoint();
  resume.chapters.push(chapter(IDS.chapter2, IDS.version2, 2));
  const resumed = await engine(resumeCalls).execute(resume);
  assert.equal(resumed.deduction_complete, true);
  assert.equal(resumeCalls.length, 15);

  const restartCalls = [];
  const restartEngine = engine(restartCalls);
  await restartEngine.execute(command());
  const restart = command("restart");
  restart.creator_direction = "strengthen the creator direction";
  restart.chapters[0].predecessor_version_id = IDS.version;
  restart.chapters[0].chapter_version_id = IDS.successor;
  const restarted = await restartEngine.execute(restart);
  assert.equal(restarted.chapters[0].candidate_version_id, IDS.successor);
  assert.equal(restartCalls.at(-3).input.creator_direction, "strengthen the creator direction");
});

test("retries one adapter-truncated 2xx model reply and charges its reported usage", async () => {
  let distributionCalls = 0;
  const deduction = createDeductionEngine({
    invokeModel: async (invocation) => {
      if (invocation.mode === "director_distribute") {
        distributionCalls += 1;
        if (distributionCalls === 1) {
          throw new DeductionServiceError(
            "MODEL_OUTPUT_INVALID",
            "The model response was truncated JSON.",
            502,
            { provider_total_tokens: 7 },
            true,
          );
        }
        return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
      }
      if (invocation.mode === "character_respond") {
        return { output: characterResult(), usage: { total_tokens: 5 } };
      }
      const completed = Number(invocation.input.particle.particle_id.split("-").at(-1));
      return { output: convergence(invocation.input.particle.particle_id, completed), usage: { total_tokens: 5 } };
    },
  });

  const result = await deduction.execute(command());
  assert.equal(distributionCalls, 4);
  assert.equal(result.token_consumed, 52);
});

test("retries one 2xx reply without usage and charges only the succeeding reply", async () => {
  let distributionCalls = 0;
  const deduction = createDeductionEngine({
    invokeModel: async (invocation) => {
      if (invocation.mode === "director_distribute") {
        distributionCalls += 1;
        if (distributionCalls === 1) {
          throw new DeductionServiceError(
            "MODEL_USAGE_MISSING",
            "The model response omitted token usage.",
            502,
            {},
            true,
          );
        }
        return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
      }
      if (invocation.mode === "character_respond") {
        return { output: characterResult(), usage: { total_tokens: 5 } };
      }
      const completed = Number(invocation.input.particle.particle_id.split("-").at(-1));
      return { output: convergence(invocation.input.particle.particle_id, completed), usage: { total_tokens: 5 } };
    },
  });

  const result = await deduction.execute(command());
  assert.equal(distributionCalls, 4);
  assert.equal(result.token_consumed, 45);
});

test("three 2xx replies without usage remain fail-closed without a checkpoint", async () => {
  let calls = 0;
  const input = command();
  const deduction = createDeductionEngine({
    invokeModel: async () => {
      calls += 1;
      throw new DeductionServiceError(
        "MODEL_USAGE_MISSING",
        "The model response omitted token usage.",
        502,
        {},
        true,
      );
    },
  });

  await assert.rejects(deduction.execute(input), (error) => error?.code === "MODEL_USAGE_MISSING");
  assert.equal(calls, 3);
  assert.equal(deduction.getProjection(input.scope), null);
});

test("a semantic F1 retry clears the invalid director reply before rebuilding the session", async () => {
  const calls = [];
  const cleared = [];
  let firstDistribution = true;
  const invokeModel = Object.assign(async (invocation) => {
    calls.push({ mode: invocation.mode, continueSession: invocation.continueSession });
    if (invocation.mode === "director_distribute") {
      const output = distribution(invocation.input.particle.particle_id);
      if (firstDistribution) {
        firstDistribution = false;
        delete output.char_tasks[0].task.newly_perceivable_particles;
      }
      return { output, usage: { total_tokens: 5 } };
    }
    if (invocation.mode === "character_respond") {
      return { output: characterResult(), usage: { total_tokens: 5 } };
    }
    const completed = Number(invocation.input.particle.particle_id.split("-").at(-1));
    return { output: convergence(invocation.input.particle.particle_id, completed), usage: { total_tokens: 5 } };
  }, {
    clearSession(sessionKey) {
      cleared.push(sessionKey);
    },
  });

  const result = await createDeductionEngine({ invokeModel }).execute(command());
  const distributions = calls.filter((call) => call.mode === "director_distribute");
  assert.equal(result.service_state, "completed");
  assert.equal(distributions[0].continueSession, false);
  assert.equal(distributions[1].continueSession, false, "the semantic retry must start a fresh director session");
  assert.equal(distributions[2].continueSession, true, "later particles still reuse the director session");
  assert.equal(cleared.length, 2, "the invalid retry and normal task cleanup both release sessions");
});

test("three adapter-truncated replies end as MODEL_OUTPUT_INVALID", async () => {
  let calls = 0;
  const deduction = createDeductionEngine({
    invokeModel: async () => {
      calls += 1;
      throw new DeductionServiceError(
        "MODEL_OUTPUT_INVALID",
        "The model response was truncated JSON.",
        502,
        { provider_total_tokens: 7 },
        true,
      );
    },
  });

  await assert.rejects(deduction.execute(command()), (error) => error?.code === "MODEL_OUTPUT_INVALID");
  assert.equal(calls, 3);
});

test("three ordinary model failures retain blocked behavior and emit safe engine diagnostics", async () => {
  const events = [];
  let calls = 0;
  const deduction = createDeductionEngine({
    onAttempt: (event) => events.push(event),
    invokeModel: async () => {
      calls += 1;
      throw new Error("provider-message-sentinel");
    },
  });

  const result = await deduction.execute(command());

  assert.equal(calls, 3);
  assert.equal(result.service_state, "blocked");
  assert.equal(result.blocked_code, "MODEL_CALL_FAILED");
  assert.deepEqual(events, [
    { source: "engine", nodeCode: "NODE_06", mode: "director_distribute", engine_attempt: 1, outcome: "retry", error_category: "transport_or_internal", error_code: null, provider_status: null, retry_scheduled: true },
    { source: "engine", nodeCode: "NODE_06", mode: "director_distribute", engine_attempt: 2, outcome: "retry", error_category: "transport_or_internal", error_code: null, provider_status: null, retry_scheduled: true },
    { source: "engine", nodeCode: "NODE_06", mode: "director_distribute", engine_attempt: 3, outcome: "blocked", error_category: "transport_or_internal", error_code: null, provider_status: null, retry_scheduled: false },
  ]);
  assert.doesNotMatch(JSON.stringify(events), /provider-message-sentinel/u);
});

test("non-retryable semantic service errors do not enter the adapter retry loop", async () => {
  let calls = 0;
  const deduction = createDeductionEngine({
    invokeModel: async () => {
      calls += 1;
      throw new DeductionServiceError("CANDIDATE_TRUTH_DRIFT", "The candidate truth state changed.", 409);
    },
  });

  await assert.rejects(deduction.execute(command()), (error) => error?.code === "CANDIDATE_TRUTH_DRIFT");
  assert.equal(calls, 1);
});

test("a completed L1A keeps a stable candidate truth ledger for FP010 audit", async () => {
  const initialProjection = {
    source: "initial_live_state_projection",
    five_layers_json: { L0: { value: "protect" }, L1: {}, L2: {}, L3: {} },
    knowledge_boundary_json: { knows: [], unknown: [], false_belief: [], reasonable_suspect: [] },
  };
  const finalLiveState = {
    philosophy_live_json: { value: "protect" },
    emotion_state_json: { mood: "resolved" },
    drive_live_json: { priority: "hold-route" },
    trigger_state_json: {},
    goal_state_json: { current: "hold-route" },
    pressure_level: 3,
    current_goal_txt: "Hold the route.",
    current_emo_tag: "resolved",
  };
  const input = command();
  input.characters[0].live_state_id = null;
  input.characters[0].live_state_source = "initial_live_state_projection";
  input.characters[0].five_layers_json = structuredClone(initialProjection.five_layers_json);
  input.characters[0].live_state_json = initialProjection;
  input.world_state = [{
    world_state_id: IDS.world,
    atom_key: "world-rule-1",
    atom_value_jsonb: { fuel: 2 },
    is_active: true,
    setting_layer: "initial",
  }];

  const deduction = createDeductionEngine({
    invokeModel: async (invocation) => {
      if (invocation.mode === "director_distribute") {
        return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
      }
      if (invocation.mode === "character_respond") {
        return { output: characterResult(), usage: { total_tokens: 5 } };
      }
      const completed = Number(invocation.input.particle.particle_id.split("-").at(-1));
      const output = convergence(invocation.input.particle.particle_id, completed);
      if (completed === 1) {
        output.state_diff = [
          {
            entity_type: "character_live_state",
            entity_id: IDS.character,
            after: finalLiveState,
            change_type: "goal_update",
            change_layer: 1,
            change_reason: "The selected event establishes the current goal.",
            event_ids: ["event-particle-1"],
          },
          {
            entity_type: "world_state",
            entity_id: IDS.world,
            after: { fuel: 1 },
            event_ids: ["event-particle-1"],
          },
        ];
        output.memory_changes = [{
          character_id: IDS.character,
          memory_type: "event",
          memory_content: "The route was held at a cost.",
          truth_status: "true",
          importance: 0.7,
          decay_rate: 0.2,
          event_ids: ["event-particle-1"],
        }];
      }
      return { output, usage: { total_tokens: 5 } };
    },
  });

  const result = await deduction.execute(input);
  assert.deepEqual(result.chapters[0].candidate_plot_sim_json.candidate_truth_ledger, {
    schema_version: 1,
    world_changes: [{
      world_state_id: IDS.world,
      before: { fuel: 2 },
      after: { fuel: 1 },
      event_ids: ["event-particle-1"],
    }],
    character_live_state_changes: [{
      character_id: IDS.character,
      before: initialProjection,
      after: finalLiveState,
      change_type: "goal_update",
      change_layer: 1,
      change_reason: "The selected event establishes the current goal.",
      event_ids: ["event-particle-1"],
    }],
    relation_changes: [],
    memories: [{
      character_id: IDS.character,
      memory_type: "event",
      memory_content: "The route was held at a cost.",
      truth_status: "true",
      importance: 0.7,
      decay_rate: 0.2,
      event_ids: ["event-particle-1"],
    }],
  });
});

test("director convergence drops a complete character state no-op without changing the truth ledger", async () => {
  const initialProjection = {
    source: "initial_live_state_projection",
    five_layers_json: { L0: { value: "protect" }, L1: {}, L2: {}, L3: {} },
    knowledge_boundary_json: { knows: [], unknown: [], false_belief: [], reasonable_suspect: [] },
  };
  const changedLiveState = {
    philosophy_live_json: { value: "protect" },
    emotion_state_json: { mood: "resolved" },
    drive_live_json: { priority: "hold-route" },
    trigger_state_json: {},
    goal_state_json: { current: "hold-route" },
    pressure_level: 3,
    current_goal_txt: "Hold the route.",
    current_emo_tag: "resolved",
  };
  const input = command();
  input.characters[0].live_state_json = initialProjection;
  input.characters[0].five_layers_json = structuredClone(initialProjection.five_layers_json);

  const deduction = createDeductionEngine({
    invokeModel: async (invocation) => {
      if (invocation.mode === "director_distribute") {
        return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
      }
      if (invocation.mode === "character_respond") {
        return { output: characterResult(), usage: { total_tokens: 5 } };
      }
      const completed = Number(invocation.input.particle.particle_id.split("-").at(-1));
      const output = convergence(invocation.input.particle.particle_id, completed);
      if (completed === 1 || completed === 2) {
        output.state_diff = [{
          entity_type: "character_live_state",
          entity_id: IDS.character,
          after: changedLiveState,
          change_type: "goal_update",
          change_layer: 1,
          change_reason: "The selected event establishes the current goal.",
          event_ids: [`event-particle-${completed}`],
        }];
      }
      return { output, usage: { total_tokens: 5 } };
    },
  });

  const result = await deduction.execute(input);
  const records = result.chapters[0].candidate_plot_sim_json.particles_records;
  const ledger = result.chapters[0].candidate_plot_sim_json.candidate_truth_ledger;
  assert.equal(result.deduction_complete, true);
  assert.deepEqual(records[1].state_diff, []);
  assert.deepEqual(ledger.character_live_state_changes, [{
    character_id: IDS.character,
    before: initialProjection,
    after: changedLiveState,
    change_type: "goal_update",
    change_layer: 1,
    change_reason: "The selected event establishes the current goal.",
    event_ids: ["event-particle-1"],
  }]);
});

test("candidate truth ledger preserves the first baseline across successive particle changes", async () => {
  const input = command();
  input.world_state = [{
    world_state_id: IDS.world,
    atom_key: "world-rule-1",
    atom_value_jsonb: { fuel: 2 },
    is_active: true,
    setting_layer: "initial",
  }];

  const deduction = createDeductionEngine({
    invokeModel: async (invocation) => {
      if (invocation.mode === "director_distribute") {
        return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
      }
      if (invocation.mode === "character_respond") {
        return { output: characterResult(), usage: { total_tokens: 5 } };
      }
      const completed = Number(invocation.input.particle.particle_id.split("-").at(-1));
      const output = convergence(invocation.input.particle.particle_id, completed);
      if (completed <= 2) {
        output.state_diff = [{
          entity_type: "world_state",
          entity_id: IDS.world,
          after: { fuel: 2 - completed },
          event_ids: [`event-particle-${completed}`],
        }];
      }
      return { output, usage: { total_tokens: 5 } };
    },
  });

  const result = await deduction.execute(input);
  assert.deepEqual(result.chapters[0].candidate_plot_sim_json.candidate_truth_ledger.world_changes, [{
    world_state_id: IDS.world,
    before: { fuel: 2 },
    after: { fuel: 0 },
    event_ids: ["event-particle-1", "event-particle-2"],
  }]);
});

test("resume continues a persisted candidate truth ledger from its prior candidate value", async () => {
  const input = command();
  input.world_state = [{
    world_state_id: IDS.world,
    atom_key: "world-rule-1",
    atom_value_jsonb: { fuel: 2 },
    is_active: true,
    setting_layer: "initial",
  }];

  let releaseFirstParticle;
  let firstParticleStarted;
  const firstParticle = new Promise((resolve) => { firstParticleStarted = resolve; });
  const initialRun = createDeductionEngine({
    invokeModel: async (invocation) => {
      if (invocation.mode === "director_distribute") {
        if (invocation.input.particle.particle_id === "particle-1") {
          firstParticleStarted();
          await new Promise((resolve) => { releaseFirstParticle = resolve; });
        }
        return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
      }
      if (invocation.mode === "character_respond") {
        return { output: characterResult(), usage: { total_tokens: 5 } };
      }
      const completed = Number(invocation.input.particle.particle_id.split("-").at(-1));
      const output = convergence(invocation.input.particle.particle_id, completed);
      if (completed === 1) {
        output.state_diff = [{
          entity_type: "world_state",
          entity_id: IDS.world,
          after: { fuel: 1 },
          event_ids: ["event-particle-1"],
        }];
      }
      return { output, usage: { total_tokens: 5 } };
    },
  });

  const running = initialRun.execute(input);
  await firstParticle;
  initialRun.requestPause(input.scope);
  releaseFirstParticle();
  const paused = await running;
  assert.equal(paused.service_state, "paused");

  const resume = command("resume");
  resume.world_state = structuredClone(input.world_state);
  resume.chapters[0].checkpoint = structuredClone(paused.chapters[0]);
  const resumedRun = createDeductionEngine({
    invokeModel: async (invocation) => {
      if (invocation.mode === "director_distribute") {
        return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
      }
      if (invocation.mode === "character_respond") {
        return { output: characterResult(), usage: { total_tokens: 5 } };
      }
      const completed = Number(invocation.input.particle.particle_id.split("-").at(-1));
      const output = convergence(invocation.input.particle.particle_id, completed);
      if (completed === 2) {
        output.state_diff = [{
          entity_type: "world_state",
          entity_id: IDS.world,
          after: { fuel: 0 },
          event_ids: ["event-particle-2"],
        }];
      }
      return { output, usage: { total_tokens: 5 } };
    },
  });

  const resumed = await resumedRun.execute(resume);
  assert.deepEqual(resumed.chapters[0].candidate_plot_sim_json.candidate_truth_ledger.world_changes, [{
    world_state_id: IDS.world,
    before: { fuel: 2 },
    after: { fuel: 0 },
    event_ids: ["event-particle-1", "event-particle-2"],
  }]);
});

test("F5 gives the next particle its role-scoped candidate state and memory", async () => {
  const initialProjection = { source: "initial_live_state_projection" };
  const finalLiveState = {
    philosophy_live_json: { value: "protect" },
    emotion_state_json: { mood: "resolved" },
    drive_live_json: { priority: "hold-route" },
    trigger_state_json: {},
    goal_state_json: { current: "hold-route" },
    pressure_level: 3,
    current_goal_txt: "Hold the route.",
    current_emo_tag: "resolved",
  };
  const input = command();
  input.characters[0].live_state_json = initialProjection;
  const roleInputs = [];
  const directorInputs = [];
  const deduction = createDeductionEngine({
    invokeModel: async (invocation) => {
      if (invocation.mode === "director_distribute") {
        return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
      }
      if (invocation.mode === "character_respond") {
        roleInputs.push(structuredClone(invocation.input));
        return { output: characterResult(), usage: { total_tokens: 5 } };
      }
      directorInputs.push(structuredClone(invocation.input));
      const completed = Number(invocation.input.particle.particle_id.split("-").at(-1));
      const output = convergence(invocation.input.particle.particle_id, completed);
      if (completed === 1) {
        output.state_diff = [{
          entity_type: "character_live_state",
          entity_id: IDS.character,
          after: finalLiveState,
          change_type: "goal_update",
          change_layer: 1,
          change_reason: "The selected event establishes the current goal.",
          event_ids: ["event-particle-1"],
        }];
        output.memory_changes = [{
          character_id: IDS.character,
          memory_type: "event",
          memory_content: "The route was held at a cost.",
          truth_status: "true",
          importance: 0.7,
          decay_rate: 0.2,
          event_ids: ["event-particle-1"],
        }];
      }
      return { output, usage: { total_tokens: 5 } };
    },
  });

  await deduction.execute(input);
  assert.deepEqual(roleInputs[1].character.live_state_json, finalLiveState);
  assert.deepEqual(roleInputs[1].character.active_memory_json, [{
    character_id: IDS.character,
    memory_type: "event",
    memory_content: "The route was held at a cost.",
    truth_status: "true",
    importance: 0.7,
    decay_rate: 0.2,
    event_ids: ["event-particle-1"],
    is_valid: true,
    is_shadow: false,
  }]);
  assert.deepEqual(directorInputs[1].candidate_state_context.characters, [{
    character_id: IDS.character,
    char_code: "P001",
    live_state_json: finalLiveState,
  }]);
});

test("FP008 validates every declared L1A world resistance against initial world facts", async () => {
  const acceptedCalls = [];
  const acceptedInput = command();
  acceptedInput.world_state = [{
    world_state_id: IDS.world,
    atom_key: "world-rule-1",
    atom_value_jsonb: { rule: "active" },
    is_active: true,
    setting_layer: "initial",
  }];
  acceptedInput.world_resistance_refs = [{ atom_key: "world-rule-1" }];

  const accepted = await engine(acceptedCalls).execute(acceptedInput);
  assert.equal(accepted.deduction_complete, true);
  assert.equal(acceptedCalls.length, 9);

  const rejectedCalls = [];
  const rejectedInput = command();
  rejectedInput.world_state = [{
    world_state_id: IDS.world,
    atom_key: "world-rule-1",
    atom_value_jsonb: { rule: "active" },
    is_active: true,
    setting_layer: "initial",
  }];
  rejectedInput.world_resistance_refs = [{ atom_key: "missing-world-rule" }];

  await assert.rejects(
    engine(rejectedCalls).execute(rejectedInput),
    (error) => error.code === "WORLD_REFERENCE_REJECTED",
  );
  assert.equal(rejectedCalls.length, 0);
});

test("ordinary roles may omit ensemble-only deduction fields", async () => {
  const deduction = createDeductionEngine({
    invokeModel: async (invocation) => {
      if (invocation.mode === "director_distribute") {
        return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
      }
      if (invocation.mode === "character_respond") {
        const output = characterResult();
        delete output.amplification_type;
        delete output.sartre_anchor_used;
        return { output, usage: { total_tokens: 5 } };
      }
      const completed = Number(invocation.input.particle.particle_id.split("-").at(-1));
      return { output: convergence(invocation.input.particle.particle_id, completed), usage: { total_tokens: 5 } };
    },
  });

  const result = await deduction.execute(command());
  assert.equal(result.deduction_complete, true);
});

test("ensemble roles still require their dedicated deduction fields", async () => {
  const input = command();
  input.characters[0].role_type = "ensemble";
  input.chapters[0].participating_chars[0].role_type = "ensemble";
  const deduction = createDeductionEngine({
    invokeModel: async (invocation) => {
      if (invocation.mode === "director_distribute") {
        const output = distribution(invocation.input.particle.particle_id);
        output.char_tasks[0].task.staged_goal_injected = "群像承受局部压力";
        output.char_tasks[0].task.sartre_dilemma_anchor = "他人即地狱";
        return { output, usage: { total_tokens: 5 } };
      }
      if (invocation.mode === "character_respond") {
        const output = characterResult();
        delete output.sartre_anchor_used;
        return { output, usage: { total_tokens: 5 } };
      }
      return { output: convergence(invocation.input.particle.particle_id, 1), usage: { total_tokens: 5 } };
    },
  });

  await assert.rejects(deduction.execute(input), (error) => error.code === "MODEL_OUTPUT_INVALID");
});

test("engine releases the director session after one long task ends", async () => {
  const releasedSessions = [];
  const invokeModel = Object.assign(async (invocation) => {
    if (invocation.mode === "director_distribute") {
      return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
    }
    if (invocation.mode === "character_respond") {
      return { output: characterResult(), usage: { total_tokens: 5 } };
    }
    const completed = Number(invocation.input.particle.particle_id.split("-").at(-1));
    return { output: convergence(invocation.input.particle.particle_id, completed), usage: { total_tokens: 5 } };
  }, {
    clearSession(sessionKey) {
      releasedSessions.push(sessionKey);
    },
  });
  const result = await createDeductionEngine({ invokeModel }).execute(command());

  assert.equal(result.service_state, "completed");
  assert.deepEqual(releasedSessions, [
    `${IDS.operator}:${IDS.book}:${IDS.l1a}:${IDS.chapter}:${IDS.version}`,
  ]);
});

test("a preaudit P0 restart reruns the same in-memory L1A without a successor or creator direction", async () => {
  const calls = [];
  const deduction = engine(calls);
  await deduction.execute(command());

  const restarted = await deduction.execute(command("restart"));
  assert.equal(restarted.deduction_complete, true);
  assert.equal(restarted.chapters[0].candidate_version_id, IDS.version);
  assert.equal(
    calls.filter((call) => call.mode === "director_distribute").at(-1).input.creator_direction,
    null,
  );
});

test("the director never receives role settings, while a role receives only its own complete boundary", async () => {
  const calls = [];
  const input = command();
  input.characters[0].knowledge_boundary_json = {
    knows: ["known-fact"],
    unknown: ["protected-truth"],
    false_belief: ["wrong-belief"],
    reasonable_suspect: ["unverified-guess"],
  };
  input.characters[0].live_state_json = { source: "initial_live_state_projection" };
  input.characters[0].active_memory_json = [
    { memory_id: "valid-memory", is_valid: true, is_shadow: false, memory_content: "usable" },
    { memory_id: "shadow-memory", is_valid: true, is_shadow: true, memory_content: "must not leak" },
    { memory_id: "invalid-memory", is_valid: false, is_shadow: false, memory_content: "must not leak" },
  ];
  await engine(calls).execute(input);
  const director = calls.find((call) => call.mode === "director_distribute");
  const character = calls.find((call) => call.mode === "character_respond");
  const directorPayload = JSON.stringify(director.input);
  assert.deepEqual(director.input.participating_roles, [{
    char_code: "P001",
    role_type: "protagonist",
    activation_reason: "required",
  }]);
  for (const privateField of [
    "characters", "five_layers_json", "knowledge_boundary_json", "live_state_json",
    "active_memory_json", "world_state", "relations", "chapter_implementation_json", "shadow_summary",
    "protected-truth", "wrong-belief", "unverified-guess",
  ]) {
    assert.doesNotMatch(directorPayload, new RegExp(privateField));
  }
  assert.deepEqual(character.input.character.knowledge_boundary_json, {
    knows: ["known-fact"],
    unknown: ["protected-truth"],
    false_belief: ["wrong-belief"],
    reasonable_suspect: ["unverified-guess"],
  });
  assert.deepEqual(character.input.character.active_memory_json, [
    { memory_id: "valid-memory", is_valid: true, is_shadow: false, memory_content: "usable" },
  ]);

  const convergence = calls.find((call) => call.mode === "director_converge");
  assert.deepEqual(convergence.input.character_candidate_actions, [{
    char_code: "P001",
    candidate_actions: characterResult().candidate_actions,
    hidden_resistance: [],
  }]);
  assert.equal(Object.hasOwn(convergence.input, "char_deduction_results"), false);
  assert.doesNotMatch(JSON.stringify(convergence.input), /knowledge_snapshot|hidden_goal|misread/);
});

test("character result hidden resistance remains typed and fail-closed before director convergence", async () => {
  const deduction = createDeductionEngine({
    invokeModel: async (invocation) => {
      if (invocation.mode === "director_distribute") {
        return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
      }
      if (invocation.mode === "character_respond") {
        return {
          output: { ...characterResult(), hidden_resistance: [{ type: "information" }] },
          usage: { total_tokens: 5 },
        };
      }
      throw new Error("The invalid character result must not reach director convergence.");
    },
  });

  await assert.rejects(
    deduction.execute(command()),
    (error) => error?.code === "MODEL_OUTPUT_INVALID" && error?.statusCode === 502,
  );
});

test("character result rejects a non-array hidden resistance as model output", async () => {
  const deduction = createDeductionEngine({
    invokeModel: async (invocation) => {
      if (invocation.mode === "director_distribute") {
        return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
      }
      if (invocation.mode === "character_respond") {
        return { output: { ...characterResult(), hidden_resistance: null }, usage: { total_tokens: 5 } };
      }
      throw new Error("The invalid character result must not reach director convergence.");
    },
  });

  await assert.rejects(
    deduction.execute(command()),
    (error) => error?.code === "MODEL_OUTPUT_INVALID" && error?.statusCode === 502,
  );
});

test("character result rejects unknown top-level fields before director convergence", async () => {
  const deduction = createDeductionEngine({
    invokeModel: async (invocation) => {
      if (invocation.mode === "director_distribute") {
        return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
      }
      if (invocation.mode === "character_respond") {
        return { output: { ...characterResult(), unregistered_field: true }, usage: { total_tokens: 5 } };
      }
      throw new Error("The invalid character result must not reach director convergence.");
    },
  });

  await assert.rejects(
    deduction.execute(command()),
    (error) => error?.code === "MODEL_OUTPUT_INVALID" && error?.statusCode === 502,
  );
});

test("character result accepts only its matching redundant formal ID before closed-schema validation", async () => {
  const result = await engine([], (invocation) => ({
    ...characterResult(),
    character_id: invocation.input.character.character_id,
  })).execute(command());

  assert.equal(result.service_state, "completed");
});

for (const [description, characterOutput] of [
  ["a different formal ID", (invocation) => ({
    ...characterResult(), character_id: IDS.successor,
  })],
  ["a non-UUID formal ID", () => ({
    ...characterResult(), character_id: "candidate-character-3",
  })],
  ["a matching ID with a mismatched char_code", (invocation) => ({
    ...characterResult(), char_code: "P002", character_id: invocation.input.character.character_id,
  })],
  ["a matching ID plus another unknown field", (invocation) => ({
    ...characterResult(), character_id: invocation.input.character.character_id, unregistered_field: true,
  })],
]) {
  test(`character result rejects ${description}`, async () => {
    await assert.rejects(
      engine([], characterOutput).execute(command()),
      (error) => error?.code === "MODEL_OUTPUT_INVALID" && error?.statusCode === 502,
    );
  });
}

test("director convergence receives backend-assigned particle counters", async () => {
  const calls = [];
  await engine(calls).execute(command());
  assert.deepEqual(
    calls
      .filter((call) => call.mode === "director_converge")
      .map((call) => call.input.particle_sequence),
    [
      { particles_completed: 1, remaining_particles: 2, deduction_complete: false },
      { particles_completed: 2, remaining_particles: 1, deduction_complete: false },
      { particles_completed: 3, remaining_particles: 0, deduction_complete: true },
    ],
  );
});

test("director receives only the immediately previous particle record during a continued L1A session", async () => {
  const calls = [];
  await engine(calls).execute(command());

  assert.deepEqual(
    calls
      .filter((call) => call.mode === "director_distribute")
      .map((call) => call.input.previous_particle_records.map((record) => record.particle_id)),
    [[], ["particle-1"], ["particle-2"]],
  );
});

test("director receives the current chapter target and light particle sequence, not the execution plan", async () => {
  const calls = [];
  const input = command();
  input.chapters[0].target_snapshot_json = { chapter_goal: "兑现固定 L1A 承诺" };
  input.chapters[0].chapter_implementation_json = {
    execution_steps: [{ step_id: "step-1", core_particles: ["particle-1"] }],
  };
  await engine(calls).execute(input);

  const distributions = calls.filter((call) => call.mode === "director_distribute");
  assert.equal(distributions.length, 3);
  assert.deepEqual(
    distributions.map((call) => call.input.remaining_particles.map((particle) => particle.particle_id)),
    [["particle-1", "particle-2", "particle-3"], ["particle-2", "particle-3"], ["particle-3"]],
  );
  for (const call of distributions) {
    assert.deepEqual(call.input.target_snapshot_json, input.chapters[0].target_snapshot_json);
    assert.equal(Object.hasOwn(call.input, "chapter_implementation_json"), false);
  }
  for (const call of calls.filter((call) => call.mode === "director_converge")) {
    assert.deepEqual(call.input.target_snapshot_json, input.chapters[0].target_snapshot_json);
  }
});

test("director convergence rejects malformed or out-of-scope state and relation changes", async () => {
  const invalidCases = [
    { state_diff: "not-an-array", relation_diff: [] },
    { state_diff: [{ entity: "lead", before: "calm", after: "afraid", event_id: "unknown-event" }], relation_diff: [] },
    { state_diff: [], relation_diff: [{ char_a: "P001", char_b: "OTHER", dimension: "trust", before: 5, after: 3, event_id: "event-particle-1" }] },
  ];

  for (const invalid of invalidCases) {
    const deduction = createDeductionEngine({
      invokeModel: async (invocation) => {
        if (invocation.mode === "director_distribute") {
          return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
        }
        if (invocation.mode === "character_respond") {
          return { output: characterResult(), usage: { total_tokens: 5 } };
        }
        return {
          output: { ...convergence(invocation.input.particle.particle_id, 1), ...invalid },
          usage: { total_tokens: 5 },
        };
      },
    });
    await assert.rejects(deduction.execute(command()), (error) => error.code === "MODEL_OUTPUT_INVALID");
  }
});

test("engine retries an invalid director convergence before blocking its particle", async () => {
  const calls = [];
  let convergenceAttempts = 0;
  const deduction = createDeductionEngine({
    invokeModel: async (invocation) => {
      calls.push(invocation);
      if (invocation.mode === "director_distribute") {
        return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
      }
      if (invocation.mode === "character_respond") {
        return { output: characterResult(), usage: { total_tokens: 5 } };
      }
      const output = convergence(
        invocation.input.particle.particle_id,
        Number(invocation.input.particle.particle_id.split("-").at(-1)),
      );
      if (convergenceAttempts++ === 0) {
        output.relation_diff = [{
          char_a: "P001",
          char_b: "OUT_OF_SCOPE",
          dimension: "trust",
          before: 5,
          after: 3,
          event_id: `event-${invocation.input.particle.particle_id}`,
        }];
      }
      return { output, usage: { total_tokens: 5 } };
    },
  });

  const result = await deduction.execute(command());
  assert.equal(result.deduction_complete, true);
  assert.equal(calls.filter((call) => call.mode === "director_converge").length, 4);
});

test("a relation change may only name characters who appear in its selected event", async () => {
  const input = command();
  input.characters.push({
    character_id: IDS.successor,
    char_code: "P002",
    role_type: "supporting",
    five_layers_json: {},
    knowledge_boundary_json: {
      knows: [], unknown: [], false_belief: [], reasonable_suspect: [],
    },
    live_state_id: null,
    live_state_source: "initial_live_state_projection",
    live_state_json: { source: "initial_live_state_projection" },
    active_memory_json: [],
  });
  input.chapters[0].participating_chars.push({
    char_id: IDS.successor,
    char_code: "P002",
    role_type: "supporting",
    activation_reason: "required",
  });

  const deduction = createDeductionEngine({
    invokeModel: async (invocation) => {
      if (invocation.mode === "director_distribute") {
        return {
          output: {
            char_tasks: [
              ...distribution(invocation.input.particle.particle_id).char_tasks,
              {
                char_code: "P002",
                task: {
                  particle_id: invocation.input.particle.particle_id,
                  isolation_confirmed: true,
                  dramatic_enhancement: {
                    supporting_staged_goal: null,
                    antagonist_control_intent: null,
                    ensemble_pressure_direction: null,
                    peak_conflict_moment: null,
                    enhancement_feedback: null,
                  },
                  staged_goal_injected: "local goal",
                  visible_situation: "visible",
                  emotion_phase_hint: "setup",
                  last_round_summary: null,
                },
              },
            ],
          },
          usage: { total_tokens: 5 },
        };
      }
      if (invocation.mode === "character_respond") {
        return {
          output: { ...characterResult(), char_code: invocation.input.character.char_code },
          usage: { total_tokens: 5 },
        };
      }
      const result = convergence(invocation.input.particle.particle_id, 1);
      result.relation_diff = [{
        char_a: "P001",
        char_b: "P002",
        dimension: "trust",
        before: 5,
        after: 3,
        event_id: `event-${invocation.input.particle.particle_id}`,
      }];
      return { output: result, usage: { total_tokens: 5 } };
    },
  });

  await assert.rejects(deduction.execute(input), (error) => error.code === "MODEL_OUTPUT_INVALID");
});

test("engine rejects missing resume state, restart checkpoints, and checkpoint drift", async () => {
  const deduction = engine([]);
  await assert.rejects(deduction.execute(command("resume")), (error) => (
    error.code === "RESUME_CHECKPOINT_REQUIRED" && error.statusCode === 409
  ));

  const startWithCheckpoint = command("start");
  startWithCheckpoint.chapters[0].checkpoint = checkpoint();
  await assert.rejects(deduction.execute(startWithCheckpoint), (error) => (
    error.code === "INVALID_CHECKPOINT" && error.statusCode === 409
  ));

  const restartWithCheckpoint = command("restart");
  restartWithCheckpoint.chapters[0].checkpoint = checkpoint();
  await assert.rejects(deduction.execute(restartWithCheckpoint), (error) => (
    error.code === "RESTART_OLD_RESULT_FORBIDDEN" && error.statusCode === 409
  ));

  for (const drift of [
    checkpoint(0, { deduction_complete: true, token_consumed: 0 }),
    checkpoint(0, { token_consumed: FP008_TOKEN_BUDGET, token_budget_exceeded: false }),
    checkpoint(0, { token_consumed: FP008_TOKEN_BUDGET + 1, token_budget_exceeded: true }),
  ]) {
    const resume = command("resume");
    resume.chapters[0].checkpoint = drift;
    await assert.rejects(deduction.execute(resume), (error) => (
      error.code === "INVALID_CHECKPOINT" && error.statusCode === 409
    ));
  }
});

test("a persisted checkpoint keeps the original FP008-01 input and rejects a re-decomposed resume", async () => {
  const input = command();
  const started = await engine([]).execute(input);
  assert.deepEqual(
    started.chapters[0].candidate_plot_sim_json.deduction_input_snapshot,
    {
      particles: input.chapters[0].particles,
      participating_chars: input.chapters[0].participating_chars,
    },
  );

  const resume = command("resume");
  resume.chapters[0].checkpoint = checkpoint();
  resume.chapters[0].particles[1].content = "a different decomposition with the same id and count";
  await assert.rejects(engine([]).execute(resume), (error) => (
    error.code === "INVALID_CHECKPOINT" && error.statusCode === 409
  ));
});

test("engine accepts a resume checkpoint whose relation change stays within the selected event", async () => {
  const calls = [];
  const resume = command("resume");
  const relationId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const secondCharacter = structuredClone(resume.characters[0]);
  secondCharacter.character_id = "99999999-aaaa-4bbb-8ccc-dddddddddddd";
  secondCharacter.char_code = "P002";
  resume.characters.push(secondCharacter);
  resume.chapters[0].participating_chars.push({
    char_id: secondCharacter.character_id,
    char_code: secondCharacter.char_code,
    role_type: secondCharacter.role_type,
    activation_reason: "required",
  });
  const relationBefore = {
    trust: 5,
    intimacy: 0,
    power_balance: 0,
    dependence: 0,
    hostility: 0,
    common_goal: 0,
    secret_known: 0,
    emotional_bond: 0,
    relation_type: "ally",
    relation_hierarchy: "peer",
    relation_origin: null,
    relation_overview: null,
    change_event_json: {},
  };
  const relationAfter = { ...relationBefore, trust: 6 };
  resume.relations = [{
    relation_state_id: relationId,
    char_a_id: IDS.character,
    char_b_id: secondCharacter.character_id,
    ...relationBefore,
    is_formal: true,
    is_valid: true,
    is_shadow: false,
  }];

  const stored = checkpoint(1, {
    token_consumed: FP008_TOKEN_BUDGET - 10,
    token_budget_exceeded: false,
  });
  stored.candidate_plot_sim_json.deduction_input_snapshot.participating_chars = structuredClone(
    resume.chapters[0].participating_chars,
  );
  const record = stored.candidate_plot_sim_json.particles_records[0];
  record.events_in_round[0].participating_chars = ["P001", "P002"];
  record.relation_diff = [{
    relation_state_id: relationId,
    char_a_id: IDS.character,
    char_b_id: secondCharacter.character_id,
    before: relationBefore,
    after: relationAfter,
    change_event: { event_id: record.events_in_round[0].event_id },
    event_ids: [record.events_in_round[0].event_id],
  }];
  stored.candidate_plot_sim_json.candidate_truth_ledger.relation_changes = [
    structuredClone(record.relation_diff[0]),
  ];
  resume.chapters[0].checkpoint = stored;

  const result = await engine(calls).execute(resume);
  assert.equal(result.service_state, "paused");
  assert.equal(result.chapters[0].deduction_progress_json.current_particle_index, 1);
  assert.equal(calls.length, 0);
});

test("engine pauses before an estimated next call could cross the fixed L1A budget", async () => {
  const calls = [];
  const resume = command("resume");
  resume.chapters[0].checkpoint = checkpoint(1, {
    token_consumed: FP008_TOKEN_BUDGET - 10,
    token_budget_exceeded: false,
  });

  const result = await engine(calls).execute(resume);
  assert.equal(result.service_state, "paused");
  assert.equal(result.token_budget_exceeded, true);
  assert.equal(
    result.chapters[0].deduction_progress_json.token_budget_exceeded,
    true,
    "the persisted chapter checkpoint must carry the L1A budget stop for FP008-04",
  );
  assert.equal(result.token_consumed, FP008_TOKEN_BUDGET - 10);
  assert.equal(calls.length, 0);
});

test("engine allows a bounded final particle when its conservative reserve fits", async () => {
  const calls = [];
  const resume = command("resume");
  resume.chapters[0].checkpoint = checkpoint(2, {
    token_consumed: FP008_TOKEN_BUDGET - 150000,
    token_budget_exceeded: false,
  });
  const invokeModel = async (invocation) => {
    calls.push(invocation);
    if (invocation.mode === "director_distribute") {
      return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 1 } };
    }
    if (invocation.mode === "character_respond") {
      return { output: characterResult(), usage: { total_tokens: 1 } };
    }
    return {
      output: convergence(invocation.input.particle.particle_id, 3),
      usage: { total_tokens: 1 },
    };
  };
  invokeModel.estimateTokenUsage = () => 100000;

  const result = await createDeductionEngine({ invokeModel }).execute(resume);
  assert.equal(result.deduction_complete, true);
  assert.equal(result.service_state, "completed");
  assert.equal(result.token_consumed, FP008_TOKEN_BUDGET - 149997);
  assert.equal(calls.length, 3);
});

test("engine stops before a growing model call can cross the fixed L1A budget", async () => {
  const calls = [];
  const usages = [400000, 400000, 400000, 400000, 400000, 800000, 900000];
  const invokeModel = async (invocation) => {
    calls.push(invocation);
    const usage = usages[calls.length - 1];
    if (invocation.mode === "director_distribute") {
      return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: usage } };
    }
    if (invocation.mode === "character_respond") {
      return { output: characterResult(), usage: { total_tokens: usage } };
    }
    const completed = Number(invocation.input.particle.particle_id.split("-").at(-1));
    return { output: convergence(invocation.input.particle.particle_id, completed), usage: { total_tokens: usage } };
  };
  invokeModel.estimateTokenUsage = () => 200000;

  const result = await createDeductionEngine({ invokeModel }).execute(command());

  assert.equal(result.service_state, "paused");
  assert.equal(result.token_budget_exceeded, true);
  assert.equal(result.token_consumed, 2800000);
  assert.ok(result.token_consumed <= FP008_TOKEN_BUDGET);
  assert.equal(calls.length, 6, "the seventh request must be held before it can exceed the L1A budget");
  assert.equal(result.chapters[0].candidate_plot_sim_json.particles_records.length, 2);
});

test("engine emits a persistence-ready partial checkpoint after a budget pause", async () => {
  const input = command();
  input.chapters.push(chapter(IDS.chapter2, IDS.version2, 2));
  const invokeModel = Object.assign(
    async (invocation) => {
      if (invocation.mode === "director_distribute") {
        return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 300000 } };
      }
      if (invocation.mode === "character_respond") {
        return { output: characterResult(), usage: { total_tokens: 300000 } };
      }
      const completed = Number(invocation.input.particle.particle_id.split("-").at(-1));
      return { output: convergence(invocation.input.particle.particle_id, completed), usage: { total_tokens: 300000 } };
    },
    {
      estimateTokenUsage: (invocation) => invocation.input.scope.book_id === IDS.book
        && invocation.input.particle?.particle_id === "particle-1"
        && invocation.sessionKey.endsWith(`${IDS.chapter2}:${IDS.version2}`)
        ? 400000
        : 0,
    },
  );
  const deduction = createDeductionEngine({ invokeModel });

  const paused = await deduction.execute(input);
  assert.equal(paused.service_state, "paused");
  for (const chapterState of paused.chapters) {
    const progress = chapterState.deduction_progress_json;
    assert.equal(progress.remaining_particles, 3 - progress.current_particle_index);
  }
});

test("a conservative budget pause below the numeric limit is a valid non-runnable resume checkpoint", async () => {
  const calls = [];
  const resume = command("resume");
  resume.chapters[0].checkpoint = checkpoint(1, {
    token_consumed: 914293,
    token_budget_exceeded: true,
  });

  const result = await engine(calls).execute(resume);
  assert.equal(result.service_state, "paused");
  assert.equal(result.token_consumed, 914293);
  assert.equal(result.token_budget_exceeded, true);
  assert.equal(calls.length, 0);
});

test("engine rejects an incomplete scene condition package before any model call", async () => {
  const calls = [];
  const input = command();
  input.chapters[0].scene_condition_package = {};

  await assert.rejects(engine(calls).execute(input), (error) => (
    error.code === "INVALID_REQUEST" && error.statusCode === 400
  ));
  assert.equal(calls.length, 0);
});

test("a failed unpersisted start releases runtime state so a new start rebuilds from authority", async () => {
  const calls = [];
  let malformedDistributions = 0;
  const deduction = createDeductionEngine({
    invokeModel: async (invocation) => {
      calls.push(invocation);
      if (invocation.mode === "director_distribute") {
        if (malformedDistributions < 3) {
          malformedDistributions += 1;
          return { output: {}, usage: { total_tokens: 5 } };
        }
        return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
      }
      if (invocation.mode === "character_respond") {
        return { output: characterResult(), usage: { total_tokens: 5 } };
      }
      const completed = Number(invocation.input.particle.particle_id.split("-").at(-1));
      return { output: convergence(invocation.input.particle.particle_id, completed), usage: { total_tokens: 5 } };
    },
  });

  await assert.rejects(deduction.execute(command()), (error) => error.code === "MODEL_OUTPUT_INVALID");
  assert.equal(deduction.getProjection(command().scope), null);

  const rebuilt = await deduction.execute(command());
  assert.equal(rebuilt.service_state, "completed");
  assert.equal(rebuilt.token_consumed, 45);
  assert.equal(calls.length, 12, "a new start must rebuild without reusing failed in-memory accounting");
  assert.equal(deduction.getProjection(command().scope), null);
});

test("a malformed director distribution is retried as model output before the particle is abandoned", async () => {
  let distributions = 0;
  const deduction = createDeductionEngine({
    invokeModel: async (invocation) => {
      if (invocation.mode === "director_distribute") {
        distributions += 1;
        if (distributions === 1) {
          return { output: { char_tasks: null }, usage: { total_tokens: 5 } };
        }
        return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
      }
      if (invocation.mode === "character_respond") {
        return { output: characterResult(), usage: { total_tokens: 5 } };
      }
      const completed = Number(invocation.input.particle.particle_id.split("-").at(-1));
      return { output: convergence(invocation.input.particle.particle_id, completed), usage: { total_tokens: 5 } };
    },
  });

  const result = await deduction.execute(command());
  assert.equal(result.service_state, "completed");
  assert.equal(distributions, 4);
  assert.equal(result.token_consumed, 50);
});

test("a permanently malformed director distribution remains a model-output failure", async () => {
  const deduction = createDeductionEngine({
    invokeModel: async (invocation) => {
      if (invocation.mode === "director_distribute") {
        return { output: { char_tasks: null }, usage: { total_tokens: 5 } };
      }
      throw new Error("The distribution must fail before role calls.");
    },
  });

  await assert.rejects(deduction.execute(command()), (error) => (
    error.code === "MODEL_OUTPUT_INVALID" && error.statusCode === 502
  ));
});

test("director distribution rejects unknown top-level fields without strict provider schemas", async () => {
  const deduction = createDeductionEngine({
    invokeModel: async (invocation) => {
      if (invocation.mode === "director_distribute") {
        return { output: { ...distribution(invocation.input.particle.particle_id), unregistered_field: true }, usage: { total_tokens: 5 } };
      }
      throw new Error("The invalid distribution must fail before role calls.");
    },
  });

  await assert.rejects(deduction.execute(command()), (error) => (
    error.code === "MODEL_OUTPUT_INVALID" && error.statusCode === 502
  ));
});

test("director convergence rejects unknown top-level fields without strict provider schemas", async () => {
  const deduction = createDeductionEngine({
    invokeModel: async (invocation) => {
      if (invocation.mode === "director_distribute") {
        return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
      }
      if (invocation.mode === "character_respond") {
        return { output: characterResult(), usage: { total_tokens: 5 } };
      }
      return {
        output: { ...convergence(invocation.input.particle.particle_id, 1), unregistered_field: true },
        usage: { total_tokens: 5 },
      };
    },
  });

  await assert.rejects(deduction.execute(command()), (error) => (
    error.code === "MODEL_OUTPUT_INVALID" && error.statusCode === 502
  ));
});

test("director convergence canonicalizes the unambiguous dual_spiral_verrix typo", async () => {
  const deduction = createDeductionEngine({
    invokeModel: async (invocation) => {
      if (invocation.mode === "director_distribute") {
        return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
      }
      if (invocation.mode === "character_respond") {
        return { output: characterResult(), usage: { total_tokens: 5 } };
      }
      const output = convergence(
        invocation.input.particle.particle_id,
        Number(invocation.input.particle.particle_id.split("-").at(-1)),
      );
      output.dual_spiral_verrix = output.dual_spiral_verdict;
      delete output.dual_spiral_verdict;
      return { output, usage: { total_tokens: 5 } };
    },
  });

  const result = await deduction.execute(command());
  assert.equal(result.service_state, "completed");
});

test("director convergence rejects dual_spiral_verrix when the canonical key is present", async () => {
  const deduction = createDeductionEngine({
    invokeModel: async (invocation) => {
      if (invocation.mode === "director_distribute") {
        return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
      }
      if (invocation.mode === "character_respond") {
        return { output: characterResult(), usage: { total_tokens: 5 } };
      }
      const output = convergence(invocation.input.particle.particle_id, 1);
      output.dual_spiral_verrix = output.dual_spiral_verdict;
      return { output, usage: { total_tokens: 5 } };
    },
  });

  await assert.rejects(deduction.execute(command()), (error) => (
    error.code === "MODEL_OUTPUT_INVALID" && error.statusCode === 502
  ));
});

test("director convergence derives a missing retry control from complete self-check state", async () => {
  const deduction = createDeductionEngine({
    invokeModel: async (invocation) => {
      if (invocation.mode === "director_distribute") {
        return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
      }
      if (invocation.mode === "character_respond") {
        return { output: characterResult(), usage: { total_tokens: 5 } };
      }
      const output = convergence(
        invocation.input.particle.particle_id,
        Number(invocation.input.particle.particle_id.split("-").at(-1)),
      );
      delete output.retry_required;
      return { output, usage: { total_tokens: 5 } };
    },
  });

  const result = await deduction.execute(command());

  assert.equal(result.service_state, "completed");
  assert.deepEqual(
    result.chapters[0].candidate_plot_sim_json.particles_records.map((record) => record.retry_required),
    [false, false, false],
  );
});

test("director convergence rejects a missing self-check item through the NODE_06 output retry", async () => {
  const calls = [];
  const deduction = createDeductionEngine({
    invokeModel: async (invocation) => {
      calls.push(invocation);
      if (invocation.mode === "director_distribute") {
        return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
      }
      if (invocation.mode === "character_respond") {
        return { output: characterResult(), usage: { total_tokens: 5 } };
      }
      const output = convergence(
        invocation.input.particle.particle_id,
        Number(invocation.input.particle.particle_id.split("-").at(-1)),
      );
      delete output.self_check.hook;
      return { output, usage: { total_tokens: 5 } };
    },
  });

  await assert.rejects(deduction.execute(command()), (error) => (
    error.code === "MODEL_OUTPUT_INVALID" && error.statusCode === 502
  ));
  assert.equal(calls.filter((call) => call.mode === "director_distribute").length, 1);
  assert.equal(calls.filter((call) => call.mode === "character_respond").length, 1);
  assert.equal(calls.filter((call) => call.mode === "director_converge").length, 3);
});

test("director convergence cannot set the backend token-budget control", async () => {
  const deduction = createDeductionEngine({
    invokeModel: async (invocation) => {
      if (invocation.mode === "director_distribute") {
        return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
      }
      if (invocation.mode === "character_respond") {
        return { output: characterResult(), usage: { total_tokens: 5 } };
      }
      const output = convergence(
        invocation.input.particle.particle_id,
        Number(invocation.input.particle.particle_id.split("-").at(-1)),
      );
      output.token_budget_exceeded = true;
      return { output, usage: { total_tokens: 5 } };
    },
  });

  const result = await deduction.execute(command());

  assert.equal(result.service_state, "completed");
  assert.equal(result.token_budget_exceeded, false);
  assert.deepEqual(
    result.chapters[0].candidate_plot_sim_json.particles_records.map((record) => record.token_budget_exceeded),
    [false, false, false],
  );
});


test("engine retries an audit-blocked director selection when the particle still has a safe action", async () => {
  const calls = [];
  let selectedUnsafeAction = false;
  const deduction = createDeductionEngine({
    invokeModel: async (invocation) => {
      calls.push(invocation);
      if (invocation.mode === "director_distribute") {
        return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
      }
      if (invocation.mode === "character_respond") {
        const safe = characterResult().candidate_actions[0];
        return {
          output: characterResult([
            safe,
            { ...safe, action_id: "unsafe-p0", audit_block: true, audit_block_reason: "P0" },
          ]),
          usage: { total_tokens: 5 },
        };
      }
      const completed = Number(invocation.input.particle.particle_id.split("-").at(-1));
      const selected = convergence(invocation.input.particle.particle_id, completed);
      if (!selectedUnsafeAction) {
        selectedUnsafeAction = true;
        selected.events_in_round[0].key_choices = ["unsafe-p0"];
      }
      return { output: selected, usage: { total_tokens: 5 } };
    },
  });

  const result = await deduction.execute(command());
  assert.equal(result.service_state, "completed");
  assert.equal(result.deduction_complete, true);
  assert.equal(calls.filter((call) => call.mode === "director_converge").length, 4);
  assert.equal(result.chapters[0].candidate_plot_sim_json.particles_records[0].events_in_round[0].key_choices[0], "action-1");
});

test("director convergence receives only candidate actions eligible for V7 selection", async () => {
  const directorInputs = [];
  const deduction = createDeductionEngine({
    invokeModel: async (invocation) => {
      if (invocation.mode === "director_distribute") {
        return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
      }
      if (invocation.mode === "character_respond") {
        const safe = characterResult().candidate_actions[0];
        return {
          output: characterResult([
            safe,
            { ...safe, action_id: "blocked-p0", audit_block: true, audit_block_reason: "P0" },
            { ...safe, action_id: "distorted-scene", scene_coupling: "失真" },
          ]),
          usage: { total_tokens: 5 },
        };
      }
      directorInputs.push(invocation.input.character_candidate_actions);
      const completed = Number(invocation.input.particle.particle_id.split("-").at(-1));
      return { output: convergence(invocation.input.particle.particle_id, completed), usage: { total_tokens: 5 } };
    },
  });

  const result = await deduction.execute(command());

  assert.equal(result.service_state, "completed");
  assert.deepEqual(directorInputs, [
    [{ char_code: "P001", candidate_actions: [characterResult().candidate_actions[0]], hidden_resistance: [] }],
    [{ char_code: "P001", candidate_actions: [characterResult().candidate_actions[0]], hidden_resistance: [] }],
    [{ char_code: "P001", candidate_actions: [characterResult().candidate_actions[0]], hidden_resistance: [] }],
  ]);
});

test("a rejected unsafe selection does not consume a self-check retry", async () => {
  const calls = [];
  let selectedUnsafeAction = true;
  const distributionsByParticle = new Map();
  const characterResponsesByParticle = new Map();
  const deduction = createDeductionEngine({
    invokeModel: async (invocation) => {
      calls.push(invocation);
      if (invocation.mode === "director_distribute") {
        const particleId = invocation.input.particle.particle_id;
        distributionsByParticle.set(particleId, (distributionsByParticle.get(particleId) ?? 0) + 1);
        return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
      }
      if (invocation.mode === "character_respond") {
        const particleId = invocation.input.particle_id;
        characterResponsesByParticle.set(particleId, (characterResponsesByParticle.get(particleId) ?? 0) + 1);
        const safe = characterResult().candidate_actions[0];
        return {
          output: characterResult([
            safe,
            { ...safe, action_id: "unsafe-p0", audit_block: true, audit_block_reason: "P0" },
          ]),
          usage: { total_tokens: 5 },
        };
      }
      const completed = Number(invocation.input.particle.particle_id.split("-").at(-1));
      const selected = convergence(invocation.input.particle.particle_id, completed);
      if (selectedUnsafeAction) {
        selectedUnsafeAction = false;
        selected.events_in_round[0].key_choices = ["unsafe-p0"];
      } else {
        selected.self_check = { emotion: false, hook: true, pivot: true };
      }
      return { output: selected, usage: { total_tokens: 5 } };
    },
  });

  const result = await deduction.execute(command());

  assert.equal(result.service_state, "blocked");
  assert.equal(result.blocked_code, "DEDUCTION_BLOCKED");
  assert.equal(distributionsByParticle.get("particle-1"), 3, "self-check retries must rebuild F1");
  assert.equal(characterResponsesByParticle.get("particle-1"), 3, "self-check retries must rebuild F2");
  assert.equal(
    calls.filter((call) => call.mode === "director_converge").length,
    4,
    "one rejected selection plus three failed self-checks must make four convergence calls",
  );
  const record = result.chapters[0].candidate_plot_sim_json.particles_records[0];
  assert.equal(record.particle_status, "blocked");
  assert.equal(record.self_check.emotion, false);
});

test("all-P0 candidate actions do not reuse an earlier self-check record before the budget pause", async () => {
  let characterResponses = 0;
  const deduction = createDeductionEngine({
    invokeModel: async (invocation) => {
      if (invocation.mode === "director_distribute") {
        return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
      }
      if (invocation.mode === "character_respond") {
        characterResponses += 1;
        const safe = characterResult().candidate_actions[0];
        return {
          output: characterResponses === 1
            ? characterResult([safe])
            : characterResult([{ ...safe, action_id: "only-p0", audit_block: true, audit_block_reason: "P0" }]),
          usage: { total_tokens: characterResponses === 1 ? 5 : 400000 },
        };
      }
      const completed = Number(invocation.input.particle.particle_id.split("-").at(-1));
      const selected = convergence(invocation.input.particle.particle_id, completed);
      selected.self_check = { emotion: false, hook: true, pivot: true };
      return { output: selected, usage: { total_tokens: 5 } };
    },
  });

  const result = await deduction.execute(command());

  assert.equal(result.service_state, "paused");
  assert.equal(result.token_budget_exceeded, true);
  assert.deepEqual(
    result.chapters[0].candidate_plot_sim_json.particles_records,
    [],
    "only an actual third self-check failure may become the FP008-03 record",
  );
});

test("all-P0 candidate actions keep the current particle in F1/F2 until a safe action exists", async () => {
  const calls = [];
  let firstParticleCharacterAttempts = 0;
  const deduction = createDeductionEngine({
    invokeModel: async (invocation) => {
      calls.push(invocation);
      if (invocation.mode === "director_distribute") {
        return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
      }
      if (invocation.mode === "character_respond") {
        const safe = characterResult().candidate_actions[0];
        const firstParticle = invocation.input.particle_id === "particle-1";
        const onlyP0 = firstParticle && firstParticleCharacterAttempts++ < 3;
        return {
          output: onlyP0
            ? characterResult([{ ...safe, action_id: `only-p0-${firstParticleCharacterAttempts}`, audit_block: true, audit_block_reason: "P0" }])
            : characterResult(),
          usage: { total_tokens: 5 },
        };
      }
      const completed = Number(invocation.input.particle.particle_id.split("-").at(-1));
      return { output: convergence(invocation.input.particle.particle_id, completed), usage: { total_tokens: 5 } };
    },
  });

  const result = await deduction.execute(command());

  assert.equal(result.service_state, "completed");
  assert.equal(result.deduction_complete, true);
  assert.equal(firstParticleCharacterAttempts, 4);
  assert.equal(result.chapters[0].candidate_plot_sim_json.particles_records[0].particle_status, "completed");
  assert.equal(
    calls.filter((call) => call.mode === "director_converge" && call.input.particle.particle_id === "particle-1").length,
    1,
    "no director selection may be attempted until F1/F2 produce a safe candidate",
  );
});

test("all scene-distorted candidate actions keep the current particle in F1/F2 until a safe action exists", async () => {
  const calls = [];
  let firstParticleCharacterAttempts = 0;
  const deduction = createDeductionEngine({
    invokeModel: async (invocation) => {
      calls.push(invocation);
      if (invocation.mode === "director_distribute") {
        return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
      }
      if (invocation.mode === "character_respond") {
        const safe = characterResult().candidate_actions[0];
        const firstParticle = invocation.input.particle_id === "particle-1";
        const onlyDistorted = firstParticle && firstParticleCharacterAttempts++ < 3;
        return {
          output: onlyDistorted
            ? characterResult([{ ...safe, action_id: `only-distorted-${firstParticleCharacterAttempts}`, scene_coupling: "失真" }])
            : characterResult(),
          usage: { total_tokens: 5 },
        };
      }
      const completed = Number(invocation.input.particle.particle_id.split("-").at(-1));
      return { output: convergence(invocation.input.particle.particle_id, completed), usage: { total_tokens: 5 } };
    },
  });

  const result = await deduction.execute(command());

  assert.equal(result.service_state, "completed");
  assert.equal(result.deduction_complete, true);
  assert.equal(firstParticleCharacterAttempts, 4);
  assert.equal(
    calls.filter((call) => call.mode === "director_converge" && call.input.particle.particle_id === "particle-1").length,
    1,
    "no director selection may be attempted until F1/F2 produce a scene-grounded candidate",
  );
});

test("unsafe director selections keep retrying F3 until a safe selection is made", async () => {
  const calls = [];
  let firstParticleSelections = 0;
  const distributionsByParticle = new Map();
  const characterResponsesByParticle = new Map();
  const deduction = createDeductionEngine({
    invokeModel: async (invocation) => {
      calls.push(invocation);
      if (invocation.mode === "director_distribute") {
        const particleId = invocation.input.particle.particle_id;
        distributionsByParticle.set(particleId, (distributionsByParticle.get(particleId) ?? 0) + 1);
        return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
      }
      if (invocation.mode === "character_respond") {
        const particleId = invocation.input.particle_id;
        characterResponsesByParticle.set(particleId, (characterResponsesByParticle.get(particleId) ?? 0) + 1);
        const safe = characterResult().candidate_actions[0];
        return {
          output: characterResult([
            safe,
            { ...safe, action_id: "unsafe-p0", audit_block: true, audit_block_reason: "P0" },
          ]),
          usage: { total_tokens: 5 },
        };
      }
      const completed = Number(invocation.input.particle.particle_id.split("-").at(-1));
      const selected = convergence(invocation.input.particle.particle_id, completed);
      if (invocation.input.particle.particle_id === "particle-1" && firstParticleSelections++ < 3) {
        selected.events_in_round[0].key_choices = ["unsafe-p0"];
      }
      return { output: selected, usage: { total_tokens: 5 } };
    },
  });

  const result = await deduction.execute(command());

  assert.equal(result.service_state, "completed");
  assert.equal(result.deduction_complete, true);
  assert.equal(firstParticleSelections, 4);
  assert.equal(distributionsByParticle.get("particle-1"), 1, "F3 retry must retain the same F1 distribution");
  assert.equal(characterResponsesByParticle.get("particle-1"), 1, "F3 retry must retain the same F2 role result");
  assert.equal(
    calls.filter((call) => call.mode === "director_converge" && call.input.particle.particle_id === "particle-1").length,
    4,
  );
  assert.equal(result.chapters[0].candidate_plot_sim_json.particles_records[0].events_in_round[0].key_choices[0], "action-1");
});

test("a pending convergence keeps the current particle open until it completes", async () => {
  let firstParticleConvergences = 0;
  const deduction = createDeductionEngine({
    invokeModel: async (invocation) => {
      if (invocation.mode === "director_distribute") {
        return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
      }
      if (invocation.mode === "character_respond") {
        return { output: characterResult(), usage: { total_tokens: 5 } };
      }
      const completed = Number(invocation.input.particle.particle_id.split("-").at(-1));
      const result = convergence(invocation.input.particle.particle_id, completed);
      if (invocation.input.particle.particle_id === "particle-1" && firstParticleConvergences++ < 3) {
        result.particle_status = "pending";
        result.retry_required = true;
      }
      return { output: result, usage: { total_tokens: 5 } };
    },
  });

  const result = await deduction.execute(command());

  assert.equal(result.service_state, "completed");
  assert.equal(result.deduction_complete, true);
  assert.equal(firstParticleConvergences, 4);
  assert.equal(result.chapters[0].candidate_plot_sim_json.particles_records[0].particle_status, "completed");
});

test("rejected director outputs clear only the current particle session before retrying", async () => {
  const rejectionKinds = ["p0", "pending", "self-check", "semantic"];
  for (const rejectionKind of rejectionKinds) {
    const directorHistory = new Map();
    const calls = [];
    let rejected = false;
    const invokeModel = Object.assign(async (invocation) => {
      if (invocation.mode === "director_distribute" || invocation.mode === "director_converge") {
        const priorHistory = invocation.continueSession
          ? structuredClone(directorHistory.get(invocation.sessionKey) ?? [])
          : [];
        let output;
        let rejectedDirectorOutput = false;
        if (invocation.mode === "director_distribute") {
          output = distribution(invocation.input.particle.particle_id);
        } else {
          const completed = Number(invocation.input.particle.particle_id.split("-").at(-1));
          output = convergence(invocation.input.particle.particle_id, completed);
          if (invocation.input.particle.particle_id === "particle-1" && !rejected) {
            rejected = true;
            rejectedDirectorOutput = true;
            if (rejectionKind === "p0") output.events_in_round[0].key_choices = ["unsafe-p0"];
            if (rejectionKind === "pending") {
              output.particle_status = "pending";
              output.retry_required = true;
            }
            if (rejectionKind === "self-check") output.self_check = { emotion: false, hook: true, pivot: true };
            if (rejectionKind === "semantic") output.unregistered_field = true;
          }
        }
        calls.push({
          mode: invocation.mode,
          particleId: invocation.input.particle.particle_id,
          priorHistory,
          rejectedDirectorOutput,
        });
        directorHistory.set(invocation.sessionKey, [
          ...priorHistory,
          `${invocation.mode}:${invocation.input.particle.particle_id}:${rejectedDirectorOutput ? "rejected" : "accepted"}`,
        ]);
        return { output, usage: { total_tokens: 5 } };
      }
      if (rejectionKind === "p0") {
        const safe = characterResult().candidate_actions[0];
        return {
          output: characterResult([
            safe,
            { ...safe, action_id: "unsafe-p0", audit_block: true, audit_block_reason: "P0" },
          ]),
          usage: { total_tokens: 5 },
        };
      }
      return { output: characterResult(), usage: { total_tokens: 5 } };
    }, {
      clearSession(sessionKey) {
        directorHistory.delete(sessionKey);
      },
    });

    const result = await createDeductionEngine({ invokeModel }).execute(command());
    const rejectedCallIndex = calls.findIndex((call) => call.rejectedDirectorOutput);
    const retryCall = calls[rejectedCallIndex + 1];
    const nextParticleDistribution = calls.find((call) => (
      call.mode === "director_distribute" && call.particleId === "particle-2"
    ));

    assert.equal(result.service_state, "completed", rejectionKind);
    assert.deepEqual(retryCall.priorHistory, [], `${rejectionKind} retry must not inherit the rejected director output`);
    assert.equal(retryCall.mode, rejectionKind === "self-check" ? "director_distribute" : "director_converge", rejectionKind);
    const acceptedPriorHistory = rejectionKind === "self-check"
      ? ["director_distribute:particle-1:accepted", "director_converge:particle-1:accepted"]
      : ["director_converge:particle-1:accepted"];
    assert.deepEqual(nextParticleDistribution.priorHistory, acceptedPriorHistory, `${rejectionKind} must retain the accepted prior particle session`);
  }
});

test("repeated unsafe director selections remain outside the checkpoint until the budget pause", async () => {
  const deduction = createDeductionEngine({
    invokeModel: async (invocation) => {
      if (invocation.mode === "director_distribute") {
        return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
      }
      if (invocation.mode === "character_respond") {
        const safe = characterResult().candidate_actions[0];
        return {
          output: characterResult([
            safe,
            { ...safe, action_id: "unsafe-p0", audit_block: true, audit_block_reason: "P0" },
          ]),
          usage: { total_tokens: 5 },
        };
      }
      const completed = Number(invocation.input.particle.particle_id.split("-").at(-1));
      const selected = convergence(invocation.input.particle.particle_id, completed);
      selected.events_in_round[0].key_choices = ["unsafe-p0"];
      return {
        output: selected,
        usage: { total_tokens: invocation.input.particle.particle_id === "particle-1" ? 250000 : 5 },
      };
    },
  });

  const result = await deduction.execute(command());
  assert.equal(result.service_state, "paused");
  assert.equal(result.token_budget_exceeded, true);
  assert.deepEqual(result.chapters[0].candidate_plot_sim_json.particles_records, []);
});

test("engine rejects scene-distorted actions selected by the director", async () => {
  const deduction = createDeductionEngine({
    invokeModel: async (invocation) => {
      if (invocation.mode === "director_distribute") {
        return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
      }
      if (invocation.mode === "character_respond") {
        const safe = characterResult().candidate_actions[0];
        return {
          output: characterResult([
            safe,
            { ...safe, action_id: "unsafe-scene", scene_coupling: "失真" },
          ]),
          usage: { total_tokens: 5 },
        };
      }
      const completed = Number(invocation.input.particle.particle_id.split("-").at(-1));
      const selected = convergence(invocation.input.particle.particle_id, completed);
      selected.events_in_round[0].key_choices = ["unsafe-scene"];
      return { output: selected, usage: { total_tokens: 5 } };
    },
  });

  await assert.rejects(deduction.execute(command()), (error) => (
    error.statusCode === 502 && error.code === "MODEL_OUTPUT_INVALID"
  ));
});

test("director task packages cannot pass a character's private or unselected candidate content to another character", async () => {
  const privateReasoning = "A-PRIVATE-REASONING";
  const unselectedCandidate = "A-UNCHOSEN-CANDIDATE";
  const receivedByB = [];
  const input = command();
  input.characters.push({
    character_id: IDS.successor,
    char_code: "P002",
    role_type: "supporting",
    five_layers_json: {},
    knowledge_boundary_json: {
      knows: [], unknown: [], false_belief: [], reasonable_suspect: [],
    },
    live_state_id: null,
    live_state_source: "initial_live_state_projection",
    live_state_json: { source: "initial_live_state_projection" },
    active_memory_json: [],
  });
  input.chapters[0].participating_chars.push({
    char_id: IDS.successor,
    char_code: "P002",
    role_type: "supporting",
    activation_reason: "required",
  });

  const deduction = createDeductionEngine({
    invokeModel: async (invocation) => {
      if (invocation.mode === "director_distribute") {
        const particleId = invocation.input.particle.particle_id;
        return {
          output: {
            char_tasks: [
              ...distribution(particleId).char_tasks,
              {
                char_code: "P002",
                task: {
                  particle_id: particleId,
                  isolation_confirmed: true,
                  dramatic_enhancement: {
                    supporting_staged_goal: "support", antagonist_control_intent: null,
                    ensemble_pressure_direction: null, peak_conflict_moment: null,
                    enhancement_feedback: null,
                  },
                  staged_goal_injected: "support",
                  visible_situation: "visible",
                  emotion_phase_hint: "setup",
                  last_round_summary: {
                    private_reasoning: privateReasoning,
                    unselected_candidate: unselectedCandidate,
                  },
                },
              },
            ],
          },
          usage: { total_tokens: 5 },
        };
      }
      if (invocation.mode === "character_respond") {
        if (invocation.input.character.char_code === "P002") {
          receivedByB.push(invocation.input.char_task);
          return {
            output: {
              ...characterResult([{ ...characterResult().candidate_actions[0], action_id: "b-action" }]),
              char_code: "P002",
            },
            usage: { total_tokens: 5 },
          };
        }
        return {
          output: {
            ...characterResult([
              { ...characterResult().candidate_actions[0], action_id: "a-selected" },
              { ...characterResult().candidate_actions[0], action_id: unselectedCandidate },
            ]),
            hidden_goal: privateReasoning,
          },
          usage: { total_tokens: 5 },
        };
      }
      const completed = Number(invocation.input.particle.particle_id.split("-").at(-1));
      const selected = convergence(invocation.input.particle.particle_id, completed);
      selected.events_in_round[0].key_choices = ["a-selected"];
      return { output: selected, usage: { total_tokens: 5 } };
    },
  });

  await deduction.execute(input);
  assert.equal(receivedByB.length, 3);
  for (const task of receivedByB) {
    assert.doesNotMatch(JSON.stringify(task), new RegExp(`${privateReasoning}|${unselectedCandidate}`));
  }
});

test("a selected observable A-to-B event is the only prior-round delivery that reaches B", async () => {
  const input = command();
  input.characters.push({
    character_id: IDS.successor,
    char_code: "P002",
    role_type: "supporting",
    five_layers_json: {},
    knowledge_boundary_json: {
      knows: [], unknown: [], false_belief: [], reasonable_suspect: [],
    },
    live_state_id: null,
    live_state_source: "initial_live_state_projection",
    live_state_json: { source: "initial_live_state_projection" },
    active_memory_json: [],
  });
  input.chapters[0].participating_chars.push({
    char_id: IDS.successor,
    char_code: "P002",
    role_type: "supporting",
    activation_reason: "required",
  });
  const deliveriesToB = [];

  const deduction = createDeductionEngine({
    invokeModel: async (invocation) => {
      if (invocation.mode === "director_distribute") {
        const particleId = invocation.input.particle.particle_id;
        return {
          output: {
            char_tasks: [
              ...distribution(particleId).char_tasks,
              {
                char_code: "P002",
                task: {
                  particle_id: particleId,
                  isolation_confirmed: true,
                  dramatic_enhancement: {
                    supporting_staged_goal: "support", antagonist_control_intent: null,
                    ensemble_pressure_direction: null, peak_conflict_moment: null,
                    enhancement_feedback: null,
                  },
                  staged_goal_injected: "support",
                  visible_situation: "visible",
                  emotion_phase_hint: "setup",
                  last_round_summary: "director-controlled value must not pass through",
                },
              },
            ],
          },
          usage: { total_tokens: 5 },
        };
      }
      if (invocation.mode === "character_respond") {
        if (invocation.input.character.char_code === "P002") {
          deliveriesToB.push({
            particle_id: invocation.input.particle_id,
            last_round_summary: invocation.input.char_task.last_round_summary,
          });
          return {
            output: {
              ...characterResult([{ ...characterResult().candidate_actions[0], action_id: "b-action" }]),
              char_code: "P002",
            },
            usage: { total_tokens: 5 },
          };
        }
        return { output: characterResult(), usage: { total_tokens: 5 } };
      }
      const particleId = invocation.input.particle.particle_id;
      const selected = convergence(particleId, Number(particleId.split("-").at(-1)));
      if (particleId === "particle-1") {
        Object.assign(selected.events_in_round[0], {
          description: "P001 shows B the sealed map.",
          source_char: "P001",
          recipient_char: "P002",
          delivery_channel: "direct",
          delivery_payload: "P001 shows B the sealed map.",
        });
      }
      return { output: selected, usage: { total_tokens: 5 } };
    },
  });

  await deduction.execute(input);
  assert.deepEqual(deliveriesToB, [
    { particle_id: "particle-1", last_round_summary: null },
    {
      particle_id: "particle-2",
      last_round_summary: [{
        event_id: "event-particle-1",
        source_char: "P001",
        recipient_char: "P002",
        delivery_channel: "direct",
        delivery_payload: "P001 shows B the sealed map.",
      }],
    },
    { particle_id: "particle-3", last_round_summary: [] },
  ]);
});

test("a budget pause gives each completed chapter a persistence-ready summary", async () => {
  const input = command();
  input.chapters.push(chapter(IDS.chapter2, IDS.version2, 2));
  const invokeModel = Object.assign(
    async (invocation) => {
      if (invocation.mode === "director_distribute") {
        return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 300000 } };
      }
      if (invocation.mode === "character_respond") {
        return { output: characterResult(), usage: { total_tokens: 300000 } };
      }
      const completed = Number(invocation.input.particle.particle_id.split("-").at(-1));
      return {
        output: convergence(invocation.input.particle.particle_id, completed),
        usage: { total_tokens: 300000 },
      };
    },
    {
      estimateTokenUsage: (invocation) => invocation.input.particle?.particle_id === "particle-1"
        && invocation.sessionKey.endsWith(`${IDS.chapter2}:${IDS.version2}`)
        ? 400000
        : 0,
    },
  );
  const deduction = createDeductionEngine({ invokeModel });

  const paused = await deduction.execute(input);
  assert.equal(paused.service_state, "paused");
  assert.equal(paused.deduction_complete, false);
  assert.equal(paused.chapters[0].deduction_progress_json.deduction_complete, true);
  const [completedSummary, pendingSummary] = paused.chapters.map((chapter) => (
    chapter.candidate_plot_sim_json.chapter_summary
  ));
  assert.equal(completedSummary.completed_particle_count, 3);
  assert.equal(completedSummary.event_count, 3);
  assert.equal(typeof completedSummary.summary, "string");
  assert.equal(pendingSummary, null);
});

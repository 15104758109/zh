import test from "node:test";
import assert from "node:assert/strict";

import { DeductionServiceError } from "../../../apps/api/src/features/fp008/fp008-02/engine.ts";
import { createOpenAiCompatibleModelInvoker } from "../../../apps/api/src/features/fp008/fp008-02/openai-compatible-model.ts";
import { buildFp008Service } from "../../../apps/api/src/features/fp008/fp008-02/service.ts";

const OPERATOR = "11111111-2222-4333-8444-555555555555";
const BOOK = "abcdefab-1234-4abc-8abc-abcdefabcdef";
const L1A = "22222222-3333-4444-8555-666666666666";
const CHAPTER = "33333333-4444-4555-8666-777777777777";
const VERSION = "44444444-5555-4666-8777-888888888888";
const SUCCESSOR_VERSION = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const SECOND_CHAPTER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const SECOND_VERSION = "88888888-9999-4aaa-8bbb-cccccccccccc";
const CHARACTER = "55555555-6666-4777-8888-999999999999";
const WORLD = "99999999-aaaa-4bbb-8ccc-dddddddddddd";

function buildTestService(t, options) {
  const app = buildFp008Service(options);
  const close = app.close.bind(app);
  let closed = false;
  app.close = async () => {
    if (closed) return undefined;
    closed = true;
    return close();
  };
  t.after(() => app.close());
  return app;
}

function particles() {
  return ["truth", "emotion", "hook"].map((type, index) => ({
    particle_id: `particle-${index + 1}`,
    content: `particle content ${index + 1}`,
    type,
    emotion_phase: index === 1 ? "rise" : "setup",
    staged_task: `task ${index + 1}`,
    reveal_to: "all",
    assigned_to_role_type: "protagonist",
    involved_chars: ["P001"],
    required_chars: ["P001"],
    source_field: "plot_emotion_commit",
    purpose: `purpose ${index + 1}`,
  }));
}

function convergence(particleId, completed = 1) {
  return {
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
    dual_spiral_verdict: "推动",
    rebellion_record: null,
    emotion_band: { band_type: "PLATFORM", entity_change_type: [], emotion_justified: true },
    state_diff: [],
    relation_diff: [],
    memory_changes: [],
    particles_completed: completed,
    particle_completion_evidence: [particleId],
    remaining_particles: Math.max(0, 3 - completed),
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

function characterResult() {
  return {
    char_code: "P001",
    knowledge_snapshot: { knows: ["fact-1"], unknown: [], false_belief: [], reasonable_suspect: [] },
    info_gap_exploited: null,
    l3_activation: null,
    trigger_check: { triggered: false },
    real_intent: "protect the current goal",
    hidden_goal: null,
    misread: null,
    misread_impact: null,
    dual_spiral: { relation_type: "推动" },
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
      memory_evidence: ["memory-valid"],
      scene_coupling: "真实",
      utilized_conditions: ["resource-1"],
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
        newly_perceivable_particles: [particleId],
        long_term_promise: "complete the L1A promise",
        visible_situation: "only the visible situation",
        emotion_phase_hint: "setup",
        last_round_summary: null,
      },
    }],
  };
}

function command(overrides = {}) {
  return {
    action: "start",
    scope: { local_operator_id: OPERATOR, book_id: BOOK, l1a_unit_id: L1A },
    token_budget: 3000000,
    token_budget_version: "mvp-fixed-3000000",
    chapters: [{
      chapter_id: CHAPTER,
      chapter_version_id: VERSION,
      chapter_index: 1,
      target_snapshot_json: { goals: ["goal-1"] },
      chapter_implementation_json: { execution_steps: ["step-1"] },
      scene_condition_package: {
        scene_location: "documented threshold",
        participant_chars: ["lead"],
        rule_locks: [],
        scene_affordance: [],
        available_resource_codes: ["resource-1"],
        info_reveal_candidates: [],
        chain_reaction_candidates: [],
        scene_constraints: [],
        forbid_lines_active: [],
        materialize_notes: [],
      },
      particles: particles(),
      participating_chars: [{
        char_id: CHARACTER,
        char_code: "P001",
        role_type: "protagonist",
        activation_reason: "required by the particle",
      }],
      shadow_summary: "",
    }],
    characters: [{
      character_id: CHARACTER,
      char_code: "P001",
      role_type: "protagonist",
      five_layers_json: { l0: "survive", l1: "protect" },
      knowledge_boundary_json: { knows: ["fact-1"], unknown: [], false_belief: [], reasonable_suspect: [] },
      live_state_id: null,
      live_state_source: "initial_live_state_projection",
      live_state_json: {
        source: "initial_live_state_projection",
        five_layers_json: { l0: "survive", l1: "protect" },
        knowledge_boundary_json: { knows: ["fact-1"], unknown: [], false_belief: [], reasonable_suspect: [] },
      },
      active_memory_json: [
        { memory_id: "memory-valid", is_valid: true, is_shadow: false, memory_content: "usable" },
        { memory_id: "memory-shadow", is_valid: true, is_shadow: true, memory_content: "must not leak" },
        { memory_id: "memory-invalid", is_valid: false, is_shadow: false, memory_content: "must not leak" },
      ],
    }],
    world_state: [{
      world_state_id: WORLD,
      atom_value_jsonb: { available_resource_codes: ["resource-1"] },
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
    ...overrides,
  };
}

function checkpoint({
  current = 1,
  remainingParticles = particles().length - current,
  tokenConsumed = 30,
  tokenBudgetExceeded = false,
  deductionComplete = current === particles().length,
  rejectCount = 0,
} = {}) {
  return {
    candidate_plot_sim_json: {
      deduction_input_snapshot: {
        particles: particles(),
        participating_chars: [{
          char_id: CHARACTER,
          char_code: "P001",
          role_type: "protagonist",
          activation_reason: "required by the particle",
        }],
      },
      particles_records: particles().slice(0, current).map((particle, index) => (
        convergence(particle.particle_id, index + 1)
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
      remaining_particles: remainingParticles,
      token_consumed: tokenConsumed,
      token_budget: 3000000,
      token_budget_version: "mvp-fixed-3000000",
      token_budget_exceeded: tokenBudgetExceeded,
      deduction_complete: deductionComplete,
      reject_count: rejectCount,
    },
  };
}

function successfulInvoker(calls) {
  return async (invocation) => {
    calls.push(invocation);
    if (invocation.mode === "director_distribute") {
      return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
    }
    if (invocation.mode === "character_respond") {
      assert.equal("characters" in invocation.input, false);
      assert.equal("world_state" in invocation.input, false);
      assert.equal("shadow_summary" in invocation.input, false);
      assert.equal("staged_goal_injected" in invocation.input.char_task, false);
      assert.deepEqual(
        invocation.input.character.active_memory_json.map((memory) => memory.memory_id),
        ["memory-valid"],
      );
      return { output: characterResult(), usage: { total_tokens: 5 } };
    }
    const completed = Number(String(invocation.input.particle.particle_id).split("-").pop());
    return {
      output: convergence(invocation.input.particle.particle_id, completed),
      usage: { total_tokens: 5 },
    };
  };
}

test("FP008-02 releases completed runtime state after returning its persistence-ready result", async (t) => {
  const calls = [];
  const app = buildTestService(t, { invokeModel: successfulInvoker(calls) });
  const response = await app.inject({ method: "POST", url: "/fp008-02", payload: command() });
  assert.equal(response.statusCode, 200);
  const payload = response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.result.service_state, "completed");
  assert.equal(payload.result.deduction_complete, true);
  assert.equal(payload.result.token_consumed, 45);
  assert.equal(payload.result.chapters[0].deduction_progress_json.current_particle_index, 3);
  assert.equal(payload.result.chapters[0].deduction_progress_json.deduction_complete, true);
  assert.equal(payload.result.chapters[0].deduction_locked, false);
  assert.equal(payload.result.chapters[0].candidate_plot_sim_json.particles_records.length, 3);
  assert.equal(calls.length, 9);
  assert.equal(calls.filter((call) => call.mode === "character_respond").every((call) => call.continueSession === false), true);

  const projection = await app.inject({
    method: "GET",
    url: `/fp008-02?local_operator_id=${OPERATOR}&book_id=${BOOK}&l1a_unit_id=${L1A}`,
  });
  assert.equal(projection.statusCode, 404);
  assert.equal(projection.json().redacted_error.code, "DEDUCTION_NOT_FOUND");
  await app.close();
});

test("FP008-02 health response contains no business data", async (t) => {
  const app = buildTestService(t, { invokeModel: successfulInvoker([]) });
  const response = await app.inject({ method: "GET", url: "/healthz" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ok: true });
  await app.close();
});

test("FP008-02 persists backend-assigned particle sequence instead of trusting a director copy error", async (t) => {
  const app = buildTestService(t, {
    invokeModel: async (invocation) => {
      if (invocation.mode === "director_distribute") {
        return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
      }
      if (invocation.mode === "character_respond") {
        return { output: characterResult(), usage: { total_tokens: 5 } };
      }
      return {
        output: {
          ...convergence(invocation.input.particle.particle_id, 99),
          particles_completed: 99,
          remaining_particles: 99,
          deduction_complete: false,
        },
        usage: { total_tokens: 5 },
      };
    },
  });

  const response = await app.inject({ method: "POST", url: "/fp008-02", payload: command() });
  assert.equal(response.statusCode, 200, response.body);
  const records = response.json().result.chapters[0].candidate_plot_sim_json.particles_records;
  assert.deepEqual(
    records.map((record) => [record.particles_completed, record.remaining_particles, record.deduction_complete]),
    [[1, 2, false], [2, 1, false], [3, 0, true]],
  );
  await app.close();
});

test("whole-L1A restart begins from the first particle without creator direction and rejects an old checkpoint", async (t) => {
  const calls = [];
  const app = buildTestService(t, { invokeModel: successfulInvoker(calls) });
  const restarted = await app.inject({
    method: "POST",
    url: "/fp008-02",
    payload: command({ action: "restart" }),
  });
  assert.equal(restarted.statusCode, 200, restarted.body);
  assert.equal(restarted.json().result.service_state, "completed");
  assert.equal(restarted.json().result.token_consumed, 45);
  assert.equal(restarted.json().result.chapters[0].candidate_version_id, VERSION);
  assert.deepEqual(
    calls.filter((call) => call.mode === "director_distribute").map((call) => call.input.particle.particle_id),
    ["particle-1", "particle-2", "particle-3"],
  );
  assert.equal(
    calls.filter((call) => call.mode.startsWith("director_")).every((call) => call.input.creator_direction === null),
    true,
  );

  const withCheckpoint = command({ action: "restart" });
  withCheckpoint.chapters[0].checkpoint = checkpoint({ current: 0, tokenConsumed: 0, rejectCount: 1 });
  const stale = await app.inject({ method: "POST", url: "/fp008-02", payload: withCheckpoint });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().redacted_error.code, "RESTART_OLD_RESULT_FORBIDDEN");
  await app.close();
});

test("whole-L1A restart discards an unpersisted model-failure run and resets its token accounting", async (t) => {
  const calls = [];
  let recover = false;
  const successful = successfulInvoker(calls);
  const app = buildTestService(t, {
    invokeModel: async (invocation) => {
      if (!recover
        && invocation.mode === "director_distribute"
        && invocation.input.particle.particle_id === "particle-2") {
        calls.push(invocation);
        throw new Error("model provider unavailable");
      }
      return successful(invocation);
    },
  });
  const blocked = await app.inject({
    method: "POST",
    url: "/fp008-02",
    payload: command(),
  });
  assert.equal(blocked.statusCode, 200, blocked.body);
  assert.equal(blocked.json().result.service_state, "blocked");
  assert.equal(blocked.json().result.blocked_code, "MODEL_CALL_FAILED");
  assert.equal(blocked.json().result.token_consumed, 15);
  assert.equal(blocked.json().result.chapters[0].candidate_plot_sim_json.particles_records.length, 1);

  const released = await app.inject({
    method: "GET",
    url: `/fp008-02?local_operator_id=${OPERATOR}&book_id=${BOOK}&l1a_unit_id=${L1A}`,
  });
  assert.equal(released.statusCode, 404);

  recover = true;
  const restarted = await app.inject({ method: "POST", url: "/fp008-02", payload: command({ action: "restart" }) });
  assert.equal(restarted.statusCode, 200, restarted.body);
  assert.equal(restarted.json().result.service_state, "completed");
  assert.equal(restarted.json().result.token_consumed, 45);
  assert.equal(restarted.json().result.chapters[0].candidate_version_id, VERSION);
  assert.deepEqual(
    restarted.json().result.chapters[0].candidate_plot_sim_json.particles_records.map((record) => record.particle_id),
    ["particle-1", "particle-2", "particle-3"],
  );
  assert.equal(
    calls.slice(6).find((call) => call.mode === "director_distribute").input.particle.particle_id,
    "particle-1",
  );
  await app.close();
});

test("exhausted provider transport remains MODEL_CALL_FAILED and leaves no service projection", async (t) => {
  const delays = [];
  let calls = 0;
  const invokeModel = createOpenAiCompatibleModelInvoker({
    resolveCredential: async () => "secret-value",
    providerRetryDelayImpl: async (attempt, reason) => { delays.push({ attempt, reason }); },
    fetchImpl: async () => {
      calls += 1;
      const error = new Error("private provider timeout");
      error.code = "ETIMEDOUT";
      throw error;
    },
  });
  const app = buildTestService(t, { invokeModel });

  const response = await app.inject({ method: "POST", url: "/fp008-02", payload: command() });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().result.service_state, "blocked");
  assert.equal(response.json().result.blocked_code, "MODEL_CALL_FAILED");
  assert.equal(response.json().result.token_consumed, 0);
  assert.equal(response.json().result.chapters[0].candidate_plot_sim_json.particles_records.length, 0);
  assert.equal(calls, 3, "the adapter must consume the existing provider retry bound once");
  assert.deepEqual(delays, [
    { attempt: 0, reason: "transport" },
    { attempt: 1, reason: "transport" },
  ]);

  const released = await app.inject({
    method: "GET",
    url: `/fp008-02?local_operator_id=${OPERATOR}&book_id=${BOOK}&l1a_unit_id=${L1A}`,
  });
  assert.equal(released.statusCode, 404, "failed transport must not retain a resumable service projection");
});

test("resume continues only after the persisted particle checkpoint", async (t) => {
  const calls = [];
  const resume = command({ action: "resume" });
  resume.chapters[0].checkpoint = checkpoint();
  const app = buildTestService(t, { invokeModel: successfulInvoker(calls) });
  const response = await app.inject({ method: "POST", url: "/fp008-02", payload: resume });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().result.token_consumed, 60);
  assert.equal(calls.length, 6);
  assert.deepEqual(
    calls.filter((call) => call.mode === "director_distribute").map((call) => call.input.particle.particle_id),
    ["particle-2", "particle-3"],
  );
  await app.close();
});

test("a pause intent finishes the current particle and leaves a resumable L1A checkpoint", async (t) => {
  const calls = [];
  let releaseFirstDistribution;
  let firstDistributionStarted;
  const firstDistribution = new Promise((resolve) => { firstDistributionStarted = resolve; });
  const app = buildTestService(t, {
    invokeModel: async (invocation) => {
      calls.push(invocation);
      if (invocation.mode === "director_distribute") {
        if (invocation.input.particle.particle_id === "particle-1") {
          firstDistributionStarted();
          await new Promise((resolve) => { releaseFirstDistribution = resolve; });
        }
        return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
      }
      if (invocation.mode === "character_respond") {
        return { output: characterResult(), usage: { total_tokens: 5 } };
      }
      const completed = Number(String(invocation.input.particle.particle_id).split("-").pop());
      return {
        output: convergence(invocation.input.particle.particle_id, completed),
        usage: { total_tokens: 5 },
      };
    },
  });

  const running = app.inject({ method: "POST", url: "/fp008-02", payload: command() });
  await firstDistribution;
  const pause = await app.inject({
    method: "POST",
    url: "/fp008-02",
    payload: {
      action: "pause",
      scope: { local_operator_id: OPERATOR, book_id: BOOK, l1a_unit_id: L1A },
    },
  });
  assert.equal(pause.statusCode, 200, pause.body);
  assert.equal(pause.json().result.service_state, "pause_requested");

  releaseFirstDistribution();
  const completed = await running;
  assert.equal(completed.statusCode, 200, completed.body);
  const result = completed.json().result;
  assert.equal(result.service_state, "paused");
  assert.equal(result.deduction_complete, false);
  assert.equal(result.chapters[0].deduction_progress_json.current_particle_index, 1);
  assert.equal(result.chapters[0].deduction_progress_json.deduction_complete, false);
  const retained = await app.inject({
    method: "GET",
    url: `/fp008-02?local_operator_id=${OPERATOR}&book_id=${BOOK}&l1a_unit_id=${L1A}`,
  });
  assert.equal(retained.statusCode, 200, "a paused checkpoint remains available until the persisted resume path takes over");
  assert.equal(retained.json().result.service_state, "paused");
  assert.equal(result.chapters[0].candidate_plot_sim_json.particles_records.length, 1);
  assert.equal(calls.length, 3, "pause must not begin the next particle");
  await app.close();
});

test("a pause at a chapter boundary first seals that chapter's persistence-ready checkpoint", async (t) => {
  const calls = [];
  let releaseFinalFirstChapterParticle;
  let finalFirstChapterParticleStarted;
  const finalFirstChapterParticle = new Promise((resolve) => { finalFirstChapterParticleStarted = resolve; });
  const input = command();
  input.chapters.push({
    ...structuredClone(input.chapters[0]),
    chapter_id: SECOND_CHAPTER,
    chapter_version_id: SECOND_VERSION,
    chapter_index: 2,
  });
  let directorDistributions = 0;
  const app = buildTestService(t, {
    invokeModel: async (invocation) => {
      calls.push(invocation);
      if (invocation.mode === "director_distribute") {
        directorDistributions += 1;
        if (directorDistributions === 3) {
          finalFirstChapterParticleStarted();
          await new Promise((resolve) => { releaseFinalFirstChapterParticle = resolve; });
        }
        return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
      }
      if (invocation.mode === "character_respond") {
        return { output: characterResult(), usage: { total_tokens: 5 } };
      }
      const completed = Number(String(invocation.input.particle.particle_id).split("-").pop());
      return {
        output: convergence(invocation.input.particle.particle_id, completed),
        usage: { total_tokens: 5 },
      };
    },
  });

  const running = app.inject({ method: "POST", url: "/fp008-02", payload: input });
  await finalFirstChapterParticle;
  const pause = await app.inject({
    method: "POST",
    url: "/fp008-02",
    payload: {
      action: "pause",
      scope: { local_operator_id: OPERATOR, book_id: BOOK, l1a_unit_id: L1A },
    },
  });
  assert.equal(pause.statusCode, 200, pause.body);

  releaseFinalFirstChapterParticle();
  const completed = await running;
  assert.equal(completed.statusCode, 200, completed.body);
  const result = completed.json().result;
  const [completedChapter, pendingChapter] = result.chapters;
  assert.equal(result.service_state, "paused");
  assert.equal(result.deduction_complete, false);
  assert.equal(completedChapter.deduction_progress_json.current_particle_index, 3);
  assert.equal(completedChapter.deduction_progress_json.remaining_particles, 0);
  assert.equal(completedChapter.deduction_progress_json.deduction_complete, true);
  assert.equal(completedChapter.candidate_plot_sim_json.particles_records.length, 3);
  assert.equal(typeof completedChapter.candidate_plot_sim_json.chapter_summary, "object");
  assert.equal(pendingChapter.deduction_progress_json.current_particle_index, 0);
  assert.equal(pendingChapter.deduction_progress_json.deduction_complete, false);
  assert.equal(pendingChapter.candidate_plot_sim_json.chapter_summary, null);
  assert.equal(calls.length, 9, "pause must not begin the next chapter");
  await app.close();
});

test("resume requires one persisted L1A checkpoint but not one for every chapter", async (t) => {
  const calls = [];
  const missing = command({ action: "resume" });
  const app = buildTestService(t, { invokeModel: successfulInvoker(calls) });
  const rejected = await app.inject({ method: "POST", url: "/fp008-02", payload: missing });
  assert.equal(rejected.statusCode, 409);
  assert.equal(rejected.json().redacted_error.code, "RESUME_CHECKPOINT_REQUIRED");
  assert.equal(calls.length, 0);

  const partial = command({ action: "resume" });
  partial.chapters[0].checkpoint = checkpoint();
  partial.chapters.push({
    ...structuredClone(partial.chapters[0]),
    chapter_id: SECOND_CHAPTER,
    chapter_version_id: SECOND_VERSION,
    chapter_index: 2,
  });
  delete partial.chapters[1].checkpoint;
  const resumed = await app.inject({ method: "POST", url: "/fp008-02", payload: partial });
  assert.equal(resumed.statusCode, 200, resumed.body);
  assert.equal(resumed.json().result.deduction_complete, true);
  assert.equal(resumed.json().result.chapters[1].deduction_progress_json.current_particle_index, 3);
  assert.equal(calls.length, 15);
  await app.close();
});

test("resume rejects checkpoint completion drift and preserves a conservative budget pause", async (t) => {
  const calls = [];
  const app = buildTestService(t, { invokeModel: successfulInvoker(calls) });
  for (const invalidCheckpoint of [
    checkpoint({ deductionComplete: true }),
    checkpoint({ current: 3, deductionComplete: false }),
    checkpoint({ tokenConsumed: 3000000, tokenBudgetExceeded: false }),
  ]) {
    const resume = command({ action: "resume" });
    resume.chapters[0].checkpoint = invalidCheckpoint;
    const response = await app.inject({ method: "POST", url: "/fp008-02", payload: resume });
    assert.equal(response.statusCode, 409, response.body);
    assert.equal(response.json().redacted_error.code, "INVALID_CHECKPOINT");
  }
  const pausedResume = command({ action: "resume" });
  pausedResume.chapters[0].checkpoint = checkpoint({ tokenConsumed: 10, tokenBudgetExceeded: true });
  const paused = await app.inject({ method: "POST", url: "/fp008-02", payload: pausedResume });
  assert.equal(paused.statusCode, 200, paused.body);
  assert.equal(paused.json().result.service_state, "paused");
  assert.equal(calls.length, 0);
  await app.close();
});

test("stale run identifiers and malformed model output fail closed", async (t) => {
  const app = buildTestService(t, { invokeModel: successfulInvoker([]) });
  const staleIdentity = await app.inject({
    method: "POST",
    url: "/fp008-02",
    payload: command({ run_id: "invented-run" }),
  });
  assert.equal(staleIdentity.statusCode, 400);
  assert.match(staleIdentity.json().redacted_error.message, /run_id is not supported/);
  await app.close();

  let calls = 0;
  const invalidApp = buildTestService(t, {
    invokeModel: async (invocation) => {
      calls += 1;
      if (invocation.mode === "director_distribute") {
        return { output: distribution(invocation.input.particle.particle_id), usage: { total_tokens: 5 } };
      }
      return { output: { char_code: "P001", candidate_actions: [] }, usage: { total_tokens: 5 } };
    },
  });
  const invalid = await invalidApp.inject({ method: "POST", url: "/fp008-02", payload: command() });
  assert.equal(invalid.statusCode, 502);
  assert.equal(invalid.json().redacted_error.code, "MODEL_OUTPUT_INVALID");
  assert.equal(calls, 4, "one malformed F2 result receives the bounded single-role retry");
  const released = await invalidApp.inject({
    method: "GET",
    url: `/fp008-02?local_operator_id=${OPERATOR}&book_id=${BOOK}&l1a_unit_id=${L1A}`,
  });
  assert.equal(released.statusCode, 404);
  await invalidApp.close();
});

test("HTTP parser failures use the redacted FP008 service error contract", async (t) => {
  const app = buildTestService(t, { invokeModel: successfulInvoker([]) });
  const malformed = await app.inject({
    method: "POST",
    url: "/fp008-02",
    headers: { "content-type": "application/json" },
    payload: '{"action":',
  });

  assert.equal(malformed.statusCode, 400);
  assert.deepEqual(malformed.json(), {
    ok: false,
    redacted_error: {
      code: "INVALID_REQUEST",
      message: "Request body must be valid JSON.",
    },
  });
  await app.close();
});

test("provider rejection returns only the adapter's safe protocol diagnostics", async (t) => {
  const app = buildTestService(t, {
    invokeModel: async () => {
      throw new DeductionServiceError(
        "MODEL_PROVIDER_REJECTED",
        "The model provider rejected the request.",
        502,
        {
          provider_status: 400,
          provider_error_code: "unsupported_response_format",
          provider_error_type: "invalid_request_error",
          has_choices: false,
          has_usage: false,
        },
      );
    },
  });

  const response = await app.inject({ method: "POST", url: "/fp008-02", payload: command() });
  assert.equal(response.statusCode, 502);
  assert.deepEqual(response.json(), {
    ok: false,
    redacted_error: {
      code: "MODEL_PROVIDER_REJECTED",
      message: "The model provider rejected the request.",
      provider_diagnostics: {
        provider_status: 400,
        provider_error_code: "unsupported_response_format",
        provider_error_type: "invalid_request_error",
        has_choices: false,
        has_usage: false,
      },
    },
  });
  await app.close();
});

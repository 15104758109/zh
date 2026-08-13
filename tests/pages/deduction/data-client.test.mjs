import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDeductionCommand,
  buildCreatorReplanSuccessorUrl,
  buildDeductionPauseIntent,
  buildDeductionPageUrl,
  deductionCommandAction,
  deductionFailureRecoveryAction,
  deductionDisplayRecords,
  deductionDisplayProgress,
  deductionReviewReady,
  fetchDeductionProjection,
  readDeductionIdentity,
  resolveDeductionContext,
  sendDeductionCommand,
  sendDeductionPauseIntent,
  scopeDeductionProjection,
} from "../../../apps/web/src/pages/multi-agent-deduction/deduction-data-client.mjs";

const BOOK = "abcdefab-1234-4abc-8abc-abcdefabcdef";
const OPERATOR = "11111111-2222-4333-8444-555555555555";
const L1A = "22222222-3333-4444-8555-666666666666";
const CHAPTER = "33333333-4444-4555-8666-777777777777";
const VERSION = "44444444-5555-4666-8777-888888888888";
const SUCCESSOR_VERSION = "55555555-6666-4777-8888-999999999999";

const SCENE_PACKAGE = {
  scene_location: "documented threshold",
  participant_chars: ["lead"],
  rule_locks: [],
  scene_affordance: [{ item_code: "resource.initial", available: true, functional: true, functions: ["documented-use"] }],
  available_resource_codes: ["resource.initial"],
  info_reveal_candidates: [],
  chain_reaction_candidates: [],
  scene_constraints: [],
  forbid_lines_active: [],
  materialize_notes: [],
};

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    value(key) { return values.get(key); },
  };
}

function response(status, payload) {
  return { ok: status >= 200 && status < 300, status, async json() { return payload; } };
}

test("direct refresh accepts only the matching B1 context and never recreates it", async () => {
  const storage = memoryStorage({ current_book_context: JSON.stringify({ current_book_id: BOOK.toUpperCase(), local_operator_id: OPERATOR.toUpperCase() }) });
  const calls = [];
  const context = await resolveDeductionContext({
    route: { bookId: BOOK.toUpperCase() },
    locationLike: { pathname: `/books/${BOOK.toUpperCase()}/deduction`, search: "" },
    storage,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response(200, { ok: true, local_operator_id: OPERATOR.toUpperCase() });
    },
  });

  assert.deepEqual(context, {
    bookId: BOOK,
    localOperatorId: OPERATOR,
    l1aUnitId: null,
    chapterId: null,
    chapterVersionId: null,
  });
  assert.equal(calls.length, 0);
  assert.equal(storage.value("zhreplan.local_operator_id.v1"), undefined);
  assert.deepEqual(JSON.parse(storage.value("current_book_context")), {
    local_operator_id: OPERATOR.toUpperCase(),
    current_book_id: BOOK.toUpperCase(),
  });
});

test("the production, deduction and review pages share one normalized ID context", async () => {
  const storage = memoryStorage({ current_book_context: JSON.stringify({ current_book_id: BOOK, local_operator_id: OPERATOR }) });
  const context = await resolveDeductionContext({
    route: { bookId: BOOK.toUpperCase() },
    locationLike: {
      pathname: `/books/${BOOK}/deduction`,
      search: `?l1a_unit_id=${L1A.toUpperCase()}&chapter_id=${CHAPTER.toUpperCase()}&chapter_version_id=${VERSION.toUpperCase()}`,
    },
    storage,
  });

  assert.deepEqual(context, {
    bookId: BOOK,
    localOperatorId: OPERATOR,
    l1aUnitId: L1A,
    chapterId: CHAPTER,
    chapterVersionId: VERSION,
  });
  assert.equal(
    buildDeductionPageUrl(BOOK, "deduction-review", context),
    `/books/${BOOK}/deduction-review?l1a_unit_id=${L1A}&chapter_id=${CHAPTER}&chapter_version_id=${VERSION}`,
  );
});

test("an interrupted deduction route restores the documented local operator scope without inventing a book", async () => {
  const storage = memoryStorage({ "zhreplan.local_operator_id.v1": OPERATOR.toUpperCase() });
  const context = await resolveDeductionContext({
    route: { bookId: BOOK.toUpperCase() },
    locationLike: { pathname: `/books/${BOOK.toUpperCase()}/deduction`, search: "" },
    storage,
  });

  assert.deepEqual(context, {
    bookId: BOOK,
    localOperatorId: OPERATOR,
    l1aUnitId: null,
    chapterId: null,
    chapterVersionId: null,
  });
  assert.equal(storage.value("current_book_context"), undefined);
});

test("an interrupted deduction route restores a missing local operator only through the existing ZH00 entry", async () => {
  const storage = memoryStorage();
  const calls = [];
  const context = await resolveDeductionContext({
    route: { bookId: BOOK },
    locationLike: { pathname: `/books/${BOOK}/deduction`, search: "" },
    storage,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response(200, { ok: true, local_operator_id: OPERATOR.toUpperCase() });
    },
  });

  assert.equal(context.bookId, BOOK);
  assert.equal(context.localOperatorId, OPERATOR);
  assert.deepEqual(calls, [{
    url: "/api/skill-library",
    init: {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ action: "operator" }),
    },
  }]);
  assert.equal(storage.value("zhreplan.local_operator_id.v1"), OPERATOR);
  assert.equal(storage.value("current_book_context"), undefined);
});

test("an interrupted deduction route fails closed when ZH00 cannot recover the local operator", async () => {
  await assert.rejects(
    resolveDeductionContext({
      route: { bookId: BOOK },
      locationLike: { pathname: `/books/${BOOK}/deduction`, search: "" },
      storage: memoryStorage(),
      fetchImpl: async () => response(503, { ok: false, redacted_error: { code: "RPC_UNAVAILABLE" } }),
    }),
    (error) => error.code === "LOCAL_OPERATOR_REQUIRED",
  );
});

test("chapter and candidate version IDs cannot be separated", () => {
  assert.throws(
    () => readDeductionIdentity({ locationLike: { search: `?chapter_id=${CHAPTER}` } }),
    (error) => error.code === "INCOMPLETE_CHAPTER_CONTEXT",
  );
  assert.throws(
    () => buildDeductionPageUrl(BOOK, "deduction", { chapterVersionId: VERSION }),
    (error) => error.code === "INCOMPLETE_CHAPTER_CONTEXT",
  );
});

test("a successful creator replan maps the current chapter to its returned successor candidate", () => {
  const context = {
    bookId: BOOK,
    localOperatorId: OPERATOR,
    l1aUnitId: L1A,
    chapterId: CHAPTER,
    chapterVersionId: VERSION,
  };
  const response = {
    ok: true,
    book_id: BOOK.toUpperCase(),
    ids: {
      l1a_unit_id: L1A.toUpperCase(),
      chapters: [
        { chapter_id: "66666666-7777-4888-8999-aaaaaaaaaaaa", chapter_version_id: "77777777-8888-4999-8aaa-bbbbbbbbbbbb" },
        { chapter_id: CHAPTER.toUpperCase(), chapter_version_id: SUCCESSOR_VERSION.toUpperCase() },
      ],
    },
  };
  const destination = buildCreatorReplanSuccessorUrl(context, response);

  assert.equal(
    destination,
    `/books/${BOOK}/deduction?l1a_unit_id=${L1A}&chapter_id=${CHAPTER}&chapter_version_id=${SUCCESSOR_VERSION}`,
  );

  const wrongBook = structuredClone(response);
  wrongBook.book_id = "55555555-6666-4777-8888-999999999999";
  assert.throws(
    () => buildCreatorReplanSuccessorUrl(context, wrongBook),
    (error) => error.code === "INVALID_RESPONSE" && error.status === 502,
  );

  const wrongL1a = structuredClone(response);
  wrongL1a.ids.l1a_unit_id = "55555555-6666-4777-8888-999999999999";
  assert.throws(
    () => buildCreatorReplanSuccessorUrl(context, wrongL1a),
    (error) => error.code === "INVALID_RESPONSE" && error.status === 502,
  );

  const sameVersion = structuredClone(response);
  sameVersion.ids.chapters[1].chapter_version_id = VERSION;
  assert.throws(
    () => buildCreatorReplanSuccessorUrl(context, sameVersion),
    (error) => error.code === "INVALID_RESPONSE" && error.status === 502,
  );

  const missingCurrentChapter = structuredClone(response);
  missingCurrentChapter.ids.chapters = [
    { chapter_id: "66666666-7777-4888-8999-aaaaaaaaaaaa", chapter_version_id: "77777777-8888-4999-8aaa-bbbbbbbbbbbb" },
  ];
  assert.throws(
    () => buildCreatorReplanSuccessorUrl(context, missingCurrentChapter),
    (error) => error.code === "INVALID_RESPONSE" && error.status === 502,
  );
});

test("the database current L1A scopes the projection for interrupted-run recovery", () => {
  const OTHER_L1A = "55555555-6666-4777-8888-999999999999";
  const scoped = scopeDeductionProjection(
    { bookId: BOOK, localOperatorId: OPERATOR, l1aUnitId: null, chapterId: null, chapterVersionId: null },
    {
      book: { id: BOOK, current_l1a_id: L1A.toUpperCase() },
      chapters: [
        { chapter_id: CHAPTER, l1a_unit_id: L1A, candidate_version_id: VERSION },
        { chapter_id: "66666666-7777-4888-8999-aaaaaaaaaaaa", l1a_unit_id: OTHER_L1A },
      ],
      characters: [],
    },
  );

  assert.equal(scoped.context.l1aUnitId, L1A);
  assert.deepEqual(scoped.result.chapters.map((chapter) => chapter.chapter_id), [CHAPTER]);
});

test("stale L1A and chapter-version URLs fail closed", () => {
  const OTHER_L1A = "55555555-6666-4777-8888-999999999999";
  assert.throws(
    () => scopeDeductionProjection(
      { l1aUnitId: OTHER_L1A, chapterId: null, chapterVersionId: null },
      { book: { current_l1a_id: L1A }, chapters: [] },
    ),
    (error) => error.code === "L1A_CONTEXT_MISMATCH",
  );
  assert.throws(
    () => scopeDeductionProjection(
      { l1aUnitId: L1A, chapterId: CHAPTER, chapterVersionId: VERSION },
      { book: { current_l1a_id: L1A }, chapters: [] },
    ),
    (error) => error.code === "CHAPTER_CONTEXT_NOT_FOUND",
  );
  assert.throws(
    () => scopeDeductionProjection(
      { l1aUnitId: L1A, chapterId: CHAPTER, chapterVersionId: "77777777-8888-4999-8aaa-bbbbbbbbbbbb" },
      {
        book: { current_l1a_id: L1A },
        chapters: [{ chapter_id: CHAPTER, l1a_unit_id: L1A, candidate_version_id: VERSION }],
      },
    ),
    (error) => error.code === "CHAPTER_VERSION_CONTEXT_MISMATCH",
  );
});

test("projection reader uses the approved scoped GET contract", async () => {
  const calls = [];
  const result = await fetchDeductionProjection(
    { bookId: BOOK, localOperatorId: OPERATOR },
    {
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return response(200, {
          ok: true,
          result: { book: { id: BOOK.toUpperCase(), title: "测试作品" }, chapters: [], characters: [] },
        });
      },
    },
  );

  assert.equal(result.book.title, "测试作品");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].url, `/api/books/${BOOK}/deduction?local_operator_id=${OPERATOR}`);
});

test("deduction start, technical recovery, and creator-directed replan use the existing ZH05 webhook and exact current-L1A scope", async () => {
  const context = { bookId: BOOK, localOperatorId: OPERATOR, l1aUnitId: L1A };
  assert.deepEqual(buildDeductionCommand(context, "start"), {
    action: "start",
    local_operator_id: OPERATOR,
    book_id: BOOK,
    l1a_unit_id: L1A,
  });
  assert.throws(() => buildDeductionCommand({ ...context, l1aUnitId: null }, "start"), (error) => error.code === "L1A_CONTEXT_REQUIRED");
  assert.deepEqual(buildDeductionCommand(context, "restart"), {
    action: "restart",
    local_operator_id: OPERATOR,
    book_id: BOOK,
    l1a_unit_id: L1A,
  });
  assert.throws(
    () => buildDeductionCommand(context, "replan", { returnDirection: "  ", idempotencyKey: "fp008-replan-empty" }),
    (error) => error.code === "RETURN_DIRECTION_REQUIRED",
  );
  assert.throws(
    () => buildDeductionCommand(context, "replan", { returnDirection: "Keep the reveal for the final particle.", idempotencyKey: "" }),
    (error) => error.code === "IDEMPOTENCY_KEY_REQUIRED",
  );
  const replanCommand = buildDeductionCommand(context, "replan", {
    returnDirection: "Keep the reveal for the final particle.",
    idempotencyKey: "fp008-replan-direction-1",
  });
  assert.deepEqual(replanCommand, {
    action: "replan",
    local_operator_id: OPERATOR,
    book_id: BOOK,
    l1a_unit_id: L1A,
    return_direction: "Keep the reveal for the final particle.",
    idempotency_key: "fp008-replan-direction-1",
  });

  const calls = [];
  const payload = await sendDeductionCommand(context, "start", {
    endpoint: "http://127.0.0.1:5678/webhook/production_stage",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response(200, { ok: true, state: { status: "deduction_complete" } });
    },
  });
  assert.equal(payload.ok, true);
  assert.equal(calls[0].url, "http://127.0.0.1:5678/webhook/production_stage");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), buildDeductionCommand(context, "start"));

  const restartCalls = [];
  await sendDeductionCommand(context, "restart", {
    endpoint: "http://127.0.0.1:5678/webhook/production_stage",
    fetchImpl: async (url, init) => {
      restartCalls.push({ url, init });
      return response(200, { ok: true, state: { status: "deduction_running" } });
    },
  });
  assert.deepEqual(JSON.parse(restartCalls[0].init.body), buildDeductionCommand(context, "restart"));

  const replanCalls = [];
  await sendDeductionCommand(context, "replan", {
    endpoint: "http://127.0.0.1:5678/webhook/production_stage",
    returnDirection: "Keep the reveal for the final particle.",
    idempotencyKey: "fp008-replan-direction-1",
    fetchImpl: async (url, init) => {
      replanCalls.push({ url, init });
      return response(200, { ok: true, state: { action: "replan" } });
    },
  });
  assert.deepEqual(JSON.parse(replanCalls[0].init.body), replanCommand);
});

test("a running deduction sends only a direct FP008-02 pause intent", async () => {
  const context = { bookId: BOOK, localOperatorId: OPERATOR, l1aUnitId: L1A };
  const expected = {
    action: "pause",
    scope: {
      local_operator_id: OPERATOR,
      book_id: BOOK,
      l1a_unit_id: L1A,
    },
  };
  assert.deepEqual(buildDeductionPauseIntent(context), expected);

  const calls = [];
  const payload = await sendDeductionPauseIntent(context, {
    endpoint: "http://127.0.0.1:4182/fp008-02",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response(200, { ok: true, result: { service_state: "pause_requested" } });
    },
  });
  assert.equal(payload.result.service_state, "pause_requested");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:4182/fp008-02");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), expected);
});

test("deduction start is fail-closed until the persisted target and scene package exist", () => {
  const target = { particle_id: "particle-1", type: "truth", purpose: "documented target", content: "A target" };
  const ready = {
    status: "plan_ready",
    run_status: "plan_ready",
    target_snapshot_json: { particles_json: [target], scene_condition_package: SCENE_PACKAGE },
    candidate_plot_sim_json: null,
    deduction_progress_json: null,
    deduction_locked: false,
  };
  assert.equal(deductionCommandAction(ready), "start");
  assert.deepEqual(deductionDisplayRecords(ready), [target]);
  assert.equal(deductionCommandAction({ ...ready, target_snapshot_json: { particles_json: [target] } }), null);
  assert.equal(deductionCommandAction({ ...ready, target_snapshot_json: { scene_condition_package: SCENE_PACKAGE } }), null);
  const staleFailedStart = {
    ...ready,
    candidate_plot_sim_json: { particles_records: [] },
    deduction_progress_json: { current_particle_index: 0, token_consumed: 29442 },
  };
  assert.equal(
    deductionCommandAction(staleFailedStart),
    "start",
    "a failed in-memory attempt without a persisted particle checkpoint must restart",
  );
  const zeroProgressCheckpoint = {
    ...ready,
    status: "deduction_partial",
    run_status: "deduction_partial",
    candidate_plot_sim_json: {
      deduction_input_snapshot: {
        particles: [target],
        participating_chars: [{ char_id: "character-1" }],
      },
      particles_records: [],
    },
    deduction_progress_json: { current_particle_index: 0, token_consumed: 0 },
  };
  assert.equal(
    deductionCommandAction(zeroProgressCheckpoint),
    "resume",
    "a persisted zero-progress checkpoint resumes through the existing ZH05 resume branch",
  );
  const resumed = {
    ...ready,
    candidate_plot_sim_json: {
      deduction_input_snapshot: {
        particles: [target],
        participating_chars: [{ char_id: "character-1" }],
      },
      particles_records: [{ particle_id: "particle-1", particle_status: "completed" }],
    },
    deduction_progress_json: { current_particle_index: 1 },
  };
  assert.equal(deductionCommandAction(resumed), "resume");
  assert.equal(deductionDisplayRecords(resumed)[0].particle_status, "completed");
  assert.equal(
    deductionCommandAction({
      ...resumed,
      deduction_progress_json: { current_particle_index: 1, token_budget_exceeded: true },
    }),
    null,
    "the fixed L1A budget stops new calls; a budget checkpoint is not a resumable command",
  );
});

test("display records follow the persisted deduction input rather than a stale target snapshot", () => {
  const targets = [
    { particle_id: "P101", purpose: "first" },
    { particle_id: "P102", purpose: "stale second" },
    { particle_id: "P103", purpose: "third" },
    { particle_id: "P104", purpose: "fourth" },
    { particle_id: "P105", purpose: "stale fifth" },
  ];
  const persistedParticles = [
    { particle_id: "P101", purpose: "first" },
    { particle_id: "P103", purpose: "third" },
    { particle_id: "P104", purpose: "fourth" },
  ];
  const chapter = {
    target_snapshot_json: { particles_json: targets, scene_condition_package: SCENE_PACKAGE },
    candidate_plot_sim_json: {
      deduction_input_snapshot: { particles: persistedParticles },
      particles_records: persistedParticles.map((particle) => ({
        particle_id: particle.particle_id,
        particle_status: "completed",
      })),
    },
  };

  assert.deepEqual(
    deductionDisplayRecords(chapter).map((record) => [record.particle_id, record.particle_status]),
    [["P101", "completed"], ["P103", "completed"], ["P104", "completed"]],
  );
});

test("a running FP008 service overlay updates display progress without changing the persisted resume checkpoint", () => {
  const targetParticles = [
    { particle_id: "particle-1", type: "truth", purpose: "first target", content: "First target" },
    { particle_id: "particle-2", type: "info", purpose: "second target", content: "Second target" },
  ];
  const chapter = {
    status: "deduction_partial",
    run_status: "deduction_partial",
    deduction_locked: false,
    runtime_service_state: "running",
    target_snapshot_json: { particles_json: targetParticles, scene_condition_package: SCENE_PACKAGE },
    deduction_progress_json: { current_particle_index: 1, token_consumed: 100 },
    candidate_plot_sim_json: {
      deduction_input_snapshot: { particles: targetParticles, participating_chars: [{ char_id: "character-1" }] },
      particles_records: [{ particle_id: "particle-1", particle_status: "completed" }],
    },
    runtime_deduction_progress_json: { current_particle_index: 2, token_consumed: 200 },
    runtime_candidate_plot_sim_json: {
      particles_records: [
        { particle_id: "particle-1", particle_status: "completed" },
        { particle_id: "particle-2", particle_status: "completed" },
      ],
    },
  };

  assert.equal(deductionDisplayProgress(chapter).current_particle_index, 2);
  assert.deepEqual(
    deductionDisplayRecords(chapter).map((record) => record.particle_status),
    ["completed", "completed"],
  );
  assert.equal(
    deductionCommandAction(chapter),
    "resume",
    "the command decision must remain anchored to the persisted checkpoint",
  );
});

test("only a runtime model-call failure exposes whole-L1A technical recovery", () => {
  const chapter = {
    deduction_locked: false,
    runtime_service_state: "blocked",
    runtime_blocked_code: "MODEL_CALL_FAILED",
  };
  assert.equal(deductionFailureRecoveryAction(chapter), "restart");
  assert.equal(deductionFailureRecoveryAction({ ...chapter, runtime_blocked_code: "DEDUCTION_BLOCKED" }), null);
  assert.equal(deductionFailureRecoveryAction({ ...chapter, runtime_service_state: "failed" }), null);
  assert.equal(deductionFailureRecoveryAction({ ...chapter, deduction_locked: true }), null);

  const planReady = { deduction_locked: false, run_status: "plan_ready" };
  assert.equal(
    deductionFailureRecoveryAction(planReady, { code: "MODEL_CALL_FAILED" }),
    "restart",
    "the page must retain the explicit runtime failure because V7 does not persist it",
  );
  assert.equal(deductionFailureRecoveryAction(planReady, { code: "DEDUCTION_BLOCKED" }), null);
  assert.equal(deductionFailureRecoveryAction({ ...planReady, deduction_locked: true }, { code: "MODEL_CALL_FAILED" }), null);

  const checkpoint = {
    ...planReady,
    status: "deduction_partial",
    run_status: "deduction_partial",
    target_snapshot_json: { particles_json: [{ particle_id: "particle-1" }], scene_condition_package: SCENE_PACKAGE },
    candidate_plot_sim_json: {
      deduction_input_snapshot: { particles: [{ particle_id: "particle-1" }], participating_chars: [{ char_id: "character-1" }] },
      particles_records: [],
    },
    deduction_progress_json: { current_particle_index: 0 },
  };
  assert.equal(
    deductionFailureRecoveryAction(checkpoint, { code: "MODEL_CALL_FAILED" }),
    null,
    "a model-call error with a valid checkpoint uses resume instead of opening restart",
  );
});

test("a provider runtime error keeps a valid persisted checkpoint resumable", () => {
  const target = { particle_id: "particle-1", type: "truth", purpose: "documented target", content: "A target" };
  const checkpoint = {
    status: "deduction_partial",
    run_status: "deduction_partial",
    deduction_locked: false,
    runtime_service_state: "blocked",
    runtime_blocked_code: "MODEL_CALL_FAILED",
    target_snapshot_json: { particles_json: [target], scene_condition_package: SCENE_PACKAGE },
    candidate_plot_sim_json: {
      deduction_input_snapshot: { particles: [target], participating_chars: [{ char_id: "character-1" }] },
      particles_records: [],
    },
    deduction_progress_json: { current_particle_index: 0, token_consumed: 10 },
  };

  assert.equal(deductionCommandAction(checkpoint), "resume");
  assert.equal(
    deductionCommandAction({ ...checkpoint, runtime_blocked_code: "DEDUCTION_BLOCKED" }),
    null,
    "a business-blocked particle must remain stopped",
  );
  assert.equal(
    deductionCommandAction({ ...checkpoint, runtime_service_state: "failed", runtime_blocked_code: "MODEL_OUTPUT_INVALID" }),
    "resume",
  );
  assert.equal(
    deductionCommandAction({ ...checkpoint, deduction_locked: true }),
    null,
  );
});

test("the review page opens only after FP008-04 has persisted the locked snapshot", () => {
  const complete = { deduction_progress_json: { deduction_complete: true } };
  assert.equal(deductionReviewReady({ ...complete, deduction_locked: false }), false);
  assert.equal(deductionReviewReady({ deduction_locked: true, deduction_progress_json: { deduction_complete: false } }), false);
  assert.equal(deductionReviewReady({ ...complete, deduction_locked: true }), true);
});

test("known RPC scope errors are shown in Chinese", async () => {
  await assert.rejects(
    fetchDeductionProjection(
      { bookId: BOOK, localOperatorId: OPERATOR },
      {
        fetchImpl: async () => response(404, {
          ok: false,
          redacted_error: { code: "SCOPE_REJECTED", message: "The selected book is unavailable." },
        }),
      },
    ),
    (error) => error.code === "SCOPE_REJECTED" && error.message === "该作品不存在，或不属于当前本地操作者。",
  );
});

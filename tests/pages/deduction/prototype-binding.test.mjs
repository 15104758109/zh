import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const pagePath = `${root}apps/web/src/pages/multi-agent-deduction/index.html`;
const modulePath = `${root}apps/web/src/pages/multi-agent-deduction/index.mjs`;
const clientPath = `${root}apps/web/src/pages/multi-agent-deduction/deduction-data-client.mjs`;
const cssPath = `${root}apps/web/src/pages/multi-agent-deduction/page.css`;
const runtimeModule = await import(new URL("../../../apps/web/src/pages/multi-agent-deduction/index.mjs", import.meta.url));
const dataClientModule = await import(new URL("../../../apps/web/src/pages/multi-agent-deduction/deduction-data-client.mjs", import.meta.url));

test("DEDUCTION describes paused service states and a rejected pause intent in Chinese", () => {
  assert.equal(runtimeModule.statusLabel("pause_requested"), "正在等待当前颗粒完成");
  assert.equal(runtimeModule.statusLabel("paused"), "推演已暂停，可继续");
  assert.equal(
    runtimeModule.deductionRunStatusText("paused", false, { message: "暂停意图未被推演服务接受。" }, "pause"),
    "暂停意图未提交：暂停意图未被推演服务接受。",
  );
  assert.match(runtimeModule.deductionRunStatusText("paused", false), /推演已暂停/);
});

test("DEDUCTION keeps a later deduction failure distinct from a rejected pause intent", async () => {
  assert.equal(
    runtimeModule.deductionRunStatusText("paused", false, { message: "The current model service is unavailable." }, "resume"),
    "推演请求未完成：The current model service is unavailable.",
  );

  const module = await readFile(modulePath, "utf8");
  const handler = module.match(/function requestDeductionPause\(runtime\) \{[\s\S]*?\n\}/);
  assert.ok(handler, "pause handler is present");
  assert.match(handler[0], /runtime\.pauseError = error/);
  assert.doesNotMatch(handler[0], /runtime\.lastCommand = "pause"/);
  assert.match(module, /const statusError = runtime\.pauseError \?\? runtime\.commandError/);
});

test("DEDUCTION keeps the existing resume command available for recoverable backend errors", () => {
  const chapter = {
    status: "deduction_partial",
    run_status: "deduction_partial",
    deduction_locked: false,
    target_snapshot_json: {
      particles_json: [{ particle_id: "particle-1" }],
      scene_condition_package: { scene_location: "documented scene" },
    },
    candidate_plot_sim_json: {
      deduction_input_snapshot: {
        particles: [{ particle_id: "particle-1" }],
        participating_chars: [{ char_id: "character-1" }],
      },
      particles_records: [{ particle_id: "particle-1", particle_status: "completed" }],
    },
    deduction_progress_json: { current_particle_index: 1 },
  };

  for (const code of ["MODEL_PROVIDER_REJECTED", "MODEL_PROVIDER_UNAVAILABLE", "MODEL_OUTPUT_INVALID", "MODEL_CALL_FAILED"]) {
    assert.equal(runtimeModule.deductionResumeAfterError(chapter, { code }), true, code);
  }
  assert.equal(
    runtimeModule.deductionResumeAfterError({
      ...chapter,
      runtime_service_state: "blocked",
      runtime_blocked_code: "MODEL_CALL_FAILED",
    }, { code: "MODEL_CALL_FAILED" }),
    true,
    "a blocked runtime overlay must keep the persisted checkpoint resumable",
  );
  assert.equal(runtimeModule.deductionResumeAfterError(chapter, { code: "SCOPE_REJECTED" }), false);
  assert.equal(
    runtimeModule.deductionResumeAfterError({ ...chapter, candidate_plot_sim_json: null }, { code: "MODEL_OUTPUT_INVALID" }),
    false,
    "without a persisted checkpoint the normal start/recovery rules remain unchanged",
  );
  assert.equal(
    runtimeModule.deductionResumeAfterError({
      ...chapter,
      deduction_progress_json: { current_particle_index: 1, token_budget_exceeded: true },
    }, { code: "MODEL_OUTPUT_INVALID" }),
    false,
    "budget exhaustion remains non-resumable",
  );
});

test("DEDUCTION does not let a stale running projection hide a recoverable command error", () => {
  const chapter = {
    status: "deduction_partial",
    run_status: "deduction_partial",
    deduction_locked: false,
    runtime_service_state: "running",
    target_snapshot_json: {
      particles_json: [{ particle_id: "particle-1" }],
      scene_condition_package: { scene_location: "documented scene" },
    },
    candidate_plot_sim_json: {
      deduction_input_snapshot: {
        particles: [{ particle_id: "particle-1" }],
        participating_chars: [{ char_id: "character-1" }],
      },
      particles_records: [{ particle_id: "particle-1", particle_status: "completed" }],
    },
    deduction_progress_json: { current_particle_index: 1 },
  };

  assert.equal(
    runtimeModule.deductionControlMode(chapter, {
      commandError: { code: "MODEL_OUTPUT_INVALID" },
      serviceState: "running",
    }),
    "resume",
  );
  assert.equal(
    runtimeModule.deductionControlMode(chapter, {
      commandError: { code: "SCOPE_REJECTED" },
      serviceState: "running",
    }),
    "unavailable",
  );
});

test("DEDUCTION clears only the runtime display overlay after a failed command refresh", () => {
  const result = runtimeModule.deductionPersistedProjection({
    book: { title: "book", runtime_service_state: "running", runtime_blocked_code: "MODEL_OUTPUT_INVALID" },
    chapters: [{
      chapter_id: "chapter-1",
      deduction_progress_json: { current_particle_index: 1 },
      runtime_service_state: "running",
      runtime_blocked_code: "MODEL_OUTPUT_INVALID",
      runtime_l1a_token_consumed: 500,
      runtime_deduction_progress_json: { current_particle_index: 3 },
      runtime_candidate_plot_sim_json: { particles_records: [{ particle_id: "runtime" }] },
    }],
  });

  assert.deepEqual(result.book, { title: "book" });
  assert.deepEqual(result.chapters, [{
    chapter_id: "chapter-1",
    deduction_progress_json: { current_particle_index: 1 },
  }]);
});

test("DEDUCTION opens the resumable chapter when a paused L1A has no explicit active chapter", () => {
  const resumable = {
    chapter_id: "chapter-2",
    status: "deduction_partial",
    run_status: "deduction_partial",
    deduction_locked: false,
    target_snapshot_json: {
      particles_json: [{ particle_id: "particle-1" }],
      scene_condition_package: { scene_location: "documented scene" },
    },
    candidate_plot_sim_json: {
      deduction_input_snapshot: {
        particles: [{ particle_id: "particle-1" }],
        participating_chars: [{ char_id: "character-1" }],
      },
      particles_records: [],
    },
    deduction_progress_json: { current_particle_index: 0 },
  };
  const result = {
    book: { active_chapter_json: null },
    chapters: [{ chapter_id: "chapter-1", deduction_locked: true }, resumable],
  };

  assert.equal(runtimeModule.chooseInitialChapter(result, { chapterId: null }), "chapter-2");
  assert.equal(runtimeModule.chooseInitialChapter(result, { chapterId: "chapter-1" }), "chapter-1");
  assert.equal(
    runtimeModule.chooseInitialChapter({ ...result, book: { active_chapter_json: { chapter_id: "chapter-1" } } }, { chapterId: null }),
    "chapter-1",
  );
});

test("DEDUCTION displays the L1A budget total instead of a selected chapter subtotal", () => {
  assert.equal(runtimeModule.l1aTokenConsumed({
    deduction_progress_json: { token_consumed: 316755, l1a_token_consumed: 816182 },
  }), 816182);
  assert.equal(runtimeModule.l1aTokenConsumed({
    runtime_l1a_token_consumed: 816182,
    runtime_deduction_progress_json: { token_consumed: 499427 },
  }), 816182);
  assert.equal(runtimeModule.l1aTokenConsumed({
    deduction_progress_json: { token_consumed: 316755 },
  }), 316755);
});

test("DEDUCTION renders a paused runtime checkpoint instead of its older persisted snapshot", () => {
  const persistedProgress = { current_particle_index: 0, token_consumed: 65_779 };
  const runtimeProgress = { current_particle_index: 1, token_consumed: 213_595 };
  const persistedPlot = { particles_records: [] };
  const runtimePlot = { particles_records: [{ particle_id: "P003", particle_status: "completed" }] };

  const chapter = {
    runtime_service_state: "paused",
    deduction_progress_json: persistedProgress,
    runtime_deduction_progress_json: runtimeProgress,
    candidate_plot_sim_json: persistedPlot,
    runtime_candidate_plot_sim_json: runtimePlot,
  };

  assert.equal(dataClientModule.deductionDisplayProgress(chapter), runtimeProgress);
  assert.equal(dataClientModule.deductionDisplayPlot(chapter), runtimePlot);
});

test("DEDUCTION retains prototype anchors while binding the approved read projection", async () => {
  const [html, module, client, css] = await Promise.all([
    readFile(pagePath, "utf8"),
    readFile(modulePath, "utf8"),
    readFile(clientPath, "utf8"),
    readFile(cssPath, "utf8"),
  ]);

  for (const anchor of [
    "main-content",
    "header-book-name",
    "current-particle-label",
    "flow-node-1",
    "flow-node-2",
    "flow-node-3",
    "node-content-area",
    "toggle-deduction-btn",
    "deduction-run-status",
  ]) {
    assert.match(html, new RegExp(`id=["']${anchor}["']`), `missing prototype anchor: ${anchor}`);
  }

  for (const purpose of ["current-particle", "deduction-controls", "deduction-summary", "l1a-plan", "chapter-progress", "global-changes"]) {
    assert.match(html, new RegExp(`data-purpose=["']${purpose}["']`));
  }
  assert.match(html, /href="\/pages\/prototype\/common\/theme\.css"/);
  assert.match(html, /href="\/pages\/prototype\/common\/sidebar\.css"/);
  assert.match(html, /href="\/pages\/multi-agent-deduction\/page\.css"/);
  assert.match(html, /id="header-book-name"[^>]*data-book-context>作品未确认<\/span>/);
  assert.doesNotMatch(html, /id="header-book-name"[^>]*>苍穹纪事<\/span>/);
  assert.match(html, /id="toggle-deduction-btn"[^>]*disabled/);
  assert.match(html, /data-action="regenerate-deduction"[^>]*disabled/);
  assert.match(html, /id="submit-replan-btn"[^>]*disabled/);
  assert.match(html, /data-deduction-runtime-content hidden inert aria-hidden="true"/);
  assert.doesNotMatch(html, /data-static-mock|静态推演预览|暂停预览|恢复预览/);
  assert.doesNotMatch(html, /text-\[(?:8|9)px\]|bg-gradient-|tracking-(?:wide|wider|widest)/);
  assert.doesNotMatch(module, /text-\[(?:8|9)px\]|bg-gradient-|tracking-(?:wide|wider|widest)/);
  assert.match(css, /background:\s*var\(--color-base-200\)/);
  assert.doesNotMatch(css, /rgb\(244 243 242 \/ 94%\)/);

  assert.match(module, /fetchDeductionProjection/);
  assert.match(html, /data-action="navigate-to-review"/);
  assert.doesNotMatch(module, /navigateToReviewWhenComplete/);
  assert.doesNotMatch(module, /renderDeductionProjection\(runtime\);\s*if \(navigateToReviewWhenComplete/);
  assert.match(module, /chapters\.every\(deductionReviewReady\)/);
  assert.match(module, /scrubPrototypeBusinessData/);
  assert.match(module, /function setDeductionContentVisible/);
  assert.match(module, /setDeductionContentVisible\(root, false\)/);
  assert.match(module, /setDeductionContentVisible\(runtime\.root, true\)/);
  assert.match(module, /schedulePolling/);
  assert.match(module, /sendDeductionCommand/);
  assert.match(module, /sendDeductionPauseIntent/);
  assert.match(module, /暂停推演/);
  assert.match(module, /正在等待当前颗粒完成/);
  assert.match(module, /开始推演/);
  assert.match(module, /pause_requested/);
  assert.match(module, /runtime\.commandPending/);
  assert.match(module, /visibilitychange/);
  assert.match(module, /5000/);
  assert.match(html, /href="\/vendor\/font-fallback\.css"/);
  assert.match(module, /中断会等待当前颗粒完成并经 FP008-03\/04 保存合法检查点/);
  assert.match(module, /继续从该检查点恢复/);
  assert.match(module, /本次 L1A 推演预算已用尽/);
  assert.match(module, /deductionFailureRecoveryAction/);
  assert.match(module, /deductionFailureRecoveryAction\(chapter, runtime\.commandError\)/);
  assert.match(module, /deductionFailureRecoveryAction\(selectedChapter\(runtime\), runtime\.commandError\)/);
  assert.match(module, /if \(runtime\.commandError\) \{\s*stopPolling\(runtime\);\s*void loadProjection\(runtime, \{ background: true \}\);/);
  assert.match(client, /MODEL_CALL_FAILED/);
  assert.match(module, /requestFailureRecovery/);
  assert.match(module, /creatorReplanAction/);
  assert.match(module, /requestCreatorReplan/);
  assert.match(module, /buildCreatorReplanSuccessorUrl/);
  assert.match(module, /navigateToCreatorReplanSuccessor/);
  assert.match(client, /return_direction/);
  assert.match(module, /模型连续调用失败/);
  assert.match(html, /id="regenerate-modal-title"/);
  assert.match(html, /提交方向并重新推演/);
  assert.match(html, /已保存的推演结果将不再作为生产输入/);
  assert.match(html, /id="re-deduction-direction"[^>]*hidden[^>]*disabled/);
  assert.doesNotMatch(module, /static_mock|静态推演预览|退回成功/);

  assert.match(client, /\/api\/books/);
  assert.match(client, /method: "GET"/);
  assert.match(client, /readMatchingBookContext/);
  assert.match(client, /BOOK_CONTEXT_REQUIRED/);
  assert.match(client, /method: "POST"/);
  assert.match(client, /SCOPE_REJECTED: "该作品不存在/);
});

test("creator-directed replan stops polling the superseded candidate until navigation", async () => {
  const module = await readFile(modulePath, "utf8");
  const match = module.match(/function requestCreatorReplan\(runtime\) \{[\s\S]*?\n\}\n\nfunction requestDeductionPause/);
  assert.ok(match, "creator replan handler is present");
  assert.match(match[0], /stopPolling\(runtime, \{ abort: true \}\);/);
  assert.match(match[0], /showState\(runtime\.root, "loading"\);/);
  assert.doesNotMatch(match[0], /schedulePolling\(runtime\);/);
});

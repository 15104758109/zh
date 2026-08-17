const visibleRuntimeStates = new Set(["running", "paused", "blocked", "failed"]);

function runtimeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function chapterIdentity(chapter) {
  return `${String(chapter?.chapter_id).toLowerCase()}:${String(chapter?.candidate_version_id).toLowerCase()}`;
}

function resumablePausedCheckpoint(chapters) {
  return chapters.some((chapter) => {
    const progress = runtimeObject(chapter?.deduction_progress_json);
    const input = runtimeObject(chapter?.candidate_plot_sim_json)?.deduction_input_snapshot;
    return progress?.deduction_complete !== true
      && Number.isInteger(progress?.current_particle_index)
      && progress.current_particle_index > 0
      && Array.isArray(input?.particles) && input.particles.length > 0
      && Array.isArray(input?.participating_chars) && input.participating_chars.length > 0;
  });
}

export function mergeDeductionRuntime(databaseResult, runtimeResult) {
  const databaseBook = databaseResult?.result?.book;
  const runtimeBook = runtimeResult?.book;
  if (!databaseBook || !runtimeBook
    || String(runtimeBook.id).toLowerCase() !== String(databaseBook.id).toLowerCase()
    || String(runtimeBook.current_l1a_id).toLowerCase() !== String(databaseBook.current_l1a_id).toLowerCase()) {
    throw new Error("FP008_RUNTIME_SCOPE_MISMATCH");
  }

  const runtimeState = typeof runtimeResult.service_state === "string" ? runtimeResult.service_state : null;
  const databaseChapters = Array.isArray(databaseResult.result.chapters) ? databaseResult.result.chapters : [];
  const runtimeChapters = Array.isArray(runtimeResult.chapters) ? runtimeResult.chapters : [];
  const byChapterId = new Map(databaseChapters.map((chapter) => [String(chapter?.chapter_id).toLowerCase(), chapter]));
  const matchedRuntimeChapters = [];

  for (const runtimeChapter of runtimeChapters) {
    if (String(runtimeChapter?.l1a_unit_id).toLowerCase() !== String(databaseBook.current_l1a_id).toLowerCase()) {
      throw new Error("FP008_RUNTIME_CHAPTER_MISMATCH");
    }
    const chapter = byChapterId.get(String(runtimeChapter?.chapter_id).toLowerCase());
    if (!chapter) {
      // After RPC-015 formalizes a completed chapter, v_chapter_progress no
      // longer projects it while FP008 can still retain its paused snapshot.
      if (runtimeState === "paused" && runtimeChapter?.deduction_progress_json?.deduction_complete === true) continue;
      throw new Error("FP008_RUNTIME_CHAPTER_MISMATCH");
    }
    if (chapterIdentity(runtimeChapter) !== chapterIdentity(chapter)) {
      throw new Error("FP008_RUNTIME_CHAPTER_MISMATCH");
    }
    matchedRuntimeChapters.push([runtimeChapter, chapter]);
  }

  if (runtimeState === "paused" && !resumablePausedCheckpoint(runtimeChapters)) return databaseResult;
  if (!visibleRuntimeStates.has(runtimeState)) return databaseResult;

  const runtimeBlockedCode = typeof runtimeResult.blocked_code === "string"
    ? runtimeResult.blocked_code
    : null;
  const runtimeL1aTokenConsumed = Number(runtimeResult.token_consumed);
  const hasRuntimeL1aTokenConsumed = Number.isFinite(runtimeL1aTokenConsumed)
    && runtimeL1aTokenConsumed >= 0;
  for (const [runtimeChapter, chapter] of matchedRuntimeChapters) {
    chapter.runtime_service_state = runtimeState;
    chapter.runtime_blocked_code = runtimeBlockedCode;
    if (hasRuntimeL1aTokenConsumed) chapter.runtime_l1a_token_consumed = runtimeL1aTokenConsumed;
    else delete chapter.runtime_l1a_token_consumed;
    const runtimeProgress = runtimeObject(runtimeChapter?.deduction_progress_json);
    const runtimePlot = runtimeObject(runtimeChapter?.candidate_plot_sim_json);
    if (runtimeProgress) chapter.runtime_deduction_progress_json = runtimeProgress;
    if (runtimePlot) chapter.runtime_candidate_plot_sim_json = runtimePlot;
  }
  databaseBook.runtime_service_state = runtimeState;
  databaseBook.runtime_blocked_code = runtimeBlockedCode;
  return databaseResult;
}

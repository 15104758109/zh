const visibleRuntimeStates = new Set(["running", "blocked", "failed"]);

function runtimeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function chapterIdentity(chapter) {
  return `${String(chapter?.chapter_id).toLowerCase()}:${String(chapter?.candidate_version_id).toLowerCase()}`;
}

export function mergeDeductionRuntime(databaseResult, runtimeResult) {
  const databaseBook = databaseResult?.result?.book;
  const runtimeBook = runtimeResult?.book;
  if (!databaseBook || !runtimeBook
    || String(runtimeBook.id).toLowerCase() !== String(databaseBook.id).toLowerCase()
    || String(runtimeBook.current_l1a_id).toLowerCase() !== String(databaseBook.current_l1a_id).toLowerCase()) {
    throw new Error("FP008_RUNTIME_SCOPE_MISMATCH");
  }

  const databaseChapters = Array.isArray(databaseResult.result.chapters) ? databaseResult.result.chapters : [];
  const runtimeChapters = Array.isArray(runtimeResult.chapters) ? runtimeResult.chapters : [];
  const byIdentity = new Map(databaseChapters.map((chapter) => [chapterIdentity(chapter), chapter]));

  for (const runtimeChapter of runtimeChapters) {
    const chapter = byIdentity.get(chapterIdentity(runtimeChapter));
    if (!chapter || String(runtimeChapter?.l1a_unit_id).toLowerCase() !== String(databaseBook.current_l1a_id).toLowerCase()) {
      throw new Error("FP008_RUNTIME_CHAPTER_MISMATCH");
    }
  }

  const runtimeState = typeof runtimeResult.service_state === "string" ? runtimeResult.service_state : null;
  if (!visibleRuntimeStates.has(runtimeState)) return databaseResult;

  const runtimeBlockedCode = typeof runtimeResult.blocked_code === "string"
    ? runtimeResult.blocked_code
    : null;
  const runtimeL1aTokenConsumed = Number(runtimeResult.token_consumed);
  const hasRuntimeL1aTokenConsumed = Number.isFinite(runtimeL1aTokenConsumed)
    && runtimeL1aTokenConsumed >= 0;
  for (const runtimeChapter of runtimeChapters) {
    const chapter = byIdentity.get(chapterIdentity(runtimeChapter));
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

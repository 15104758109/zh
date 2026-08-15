import "../prototype/common/book-context.js";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEDUCTION_PAGE_SEGMENTS = Object.freeze({
  production: "production",
  deduction: "deduction",
  "deduction-review": "deduction-review",
});
const LOCAL_OPERATOR_STORAGE_KEY = "zhreplan.local_operator_id.v1";
const OPERATOR_ENDPOINT = "/api/skill-library";
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
// A runtime overlay can be terminal even though FP008-04 still has the last
// valid checkpoint. Keep resume available for provider failures only; business
// blockers and completed runs remain fail-closed.
const RESUMABLE_RUNTIME_BLOCK_CODES = new Set([
  "MODEL_CALL_FAILED",
  "MODEL_PROVIDER_REJECTED",
  "MODEL_PROVIDER_UNAVAILABLE",
  "MODEL_OUTPUT_INVALID",
]);

const IDENTITY_FIELDS = Object.freeze([
  { key: "l1aUnitId", query: "l1a_unit_id", label: "L1A" },
  { key: "chapterId", query: "chapter_id", legacyQuery: "chapterId", label: "章节" },
  { key: "chapterVersionId", query: "chapter_version_id", label: "章节版本" },
]);

export class DeductionDataError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.name = "DeductionDataError";
    this.code = code;
    this.status = status;
  }
}

function normalizedOptionalUuid(value, label, code = "INVALID_DEDUCTION_CONTEXT") {
  if (value === undefined || value === null || value === "") return null;
  if (!UUID_PATTERN.test(String(value))) {
    throw new DeductionDataError(code, `${label}标识无效，页面已停止使用该上下文。`);
  }
  return String(value).toLowerCase();
}

export function readDeductionIdentity({ route, locationLike } = {}) {
  const params = new URLSearchParams(locationLike?.search || "");
  const identity = {};
  for (const field of IDENTITY_FIELDS) {
    const routeValue = route?.[field.key];
    const queryValue = params.get(field.query) ?? (field.legacyQuery ? params.get(field.legacyQuery) : null);
    identity[field.key] = normalizedOptionalUuid(routeValue ?? queryValue, field.label);
  }
  if (Boolean(identity.chapterId) !== Boolean(identity.chapterVersionId)) {
    throw new DeductionDataError(
      "INCOMPLETE_CHAPTER_CONTEXT",
      "章节标识与章节版本标识必须同时提供，页面未采用不完整上下文。",
    );
  }
  return identity;
}

export function buildDeductionPageUrl(bookId, page, identity = {}) {
  const normalizedBookId = normalizedOptionalUuid(bookId, "作品");
  const segment = DEDUCTION_PAGE_SEGMENTS[page];
  if (!segment) throw new DeductionDataError("INVALID_DEDUCTION_ROUTE", "目标页面不属于推演链路。");

  const normalizedIdentity = {};
  for (const field of IDENTITY_FIELDS) {
    normalizedIdentity[field.key] = normalizedOptionalUuid(identity[field.key], field.label);
  }
  if (Boolean(normalizedIdentity.chapterId) !== Boolean(normalizedIdentity.chapterVersionId)) {
    throw new DeductionDataError(
      "INCOMPLETE_CHAPTER_CONTEXT",
      "章节标识与章节版本标识必须同时提供，无法生成跳转地址。",
    );
  }

  const params = new URLSearchParams();
  for (const field of IDENTITY_FIELDS) {
    if (normalizedIdentity[field.key]) params.set(field.query, normalizedIdentity[field.key]);
  }
  const query = params.toString();
  return `/books/${encodeURIComponent(normalizedBookId)}/${segment}${query ? `?${query}` : ""}`;
}

export function buildCreatorReplanSuccessorUrl(context, payload) {
  const bookId = normalizedOptionalUuid(context?.bookId, "当前作品", "INVALID_RESPONSE");
  const l1aUnitId = normalizedOptionalUuid(context?.l1aUnitId, "当前 L1A", "INVALID_RESPONSE");
  const chapterId = normalizedOptionalUuid(context?.chapterId, "当前章节", "INVALID_RESPONSE");
  const previousVersionId = normalizedOptionalUuid(context?.chapterVersionId, "当前章节版本", "INVALID_RESPONSE");
  const responseBookId = normalizedOptionalUuid(payload?.book_id, "重新推演返回作品", "INVALID_RESPONSE");
  const responseL1aUnitId = normalizedOptionalUuid(payload?.ids?.l1a_unit_id, "重新推演返回 L1A", "INVALID_RESPONSE");
  if (!bookId || !l1aUnitId || !chapterId || !previousVersionId || !responseBookId || !responseL1aUnitId) {
    throw new DeductionDataError("INVALID_RESPONSE", "重新推演响应缺少当前章节的后继候选范围，页面未采用该结果。", 502);
  }
  if (responseBookId !== bookId || responseL1aUnitId !== l1aUnitId) {
    throw new DeductionDataError("INVALID_RESPONSE", "重新推演响应不属于当前作品或 L1A，页面未采用该结果。", 502);
  }
  const chapters = Array.isArray(payload?.ids?.chapters) ? payload.ids.chapters : [];
  const successor = chapters.find((chapter) => String(chapter?.chapter_id || "").toLowerCase() === chapterId);
  const successorVersionId = normalizedOptionalUuid(
    successor?.chapter_version_id,
    "重新推演返回章节版本",
    "INVALID_RESPONSE",
  );
  if (!successorVersionId || successorVersionId === previousVersionId) {
    throw new DeductionDataError("INVALID_RESPONSE", "重新推演未返回当前章节的后继候选，页面未采用该结果。", 502);
  }
  return buildDeductionPageUrl(bookId, "deduction", {
    l1aUnitId,
    chapterId,
    chapterVersionId: successorVersionId,
  });
}

export function scopeDeductionProjection(context, result) {
  const book = result?.book && typeof result.book === "object" ? result.book : {};
  const currentL1aId = normalizedOptionalUuid(
    book.current_l1a_id,
    "数据库当前 L1A",
    "INVALID_RESPONSE",
  );
  if (context.l1aUnitId && currentL1aId && context.l1aUnitId !== currentL1aId) {
    throw new DeductionDataError(
      "L1A_CONTEXT_MISMATCH",
      "网址中的 L1A 与数据库标记的当前推演 L1A 不一致，页面已停止展示。",
      409,
    );
  }

  let l1aUnitId = context.l1aUnitId || currentL1aId;
  const allChapters = Array.isArray(result?.chapters) ? result.chapters : [];
  if (context.chapterId) {
    const chapter = allChapters.find((item) => String(item?.chapter_id || "").toLowerCase() === context.chapterId);
    if (!chapter) {
      throw new DeductionDataError(
        "CHAPTER_CONTEXT_NOT_FOUND",
        "网址中的章节不属于当前作品投影，页面已停止展示。",
        404,
      );
    }
    const chapterL1aId = normalizedOptionalUuid(chapter.l1a_unit_id, "返回章节 L1A", "INVALID_RESPONSE");
    if (l1aUnitId && chapterL1aId !== l1aUnitId) {
      throw new DeductionDataError(
        "L1A_CONTEXT_MISMATCH",
        "网址中的章节不属于当前推演 L1A，页面已停止展示。",
        409,
      );
    }
    l1aUnitId ||= chapterL1aId;
    const versionId = normalizedOptionalUuid(
      chapter.candidate_version_id,
      "返回章节版本",
      "INVALID_RESPONSE",
    );
    if (versionId !== context.chapterVersionId) {
      throw new DeductionDataError(
        "CHAPTER_VERSION_CONTEXT_MISMATCH",
        "网址中的章节版本与当前候选版本不一致，页面已停止展示。",
        409,
      );
    }
  }
  const chapters = l1aUnitId
    ? allChapters.filter((chapter) => String(chapter?.l1a_unit_id || "").toLowerCase() === l1aUnitId)
    : allChapters;

  return {
    context: { ...context, l1aUnitId },
    result: { ...result, chapters },
  };
}

function visibleRuntimeValue(chapter, key) {
  if (!['running', 'pause_requested', 'paused', 'blocked', 'failed'].includes(chapter?.runtime_service_state)) return null;
  const value = chapter?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export function deductionDisplayProgress(chapter) {
  return visibleRuntimeValue(chapter, "runtime_deduction_progress_json")
    || (chapter?.deduction_progress_json && typeof chapter.deduction_progress_json === "object" && !Array.isArray(chapter.deduction_progress_json)
      ? chapter.deduction_progress_json
      : {});
}

export function deductionDisplayPlot(chapter) {
  return visibleRuntimeValue(chapter, "runtime_candidate_plot_sim_json")
    || (chapter?.candidate_plot_sim_json && typeof chapter.candidate_plot_sim_json === "object" && !Array.isArray(chapter.candidate_plot_sim_json)
      ? chapter.candidate_plot_sim_json
      : {});
}

export function deductionDisplayRecords(chapter) {
  const plot = deductionDisplayPlot(chapter);
  const persistedParticles = Array.isArray(plot?.deduction_input_snapshot?.particles)
    ? plot.deduction_input_snapshot.particles
    : [];
  const targets = persistedParticles.length
    ? persistedParticles
    : (Array.isArray(chapter?.target_snapshot_json?.particles_json)
      ? chapter.target_snapshot_json.particles_json
      : []);
  const completed = Array.isArray(plot.particles_records)
    ? plot.particles_records
    : [];
  if (!targets.length) return completed;
  const completedById = new Map(completed.map((record) => [record?.particle_id, record]));
  return targets.map((target) => ({ ...target, ...(completedById.get(target?.particle_id) || {}) }));
}

export function deductionCommandAction(chapter) {
  if (!chapter || chapter.deduction_locked === true) return null;
  const terminalRuntimeState = ["blocked", "failed"].includes(chapter.runtime_service_state);
  const resumableRuntimeState = terminalRuntimeState
    && RESUMABLE_RUNTIME_BLOCK_CODES.has(chapter.runtime_blocked_code);
  if ((terminalRuntimeState && !resumableRuntimeState) || chapter.runtime_service_state === "completed") return null;
  const target = chapter?.target_snapshot_json;
  const particles = Array.isArray(target?.particles_json) ? target.particles_json : [];
  const scene = target?.scene_condition_package;
  if (!particles.length || !scene || typeof scene !== "object" || Array.isArray(scene)) return null;
  const progress = chapter?.deduction_progress_json && typeof chapter.deduction_progress_json === "object"
    ? chapter.deduction_progress_json
    : {};
  const checkpoints = Array.isArray(chapter?.candidate_plot_sim_json?.particles_records)
    ? chapter.candidate_plot_sim_json.particles_records
    : [];
  const inputSnapshot = chapter?.candidate_plot_sim_json?.deduction_input_snapshot;
  const hasPersistedInputCheckpoint = inputSnapshot
    && typeof inputSnapshot === "object"
    && !Array.isArray(inputSnapshot)
    && Array.isArray(inputSnapshot.particles)
    && inputSnapshot.particles.length > 0
    && Array.isArray(inputSnapshot.participating_chars)
    && inputSnapshot.participating_chars.length > 0;
  if (progress.deduction_complete === true) return null;
  if (progress.token_budget_exceeded === true) return null;
  if (hasPersistedInputCheckpoint
    && Number.isInteger(progress.current_particle_index)
    && progress.current_particle_index >= 0
    && (progress.current_particle_index === 0 || checkpoints.length > 0)) return "resume";
  return ["plan_ready", "pending"].includes(chapter.run_status || chapter.status) ? "start" : null;
}

export function deductionFailureRecoveryAction(chapter, runtimeError = null) {
  if (!chapter || chapter.deduction_locked === true) return null;
  const modelCallFailed = runtimeError?.code === "MODEL_CALL_FAILED"
    || (chapter.runtime_service_state === "blocked"
      && chapter.runtime_blocked_code === "MODEL_CALL_FAILED");
  if (!modelCallFailed) return null;
  // A valid checkpoint is recoverable through the normal resume button. The
  // whole-L1A restart modal is only for an unpersisted or unusable run.
  return deductionCommandAction(chapter) === "resume" ? null : "restart";
}

export function creatorReplanAction(chapter) {
  if (!chapter || chapter.has_candidate_text !== false) return null;
  if (["running", "pause_requested"].includes(chapter.runtime_service_state)) return null;
  const hasSavedPlot = chapter.candidate_plot_sim_json
    && typeof chapter.candidate_plot_sim_json === "object"
    && !Array.isArray(chapter.candidate_plot_sim_json);
  const hasSavedProgress = chapter.deduction_progress_json
    && typeof chapter.deduction_progress_json === "object"
    && !Array.isArray(chapter.deduction_progress_json);
  return hasSavedPlot || hasSavedProgress ? "replan" : null;
}

function routeBookId(route, locationLike) {
  const fromRoute = route?.bookId;
  if (fromRoute !== undefined) return normalizedOptionalUuid(fromRoute, "\u4f5c\u54c1");
  const match = locationLike?.pathname?.match(/^\/books\/([^/]+)\//);
  if (!match) return null;
  try {
    return normalizedOptionalUuid(decodeURIComponent(match[1]), "\u4f5c\u54c1");
  } catch {
    throw new DeductionDataError("INVALID_DEDUCTION_CONTEXT", "\u4f5c\u54c1\u6807\u8bc6\u65e0\u6548\uff0c\u9875\u9762\u5df2\u505c\u6b62\u4f7f\u7528\u8be5\u4e0a\u4e0b\u6587\u3002");
  }
}

function storedLocalOperatorId(storage) {
  try {
    const value = storage?.getItem(LOCAL_OPERATOR_STORAGE_KEY);
    return UUID_PATTERN.test(String(value || "")) ? String(value).toLowerCase() : null;
  } catch {
    return null;
  }
}

function persistLocalOperatorId(storage, localOperatorId) {
  try {
    storage?.setItem(LOCAL_OPERATOR_STORAGE_KEY, localOperatorId);
  } catch {
    // Storage is an optimization; the scoped server read remains authoritative.
  }
}

async function restoreLocalOperatorId({ storage, fetchImpl, operatorEndpoint }) {
  const stored = storedLocalOperatorId(storage);
  if (stored) return stored;
  if (typeof fetchImpl !== "function") {
    throw new DeductionDataError("LOCAL_OPERATOR_REQUIRED", "\u5f53\u524d\u672c\u5730\u521b\u4f5c\u7a7a\u95f4\u4e0d\u53ef\u6062\u590d\uff0c\u9875\u9762\u672a\u8bfb\u53d6\u4f5c\u54c1\u6570\u636e\u3002", 503);
  }

  let response;
  try {
    response = await fetchImpl(operatorEndpoint, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ action: "operator" }),
    });
  } catch {
    throw new DeductionDataError("LOCAL_OPERATOR_REQUIRED", "\u5f53\u524d\u672c\u5730\u521b\u4f5c\u7a7a\u95f4\u4e0d\u53ef\u6062\u590d\uff0c\u9875\u9762\u672a\u8bfb\u53d6\u4f5c\u54c1\u6570\u636e\u3002", 503);
  }

  const payload = await response.json().catch(() => null);
  const localOperatorId = payload?.local_operator_id || payload?.result?.local_operator_id;
  if (!response.ok || payload?.ok !== true || !UUID_PATTERN.test(String(localOperatorId || ""))) {
    throw new DeductionDataError("LOCAL_OPERATOR_REQUIRED", "\u5f53\u524d\u672c\u5730\u521b\u4f5c\u7a7a\u95f4\u4e0d\u53ef\u6062\u590d\uff0c\u9875\u9762\u672a\u8bfb\u53d6\u4f5c\u54c1\u6570\u636e\u3002", response.status || 503);
  }
  const normalized = String(localOperatorId).toLowerCase();
  persistLocalOperatorId(storage, normalized);
  return normalized;
}

export async function resolveDeductionContext({
  route,
  locationLike,
  storage,
  fetchImpl = globalThis.fetch,
  operatorEndpoint = OPERATOR_ENDPOINT,
} = {}) {
  const identity = readDeductionIdentity({ route, locationLike });
  const context = globalThis.ZHBookContext?.readMatchingBookContext({
    storage,
    locationLike,
    routeBookId: route?.bookId,
    requireRoute: true,
  });
  const bookId = context?.bookId || routeBookId(route, locationLike);
  if (!UUID_PATTERN.test(bookId || "")) {
    throw new DeductionDataError(
      "BOOK_CONTEXT_REQUIRED",
      "当前网址没有有效作品标识，请先从总控设置进入作品。",
    );
  }
  const normalizedBookId = bookId.toLowerCase();

  let operatorId = context?.localOperatorId || null;
  if (!UUID_PATTERN.test(operatorId || "")) {
    operatorId = await restoreLocalOperatorId({ storage, fetchImpl, operatorEndpoint });
  }
  operatorId = operatorId.toLowerCase();

  return { bookId: normalizedBookId, localOperatorId: operatorId, ...identity };
}

function errorMessage(payload, status) {
  const error = payload?.redacted_error || payload?.error;
  const localized = {
    SCOPE_REJECTED: "该作品不存在，或不属于当前本地操作者。",
    INVALID_BOOK_CONTEXT: "当前作品标识无效，请从总控设置重新进入作品。",
    RPC_UNAVAILABLE: "推演数据服务暂不可用，请稍后重试。",
  };
  if (localized[error?.code]) return localized[error.code];
  if (typeof error?.message === "string" && error.message.trim()) return error.message.trim();
  if (status === 404) return "该作品不存在，或不属于当前本地操作者。";
  if (status === 503) return "推演数据服务暂不可用，请稍后重试。";
  return "推演数据读取失败，请稍后重试。";
}

export function buildDeductionCommand(context, action, { returnDirection, idempotencyKey } = {}) {
  if (!['start', 'resume', 'restart', 'replan'].includes(action)) {
    throw new DeductionDataError("INVALID_DEDUCTION_ACTION", "推演页面只能开始、继续或重新推演当前 L1A。", 400);
  }
  const localOperatorId = normalizedOptionalUuid(context?.localOperatorId, "本地操作者");
  const bookId = normalizedOptionalUuid(context?.bookId, "作品");
  const l1aUnitId = normalizedOptionalUuid(context?.l1aUnitId, "L1A");
  if (!localOperatorId) throw new DeductionDataError("LOCAL_OPERATOR_REQUIRED", "当前本地操作者范围不可用。", 400);
  if (!bookId) throw new DeductionDataError("BOOK_CONTEXT_REQUIRED", "当前作品范围不可用。", 400);
  if (!l1aUnitId) throw new DeductionDataError("L1A_CONTEXT_REQUIRED", "当前作品还没有可开始推演的 L1A。", 409);
  const command = {
    action,
    local_operator_id: localOperatorId,
    book_id: bookId,
    l1a_unit_id: l1aUnitId,
  };
  if (action !== "replan") return command;

  const normalizedDirection = typeof returnDirection === "string" ? returnDirection.trim() : "";
  if (!normalizedDirection) {
    throw new DeductionDataError("RETURN_DIRECTION_REQUIRED", "请填写本次重新推演的方向。", 400);
  }
  const normalizedKey = typeof idempotencyKey === "string" ? idempotencyKey.trim() : "";
  if (!IDEMPOTENCY_KEY_PATTERN.test(normalizedKey)) {
    throw new DeductionDataError("IDEMPOTENCY_KEY_REQUIRED", "当前重新推演请求缺少可重试标识。", 400);
  }
  return {
    ...command,
    return_direction: normalizedDirection,
    idempotency_key: normalizedKey,
  };
}

export function buildDeductionPauseIntent(context) {
  const localOperatorId = normalizedOptionalUuid(context?.localOperatorId, "本地操作者");
  const bookId = normalizedOptionalUuid(context?.bookId, "作品");
  const l1aUnitId = normalizedOptionalUuid(context?.l1aUnitId, "L1A");
  if (!localOperatorId) throw new DeductionDataError("LOCAL_OPERATOR_REQUIRED", "当前本地操作者范围不可用。", 400);
  if (!bookId) throw new DeductionDataError("BOOK_CONTEXT_REQUIRED", "当前作品范围不可用。", 400);
  if (!l1aUnitId) throw new DeductionDataError("L1A_CONTEXT_REQUIRED", "当前作品还没有可暂停的 L1A。", 409);
  return {
    action: "pause",
    scope: {
      local_operator_id: localOperatorId,
      book_id: bookId,
      l1a_unit_id: l1aUnitId,
    },
  };
}

export function deductionReviewReady(chapter) {
  return chapter?.deduction_locked === true
    && chapter?.deduction_progress_json?.deduction_complete === true;
}

export async function sendDeductionCommand(
  context,
  action,
  {
    fetchImpl = globalThis.fetch,
    endpoint = "http://127.0.0.1:5678/webhook/production_stage",
    signal,
    returnDirection,
    idempotencyKey,
  } = {},
) {
  if (typeof fetchImpl !== "function") {
    throw new DeductionDataError("FETCH_UNAVAILABLE", "当前浏览器无法启动推演。", 503);
  }
  const command = buildDeductionCommand(context, action, { returnDirection, idempotencyKey });
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(command),
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new DeductionDataError("DEDUCTION_SERVICE_UNAVAILABLE", "无法连接推演服务，请稍后重试。", 503);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok !== true) {
    const code = payload?.redacted_error?.code || payload?.error?.code || `HTTP_${response.status}`;
    throw new DeductionDataError(code, errorMessage(payload, response.status), response.status);
  }
  return payload;
}

export async function sendDeductionPauseIntent(
  context,
  {
    fetchImpl = globalThis.fetch,
    endpoint = "http://127.0.0.1:4182/fp008-02",
    signal,
  } = {},
) {
  if (typeof fetchImpl !== "function") {
    throw new DeductionDataError("FETCH_UNAVAILABLE", "当前浏览器无法提交暂停意图。", 503);
  }
  const intent = buildDeductionPauseIntent(context);
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(intent),
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new DeductionDataError("DEDUCTION_SERVICE_UNAVAILABLE", "无法连接推演服务，暂停意图未提交。", 503);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok !== true) {
    const code = payload?.redacted_error?.code || payload?.error?.code || `HTTP_${response.status}`;
    const message = code === "DEDUCTION_NOT_RUNNING"
      ? "当前 L1A 已不在推演中，页面将重新读取已保存状态。"
      : code === "DEDUCTION_ALREADY_RUNNING"
        ? "当前 L1A 正在处理暂停意图，请等待当前颗粒完成。"
        : "暂停意图未被推演服务接受。";
    throw new DeductionDataError(code, message, response.status);
  }
  return payload;
}

export async function fetchDeductionProjection(
  context,
  { fetchImpl = globalThis.fetch, endpointBase = "/api/books", signal } = {},
) {
  if (typeof fetchImpl !== "function") {
    throw new DeductionDataError("FETCH_UNAVAILABLE", "当前浏览器无法读取推演数据。");
  }

  const url = `${endpointBase}/${encodeURIComponent(context.bookId)}/deduction?local_operator_id=${encodeURIComponent(context.localOperatorId)}`;
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new DeductionDataError("DATA_SERVICE_UNAVAILABLE", "无法连接推演数据服务，请稍后重试。", 503);
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok !== true) {
    const code = payload?.redacted_error?.code || payload?.error?.code || `HTTP_${response.status}`;
    throw new DeductionDataError(code, errorMessage(payload, response.status), response.status);
  }
  if (!payload.result || typeof payload.result !== "object" || !Array.isArray(payload.result.chapters)) {
    throw new DeductionDataError("INVALID_RESPONSE", "推演数据返回格式不完整，页面未采用其中内容。", 502);
  }
  if (String(payload.result.book?.id || "").toLowerCase() !== context.bookId.toLowerCase()) {
    throw new DeductionDataError("SCOPE_MISMATCH", "返回作品与当前作品不一致，页面已停止展示。", 502);
  }

  return payload.result;
}

import "../prototype/common/book-context.js";
import {
  AuditWaitRouteError,
  readAuditWaitRoute,
  readReusableAuditWaitRoute,
  validateAuditWaitRoute,
} from "./wait-route.mjs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class AuditStageError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "AuditStageError";
    this.code = code;
    this.status = status;
  }
}

function normalizedUuid(value, label, code = "INVALID_AUDIT_CONTEXT") {
  if (!UUID_PATTERN.test(String(value || ""))) {
    throw new AuditStageError(code, `${label}标识无效，页面未提交确认请求。`);
  }
  return String(value).toLowerCase();
}

function issuedWaitRoute(value) {
  try {
    return validateAuditWaitRoute(value);
  } catch (error) {
    const code = error instanceof AuditWaitRouteError ? error.code : "AUDIT_WAIT_ROUTE_REQUIRED";
    throw new AuditStageError(code, "审计确认必须使用本次工作流发出的签名等待回调。", 409);
  }
}

function requireCurrentFormalChapter(context, projection, waitRoute) {
  normalizedUuid(context?.localOperatorId, "本地操作者");
  normalizedUuid(context?.bookId, "作品");
  normalizedUuid(projection?.chapter?.chapter_id, "章节", "INCOMPLETE_CHAPTER_CONTEXT");
  normalizedUuid(projection?.chapter?.chapter_version_id, "候选章节版本", "INCOMPLETE_CHAPTER_CONTEXT");
  if (projection?.chapter?.version_state !== "formal") {
    throw new AuditStageError("FORMAL_CHAPTER_REQUIRED", "只有已正式写入的当前章节可以提交作者决定。", 409);
  }
  return issuedWaitRoute(waitRoute);
}

export function buildAuditConfirmationIntent(context, projection, waitRoute) {
  requireCurrentFormalChapter(context, projection, waitRoute);
  return { action: "continue_next_chapter" };
}

export function buildAuditReturnIntent(context, projection, waitRoute, returnReason) {
  requireCurrentFormalChapter(context, projection, waitRoute);
  const reason = typeof returnReason === "string" ? returnReason.trim() : "";
  if (!reason) {
    throw new AuditStageError("RETURN_REASON_REQUIRED", "退回当前正式章节需要填写原因。", 400);
  }
  return { action: "return_current_chapter", return_reason: reason };
}

async function sendAuditIntent(waitRoute, intent, { fetchImpl = globalThis.fetch, signal } = {}) {
  if (typeof fetchImpl !== "function") {
    throw new AuditStageError("FETCH_UNAVAILABLE", "当前浏览器无法提交作者决定。", 503);
  }
  const endpoint = issuedWaitRoute(waitRoute);
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
    throw new AuditStageError("AUDIT_CONFIRMATION_UNAVAILABLE", "无法连接审计决定服务，请稍后重试。", 503);
  }
  const payload = await response.json().catch(() => ({}));
  const error = objectValue(payload?.redacted_error) || objectValue(payload?.error);
  if (!response.ok || error || payload?.ok === false) {
    throw new AuditStageError(
      error?.code || `HTTP_${response.status}`,
      typeof error?.message === "string" && error.message.trim()
        ? error.message.trim()
        : "审计确认请求未被后端接受。",
      response.status,
    );
  }
  return payload;
}

export async function sendAuditConfirmationIntent(
  context,
  projection,
  waitRoute,
  options = {},
) {
  const endpoint = requireCurrentFormalChapter(context, projection, waitRoute);
  return sendAuditIntent(endpoint, buildAuditConfirmationIntent(context, projection, endpoint), options);
}

export async function sendAuditReturnIntent(
  context,
  projection,
  waitRoute,
  returnReason,
  options = {},
) {
  const endpoint = requireCurrentFormalChapter(context, projection, waitRoute);
  return sendAuditIntent(endpoint, buildAuditReturnIntent(context, projection, endpoint, returnReason), options);
}

function auditReadContext(context) {
  return {
    localOperatorId: normalizedUuid(context?.localOperatorId, "本地操作者"),
    bookId: normalizedUuid(context?.bookId, "作品"),
    chapterId: normalizedUuid(context?.chapterId, "章节", "INCOMPLETE_CHAPTER_CONTEXT"),
    chapterVersionId: normalizedUuid(context?.chapterVersionId, "候选章节版本", "INCOMPLETE_CHAPTER_CONTEXT"),
  };
}

function sameUuid(left, right) {
  return String(left || "").toLowerCase() === String(right || "").toLowerCase();
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function normalizeAuditChapterQueue(value, currentChapter) {
  const seen = new Set();
  const rows = Array.isArray(value) ? value : [];
  const normalized = [];
  for (const row of [...rows, currentChapter]) {
    const candidate = objectValue(row);
    if (!candidate
      || !UUID_PATTERN.test(String(candidate.chapter_id || ""))
      || !UUID_PATTERN.test(String(candidate.chapter_version_id || ""))) {
      continue;
    }
    const chapterId = String(candidate.chapter_id).toLowerCase();
    const chapterVersionId = String(candidate.chapter_version_id).toLowerCase();
    const key = `${chapterId}:${chapterVersionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      chapter_id: chapterId,
      chapter_version_id: chapterVersionId,
      chapter_index: candidate.chapter_index,
      title: typeof candidate.title === "string" ? candidate.title : "",
    });
  }
  return normalized.sort((left, right) => Number(left.chapter_index) - Number(right.chapter_index));
}

export function buildAuditStageChapterUrl(context, chapter) {
  const bookId = normalizedUuid(context?.bookId, "作品");
  const chapterId = normalizedUuid(chapter?.chapter_id, "章节", "INCOMPLETE_CHAPTER_CONTEXT");
  const chapterVersionId = normalizedUuid(
    chapter?.chapter_version_id,
    "候选章节版本",
    "INCOMPLETE_CHAPTER_CONTEXT",
  );
  const query = new URLSearchParams({
    chapter_id: chapterId,
    chapter_version_id: chapterVersionId,
  });
  return `/books/${encodeURIComponent(bookId)}/audit?${query.toString()}`;
}

export function auditNextAction(projection) {
  const decision = objectValue(projection?.editorial?.decision_json);
  if (projection?.chapter?.version_state !== "formal"
    || !decision
    || typeof projection?.objective?.has_p0_blocker !== "boolean") {
    return { kind: "manual", message: "当前页面不是可确认的正式章节。" };
  }
  if (projection.objective.has_p0_blocker || decision.verdict !== "Y" || decision.force_manual === true) {
    return { kind: "manual", message: "当前正式章节的审计证据不完整，不能继续。" };
  }
  if (projection?.chapter?.continuation_available === true) {
    return { kind: "continue", message: "继续后将自动生成同一 L1A 的下一章。" };
  }
  return { kind: "view", message: "这不是当前可继续的正式章节，仅供查看审计结论。" };
}

function auditReadFailure(payload, status) {
  const error = objectValue(payload?.redacted_error) || objectValue(payload?.error);
  return new AuditStageError(
    error?.code || "AUDIT_PROJECTION_UNAVAILABLE",
    typeof error?.message === "string" && error.message.trim()
      ? error.message.trim()
      : "审计结果暂时不可读取。",
    status,
  );
}

function validateAuditProjection(result, context) {
  const book = objectValue(result?.book);
  const chapter = objectValue(result?.chapter);
  const objective = objectValue(result?.objective);
  const editorial = objectValue(result?.editorial);
  if (!sameUuid(book?.id, context.bookId)
    || !sameUuid(chapter?.chapter_id, context.chapterId)
    || !sameUuid(chapter?.chapter_version_id, context.chapterVersionId)) {
    throw new AuditStageError("AUDIT_SCOPE_MISMATCH", "审计读取返回的作品、章节或候选版本与当前页面不一致。", 409);
  }
  if (chapter?.version_state !== "formal") {
    throw new AuditStageError("FORMAL_CHAPTER_REQUIRED", "主编尚未完成正式写入，页面不会展示候选正文。", 409);
  }
  if (!editorial) {
    throw new AuditStageError("EDITORIAL_DECISION_REQUIRED", "当前正式章节缺少主编结论，页面不会展示正文。", 409);
  }
  const decision = objectValue(editorial.decision_json);
  if (!decision
    || decision.verdict !== "Y"
    || typeof decision.force_manual !== "boolean"
    || typeof objective?.has_p0_blocker !== "boolean") {
    throw new AuditStageError("EDITORIAL_DECISION_REQUIRED", "当前正式章节的主编结论或审计闸门不完整，页面不会展示正文。", 409);
  }

  const proseText = typeof chapter.prose_text === "string" && chapter.prose_text.trim()
    ? chapter.prose_text
    : null;
  if (!proseText || decision.force_manual || objective.has_p0_blocker) {
    throw new AuditStageError("AUDIT_PROJECTION_INCOMPLETE", "当前正式章节的正文或审计证据不完整，页面未显示任何文本。", 409);
  }

  const currentChapter = {
    chapter_id: String(chapter.chapter_id).toLowerCase(),
    chapter_version_id: String(chapter.chapter_version_id).toLowerCase(),
    chapter_index: chapter.chapter_index,
    title: typeof chapter.title === "string" ? chapter.title : "",
  };
  const wordCount = nonNegativeInteger(chapter.word_count);
  const chapterWords = positiveInteger(chapter.chapter_words);
  const wordCountDelta = Number.isInteger(chapter.word_count_delta)
    ? chapter.word_count_delta
    : null;
  if (wordCount === null || chapterWords === null || wordCountDelta === null
    || wordCountDelta !== wordCount - chapterWords) {
    throw new AuditStageError(
      "AUDIT_PROJECTION_INCOMPLETE",
      "当前正式章节缺少一致的服务端字数投影，页面不会展示正文。",
      409,
    );
  }

  return {
    book: {
      id: String(book.id).toLowerCase(),
      title: typeof book.title === "string" ? book.title : "",
    },
    chapter: {
      ...currentChapter,
      version_state: "formal",
      confirmation_status: typeof chapter.confirmation_status === "string"
        ? chapter.confirmation_status
        : "",
      continuation_available: chapter.continuation_available === true,
      reject_count: chapter.reject_count,
      prose_text: proseText,
      word_count: wordCount,
      chapter_words: chapterWords,
      word_count_delta: wordCountDelta,
    },
    chapter_queue: normalizeAuditChapterQueue(result?.chapter_queue, currentChapter),
    objective: {
      has_p0_blocker: objective.has_p0_blocker,
      audit_findings_jsonb: objective.audit_findings_jsonb,
      p0_items_json: objective.p0_items_json,
      return_route_suggestion_jsonb: objective.return_route_suggestion_jsonb,
    },
    reader: objectValue(result?.reader) || null,
    commercial: objectValue(result?.commercial) || null,
    editorial: {
      decision_json: decision,
      fix_instruction_json: editorial.fix_instruction_json,
    },
  };
}

export async function fetchAuditProjection(context, {
  fetchImpl = globalThis.fetch,
  endpointBase = "/api/books",
  signal,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new AuditStageError("FETCH_UNAVAILABLE", "当前浏览器无法读取审计结果。", 503);
  }
  const scoped = auditReadContext(context);
  const query = new URLSearchParams({
    local_operator_id: scoped.localOperatorId,
    chapter_id: scoped.chapterId,
    chapter_version_id: scoped.chapterVersionId,
  });
  let response;
  try {
    response = await fetchImpl(
      `${endpointBase}/${encodeURIComponent(scoped.bookId)}/audit?${query.toString()}`,
      { method: "GET", headers: { accept: "application/json" }, signal },
    );
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new AuditStageError("AUDIT_SERVICE_UNAVAILABLE", "审计结果服务暂时不可用。", 503);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok !== true) throw auditReadFailure(payload, response.status);
  return validateAuditProjection(payload.result, scoped);
}

const stateCopy = {
  blocked: ["当前候选需要人工处理", "客观审计或主编裁决要求人工处理，页面没有执行放行或重写。"],
  context: ["无法确认当前作品", "请从作品工作流进入审计阶段。页面不会采用默认作品或原型数据。"],
  empty: ["当前章节尚不能进入作者确认", "当前候选尚未形成可展示的正式正文或完整审计结论。页面不会展示候选正文。"],
  loading: ["正在读取审计结果", "页面正在读取同一候选版本的审计投影。"],
  error: ["审计结果不可用", "无法读取当前审计投影。页面没有执行放行、退回或正式写入。"],
};

const pageRuntimes = new WeakMap();

function activeState(value) {
  return Object.hasOwn(stateCopy, value) ? value : "error";
}

function routeFor(bookId, segment) {
  return `/books/${encodeURIComponent(bookId)}/${segment}`;
}

function navigateTo(navigate, destination) {
  if (typeof navigate === "function") {
    navigate(destination);
    return;
  }
  globalThis.location?.assign(destination);
}

function createNode(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function displayText(value, fallback = "未提供") {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function formattedValue(value, fallback = "未提供") {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return displayText(value, fallback);
  }
  if (Array.isArray(value)) {
    return value.map((item) => formattedValue(item, "")).filter(Boolean).join("；") || fallback;
  }
  if (objectValue(value)) {
    const concise = Object.entries(value)
      .map(([key, item]) => `${key}：${formattedValue(item, "")}`)
      .filter((item) => !item.endsWith("："))
      .join("；");
    return concise || fallback;
  }
  return fallback;
}

function setNotice(root, kind, message) {
  const preview = root.querySelector("[data-audit-stage-preview]");
  if (preview) preview.textContent = message;
  root.dataset.auditAvailability = kind;
}

function bindBookContext(root, book, navigate) {
  const bookId = book?.id || null;
  const setBookName = () => {
    const bookName = root.ownerDocument.querySelector("#header-book-name");
    if (bookName) {
      bookName.textContent = bookId ? displayText(book?.title, `作品 ${bookId}`) : "作品未确认";
    }
  };
  setBookName();
  globalThis.setTimeout?.(setBookName, 0);

  const destinations = {
    "workbench.html": bookId ? `/workbench?book_id=${encodeURIComponent(bookId)}` : "/workbench",
    ...(bookId ? {
      "world_creator.html": routeFor(bookId, "world"),
      "production_stage.html": routeFor(bookId, "production"),
      "audit_stage.html": routeFor(bookId, "audit"),
    } : {}),
  };
  root.ownerDocument.querySelectorAll("a[href]").forEach((link) => {
    const name = link.getAttribute("href")?.split("/").at(-1);
    if (name === "iteration.html") {
      link.dataset.mvpDeferred = "FP014";
      link.setAttribute("aria-disabled", "true");
      link.setAttribute("title", "MVP 后续能力");
      link.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
      }, { once: true });
      return;
    }
    const destination = destinations[name];
    if (!destination || link.dataset.auditStageBound) return;
    link.dataset.auditStageBound = "true";
    link.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      navigateTo(navigate, destination);
    });
  });
}

function setAuditContentVisible(root, visible) {
  root.querySelectorAll("[data-audit-stage-mock-content]").forEach((container) => {
    container.hidden = !visible;
    container.inert = !visible;
    if (visible) {
      container.removeAttribute("inert");
      container.removeAttribute("aria-hidden");
      return;
    }
    container.setAttribute("inert", "");
    container.setAttribute("aria-hidden", "true");
  });
}

function setState(root, state, { detail, retry } = {}) {
  const overlay = root.querySelector("[data-audit-stage-state-overlay]");
  if (!overlay) return;
  const active = activeState(state);
  setAuditContentVisible(root, false);
  root.dataset.pageState = active;
  root.dataset.mode = "contract_unavailable";
  overlay.hidden = false;
  overlay.dataset.state = active;
  overlay.setAttribute("aria-busy", String(active === "loading"));
  const [title, copy] = stateCopy[active];
  const titleNode = overlay.querySelector("[data-state-title]");
  const detailNode = overlay.querySelector("[data-state-detail]");
  const retryButton = overlay.querySelector("[data-state-retry]");
  if (titleNode) titleNode.textContent = title;
  if (detailNode) detailNode.textContent = detail || copy;
  if (retryButton) {
    retryButton.hidden = typeof retry !== "function";
    retryButton.onclick = typeof retry === "function" ? retry : null;
  }
}

function showReadyState(root) {
  const overlay = root.querySelector("[data-audit-stage-state-overlay]");
  if (overlay) overlay.hidden = true;
  setAuditContentVisible(root, true);
  root.dataset.pageState = "ready";
  root.dataset.mode = "ready";
}

function scopedWaitRoute(runtime) {
  const projection = runtime.projection;
  const scope = {
    bookId: projection.book.id,
    chapterId: projection.chapter.chapter_id,
    chapterVersionId: projection.chapter.chapter_version_id,
  };
  return readAuditWaitRoute(runtime.sessionStorage, scope)
    || readReusableAuditWaitRoute(runtime.sessionStorage, scope);
}

function setChapterDropdownOpen(runtime, open) {
  runtime.chapterDropdownOpen = open;
  const dropdown = runtime.root.ownerDocument.getElementById("chapter-select-dropdown");
  const trigger = runtime.root.ownerDocument.getElementById("chapter-title-btn");
  if (dropdown) dropdown.classList.toggle("hidden", !open);
  if (trigger) trigger.setAttribute("aria-expanded", String(open));
}

function chapterQueueRows(runtime) {
  return arrayValue(runtime.projection.chapter_queue);
}

function renderChapterChoices(runtime, container, chapters, emptyMessage) {
  if (!container) return;
  const doc = container.ownerDocument;
  const fragment = doc.createDocumentFragment();
  if (!chapters.length) {
    fragment.append(createNode(doc, "p", "px-3 py-2 text-xs text-base-content/60", emptyMessage));
  }
  chapters.forEach((chapter) => {
    const selected = sameUuid(chapter.chapter_id, runtime.projection.chapter.chapter_id)
      && sameUuid(chapter.chapter_version_id, runtime.projection.chapter.chapter_version_id);
    const button = createNode(
      doc,
      "button",
      `w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-base-content/5 text-left text-xs ${selected ? "font-semibold text-secondary" : "text-base-content opacity-70"}`,
    );
    button.type = "button";
    button.dataset.chapterId = chapter.chapter_id;
    button.dataset.chapterVersionId = chapter.chapter_version_id;
    button.setAttribute("aria-current", String(selected));
    button.append(
      createNode(doc, "span", `w-1.5 h-1.5 rounded-full ${selected ? "bg-secondary" : "bg-base-content/40"}`),
      createNode(doc, "span", "truncate", `第 ${displayText(chapter.chapter_index, "-")} 章 ${displayText(chapter.title, "")}`.trim()),
    );
    if (selected) button.append(createNode(doc, "span", "px-1 py-0.5 bg-secondary/15 text-secondary text-[8px] rounded border border-secondary/20 ml-auto", "当前"));
    button.onclick = () => {
      setChapterDropdownOpen(runtime, false);
      if (selected) return;
      navigateTo(runtime.navigate, buildAuditStageChapterUrl(runtime.context, chapter));
    };
    fragment.append(button);
  });
  container.replaceChildren(fragment);
}

function renderChapterIdentity(runtime) {
  const { root, projection } = runtime;
  const chapter = projection.chapter;
  const doc = root.ownerDocument;
  const title = doc.querySelector("#current-chapter-title");
  if (title) title.textContent = `第 ${displayText(chapter.chapter_index, "-")} 章 ${displayText(chapter.title, "")}`.trim();
  const chapterButton = doc.querySelector("#chapter-title-btn");
  if (chapterButton) {
    chapterButton.removeAttribute("onclick");
    chapterButton.disabled = false;
    chapterButton.setAttribute("aria-disabled", "false");
    chapterButton.setAttribute("aria-haspopup", "menu");
    chapterButton.title = "切换当前 L1A 内已形成主编裁决的章节";
    chapterButton.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      setChapterDropdownOpen(runtime, !runtime.chapterDropdownOpen);
    };
  }
  setChapterDropdownOpen(runtime, runtime.chapterDropdownOpen === true);
  renderChapterChoices(
    runtime,
    doc.getElementById("current-run-chapters-list"),
    chapterQueueRows(runtime),
    "当前 L1A 暂无其他可确认章节。",
  );
  renderChapterChoices(runtime, doc.getElementById("history-chapters-list"), [], "暂无已放行章节。");
  const curl = doc.getElementById("page-curl-ctrl");
  if (curl) {
    curl.removeAttribute("onclick");
    curl.hidden = true;
  }
}

function renderProse(runtime) {
  const { root, projection } = runtime;
  const doc = root.ownerDocument;
  const editor = doc.getElementById("editor-panel");
  const proseContainer = editor?.querySelector("section .space-y-8");
  const wordCount = doc.getElementById("editor-word-count");
  if (wordCount) {
    const count = projection.chapter.word_count;
    const target = projection.chapter.chapter_words;
    const delta = projection.chapter.word_count_delta;
    if (count === null || target === null || delta === null) {
      wordCount.textContent = "字数投影未返回";
      wordCount.title = "当前正式章节缺少服务端字数投影。";
    } else {
      const formattedCount = new Intl.NumberFormat("zh-CN").format(count);
      const formattedTarget = new Intl.NumberFormat("zh-CN").format(target);
      const deltaSign = delta > 0 ? "+" : "";
      wordCount.textContent = `总字数：${formattedCount} 字，目标 ${formattedTarget} 字（${deltaSign}${delta}）`;
      wordCount.removeAttribute("title");
    }
  }
  if (!proseContainer) return;
  const text = projection.chapter.prose_text;
  if (!text) {
    proseContainer.replaceChildren(createNode(
      doc,
      "p",
      "text-sm leading-relaxed text-base-content/60",
      "当前正式正文不可用，本页不展示文本。",
    ));
    return;
  }
  const fragment = doc.createDocumentFragment();
  text.split(/\r?\n\s*\r?\n/u).map((part) => part.trim()).filter(Boolean).forEach((paragraph) => {
    fragment.append(createNode(doc, "p", "leading-relaxed text-base-content", paragraph));
  });
  proseContainer.replaceChildren(fragment);
}

function auditTabButton(root, kind) {
  return root.ownerDocument.getElementById(`tab-audit-${kind}`);
}

function scoreState(value) {
  if (!objectValue(value) || Object.keys(value).length === 0) return "未返回";
  return "已完成";
}

function renderAuditTabs(runtime) {
  const objective = runtime.projection.objective;
  const summaries = {
    objective: objective.has_p0_blocker ? "P0 阻断" : "已完成",
    commercial: scoreState(runtime.projection.commercial?.score_json),
    reader: scoreState(runtime.projection.reader?.score_json),
  };
  for (const kind of ["objective", "commercial", "reader"]) {
    const button = auditTabButton(runtime.root, kind);
    if (!button) continue;
    button.removeAttribute("onclick");
    button.removeAttribute("data-contract-unavailable");
    button.removeAttribute("data-mvp-deferred");
    button.disabled = false;
    button.setAttribute("aria-disabled", "false");
    button.classList.toggle("active", runtime.activeAuditKind === kind);
    button.setAttribute("aria-pressed", String(runtime.activeAuditKind === kind));
    const summary = button.querySelector("span");
    if (summary) summary.textContent = summaries[kind];
    button.onclick = () => {
      runtime.activeAuditKind = kind;
      renderAuditTabs(runtime);
      renderAuditDetails(runtime);
    };
  }
}

function appendAuditText(doc, target, label, value) {
  const row = createNode(doc, "div", "border-t border-base-content/10 pt-3 mt-3");
  row.append(
    createNode(doc, "p", "text-[11px] font-semibold text-base-content", label),
    createNode(doc, "p", "text-[11px] leading-relaxed text-base-content/70 mt-1 whitespace-pre-wrap", formattedValue(value)),
  );
  target.append(row);
}

function renderAuditDetails(runtime) {
  const target = runtime.root.ownerDocument.getElementById("audit-details-panel");
  if (!target) return;
  const doc = target.ownerDocument;
  const kind = runtime.activeAuditKind;
  const panel = createNode(doc, "div", "space-y-2 h-full overflow-y-auto");
  if (kind === "objective") {
    const blocked = runtime.projection.objective.has_p0_blocker;
    panel.append(
      createNode(doc, "h2", "text-sm font-semibold text-base-content", "客观审计"),
      createNode(doc, `p`, blocked ? "text-xs text-error" : "text-xs text-success", blocked ? "发现 P0 阻断" : "未发现 P0 阻断"),
    );
    appendAuditText(doc, panel, "审计发现", runtime.projection.objective.audit_findings_jsonb);
    if (blocked) appendAuditText(doc, panel, "P0 项", runtime.projection.objective.p0_items_json);
    return void target.replaceChildren(panel);
  }
  const review = kind === "reader" ? runtime.projection.reader : runtime.projection.commercial;
  panel.append(
    createNode(doc, "h2", "text-sm font-semibold text-base-content", kind === "reader" ? "读者体验审计" : "商业审计"),
    createNode(doc, "p", "text-xs text-base-content/60", "本页只展示该版本的评分摘要；主编意见单独呈现。"),
  );
  appendAuditText(doc, panel, "评分摘要", review?.score_json);
  target.replaceChildren(panel);
}

function editorInstruction(projection) {
  return formattedValue(projection.editorial.fix_instruction_json, "主编已通过本章的主观审计。" );
}

function setActionButton(button, { enabled, label, title, onClick }) {
  if (!button) return;
  button.removeAttribute("onclick");
  button.removeAttribute("data-contract-unavailable");
  button.disabled = !enabled;
  button.setAttribute("aria-disabled", String(!enabled));
  button.title = title;
  button.onclick = enabled ? onClick : null;
  const text = button.querySelector("span:last-child");
  if (text && label) text.textContent = label;
}

function closeReplanModal(root) {
  const modal = root.ownerDocument.getElementById("replan-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.classList.remove("flex");
}

function openReplanModal(root) {
  const modal = root.ownerDocument.getElementById("replan-modal");
  if (!modal) return;
  modal.classList.remove("hidden");
  modal.classList.add("flex");
  root.ownerDocument.getElementById("replan-suggestion")?.focus();
}

async function submitAuditConfirmation(runtime) {
  const action = auditNextAction(runtime.projection);
  if (action.kind !== "continue" || runtime.confirmationPending) return;
  const waitRoute = scopedWaitRoute(runtime);
  if (!waitRoute) {
    setNotice(runtime.root, "error", "本次继续地址已失效，请刷新当前正式章节后重试。" );
    renderActions(runtime);
    return;
  }
  runtime.confirmationPending = true;
  runtime.pendingAction = "continue";
  runtime.confirmationError = null;
  renderActions(runtime);
  try {
    await sendAuditConfirmationIntent(runtime.context, runtime.projection, waitRoute, {
      fetchImpl: runtime.fetchImpl,
    });
    runtime.confirmed = true;
    runtime.submittedAction = "continue";
    setNotice(runtime.root, "submitted", "继续请求已提交，系统将按顺序开始同一 L1A 的下一章。" );
    globalThis.window?.showToast?.("已继续下一章。", "success");
  } catch (error) {
    runtime.confirmationError = error;
    setNotice(runtime.root, "error", `${error.code || "AUDIT_CONFIRMATION_FAILED"}：${error.message}`);
  } finally {
    runtime.confirmationPending = false;
    runtime.pendingAction = null;
    renderActions(runtime);
  }
}

async function submitAuditReturn(runtime) {
  const action = auditNextAction(runtime.projection);
  if (action.kind !== "continue" || runtime.confirmationPending) return;
  const waitRoute = scopedWaitRoute(runtime);
  if (!waitRoute) {
    setNotice(runtime.root, "error", "本次退回地址已失效，请刷新当前正式章节后重试。");
    renderActions(runtime);
    return;
  }
  const reason = runtime.root.ownerDocument.getElementById("replan-suggestion")?.value ?? "";
  if (!reason.trim()) {
    setNotice(runtime.root, "error", "请填写退回当前正式章节的原因。");
    renderActions(runtime);
    return;
  }
  runtime.confirmationPending = true;
  runtime.pendingAction = "return";
  runtime.confirmationError = null;
  renderActions(runtime);
  try {
    await sendAuditReturnIntent(runtime.context, runtime.projection, waitRoute, reason, {
      fetchImpl: runtime.fetchImpl,
    });
    runtime.confirmed = true;
    runtime.submittedAction = "return";
    runtime.root.ownerDocument.getElementById("replan-suggestion").value = "";
    closeReplanModal(runtime.root);
    setNotice(runtime.root, "submitted", "退回请求已提交，系统将归档当前正式章节并生成同章后继候选。");
    globalThis.window?.showToast?.("已退回当前章节。", "success");
  } catch (error) {
    runtime.confirmationError = error;
    setNotice(runtime.root, "error", `${error.code || "AUDIT_RETURN_FAILED"}：${error.message}`);
  } finally {
    runtime.confirmationPending = false;
    runtime.pendingAction = null;
    renderActions(runtime);
  }
}

function renderActions(runtime) {
  const { root, projection } = runtime;
  const action = auditNextAction(projection);
  const waitRoute = scopedWaitRoute(runtime);
  const hasConfirmRoute = Boolean(waitRoute) && !runtime.confirmed && !runtime.confirmationPending;
  const start = root.ownerDocument.getElementById("start-presentation-btn");
  setActionButton(start, {
    enabled: false,
    label: "审计已启动",
    title: "正文呈现只能从结果审核页发起。",
  });

  const decisionPanel = root.querySelector("[data-purpose='editor-decision-panel']");
  const decisionCopy = decisionPanel?.querySelector("p:not([data-audit-stage-preview])");
  if (decisionCopy) decisionCopy.textContent = editorInstruction(projection);
  const verdict = "主编已放行";
  const actionMessage = runtime.submittedAction === "return"
    ? "退回请求已提交，等待后端生成同章后继候选。"
    : runtime.confirmed
      ? "继续请求已提交，等待后端开始下一章。"
      : runtime.confirmationPending
        ? runtime.pendingAction === "return" ? "正在退回当前章节。" : "正在继续下一章。"
      : action.message;
  setNotice(root, action.kind, `${verdict}。${actionMessage}`);

  const approve = root.ownerDocument.getElementById("approve-chapter-btn");
  setActionButton(approve, {
    enabled: action.kind === "continue" && hasConfirmRoute,
    label: "继续下一章",
    title: action.kind === "continue" && hasConfirmRoute ? "按顺序开始下一章文学呈现" : action.message,
    onClick: () => { void submitAuditConfirmation(runtime); },
  });
  const replan = root.ownerDocument.getElementById("replan-chapter-btn");
  setActionButton(replan, {
    enabled: action.kind === "continue" && hasConfirmRoute,
    label: "退回当前章",
    title: action.kind === "continue" && hasConfirmRoute ? "归档当前正式章节并从同章后继候选重新呈现" : action.message,
    onClick: () => openReplanModal(root),
  });
  const confirm = root.ownerDocument.getElementById("confirm-replan-btn");
  setActionButton(confirm, {
    enabled: action.kind === "continue" && hasConfirmRoute,
    label: runtime.confirmationPending && runtime.pendingAction === "return" ? "退回中..." : "确认退回",
    title: action.kind === "continue" && hasConfirmRoute ? "提交当前正式章节的退回原因" : action.message,
    onClick: () => { void submitAuditReturn(runtime); },
  });
  root.ownerDocument.querySelectorAll("[onclick='closeReplanModal()']").forEach((button) => {
    button.removeAttribute("onclick");
    button.onclick = () => closeReplanModal(root);
  });
  if (runtime.confirmationError) {
    setNotice(root, "error", `${runtime.confirmationError.code || "AUDIT_CONFIRMATION_FAILED"}：${runtime.confirmationError.message}`);
  }
}

function bindViewControls(runtime) {
  for (const id of ["view-audit-btn", "view-assets-btn"]) {
    const button = runtime.root.ownerDocument.getElementById(id);
    if (!button) continue;
    button.removeAttribute("onclick");
    button.disabled = true;
    button.setAttribute("aria-disabled", "true");
    button.title = id === "view-assets-btn"
      ? "资产视图尚未接入此审计读取合同"
      : "当前为审计视图";
  }
}

function renderAuditStage(runtime) {
  showReadyState(runtime.root);
  bindBookContext(runtime.root, runtime.projection.book, runtime.navigate);
  renderChapterIdentity(runtime);
  renderProse(runtime);
  renderAuditTabs(runtime);
  renderAuditDetails(runtime);
  renderActions(runtime);
  bindViewControls(runtime);
}

function locationBookId(route, locationLike) {
  if (route?.bookId) return route.bookId;
  const match = locationLike?.pathname?.match(/^\/books\/([^/]+)\//);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function resolveAuditPageContext({ route, locationLike, storage }) {
  const context = globalThis.ZHBookContext?.readMatchingBookContext?.({
    storage,
    locationLike,
    routeBookId: locationBookId(route, locationLike),
    requireRoute: true,
  });
  if (!context) {
    throw new AuditStageError("BOOK_CONTEXT_REQUIRED", "当前作品上下文不可用，请从作品工作流重新进入。", 409);
  }
  const query = new URLSearchParams(locationLike?.search || "");
  return {
    localOperatorId: normalizedUuid(context.localOperatorId, "本地操作者"),
    bookId: normalizedUuid(context.bookId, "作品"),
    chapterId: normalizedUuid(route?.chapterId ?? query.get("chapter_id"), "章节", "INCOMPLETE_CHAPTER_CONTEXT"),
    chapterVersionId: normalizedUuid(
      route?.chapterVersionId ?? query.get("chapter_version_id"),
      "候选章节版本",
      "INCOMPLETE_CHAPTER_CONTEXT",
    ),
  };
}

async function loadAuditStage(runtime) {
  setState(runtime.root, "loading");
  try {
    runtime.projection = await fetchAuditProjection(runtime.context, {
      fetchImpl: runtime.fetchImpl,
      endpointBase: runtime.endpointBase,
    });
    renderAuditStage(runtime);
  } catch (error) {
    const state = error?.code === "AUDIT_PROJECTION_UNAVAILABLE"
      || error?.code === "EDITORIAL_DECISION_REQUIRED"
      || error?.code === "FORMAL_CHAPTER_REQUIRED"
      ? "empty"
      : error?.code === "BOOK_CONTEXT_REQUIRED" || error?.code === "INCOMPLETE_CHAPTER_CONTEXT"
        ? "context"
        : "error";
    setState(runtime.root, state, {
      detail: error?.message,
      retry: state === "error" || state === "empty" ? () => { void loadAuditStage(runtime); } : undefined,
    });
  }
}

export async function bindAuditStagePage({
  route,
  state,
  navigate,
  fetchImpl = globalThis.fetch,
  endpointBase = "/api/books",
  locationLike = globalThis.location,
  storage = globalThis.localStorage,
  sessionStorage = globalThis.sessionStorage,
} = {}) {
  const root = globalThis.document?.querySelector("main[data-audit-stage-root]");
  if (!root) return false;
  const forcedState = state || new URLSearchParams(locationLike?.search || "").get("state");
  if (forcedState && forcedState !== "normal") {
    setState(root, forcedState);
    return true;
  }
  let context;
  try {
    context = resolveAuditPageContext({ route, locationLike, storage });
  } catch (error) {
    setState(root, "context", { detail: error?.message });
    return false;
  }
  let runtime = pageRuntimes.get(root);
  if (!runtime) {
    runtime = { root, activeAuditKind: "objective", confirmed: false };
    pageRuntimes.set(root, runtime);
  }
  Object.assign(runtime, {
    context, navigate, fetchImpl, endpointBase, locationLike, sessionStorage,
    confirmationPending: false, confirmationError: null, confirmed: false,
    submittedAction: null, pendingAction: null,
  });
  await loadAuditStage(runtime);
  return true;
}

function bindWhenReady() {
  bindAuditStagePage();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bindWhenReady, { once: true });
  else bindWhenReady();
}

export async function renderPage(options) {
  return bindAuditStagePage(options);
}

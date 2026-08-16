import {
  buildDeductionPageUrl,
  DeductionDataError,
  fetchDeductionProjection,
} from "../multi-agent-deduction/deduction-data-client.mjs";
import { AuditWaitRouteError, storeAuditWaitRoute } from "../audit-stage/wait-route.mjs";
import { legacyRouteNames } from "../prototype/common/legacy-route-names.mjs";

export { DeductionDataError };

const AUDIT_WEBHOOK_URL = globalThis.window?.AUDIT_WEBHOOK_URL || "http://127.0.0.1:5678/webhook/audit_stage";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const stateCopy = Object.freeze({
  loading: ["正在读取待呈现 L1A", "正在读取当前作品已完成推演的 L1A 与顺序下一章。"],
  empty: ["暂无可呈现 L1A", "当前作品没有已完成推演且存在顺序下一章的 L1A。"],
  error: ["结果审核数据加载失败", "未能读取真实候选版本，请检查数据服务后重试。"],
  context: ["无法确认当前作品", "请先从总控设置选择作品，再进入结果审核。"],
});

const presentationLabel = "待正文呈现";

const pageRuntimes = new WeakMap();

function correlation(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || Date.now()}`.slice(0, 128);
}

function normalizedUuid(value, label, code = "INVALID_DEDUCTION_CONTEXT") {
  if (!UUID_PATTERN.test(String(value || ""))) {
    throw new DeductionDataError(code, `${label}标识无效，页面未提交该请求。`, 400);
  }
  return String(value).toLowerCase();
}

export function buildAuditPresentationIntent(context, l1a, idempotencyKey) {
  const localOperatorId = normalizedUuid(context?.localOperatorId, "本地操作者");
  const bookId = normalizedUuid(context?.bookId, "作品");
  const l1aUnitId = normalizedUuid(l1a?.id, "L1A", "INVALID_DEDUCTION_CONTEXT");
  if (!IDEMPOTENCY_KEY_PATTERN.test(String(idempotencyKey || ""))) {
    throw new DeductionDataError("INVALID_DEDUCTION_CONTEXT", "正文呈现请求标识无效，页面未提交请求。", 400);
  }
  return {
    local_operator_id: localOperatorId,
    book_id: bookId,
    l1a_unit_id: l1aUnitId,
    idempotency_key: idempotencyKey,
  };
}

function auditWaitRouteScope(context, chapter) {
  return {
    bookId: normalizedUuid(context?.bookId, "作品"),
    chapterId: normalizedUuid(chapter?.chapter_id, "章节", "INCOMPLETE_CHAPTER_CONTEXT"),
    chapterVersionId: normalizedUuid(
      chapter?.candidate_version_id,
      "候选章节版本",
      "INCOMPLETE_CHAPTER_CONTEXT",
    ),
  };
}

export function buildAuditStageUrl(context, chapter) {
  const scope = auditWaitRouteScope(context, chapter);
  const query = new URLSearchParams({
    chapter_id: scope.chapterId,
    chapter_version_id: scope.chapterVersionId,
  });
  return `/books/${encodeURIComponent(scope.bookId)}/audit?${query.toString()}`;
}

export function storeIssuedAuditWaitRoute(storage, context, chapter, payload) {
  const scope = auditWaitRouteScope(context, chapter);
  try {
    return storeAuditWaitRoute(storage, scope, payload?.wait_route);
  } catch (error) {
    const code = error instanceof AuditWaitRouteError ? error.code : "AUDIT_WAIT_ROUTE_REQUIRED";
    throw new DeductionDataError(code, "审计工作流没有返回可用的签名确认地址。", 409);
  }
}

function controlledPresentationError(payload) {
  for (const value of [payload?.redacted_error, payload?.context?.redacted_error, payload?.error]) {
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  }
  return null;
}

function presentationErrorMessage(payload, status) {
  const error = controlledPresentationError(payload);
  const labels = {
    DATA_DEBT: "正式世界设定或角色事实不完整，无法生成正文。",
    DEDUCTION_NOT_LOCKED: "当前候选尚未完成锁定推演，无法生成正文。",
    CONFIG_CONTRACT_BLOCKED: "正文呈现所需的提示词或模型配置不可用。",
    SCOPE_REJECTED: "当前作品或章节不属于本地操作者范围。",
    EDITORIAL_REWRITING: "主编已退回系统自动修文，当前候选不会进入作者确认。",
    EDITORIAL_RETRY_LIMIT_REACHED: "本章连续三次未通过主编审计，自动生产已停止。",
    WORD_COUNT_CONTRACT_UNRESOLVED: "无法确定正式章节字数和进度，当前章节不能进入作者确认。",
  };
  if (labels[error?.code]) return labels[error.code];
  if (typeof error?.message === "string" && error.message.trim()) return error.message.trim();
  if (status === 503) return "无法连接正文呈现服务，请稍后重试。";
  return "正文呈现请求未被后端接受。";
}

export async function sendAuditPresentationIntent(
  context,
  l1a,
  idempotencyKey,
  { fetchImpl = globalThis.fetch, endpoint = AUDIT_WEBHOOK_URL, signal } = {},
) {
  if (typeof fetchImpl !== "function") {
    throw new DeductionDataError("FETCH_UNAVAILABLE", "当前浏览器无法启动正文呈现。", 503);
  }
  const intent = buildAuditPresentationIntent(context, l1a, idempotencyKey);
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
    throw new DeductionDataError("AUDIT_SERVICE_UNAVAILABLE", "无法连接审计服务，请稍后重试。", 503);
  }
  const payload = await response.json().catch(() => null);
  const error = controlledPresentationError(payload);
  if (!response.ok || payload?.ok !== true || error) {
    const code = error?.code || `HTTP_${response.status}`;
    throw new DeductionDataError(code, presentationErrorMessage(payload, response.status), response.status);
  }
  if (payload?.decision?.verdict === "N") {
    const code = payload.decision.force_manual === true
      ? "EDITORIAL_RETRY_LIMIT_REACHED"
      : "EDITORIAL_REWRITING";
    throw new DeductionDataError(code, presentationErrorMessage({
      redacted_error: { code },
    }, response.status), response.status);
  }
  return payload;
}

function bookIdFromLocation(route, locationLike = globalThis.location) {
  if (route?.bookId) return route.bookId;
  const match = locationLike?.pathname?.match(/^\/books\/([^/]+)\//);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function resolveAuditReviewContext({ route, locationLike, storage } = {}) {
  const routeBookId = bookIdFromLocation(route, locationLike);
  if (!UUID_PATTERN.test(String(routeBookId || ""))) {
    throw new DeductionDataError("BOOK_CONTEXT_REQUIRED", "当前网址的作品标识无效，请从总控设置重新进入作品。");
  }
  const context = globalThis.ZHBookContext?.readMatchingBookContext({
    storage,
    locationLike,
    routeBookId,
    requireRoute: true,
  });
  if (!UUID_PATTERN.test(String(context?.bookId || ""))) {
    throw new DeductionDataError("BOOK_CONTEXT_REQUIRED", "当前路由的作品上下文不可用，请从作品工作流重新进入。");
  }
  if (!UUID_PATTERN.test(String(context?.localOperatorId || ""))) {
    throw new DeductionDataError("LOCAL_OPERATOR_REQUIRED", "当前作品上下文不可用，请从作品工作流重新进入。");
  }
  return {
    bookId: String(context.bookId).toLowerCase(),
    localOperatorId: String(context.localOperatorId).toLowerCase(),
  };
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function presentationSelection(result) {
  const l1a = asObject(result?.book?.current_l1a);
  const chapter = asObject(result?.next_presentation);
  const l1aId = String(l1a.id || "").toLowerCase();
  const chapterL1aId = String(chapter.l1a_unit_id || "").toLowerCase();
  const chapterId = String(chapter.chapter_id || "").toLowerCase();
  const versionId = String(chapter.candidate_version_id || "").toLowerCase();
  if (!UUID_PATTERN.test(l1aId)
    || !UUID_PATTERN.test(chapterL1aId)
    || !UUID_PATTERN.test(chapterId)
    || !UUID_PATTERN.test(versionId)
    || chapterL1aId !== l1aId
    || chapter.is_next_presentation !== true) {
    return { l1a: null, chapter: null };
  }
  return {
    l1a: { ...l1a, id: l1aId },
    chapter: {
      ...chapter,
      l1a_unit_id: chapterL1aId,
      chapter_id: chapterId,
      candidate_version_id: versionId,
    },
  };
}

export function pendingCreatorConfirmationSelection(result) {
  const l1a = asObject(result?.book?.current_l1a);
  const chapter = asObject(result?.pending_creator_confirmation);
  const l1aId = String(l1a.id || "").toLowerCase();
  const chapterL1aId = String(chapter.l1a_unit_id || "").toLowerCase();
  const chapterId = String(chapter.chapter_id || "").toLowerCase();
  const versionId = String(chapter.chapter_version_id || "").toLowerCase();
  if (!UUID_PATTERN.test(l1aId)
    || !UUID_PATTERN.test(chapterL1aId)
    || !UUID_PATTERN.test(chapterId)
    || !UUID_PATTERN.test(versionId)
    || chapterL1aId !== l1aId
    || chapter.version_state !== "formal"
    || chapter.confirmation_status !== "unconfirmed"
    || chapter.continuation_available !== true) {
    return null;
  }
  return {
    chapter_id: chapterId,
    candidate_version_id: versionId,
  };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function isPresentationCandidate(chapter) {
  return chapter?.is_next_presentation === true
    && chapter?.deduction_locked === true
    && chapter?.has_candidate_text === false;
}

export function isAuditRecoveryCandidate(chapter) {
  return chapter?.is_next_presentation === true
    && chapter?.deduction_locked === true
    && chapter?.has_candidate_text === true
    && (chapter?.objective_audit_completed !== true || chapter?.subjective_audit_completed !== true);
}

export function clearRecoveredPresentationFailure(runtime, chapter) {
  if (!runtime || runtime.presentationPending === true
    || (!isPresentationCandidate(chapter) && !isAuditRecoveryCandidate(chapter))) return false;
  const hadFailure = runtime.presentationError != null || runtime.presentationKey != null;
  runtime.presentationError = null;
  runtime.presentationKey = null;
  return hadFailure;
}

export function presentationReleaseState(
  chapter,
  { presentationError = null, presentationPending = false } = {},
) {
  if (!chapter) return "unselected";
  if (presentationError) return "blocked";
  if (presentationPending) return "running";
  if (chapter.has_candidate_text === true) {
    return chapter.objective_audit_completed === true && chapter.subjective_audit_completed === true
      ? "awaiting_editorial"
      : "audit_evidence_required";
  }
  if (!canStartPresentation(chapter)) return "unavailable";
  return "ready";
}

export function currentL1aLabel(book) {
  const l1a = asObject(book?.current_l1a);
  const index = Number(l1a.l1a_index);
  const name = typeof l1a.l1a_name === "string" ? l1a.l1a_name.trim() : "";
  if (!Number.isInteger(index) || index < 0 || !name) return null;
  return `L1A-${String(index).padStart(2, "0")} ${name}`;
}

function present(value) {
  return value !== undefined && value !== null && value !== "";
}

function firstPresent(source, keys) {
  for (const key of keys) {
    if (present(source?.[key])) return source[key];
  }
  return null;
}

function displayText(value, fallback = "未提供") {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function createNode(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(doc, name, className = "text-[18px]") {
  return createNode(doc, "span", `material-symbols-outlined ${className}`, name);
}

export function hasPlot(chapter) {
  const plot = asObject(chapter?.candidate_plot_sim_json);
  const records = asArray(plot.particles_records);
  const summary = plot.chapter_summary;
  const hasSummary = typeof summary === "string"
    ? Boolean(summary.trim())
    : summary && typeof summary === "object" && Object.keys(summary).length > 0;
  return records.length > 0 || Boolean(hasSummary);
}

function chapterRecords(chapter) {
  return asArray(asObject(chapter?.candidate_plot_sim_json).particles_records);
}

function recordEvents(record) {
  return asArray(record?.events_in_round);
}

function eventDescription(event) {
  if (typeof event === "string") return event;
  return displayText(firstPresent(event, ["description", "summary", "surface_action"]), "事件描述未提供");
}

function chapterSummary(chapter) {
  const summary = asObject(chapter?.candidate_plot_sim_json).chapter_summary;
  if (typeof summary === "string") return summary;
  return displayText(firstPresent(asObject(summary), ["summary", "synopsis", "description"]), "后端未返回章节级摘要。" );
}

function statusLabel(chapter) {
  if (chapter?.deduction_locked === true && chapter.has_candidate_text === true) {
    return chapter.objective_audit_completed === true && chapter.subjective_audit_completed === true
      ? "已进入审计"
      : "待审计留痕";
  }
  if (chapter?.deduction_locked === true && chapter.has_candidate_text === false) return "待正文呈现";
  if (chapter?.deduction_locked === true) return "正文状态未返回";
  const value = chapter?.run_status || chapter?.status;
  const labels = {
    deduction_complete: "推演已完成",
    deduction_partial: "推演部分完成",
    deduction_blocked: "推演受阻",
    blocked: "推演受阻",
    running: "推演中",
    pending: "等待推演",
  };
  return labels[value] || displayText(value, "状态待确认");
}

function ensurePageCss(doc) {
  if (doc.querySelector('link[href="/pages/audit-review/page.css"]')) return;
  const link = doc.createElement("link");
  link.rel = "stylesheet";
  link.href = "/pages/audit-review/page.css";
  doc.head.append(link);
}

function setReviewContentVisible(root, visible) {
  root.hidden = !visible;
  root.inert = !visible;
  if (visible) {
    root.removeAttribute("inert");
    root.removeAttribute("aria-hidden");
    return;
  }
  root.setAttribute("inert", "");
  root.setAttribute("aria-hidden", "true");
}

function setState(root, state, { detail, retry } = {}) {
  const overlay = root.ownerDocument.querySelector("[data-audit-review-state-overlay]");
  if (!overlay || !stateCopy[state]) return;
  setReviewContentVisible(root, false);
  overlay.hidden = false;
  overlay.dataset.kind = state;
  overlay.setAttribute("role", state === "error" || state === "context" ? "alert" : "status");
  root.dataset.pageState = state;
  const [title, copy] = stateCopy[state];
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

function isReviewContextError(error) {
  return error instanceof DeductionDataError
    && ["BOOK_CONTEXT_REQUIRED", "LOCAL_OPERATOR_REQUIRED"].includes(error.code);
}

function hideState(root) {
  const overlay = root.ownerDocument.querySelector("[data-audit-review-state-overlay]");
  if (overlay) overlay.hidden = true;
  setReviewContentVisible(root, true);
  root.dataset.pageState = "ready";
}

function bindBookContext(runtime) {
  const { root, context, result, navigate } = runtime;
  const book = asObject(result.book);
  const title = displayText(book.title, context.bookId);
  const label = root.ownerDocument.querySelector("#header-book-name");
  if (label) {
    label.textContent = title;
    label.dataset.bookId = context.bookId;
    label.title = `当前作品：${title}`;
  }
  root.dataset.bookId = context.bookId;
  const l1a = selectedL1a(runtime);
  if (l1a?.id) root.dataset.l1aUnitId = l1a.id;
  else delete root.dataset.l1aUnitId;
  root.ownerDocument.documentElement.dataset.bookId = context.bookId;

  const identity = {
    l1aUnitId: l1a?.id || null,
  };
  root.ownerDocument.querySelectorAll("a[href]").forEach((link) => {
    const original = link.getAttribute("href")?.split("?")[0].split("/").at(-1);
    const target = link.dataset.auditReviewRouteTarget || legacyRouteNames[original];
    if (!target) return;
    link.dataset.auditReviewRouteTarget = target;
    const destination = target === "workbench"
      ? `/workbench?book_id=${encodeURIComponent(context.bookId)}`
      : ["production", "deduction", "deduction-review"].includes(target)
        ? buildDeductionPageUrl(context.bookId, target, identity)
        : `/books/${encodeURIComponent(context.bookId)}/${target}`;
    link.href = destination;
    link.dataset.auditReviewDestination = destination;
    if (link.dataset.auditReviewNavigationBound === "true") return;
    link.dataset.auditReviewNavigationBound = "true";
    link.addEventListener("click", (event) => {
      if (typeof navigate !== "function") return;
      event.preventDefault();
      navigate(link.dataset.auditReviewDestination);
    });
  });
}

function bindReadonlyHeader(root, book) {
  const values = {
    "sw-auto-production": book.auto_production,
    "sw-auto-audit": book.auto_audit,
    "sw-auto-iteration": book.auto_iteration,
  };
  for (const [id, value] of Object.entries(values)) {
    const control = root.ownerDocument.getElementById(id);
    if (!control) continue;
    control.removeAttribute("onclick");
    control.setAttribute("aria-disabled", "true");
    control.title = "自动化配置仅可在总控设置中修改";
    if ("disabled" in control) control.disabled = true;
    if (typeof value === "boolean") {
      control.classList.toggle("on", value);
      control.setAttribute("aria-checked", String(value));
    } else {
      control.classList.remove("on");
      control.setAttribute("aria-checked", "mixed");
    }
  }
  const apply = root.ownerDocument.querySelector("#quick-settings-popover button");
  if (apply) {
    apply.disabled = true;
    apply.removeAttribute("onclick");
    apply.setAttribute("aria-disabled", "true");
    apply.title = "请在总控设置中修改自动化配置";
  }
  const notification = root.ownerDocument.querySelector('button[aria-label="通知中心"]');
  if (notification) {
    notification.disabled = true;
    notification.title = "通知中心尚未接入稳定数据合同";
  }
  const iteration = root.ownerDocument.querySelector('a[href$="iteration.html"]');
  if (iteration && iteration.dataset.disabledBound !== "true") {
    iteration.dataset.disabledBound = "true";
    iteration.removeAttribute("href");
    iteration.setAttribute("aria-disabled", "true");
    iteration.title = "迭代管理当前没有稳定页面路由";
    iteration.addEventListener("click", (event) => event.preventDefault());
  }
}

function selectableL1as(runtime) {
  const selection = presentationSelection(runtime.result);
  return selection.l1a && selection.chapter ? [selection.l1a] : [];
}

function selectedL1a(runtime) {
  return selectableL1as(runtime).find((l1a) => l1a.id === runtime.selectedL1aId) || null;
}

function presentationChapter(runtime) {
  const selection = presentationSelection(runtime.result);
  return selection.l1a?.id === runtime.selectedL1aId ? selection.chapter : null;
}

function configureFilterTabs(runtime) {
  const ids = ["tab-promise", "tab-sparks", "tab-world"];
  ids.forEach((id, index) => {
    const button = runtime.root.querySelector(`#${id}`);
    if (!button) return;
    if (index > 0) {
      button.hidden = true;
      button.disabled = true;
      button.setAttribute("aria-disabled", "true");
      button.removeAttribute("onclick");
      return;
    }
    const count = selectableL1as(runtime).length;
    button.hidden = false;
    button.disabled = false;
    button.textContent = `${presentationLabel} ${count}`;
    button.removeAttribute("onclick");
    button.classList.toggle("active", true);
    button.setAttribute("aria-pressed", "true");
    button.onclick = () => {
      renderAuditProjection(runtime);
    };
  });
  const heading = runtime.root.querySelector('[data-purpose="plot-summary-tabs"] h2');
  if (heading) {
    const marker = heading.querySelector("span");
    heading.replaceChildren();
    if (marker) heading.append(marker);
    heading.append("已完成推演 L1A");
  }
  const note = runtime.root.querySelector('[data-purpose="plot-summary-tabs"] > .mt-4 span:last-child');
  if (note) note.textContent = "仅列出已完成推演且后端已解析出顺序下一章的 L1A。";
}

function renderChapterQueue(runtime) {
  const target = runtime.root.querySelector("#audit-list-container");
  if (!target) return;
  const doc = target.ownerDocument;
  const l1as = selectableL1as(runtime);
  const nextChapter = presentationSelection(runtime.result).chapter;
  const fragment = doc.createDocumentFragment();
  l1as.forEach((l1a) => {
    const selected = l1a.id === runtime.selectedL1aId;
    const button = createNode(doc, "button", "audit-chapter-row w-full bg-base-200/50 border border-base-content/10 rounded-box p-3.5 flex items-center justify-between gap-4 text-left");
    button.type = "button";
    button.dataset.l1aId = l1a.id;
    button.setAttribute("aria-current", String(selected));
    const title = createNode(doc, "div", "min-w-0 flex-1");
    title.append(
      createNode(doc, "p", "text-xs text-base-content font-medium", `L1A-${String(displayText(l1a.l1a_index, "-")).padStart(2, "0")} ${displayText(l1a.l1a_name, "未命名 L1A")}`),
      createNode(doc, "p", "text-[11px] text-base-content/60 mt-1", `后端已解析下一章：第 ${displayText(nextChapter?.chapter_index, "-")} 章 ${displayText(nextChapter?.title, "")}`.trim()),
    );
    button.append(title, createNode(doc, "span", "badge badge-sm badge-outline", statusLabel(nextChapter)));
    button.addEventListener("click", () => {
      runtime.selectedL1aId = l1a.id;
      renderAuditProjection(runtime);
    });
    fragment.append(button);
  });
  if (!l1as.length) {
    fragment.append(createNode(doc, "p", "text-xs text-base-content/60 text-center py-8", "没有可选择的已完成推演 L1A。"));
  }
  target.replaceChildren(fragment);
  const detail = runtime.root.querySelector("#granule-detail-panel");
  if (detail) {
    detail.replaceChildren();
    detail.classList.add("hidden");
  }
}

function renderFactSummary(runtime, chapter) {
  const target = runtime.root.querySelector('[data-purpose="chapter-cut-preview"]');
  if (!target) return;
  const doc = target.ownerDocument;
  if (!chapter) {
    target.replaceChildren(createNode(doc, "p", "audit-neutral-slot", "请选择上方 L1A 查看后端解析的下一章推演事实摘要。"));
    return;
  }
  const heading = createNode(doc, "div", "flex justify-between items-start gap-4 mb-4");
  const title = createNode(doc, "div");
  title.append(
    createNode(doc, "h2", "text-sm font-semibold text-base-content", `第 ${displayText(chapter.chapter_index, "-")} 章推演事实摘要`),
    createNode(doc, "p", "text-[10px] text-base-content/60 mt-1", displayText(chapter.title, "章节标题未提供")),
  );
  heading.append(title, createNode(doc, "span", "badge badge-sm badge-outline", statusLabel(chapter)));
  const summary = createNode(doc, "p", "text-xs leading-relaxed text-base-content/75 p-4 bg-base-200/50 border border-base-content/10 rounded-box", chapterSummary(chapter));
  const bands = chapterRecords(chapter)
    .map((record) => asObject(record.emotion_band).band_type)
    .filter(present);
  const bandRow = createNode(doc, "div", "flex flex-wrap gap-2 mt-3");
  bands.forEach((band) => bandRow.append(createNode(doc, "span", "badge badge-sm badge-outline", `情绪波段 ${band}`)));
  const eventList = createNode(doc, "div", "space-y-2 mt-4");
  chapterRecords(chapter).flatMap(recordEvents).forEach((event, index) => {
    const row = createNode(doc, "div", "flex items-start gap-3 p-3 bg-base-100 border border-base-content/10 rounded-box");
    row.append(
      createNode(doc, "span", "text-[11px] text-base-content/60 font-mono", displayText(event?.event_id, `E${index + 1}`)),
      createNode(doc, "span", "text-[11px] text-base-content/75 flex-1", eventDescription(event)),
    );
    eventList.append(row);
  });
  if (!eventList.children.length) eventList.append(createNode(doc, "p", "text-[11px] text-base-content/60 py-3", "候选快照尚未返回可展示的事件。"));
  target.replaceChildren(heading, summary, bandRow, eventList);
}

function renderOutcome(runtime, chapter) {
  const target = runtime.root.querySelector('[data-purpose="simulation-outcome"]');
  if (!target) return;
  const doc = target.ownerDocument;
  if (!chapter) {
    target.replaceChildren(createNode(doc, "p", "audit-neutral-slot", "选择 L1A 后显示其顺序下一章的推演结果总览。"));
    return;
  }
  const progress = asObject(chapter.deduction_progress_json);
  const records = chapterRecords(chapter);
  const header = createNode(doc, "h2", "text-sm font-semibold flex items-center gap-2 mb-4", "推演结果总览");
  const l1aLabel = currentL1aLabel(runtime.result.book);
  const scope = createNode(doc, "div", "mb-4");
  scope.append(createNode(doc, "p", "text-xs text-base-content/60 mb-1", "当前 L1A"));
  if (l1aLabel) {
    scope.append(createNode(doc, "h3", "text-base font-bold text-base-content leading-tight", l1aLabel));
  } else {
    scope.append(createNode(doc, "p", "text-xs text-base-content/60", "当前 L1A 信息未返回。"));
  }
  const title = createNode(doc, "h3", "text-base font-bold text-base-content leading-tight", `第 ${displayText(chapter.chapter_index, "-")} 章 ${displayText(chapter.title, "")}`.trim());
  const grid = createNode(doc, "div", "grid grid-cols-3 gap-3 border-t border-base-content/10 pt-4 mt-4 text-center");
  const metrics = [
    ["颗粒记录", String(records.length)],
    ["剩余颗粒", displayText(progress.remaining_particles)],
    ["令牌消耗", Number.isFinite(Number(progress.token_consumed)) ? Number(progress.token_consumed).toLocaleString("zh-CN") : "未提供"],
  ];
  metrics.forEach(([label, value]) => {
    const card = createNode(doc, "div", "bg-base-200/50 p-2 rounded border border-base-content/10");
    card.append(createNode(doc, "p", "text-[11px] text-base-content/60", label), createNode(doc, "p", "text-sm font-bold text-base-content mt-0.5", value));
    grid.append(card);
  });
  target.replaceChildren(header, scope, title, grid);
}

function diffCount(chapter, key) {
  return chapterRecords(chapter).reduce((total, record) => {
    const value = record?.[key];
    if (Array.isArray(value)) return total + value.length;
    if (value && typeof value === "object") return total + Object.keys(value).length;
    return total;
  }, 0);
}

function renderIndicators(runtime, chapter) {
  const target = runtime.root.querySelector('[data-purpose="simulation-indicators"]');
  if (!target) return;
  const doc = target.ownerDocument;
  if (!chapter) {
    target.replaceChildren(createNode(doc, "p", "audit-neutral-slot", "选择 L1A 后显示其顺序下一章的结构化变化指标。"));
    return;
  }
  const records = chapterRecords(chapter);
  const metrics = [
    ["bolt", "关键事件", records.flatMap(recordEvents).length],
    ["person", "状态变化", diffCount(chapter, "state_diff")],
    ["groups", "关系变化", diffCount(chapter, "relation_diff")],
    ["block", "受阻颗粒", records.filter((record) => record?.particle_status === "blocked").length],
  ];
  const heading = createNode(doc, "h2", "text-sm font-semibold flex items-center gap-2 mb-4", "推演结果指标");
  const grid = createNode(doc, "div", "grid grid-cols-2 gap-2.5");
  metrics.forEach(([iconName, label, value]) => {
    const card = createNode(doc, "div", "bg-base-200/50 border border-base-content/10 rounded-box p-3 flex items-center gap-2.5");
    const mark = createNode(doc, "div", "w-8 h-8 rounded bg-base-content/5 flex items-center justify-center text-base-content shrink-0");
    mark.append(icon(doc, iconName));
    const text = createNode(doc, "div", "min-w-0 flex-1");
    text.append(createNode(doc, "p", "text-[11px] text-base-content/60 font-semibold", label), createNode(doc, "p", "text-xs font-bold text-base-content mt-0.5", String(value)));
    card.append(mark, text);
    grid.append(card);
  });
  target.replaceChildren(heading, grid);
}

function canStartPresentation(chapter) {
  return (isPresentationCandidate(chapter) || isAuditRecoveryCandidate(chapter))
    && UUID_PATTERN.test(String(chapter?.chapter_id || ""))
    && UUID_PATTERN.test(String(chapter?.candidate_version_id || ""));
}

async function startPresentation(runtime) {
  const chapter = presentationChapter(runtime);
  const l1a = selectedL1a(runtime);
  if (!l1a || !canStartPresentation(chapter) || runtime.presentationPending === true) return;
  runtime.presentationPending = true;
  runtime.presentationError = null;
  runtime.presentationNotice = null;
  runtime.presentationKey ||= correlation("audit-presentation");
  renderRelease(runtime, chapter);
  try {
    const result = await sendAuditPresentationIntent(runtime.context, l1a, runtime.presentationKey, {
      fetchImpl: runtime.fetchImpl,
      endpoint: runtime.auditEndpoint,
    });
    storeIssuedAuditWaitRoute(runtime.sessionStorage, runtime.context, chapter, result);
    runtime.presentationPending = false;
    runtime.presentationKey = null;
    const destination = buildAuditStageUrl(runtime.context, chapter);
    if (typeof runtime.navigate === "function") runtime.navigate(destination);
    else globalThis.location?.assign(destination);
  } catch (error) {
    runtime.presentationPending = false;
    runtime.presentationError = error;
    renderRelease(runtime, chapter);
  }
}

function renderRelease(runtime, chapter) {
  const target = runtime.root.querySelector('[data-purpose="release-preparation"]');
  if (!target) return;
  const doc = target.ownerDocument;
  const heading = createNode(doc, "h2", "text-sm font-semibold flex items-center gap-2 mb-4", "正文呈现");
  const releaseState = presentationReleaseState(chapter, {
    presentationError: runtime.presentationError,
    presentationPending: runtime.presentationPending,
  });
  if (releaseState === "unselected") {
    runtime.root.dataset.presentationState = "unselected";
    target.replaceChildren(heading, createNode(doc, "p", "audit-neutral-slot", "请选择已完成推演的 L1A 查看顺序下一章并开始正文呈现。"));
    return;
  }
  if (releaseState === "blocked") {
    runtime.root.dataset.presentationState = "blocked";
    const code = runtime.presentationError?.code || "AUDIT_REQUEST_FAILED";
    const message = runtime.presentationError?.message || "当前章节尚不能进入作者确认。";
    target.replaceChildren(
      heading,
      createNode(doc, "p", "text-[11px] text-error leading-relaxed p-3 bg-base-content/5 border border-base-content/5 rounded-box", `${code}：${message}`),
    );
    return;
  }
  if (releaseState === "awaiting_editorial") {
    runtime.root.dataset.presentationState = "awaiting_editorial";
    target.replaceChildren(
      heading,
      createNode(doc, "p", "text-[11px] text-base-content/60 leading-relaxed p-3 bg-base-content/5 border border-base-content/5 rounded-box", "候选正文已进入审计链路。本页不展示正文；主编放行并完成正式写入后，审计页面才会显示正文。"),
    );
    return;
  }
  if (releaseState === "audit_evidence_required") {
    runtime.root.dataset.presentationState = "audit_evidence_required";
    const actions = createNode(doc, "div", "grid gap-2 mt-4");
    const button = createNode(
      doc,
      "button",
      "btn btn-primary h-auto py-2.5 rounded-lg flex items-center justify-center gap-2",
      "\u7ee7\u7eed\u6b63\u6587\u5448\u73b0",
    );
    button.type = "button";
    button.dataset.action = "start-presentation";
    button.append(icon(doc, "auto_stories", "text-[18px]"));
    button.addEventListener("click", () => { void startPresentation(runtime); });
    actions.append(button);
    target.replaceChildren(
      heading,
      createNode(doc, "p", "audit-neutral-slot", "候选正文已保存，但当前版本缺少匹配的客观或主观审计证据。可继续正文呈现以恢复审计链路；在证据完整前，页面不会进入主编裁决。"),
    );
    target.append(actions);
    return;
  }
  if (releaseState === "unavailable") {
    runtime.root.dataset.presentationState = "unavailable";
    target.replaceChildren(
      heading,
      createNode(doc, "p", "audit-neutral-slot", "当前章节尚未具备锁定推演快照，不能启动正文呈现。"),
    );
    return;
  }
  runtime.root.dataset.presentationState = releaseState;
  const copy = createNode(
    doc,
    "p",
    "text-[11px] text-base-content/60 leading-relaxed p-3 bg-base-content/5 border border-base-content/5 rounded-box",
    runtime.presentationPending
      ? "后端正在基于锁定推演生成候选正文并执行审计。主编裁决前不展示候选正文。"
      : runtime.presentationNotice || "已读取锁定推演事实。开始后将生成候选正文并进入客观、读者和商业审计；主编裁决前不展示候选正文。",
  );
  const actions = createNode(doc, "div", "grid gap-2 mt-4");
  const button = createNode(doc, "button", "btn btn-primary h-auto py-2.5 rounded-lg flex items-center justify-center gap-2", runtime.presentationPending ? "正在生成与审计" : "开始生成正文");
  button.type = "button";
  button.dataset.action = "start-presentation";
  button.disabled = runtime.presentationPending === true;
  button.setAttribute("aria-disabled", String(runtime.presentationPending === true));
  button.append(icon(doc, runtime.presentationPending ? "progress_activity" : "auto_stories", "text-[18px]"));
  button.addEventListener("click", () => { void startPresentation(runtime); });
  actions.append(button);
  if (runtime.presentationError) {
    const error = createNode(doc, "p", "text-[11px] text-error leading-relaxed", `${runtime.presentationError.code || "AUDIT_REQUEST_FAILED"}：${runtime.presentationError.message}`);
    target.replaceChildren(heading, copy, actions, error);
    return;
  }
  target.replaceChildren(heading, copy, actions);
}

function setFooter(runtime, chapter) {
  const footer = runtime.root.ownerDocument.querySelector('[data-purpose="status-footer"]');
  if (!footer) return;
  if (runtime.presentationError) {
    const code = runtime.presentationError.code || "AUDIT_REQUEST_FAILED";
    const message = runtime.presentationError.message || "当前章节尚不能进入作者确认。";
    footer.textContent = `正式写入受控阻断：${code}：${message}`;
    return;
  }
  footer.textContent = runtime.presentationPending
    ? "正文呈现与审计正在运行；页面只读取候选状态，不展示候选正文。"
    : chapter?.has_candidate_text === true
      && chapter.objective_audit_completed === true
      && chapter.subjective_audit_completed === true
      ? `候选版本 ${displayText(chapter.candidate_version_id)} 已进入审计；正文仅在主编放行并完成正式写入后显示。`
      : chapter?.has_candidate_text === true
        ? `候选版本 ${displayText(chapter.candidate_version_id)} 的正文已保存，但客观或主观审计证据不完整；可通过正文呈现入口恢复审计。`
      : chapter
        ? `正在浏览后端解析的顺序下一章候选版本 ${displayText(chapter.candidate_version_id)} 的推演事实摘要；可提交正文呈现意图。`
        : "请选择已完成推演的 L1A；页面不会代替后端裁决章节顺序、正文或审计结果。";
}

function renderAuditProjection(runtime) {
  bindBookContext(runtime);
  bindReadonlyHeader(runtime.root, asObject(runtime.result.book));
  configureFilterTabs(runtime);
  renderChapterQueue(runtime);
  const chapter = presentationChapter(runtime);
  renderFactSummary(runtime, chapter);
  renderOutcome(runtime, chapter);
  renderIndicators(runtime, chapter);
  renderRelease(runtime, chapter);
  setFooter(runtime, chapter);
}

function scrubPrototypeBusinessData(root) {
  const doc = root.ownerDocument;
  bindReadonlyHeader(root, {});
  const bookLabel = doc.querySelector("#header-book-name");
  if (bookLabel) bookLabel.textContent = "作品未确认";
  doc.querySelector("#toast-container")?.replaceChildren();
  const modal = doc.querySelector("#regenerate-modal");
  modal?.classList.add("hidden");
  modal?.classList.remove("flex");
  for (const selector of ['[data-action="approve-preview"]', '[data-action="return-preview"]', "#confirm-replan-btn"]) {
    const button = doc.querySelector(selector);
    if (!button) continue;
    button.disabled = true;
    button.removeAttribute("onclick");
    button.setAttribute("aria-disabled", "true");
  }
  doc.querySelectorAll("script[data-prototype-business-data]").forEach((script) => script.remove());
  doc.defaultView.openRegenerateModal = () => false;
  doc.defaultView.submitReplanDirection = () => false;

  const runtime = {
    root,
    result: { book: {}, chapters: [], next_presentation: null, characters: [] },
    selectedL1aId: null,
  };
  configureFilterTabs(runtime);
  renderChapterQueue(runtime);
  renderFactSummary(runtime, null);
  renderOutcome(runtime, null);
  renderIndicators(runtime, null);
  renderRelease(runtime, null);
  setFooter(runtime, null);
}

function stopPolling(runtime, { abort = false } = {}) {
  if (runtime.pollTimer) {
    runtime.root.ownerDocument.defaultView?.clearTimeout(runtime.pollTimer);
    runtime.pollTimer = null;
  }
  if (abort) runtime.controller?.abort();
}

function schedulePolling(runtime) {
  stopPolling(runtime);
  const view = runtime.root.ownerDocument.defaultView;
  if (!view || runtime.root.ownerDocument.hidden) return;
  runtime.pollTimer = view.setTimeout(async () => {
    runtime.pollTimer = null;
    await loadProjection(runtime, { background: true, scheduleNext: true });
  }, 5000);
}

async function loadProjection(runtime, { background = false, scheduleNext = false } = {}) {
  runtime.controller?.abort();
  runtime.controller = new AbortController();
  if (!background) setState(runtime.root, "loading");
  try {
    const fetched = await fetchDeductionProjection(runtime.context, {
      fetchImpl: runtime.fetchImpl,
      endpointBase: runtime.endpointBase,
      signal: runtime.controller.signal,
    });
    const result = fetched;
    runtime.result = result;
    const pendingConfirmation = pendingCreatorConfirmationSelection(result);
    if (pendingConfirmation) {
      const destination = buildAuditStageUrl(runtime.context, pendingConfirmation);
      if (typeof runtime.navigate === "function") runtime.navigate(destination);
      else globalThis.location?.assign(destination);
      return;
    }
    const selection = presentationSelection(result);
    const available = selectableL1as(runtime);
    runtime.selectedL1aId = runtime.selectedL1aId && available.some((l1a) => l1a.id === runtime.selectedL1aId)
      ? runtime.selectedL1aId
      : selection.l1a?.id || null;
    clearRecoveredPresentationFailure(runtime, presentationChapter(runtime));
    hideState(runtime.root);
    bindBookContext(runtime);
    bindReadonlyHeader(runtime.root, asObject(result.book));
    if (!available.length) {
      setState(runtime.root, "empty");
      if (scheduleNext) schedulePolling(runtime);
      return;
    }
    renderAuditProjection(runtime);
    if (scheduleNext) schedulePolling(runtime);
  } catch (error) {
    if (error?.name === "AbortError") return;
    const contextError = isReviewContextError(error);
    setState(runtime.root, contextError ? "context" : "error", {
      detail: error?.message,
      retry: contextError ? undefined : () => loadProjection(runtime, { scheduleNext: true }),
    });
  }
}

export async function bindAuditReviewPage({
  route,
  state = "normal",
  navigate,
  fetchImpl = globalThis.fetch,
  endpointBase = "/api/books",
  auditEndpoint = AUDIT_WEBHOOK_URL,
  locationLike = globalThis.location,
  storage = globalThis.localStorage,
  sessionStorage = globalThis.sessionStorage,
} = {}) {
  const root = globalThis.document?.querySelector("main[data-audit-review-root]");
  if (!root) return false;
  ensurePageCss(root.ownerDocument);
  scrubPrototypeBusinessData(root);

  const forcedState = state === "normal" ? null : stateCopy[state] ? state : null;
  if (forcedState) {
    setState(root, forcedState);
    return true;
  }

  let context;
  try {
    context = resolveAuditReviewContext({
      route,
      locationLike,
      storage,
    });
  } catch (error) {
    const contextError = isReviewContextError(error);
    setState(root, contextError ? "context" : "error", {
      detail: error.message,
      retry: contextError ? undefined : () => bindAuditReviewPage({
        route, state: "normal", navigate, fetchImpl, endpointBase, auditEndpoint, locationLike, storage, sessionStorage,
      }),
    });
    return false;
  }

  let runtime = pageRuntimes.get(root);
  if (!runtime) {
    runtime = { root, result: { book: {}, chapters: [], next_presentation: null, characters: [] }, selectedL1aId: null };
    pageRuntimes.set(root, runtime);
  }
  Object.assign(runtime, {
    context, navigate, fetchImpl, endpointBase, auditEndpoint, locationLike, sessionStorage,
  });
  bindBookContext(runtime);
  await loadProjection(runtime);
  schedulePolling(runtime);
  if (!runtime.lifecycleBound) {
    runtime.lifecycleBound = true;
    root.ownerDocument.addEventListener("visibilitychange", () => {
      if (root.ownerDocument.hidden) {
        stopPolling(runtime, { abort: true });
        return;
      }
      loadProjection(runtime, { background: true, scheduleNext: true });
    });
    root.ownerDocument.defaultView?.addEventListener("pagehide", () => stopPolling(runtime, { abort: true }), { once: true });
  }
  return true;
}

export async function renderPage(options) {
  return bindAuditReviewPage(options);
}

if (typeof window !== "undefined" && document.querySelector("main[data-audit-review-root]")) {
  const state = new URLSearchParams(window.location.search).get("state") || "normal";
  bindAuditReviewPage({ state });
}

import "../prototype/common/book-context.js";
import { legacyRouteNames } from "../prototype/common/legacy-route-names.mjs";

const ENDPOINT = globalThis.window?.PRODUCTION_WEBHOOK_URL || "http://127.0.0.1:5678/webhook/content_production";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const runtime = { context: null, projection: null, l1as: [], selectedL1aId: null, selectionKey: null, candidate: null, busy: false };

export class ProductionContextError extends Error {
  constructor(code, message) { super(message); this.name = "ProductionContextError"; this.code = code; }
}

function validUuid(value) { return UUID_PATTERN.test(String(value || "")); }
function normalizeUuid(value) { return validUuid(value) ? String(value).toLowerCase() : null; }
function text(value, fallback = "") { return typeof value === "string" && value.trim() ? value.trim() : fallback; }
function correlation(prefix) { return `${prefix}-${globalThis.crypto?.randomUUID?.() || Date.now()}`.slice(0, 128); }

export function resolveProductionContext({ route, locationLike = globalThis.location, storage = globalThis.localStorage } = {}) {
  const context = globalThis.ZHBookContext?.readMatchingBookContext({
    storage,
    locationLike,
    routeBookId: route?.bookId,
    requireRoute: true,
  });
  if (!context) throw new ProductionContextError("BOOK_CONTEXT_REQUIRED", "当前作品上下文不可用，请从作品工作流重新进入。");
  return context;
}

export function productionRequest(context, action, extras = {}) {
  const scope = runtime.candidate?.scope;
  return {
    action,
    local_operator_id: context.localOperatorId,
    book_id: context.bookId,
    correlation_id: correlation(`production-${action}`),
    ...(scope ? { scope } : {}),
    ...extras,
  };
}

export function normalizeProductionProjection(result) {
  const book = result?.book;
  if (!validUuid(book?.book_id)) throw new ProductionContextError("PRODUCTION_READ_FAILED", "当前作品的生产范围不可用。");
  const l1as = (Array.isArray(result?.l1as) ? result.l1as : [])
    .filter((item) => validUuid(item?.l1a_id) && item?.is_formal === true && item?.is_locked === true
      && ["finalized", "locked_for_deduction"].includes(item?.status))
    .map((item) => ({ ...item, l1a_id: normalizeUuid(item.l1a_id) }))
    .sort((left, right) => Number(left.l1a_index) - Number(right.l1a_index));
  const currentL1aId = normalizeUuid(book.current_l1a_id);
  const selected = l1as.find((item) => item.l1a_id === currentL1aId)
    || l1as.find((item) => item.status === "finalized")
    || null;
  return { book, l1as, selectedL1aId: selected?.l1a_id || null };
}

export function hasChapterDivision(plan) {
  return Array.isArray(plan?.chapter_division) && plan.chapter_division.length > 0;
}

function setText(root, selector, value) {
  const node = root.querySelector(selector);
  if (!node) return;
  const content = String(value ?? "");
  node.textContent = content;
  if (node.hasAttribute("data-full-text")) node.title = content;
}
function node(document, tag, className, value) { const item = document.createElement(tag); if (className) item.className = className; item.textContent = value; return item; }
function itemText(value, field) {
  if (typeof value === "string") return text(value);
  return field ? text(value?.[field]) : "";
}
function listText(values, field, fallback) {
  const rendered = Array.isArray(values)
    ? values.map((value) => itemText(value, field)).filter(Boolean).join("；")
    : "";
  return rendered || fallback;
}
function replaceBadges(root, selector, labels, className, fallback) {
  const target = root.querySelector(selector);
  if (!target) return;
  const values = Array.isArray(labels) ? labels.filter(Boolean) : [];
  target.replaceChildren(...(values.length ? values : [fallback]).map((label) => node(root.ownerDocument, "span", className, label)));
}

export function productionCandidateDisplay(candidate) {
  const plan = candidate?.l1a_presentation_plan || {};
  const scene = candidate?.scene_condition_package || {};
  const divisions = Array.isArray(plan.chapter_division) ? plan.chapter_division : [];
  const arcNodes = Array.isArray(plan.small_arc_sequence)
    ? plan.small_arc_sequence.map((arc) => text(arc?.arc_node)).filter(Boolean)
    : [];
  const characterNames = new Map((Array.isArray(candidate?.context?.characters) ? candidate.context.characters : [])
    .map((character) => [normalizeUuid(character?.character_id), text(character?.char_name)])
    .filter(([id, name]) => id && name));
  const participants = Array.isArray(scene.participant_chars)
    ? scene.participant_chars.map((id) => characterNames.get(normalizeUuid(id))).filter(Boolean)
    : [];
  const reveal = plan.revelation_plan || {};
  const revealText = reveal.has_truth_particle === true
    ? listText([reveal.technical, reveal.institutional, reveal.philosophical], null, "包含三层揭露计划。")
    : "本次候选未声明三层揭露。";
  const sceneLocation = text(scene.scene_location);
  const resources = listText(scene.available_resource_codes, null, "");

  return {
    divisions,
    chapterCount: String(divisions.length),
    phase: arcNodes[0] || "候选呈现策略",
    events: listText(plan.plot_retained, "content", "候选呈现方案已返回。"),
    hooks: listText(plan.hook_positions, "content", "本次候选未安排钩子。"),
    reveal: revealText,
    boundary: listText(scene.scene_constraints, null, "后端未返回"),
    scene: [sceneLocation, resources ? `可支配资源：${resources}` : ""].filter(Boolean).join("；") || "后端未返回",
    arcNodes,
    participants,
  };
}

function setButton(button, { icon, label, disabled, title }) {
  if (!button) return;
  button.disabled = Boolean(disabled);
  button.setAttribute("aria-disabled", String(Boolean(disabled)));
  button.title = title || "";
  const iconNode = button.querySelector(".material-symbols-outlined");
  if (iconNode) iconNode.textContent = icon;
  const textNode = [...button.childNodes].find((item) => item.nodeType === Node.TEXT_NODE && item.textContent.trim());
  if (textNode) textNode.textContent = ` ${label}`;
  else button.append(document.createTextNode(` ${label}`));
}

function setOverlay(root, state, title, detail, retry = false) {
  const overlay = root.querySelector("#production-state-overlay");
  if (!overlay) return;
  overlay.hidden = state === "ready";
  overlay.setAttribute("aria-hidden", String(state === "ready"));
  overlay.dataset.kind = state;
  root.dataset.productionState = state;
  setText(overlay, "[data-state-title]", title);
  setText(overlay, "[data-state-detail]", detail);
  const button = overlay.querySelector("[data-action='retry-production-state']");
  if (button) { button.hidden = !retry; button.disabled = !retry; }
}

function bindNavigation(root, context) {
  const document = root.ownerDocument;
  document.documentElement.dataset.bookId = context.bookId;
  const header = document.getElementById("header-book-name");
  if (header) header.textContent = `作品 ${context.bookId.slice(0, 8)}`;
  document.querySelectorAll("a[href]").forEach((link) => {
    const source = link.dataset.productionRouteTarget || link.getAttribute("href")?.split("?")[0].split("/").at(-1);
    const target = legacyRouteNames[source];
    if (target) link.href = target === "workbench"
      ? `/workbench?book_id=${encodeURIComponent(context.bookId)}`
      : `/books/${encodeURIComponent(context.bookId)}/${target}`;
  });
  document.getElementById("quick-settings-btn")?.closest(".relative.flex.items-center")?.setAttribute("hidden", "");
  document.querySelector('button[aria-label="通知中心"]')?.setAttribute("hidden", "");
}

function selectedL1a() { return runtime.l1as.find((item) => item.l1a_id === runtime.selectedL1aId) || null; }

export function canSwitchProductionL1a(current) {
  return !current || ["finalized", "completed"].includes(current.status);
}

export function productionStartHint(context, selected) {
  if (!context) return "缺少作品或操作者范围";
  if (!selected) return "请先选择正式锁定的 L1A";
  if (selected.status === "locked_for_deduction") return "当前 L1A 已进入推演，暂不能重新生成方案";
  return "当前 L1A 未满足生产入口条件";
}

function renderSelection(root) {
  const document = root.ownerDocument;
  const selected = selectedL1a();
  setText(root, "#l1a-current-label", selected ? `L1A-${String(selected.l1a_index).padStart(3, "0")}` : "暂无可生产 L1A");
  setText(root, "#l1a-current-title", selected ? text(selected.l1a_name, "未命名 L1A") : "请先完成并锁定 L1A 设计");
  const list = root.querySelector("#l1a-dropdown .p-1");
  if (!list) return;
  list.replaceChildren();
  if (!runtime.l1as.length) {
    list.append(node(document, "p", "production-l1a-empty", "当前作品没有可生产的正式锁定 L1A。"));
    return;
  }
  const currentId = normalizeUuid(runtime.projection?.book?.current_l1a_id);
  const current = runtime.l1as.find((item) => item.l1a_id === currentId);
  const canSwitch = canSwitchProductionL1a(current);
  for (const item of runtime.l1as) {
    const option = node(document, "button", "production-l1a-option", `L1A-${String(item.l1a_index).padStart(3, "0")} ${text(item.l1a_name, "未命名 L1A")}`);
    option.type = "button";
    option.dataset.l1aId = item.l1a_id;
    option.setAttribute("aria-current", String(item.l1a_id === runtime.selectedL1aId));
    option.disabled = runtime.busy || Boolean(runtime.candidate) || (!canSwitch && item.l1a_id !== currentId);
    option.setAttribute("aria-disabled", String(option.disabled));
    option.addEventListener("click", () => {
      if (option.disabled) return;
      runtime.selectedL1aId = item.l1a_id;
      runtime.selectionKey = null;
      root.querySelector("#l1a-dropdown")?.classList.add("hidden");
      renderSelection(root);
      renderControls(root);
    });
    list.append(option);
  }
}

function clearProjection(root, message) {
  const document = root.ownerDocument;
  renderSelection(root);
  setText(root, "#detail-events", message);
  ["#detail-ch-number-mid", "#detail-ch-phase-mid", "#detail-emotion-val-mid", "#detail-l1a-progress-mid", "#detail-drive-mode", "#detail-satisfaction", "#detail-hook", "#detail-reveal", "#detail-boundary", "#detail-scenes"].forEach((selector) => setText(root, selector, "后端未返回"));
  for (const selector of ["#emotion-chart-area", "[data-region='chapter_tabs']", "#detail-tags", "#detail-characters", "#detail-characters-right"]) {
    const target = root.querySelector(selector);
    if (target) target.replaceChildren(node(document, "p", "production-value-empty", "候选方案尚未生成"));
  }
}

function renderCandidate(root) {
  const candidate = runtime.candidate;
  if (!candidate) return clearProjection(root, "候选方案尚未生成。");
  const document = root.ownerDocument;
  const display = productionCandidateDisplay(candidate);
  renderSelection(root);
  setText(root, "#detail-ch-number-mid", display.chapterCount);
  setText(root, "#detail-ch-phase-mid", display.phase);
  setText(root, "#detail-events", display.events);
  setText(root, "#detail-hook", display.hooks);
  setText(root, "#detail-reveal", display.reveal);
  setText(root, "#detail-boundary", display.boundary);
  setText(root, "#detail-scenes", display.scene);
  replaceBadges(root, "#detail-tags", display.arcNodes, "text-[10px] px-1.5 py-0.5 rounded bg-base-200 text-base-content opacity-60 border border-base-content/5", "后端未返回");
  replaceBadges(root, "#detail-characters", display.participants, "text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-code-sm", "后端未返回");
  replaceBadges(root, "#detail-characters-right", display.participants, "text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-code-sm", "后端未返回");
  const tabs = root.querySelector("[data-region='chapter_tabs']");
  if (tabs) {
    const box = node(document, "div", "production-chapter-tabs", "");
    display.divisions.forEach((chapter, index) => box.append(node(document, "span", "production-chapter-tab", `第 ${chapter.chapter_seq ?? index + 1} 章`)));
    tabs.replaceChildren(box);
  }
  const chart = root.querySelector("#emotion-chart-area");
  if (chart) chart.replaceChildren(node(document, "p", "production-chart-empty", `已生成 ${display.divisions.length} 个候选章节节拍，等待创作者批准。`));
}

function readableFailure(result, fallback) {
  return result?.redacted_error?.message || result?.error?.message || fallback;
}

async function post(payload) {
  const response = await fetch(ENDPOINT, {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.ok !== true) {
    const error = new Error(readableFailure(result, "生产服务暂时无法完成请求。"));
    error.code = result?.redacted_error?.code || "PRODUCTION_REQUEST_FAILED";
    throw error;
  }
  return result;
}

async function singleFlight(root, operation) {
  if (runtime.busy || !runtime.context) return;
  runtime.busy = true;
  root.setAttribute("aria-busy", "true");
  renderControls(root);
  try { await operation(); } finally { runtime.busy = false; root.removeAttribute("aria-busy"); renderControls(root); }
}

function renderControls(root) {
  const regenerate = [...root.querySelectorAll("button")].find((button) => button.textContent.includes("重新生成"));
  const primary = root.querySelector("#plan-generation-btn");
  const returnButton = root.querySelector("#submit-replan-btn");
  const selected = selectedL1a();
  const ready = Boolean(runtime.context && selected && selected.status === "finalized");
  const candidate = Boolean(runtime.candidate && hasChapterDivision(runtime.candidate.l1a_presentation_plan));
  setButton(primary, runtime.busy
    ? { icon: "progress_activity", label: "正在等待后端", disabled: true }
    : candidate
      ? { icon: "check_circle", label: "批准方案并建立章节", disabled: false }
      : { icon: "auto_awesome", label: "生成方案", disabled: !ready, title: ready ? "生成当前锁定 L1A 的候选呈现方案" : productionStartHint(runtime.context, selected) });
  setButton(regenerate, { icon: "refresh", label: "重新生成", disabled: runtime.busy || !candidate, title: candidate ? "放弃当前未持久化候选并重新生成" : "请先生成候选方案" });
  setButton(returnButton, { icon: "undo", label: "确认退回", disabled: runtime.busy || !candidate, title: candidate ? "退回候选并重新生成" : "请先生成候选方案" });
}

async function generate(root) {
  await singleFlight(root, async () => {
    runtime.candidate = null;
    clearProjection(root, "正在生成当前锁定 L1A 的候选呈现方案。");
    setOverlay(root, "loading", "正在生成方案", "后端正在物化场景并拆解章节呈现策略。");
    runtime.selectionKey ||= correlation("production-select");
    const result = await post(productionRequest(runtime.context, "generate", {
      l1a_id: runtime.selectedL1aId,
      idempotency_key: runtime.selectionKey,
    }));
    const candidate = result?.result;
    if (!candidate?.scope || !candidate?.l1a_presentation_plan || !candidate?.scene_condition_package || !hasChapterDivision(candidate.l1a_presentation_plan)) {
      throw new Error("生成响应没有返回至少一个候选章节节拍。");
    }
    runtime.candidate = { ...candidate, approvalKey: correlation("production-approve") };
    runtime.selectionKey = null;
    renderCandidate(root);
    setOverlay(root, "ready", "", "");
  }).catch((error) => {
    clearProjection(root, readableFailure(error, "方案未生成。"));
    setOverlay(root, "error", "方案未生成", `${error.code || "REQUEST_FAILED"}：${error.message}`, true);
  });
}

async function loadProjection(root) {
  if (!runtime.context || runtime.busy) return;
  runtime.busy = true;
  root.setAttribute("aria-busy", "true");
  renderControls(root);
  setOverlay(root, "loading", "正在读取 L1A", "正在读取当前作品可进入生产的正式锁定 L1A。");
  try {
    const response = await post(productionRequest(runtime.context, "read"));
    const projection = normalizeProductionProjection(response.result);
    runtime.projection = projection;
    runtime.l1as = projection.l1as;
    runtime.selectedL1aId = projection.selectedL1aId;
    runtime.selectionKey = null;
    const header = root.ownerDocument.getElementById("header-book-name");
    if (header) header.textContent = text(projection.book.title, `作品 ${runtime.context.bookId.slice(0, 8)}`);
    clearProjection(root, runtime.l1as.length ? "候选方案尚未生成" : "当前作品没有可生产的正式锁定 L1A。");
    setOverlay(root, "ready", "", "");
  } catch (error) {
    runtime.projection = null;
    runtime.l1as = [];
    runtime.selectedL1aId = null;
    clearProjection(root, readableFailure(error, "生产范围读取失败。"));
    setOverlay(root, "error", "生产范围读取失败", `${error.code || "REQUEST_FAILED"}：${error.message}`, true);
  } finally {
    runtime.busy = false;
    root.removeAttribute("aria-busy");
    renderSelection(root);
    renderControls(root);
  }
}

async function approve(root) {
  const candidate = runtime.candidate;
  if (!candidate || !hasChapterDivision(candidate.l1a_presentation_plan)) return generate(root);
  await singleFlight(root, async () => {
    setOverlay(root, "loading", "正在批准方案", "后端正在重新校验范围和候选完整性，并建立候选章节。 ");
    const result = await post(productionRequest(runtime.context, "approve", {
      scope: candidate.scope,
      l1a_presentation_plan: candidate.l1a_presentation_plan,
      scene_condition_package: candidate.scene_condition_package,
      idempotency_key: candidate.approvalKey,
    }));
    const ids = result?.ids || result?.result?.ids;
    if (!ids?.chapter_ids?.length || !ids?.chapter_versions?.length) throw new Error("批准响应没有返回候选章节标识。");
    window.location.assign(`/books/${encodeURIComponent(runtime.context.bookId)}/deduction`);
  }).catch((error) => setOverlay(root, "error", "方案未批准", `${error.code || "REQUEST_FAILED"}：${error.message}`, true));
}

async function returnForRegeneration(root) {
  const candidate = runtime.candidate;
  const direction = text(root.querySelector("#re-deduction-direction")?.value);
  if (!candidate || !direction) return;
  await singleFlight(root, async () => {
    await post(productionRequest(runtime.context, "return", { scope: candidate.scope, return_direction: direction }));
    runtime.candidate = null;
    root.querySelector("#regenerate-modal")?.classList.add("hidden");
    clearProjection(root, "候选方案已退回，您可以补充方向后重新生成。");
    setOverlay(root, "ready", "", "");
  }).catch((error) => setOverlay(root, "error", "退回未完成", `${error.code || "REQUEST_FAILED"}：${error.message}`, true));
}

function openReturnModal(root) {
  if (!runtime.candidate || runtime.busy) return;
  const modal = root.querySelector("#regenerate-modal");
  const field = root.querySelector("#re-deduction-direction");
  if (!modal || !field) return;
  modal.classList.remove("hidden");
  modal.classList.add("flex");
  field.disabled = false;
  field.value = "";
  field.focus();
}

function bindPage({ route } = {}) {
  const root = document.getElementById("main-content");
  if (!root || root.dataset.productionBound) return;
  root.dataset.productionBound = "true";
  root.ownerDocument.querySelectorAll("[onclick]").forEach((item) => item.removeAttribute("onclick"));
  try {
    runtime.context = resolveProductionContext({ route, locationLike: window.location, storage: window.localStorage });
    bindNavigation(root, runtime.context);
    clearProjection(root, "正在读取当前作品的正式锁定 L1A。");
  } catch (error) {
    runtime.context = null;
    clearProjection(root, error.message);
    setOverlay(root, "error", "无法确认当前作品", `${error.code || "CONTEXT_REQUIRED"}：${error.message}`);
  }
  root.querySelector("#plan-generation-btn")?.addEventListener("click", () => runtime.candidate ? approve(root) : generate(root));
  [...root.querySelectorAll("button")].find((button) => button.textContent.includes("重新生成"))?.addEventListener("click", () => openReturnModal(root));
  root.querySelector("#submit-replan-btn")?.addEventListener("click", () => returnForRegeneration(root));
  root.querySelector("[data-action='retry-production-state']")?.addEventListener("click", () => runtime.l1as.length ? generate(root) : loadProjection(root));
  root.querySelector("#l1a-dropdown-trigger")?.addEventListener("click", () => {
    if (runtime.l1as.length) root.querySelector("#l1a-dropdown")?.classList.toggle("hidden");
  });
  renderControls(root);
  if (runtime.context) loadProjection(root);
}

export async function renderPage(options) { bindPage(options); }
if (typeof document !== "undefined") bindPage();

import {
  buildCreatorReplanSuccessorUrl,
  buildDeductionPageUrl,
  creatorReplanAction,
  DeductionDataError,
  deductionCommandAction,
  deductionDisplayPlot,
  deductionDisplayProgress,
  deductionFailureRecoveryAction,
  deductionDisplayRecords,
  deductionReviewReady,
  fetchDeductionProjection,
  resolveDeductionContext,
  sendDeductionCommand,
  sendDeductionPauseIntent,
  scopeDeductionProjection,
} from "./deduction-data-client.mjs";
import { legacyRouteNames } from "../prototype/common/legacy-route-names.mjs";

const stateCopy = Object.freeze({
  loading: ["正在读取推演进度", "正在读取当前作品的候选章节、颗粒进度与角色活态。"],
  empty: ["暂无推演结果", "当前作品还没有可展示的候选章节推演。"],
  error: ["推演数据加载失败", "未能读取真实推演数据，请检查数据服务后重试。"],
  context: ["无法确认当前作品", "请先从总控设置选择作品，再进入多代理推演。"],
});

const pageRuntimes = new WeakMap();
const RESUMABLE_DEDUCTION_ERROR_CODES = new Set([
  "MODEL_PROVIDER_REJECTED",
  "MODEL_PROVIDER_UNAVAILABLE",
  "MODEL_OUTPUT_INVALID",
  "MODEL_CALL_FAILED",
]);

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
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

function icon(doc, name, className = "text-[16px]") {
  return createNode(doc, "span", `material-symbols-outlined ${className}`, name);
}

function pageRoot(content, doc) {
  return content?.querySelector?.("#main-content") || doc.querySelector("#main-content");
}

function ensurePageCss(doc) {
  if (doc.querySelector('link[href="/pages/multi-agent-deduction/page.css"]')) return;
  const link = doc.createElement("link");
  link.rel = "stylesheet";
  link.href = "/pages/multi-agent-deduction/page.css";
  doc.head.append(link);
}

function section(root, purpose) {
  return root.querySelector(`[data-purpose="${purpose}"]`);
}

function setText(root, selector, value) {
  const node = root.querySelector(selector);
  if (node) node.textContent = value;
}

export function statusLabel(status, locked) {
  if (locked === true) return "推演已完成";
  const labels = {
    deduction_complete: "推演已完成",
    deduction_partial: "推演部分完成",
    deduction_blocked: "推演受阻",
    blocked: "推演受阻",
    running: "推演中",
    pause_requested: "正在等待当前颗粒完成",
    paused: "推演已暂停，可继续",
    failed: "推演失败",
    pending: "等待推演",
  };
  return labels[status] || displayText(status, "状态待确认");
}

export function deductionRunStatusText(status, locked, error, action) {
  const message = typeof error?.message === "string" ? error.message.trim() : "";
  if (message) {
    return `${action === "pause" ? "暂停意图未提交" : "推演请求未完成"}：${message}`;
  }
  return statusLabel(status, locked);
}

export function deductionResumeAfterError(chapter, error) {
  return RESUMABLE_DEDUCTION_ERROR_CODES.has(error?.code)
    && deductionCommandAction(chapter) === "resume";
}

export function deductionControlMode(chapter, {
  commandError = null,
  pauseRequested = false,
  pausePending = false,
  commandPending = false,
  serviceState = null,
} = {}) {
  if (commandError) return deductionResumeAfterError(chapter, commandError) ? "resume" : "unavailable";
  if (pauseRequested || pausePending || serviceState === "pause_requested") return "pause_requested";
  if (commandPending || serviceState === "running") return "pause";
  return deductionCommandAction(chapter) || "unavailable";
}

export function deductionPersistedProjection(result) {
  const book = { ...(asObject(result?.book)) };
  delete book.runtime_service_state;
  delete book.runtime_blocked_code;
  const chapters = Array.isArray(result?.chapters) ? result.chapters.map((chapter) => {
    const projection = { ...asObject(chapter) };
    delete projection.runtime_service_state;
    delete projection.runtime_blocked_code;
    delete projection.runtime_l1a_token_consumed;
    delete projection.runtime_deduction_progress_json;
    delete projection.runtime_candidate_plot_sim_json;
    return projection;
  }) : [];
  return { ...asObject(result), book, chapters };
}

function budgetExhausted(chapter) {
  return deductionDisplayProgress(chapter).token_budget_exceeded === true;
}

export function l1aTokenConsumed(chapter) {
  const runtimeConsumed = Number(chapter?.runtime_l1a_token_consumed);
  if (Number.isFinite(runtimeConsumed) && runtimeConsumed >= 0) return runtimeConsumed;
  const progress = deductionDisplayProgress(chapter);
  const persistedL1aConsumed = Number(progress.l1a_token_consumed);
  if (Number.isFinite(persistedL1aConsumed) && persistedL1aConsumed >= 0) return persistedL1aConsumed;
  const chapterConsumed = Number(progress.token_consumed);
  return Number.isFinite(chapterConsumed) && chapterConsumed >= 0 ? chapterConsumed : null;
}

function setDeductionContentVisible(root, visible) {
  const content = root.querySelector("[data-deduction-runtime-content]");
  if (!content) return;
  content.hidden = !visible;
  content.inert = !visible;
  if (visible) {
    content.removeAttribute("inert");
    content.removeAttribute("aria-hidden");
    return;
  }
  content.setAttribute("inert", "");
  content.setAttribute("aria-hidden", "true");
}

function showState(root, state, { detail, retry } = {}) {
  root.querySelector("#deduction-state-overlay")?.remove();
  if (!stateCopy[state]) return;
  setDeductionContentVisible(root, false);

  const doc = root.ownerDocument;
  const overlay = createNode(doc, "section", "ui-state-overlay deduction-state-overlay");
  overlay.id = "deduction-state-overlay";
  overlay.dataset.kind = state;
  overlay.setAttribute("role", state === "error" || state === "context" ? "alert" : "status");
  overlay.setAttribute("aria-live", "polite");

  const panel = createNode(doc, "div", "ui-state-panel deduction-state-overlay__panel");
  panel.append(
    createNode(doc, "h1", "ui-state-title", stateCopy[state][0]),
    createNode(doc, "p", "ui-state-detail", detail || stateCopy[state][1]),
  );
  if (typeof retry === "function") {
    const button = createNode(doc, "button", "btn btn-sm mt-5", "重新载入");
    button.type = "button";
    button.className = "ui-button ui-button-quiet ui-button-small";
    button.dataset.action = "retry-deduction-data";
    button.addEventListener("click", retry);
    panel.append(button);
  }
  overlay.append(panel);
  root.style.position ||= "relative";
  root.append(overlay);
  root.dataset.pageState = state;
}

function bindBookContext(runtime) {
  const { root, result, context, navigate } = runtime;
  const book = asObject(result.book);
  const title = displayText(book.title, context.bookId);
  const label = root.querySelector("[data-book-context]");
  if (label) {
    label.textContent = title;
    label.dataset.bookId = context.bookId;
    label.title = `当前作品：${title}`;
  }

  root.dataset.bookId = context.bookId;
  if (context.l1aUnitId) root.dataset.l1aUnitId = context.l1aUnitId;
  else delete root.dataset.l1aUnitId;
  root.ownerDocument.documentElement.dataset.bookId = context.bookId;
  const chapter = selectedChapter(runtime);
  const chapterId = chapter?.chapter_id || context.chapterId;
  const chapterVersionId = chapter?.candidate_version_id || context.chapterVersionId;
  const identity = {
    l1aUnitId: chapter?.l1a_unit_id || context.l1aUnitId,
    chapterId: chapterId && chapterVersionId ? chapterId : null,
    chapterVersionId: chapterId && chapterVersionId ? chapterVersionId : null,
  };
  root.ownerDocument.querySelectorAll("a[href]").forEach((link) => {
    const original = link.getAttribute("href")?.split("?")[0].split("/").at(-1);
    const target = link.dataset.deductionRouteTarget || legacyRouteNames[original];
    if (!target) return;
    link.dataset.deductionRouteTarget = target;
    const destination = target === "workbench"
      ? `/workbench?book_id=${encodeURIComponent(context.bookId)}`
      : ["production", "deduction", "deduction-review"].includes(target)
        ? buildDeductionPageUrl(context.bookId, target, identity)
        : `/books/${encodeURIComponent(context.bookId)}/${target}`;
    link.href = destination;
    link.dataset.deductionDestination = destination;
    if (link.dataset.deductionNavigationBound === "true") return;
    link.dataset.deductionNavigationBound = "true";
    link.addEventListener("click", (event) => {
      if (typeof navigate !== "function") return;
      event.preventDefault();
      navigate(link.dataset.deductionDestination);
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
      if ("checked" in control) {
        control.indeterminate = false;
        control.checked = value;
      }
      control.classList.toggle("on", value);
      control.setAttribute("aria-checked", String(value));
    } else {
      if ("checked" in control) {
        control.checked = false;
        control.indeterminate = true;
      }
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

function chapterRecords(chapter) { return deductionDisplayRecords(chapter); }

function selectedChapter(runtime) {
  return runtime.result.chapters.find((chapter) => chapter.chapter_id === runtime.selectedChapterId) || null;
}

function selectedParticle(runtime, chapter) {
  const records = chapterRecords(chapter);
  return records.find((record) => record?.particle_id === runtime.selectedParticleId) || null;
}

export function chooseInitialChapter(result, context) {
  const chapters = asArray(result.chapters);
  const requested = context.chapterId;
  if (requested && chapters.some((chapter) => String(chapter.chapter_id).toLowerCase() === requested)) return requested;
  const active = asObject(result.book?.active_chapter_json).chapter_id;
  if (active && chapters.some((chapter) => chapter.chapter_id === active)) return active;
  const resumable = chapters.find((chapter) => deductionCommandAction(chapter) === "resume");
  if (resumable) return resumable.chapter_id;
  const startable = chapters.find((chapter) => deductionCommandAction(chapter) === "start");
  if (startable) return startable.chapter_id;
  return chapters.length === 1 ? chapters[0].chapter_id : null;
}

function chooseInitialParticle(chapter) {
  const records = chapterRecords(chapter);
  const currentId = deductionDisplayProgress(chapter).current_particle_id;
  if (currentId && records.some((record) => record?.particle_id === currentId)) return currentId;
  return records.length === 1 ? records[0]?.particle_id || null : null;
}

function renderCurrentParticle(runtime, chapter, record) {
  const target = section(runtime.root, "current-particle");
  if (!target) return;
  const doc = target.ownerDocument;
  const progress = deductionDisplayProgress(chapter);
  const records = chapterRecords(chapter);
  const current = firstPresent(progress, ["current_particle_index"]);
  const heading = createNode(doc, "div", "flex items-center gap-3 mb-3");
  const grainIcon = createNode(doc, "div", "w-9 h-9 rounded-lg bg-base-100 border border-base-300 flex items-center justify-center text-base-content");
  grainIcon.append(icon(doc, "grain", "text-[18px]"));
  const title = createNode(doc, "div", "flex-1");
  const titleRow = createNode(doc, "div", "flex items-center gap-3");
  titleRow.append(createNode(doc, "h3", "text-[13px] font-bold text-base-content", "当前颗粒"));
  const particleLabel = createNode(doc, "span", "text-[11px] text-base-content font-bold", displayText(record?.particle_id, "请选择颗粒"));
  particleLabel.id = "current-particle-label";
  particleLabel.dataset.particleCurrent = "";
  titleRow.append(particleLabel);
  if (record) titleRow.append(createNode(doc, "span", "badge badge-sm badge-outline", statusLabel(record.particle_status)));
  title.append(titleRow);
  const pointer = present(current) ? `进度 ${current} / ${records.length}` : `${records.length} 个颗粒`;
  heading.append(grainIcon, title, createNode(doc, "span", "text-[10px] text-base-content/60", pointer));

  const grid = createNode(doc, "div", "grid grid-cols-3 gap-3");
  const cards = [
    ["颗粒类型", firstPresent(record, ["type", "particle_type"])],
    ["颗粒目标", firstPresent(record, ["purpose", "staged_task"])],
    ["颗粒内容", firstPresent(record, ["content", "description"])],
  ];
  for (const [label, value] of cards) {
    const card = createNode(doc, "div", "ui-data-cell border-base-300 bg-base-200 p-2.5");
    card.append(
      createNode(doc, "span", "text-[10px] text-base-content/45 block mb-1", label),
      createNode(doc, "span", "text-[10px] text-base-content/75 leading-relaxed block", displayText(value, record ? "未提供" : "选择颗粒后查看")),
    );
    grid.append(card);
  }
  target.replaceChildren(heading, grid);
}

function renderParticlePanel(runtime, chapter) {
  const panel = runtime.root.querySelector("#content-panel-1");
  if (!panel) return;
  const doc = panel.ownerDocument;
  const records = chapterRecords(chapter);
  const list = createNode(doc, "div", "space-y-2");
  if (!records.length) {
    list.append(createNode(doc, "p", "text-[11px] text-base-content/60 py-6 text-center", "候选版本尚未返回颗粒记录。"));
  }
  records.forEach((record, index) => {
    const id = displayText(record?.particle_id, `颗粒 ${index + 1}`);
    const button = createNode(doc, "button", "deduction-particle-row flex w-full items-center gap-3 p-3 rounded-box bg-base-200 border border-base-300 text-left");
    button.type = "button";
    button.dataset.particle = id;
    button.setAttribute("aria-current", String(runtime.selectedParticleId === record?.particle_id));
    button.append(
      createNode(doc, "span", "text-[11px] font-semibold text-base-content shrink-0", id),
      createNode(doc, "span", "text-[10px] text-base-content/65 flex-1", displayText(firstPresent(record, ["purpose", "content"]), "未提供颗粒摘要")),
      createNode(doc, "span", "badge badge-xs badge-outline", statusLabel(record?.particle_status)),
    );
    button.addEventListener("click", () => {
      runtime.selectedParticleId = record?.particle_id || null;
      renderDeductionProjection(runtime);
    });
    list.append(button);
  });
  panel.replaceChildren(list);
}

function renderCharacterPanel(runtime) {
  const panel = runtime.root.querySelector("#content-panel-2");
  if (!panel) return;
  const doc = panel.ownerDocument;
  const list = createNode(doc, "div", "space-y-3");
  const characters = asArray(runtime.result.characters);
  if (!characters.length) {
    list.append(createNode(doc, "p", "text-[11px] text-base-content/60 py-6 text-center", "当前章节未返回可展示的角色活态。"));
  }
  for (const character of characters) {
    const name = displayText(firstPresent(character, ["name", "display_name", "char_name", "char_code"]), "未命名角色");
    const card = createNode(doc, "article", "bg-base-200 border border-base-300 rounded-box p-4");
    const row = createNode(doc, "div", "flex items-center gap-3 mb-3 pb-2 border-b border-base-300");
    const avatar = createNode(doc, "div", "w-10 h-10 rounded-full bg-base-100 border border-base-300 flex items-center justify-center text-base-content font-bold shrink-0 text-[14px]", name.slice(0, 1));
    const heading = createNode(doc, "div", "flex-1");
    heading.append(
      createNode(doc, "div", "text-[13px] font-medium text-base-content", name),
      createNode(doc, "div", "text-[11px] text-base-content/60", displayText(firstPresent(character, ["char_type", "role_type"]), "角色类型未提供")),
    );
    row.append(avatar, heading);
    const details = createNode(doc, "div", "pl-12 grid gap-1.5 text-[10px] text-base-content/75");
    details.append(
      createNode(doc, "p", "", `当前目标：${displayText(character.current_goal_txt)}`),
      createNode(doc, "p", "", `情绪标签：${displayText(character.current_emo_tag)}`),
      createNode(doc, "p", "", `压力等级：${displayText(character.pressure_level)}`),
    );
    card.append(row, details);
    list.append(card);
  }
  panel.replaceChildren(list);
}

function recordEvents(record) {
  return asArray(record?.events_in_round);
}

function eventDescription(event) {
  if (typeof event === "string") return event;
  return displayText(firstPresent(event, ["description", "summary", "surface_action"]), "事件描述未提供");
}

function chapterSummary(plot) {
  const summary = plot.chapter_summary;
  if (typeof summary === "string") return summary;
  return displayText(firstPresent(asObject(summary), ["summary", "synopsis", "description"]), "后端未返回章节级摘要。" );
}

function renderSummaryPanel(runtime, chapter) {
  const panel = runtime.root.querySelector("#content-panel-3");
  if (!panel) return;
  const doc = panel.ownerDocument;
  const plot = deductionDisplayPlot(chapter);
  const wrapper = createNode(doc, "div", "space-y-3");
  const summary = createNode(doc, "div", "bg-base-200 border border-base-300 rounded-box p-4");
  summary.append(
    createNode(doc, "h3", "text-[11px] font-semibold text-base-content mb-2", "章节完成摘要"),
    createNode(doc, "p", "text-[11px] text-base-content/75 leading-relaxed", chapterSummary(plot)),
  );
  wrapper.append(summary);
  const events = chapterRecords(chapter).flatMap(recordEvents);
  const list = createNode(doc, "div", "space-y-2");
  events.forEach((event, index) => {
    const item = createNode(doc, "div", "flex items-start gap-3 p-3 rounded-box bg-base-100 border border-base-300");
    item.append(
      createNode(doc, "span", "text-[11px] font-bold text-base-content/55", displayText(event?.event_id, `E${index + 1}`)),
      createNode(doc, "span", "text-[10px] text-base-content/75 flex-1", eventDescription(event)),
    );
    list.append(item);
  });
  if (!events.length) list.append(createNode(doc, "p", "text-[11px] text-base-content/60 py-4 text-center", "尚无已放行的颗粒事件摘要。"));
  wrapper.append(list);
  panel.replaceChildren(wrapper);
}

function setActiveView(root, active) {
  for (let index = 1; index <= 3; index += 1) {
    const node = root.querySelector(`#flow-node-${index}`);
    const iconNode = root.querySelector(`#node-icon-${index}`);
    const text = root.querySelector(`#node-text-${index}`);
    const panel = root.querySelector(`#content-panel-${index}`);
    const selected = index === active;
    node?.classList.toggle("opacity-50", !selected);
    node?.setAttribute("aria-selected", String(selected));
    panel?.classList.toggle("hidden", !selected);
    if (iconNode) iconNode.className = selected
      ? "w-8 h-8 rounded-full bg-base-content flex items-center justify-center text-base-100 text-[11px] shadow-sm"
      : "w-8 h-8 rounded-full bg-base-300 flex items-center justify-center text-base-content text-[11px]";
    if (text) text.className = selected
      ? "text-base-content text-[11px] font-medium text-center leading-tight"
      : "text-base-content opacity-60 text-[11px] font-medium text-center leading-tight";
  }
}

function renderControls(runtime, chapter) {
  const labels = ["颗粒进度", "角色活态", "完成摘要"];
  labels.forEach((label, offset) => {
    const index = offset + 1;
    const node = runtime.root.querySelector(`#flow-node-${index}`);
    const text = runtime.root.querySelector(`#node-text-${index}`);
    node?.removeAttribute("onclick");
    node?.setAttribute("role", "tab");
    node?.setAttribute("tabindex", "0");
    if (text) text.textContent = label;
    if (node && node.dataset.bound !== "true") {
      node.dataset.bound = "true";
      node.addEventListener("click", () => setActiveView(runtime.root, index));
      node.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setActiveView(runtime.root, index);
        }
      });
    }
  });
  setActiveView(runtime.root, 1);

  const progress = deductionDisplayProgress(chapter);
  setText(runtime.root, "[data-progress-label]", "颗粒");
  setText(runtime.root, "[data-progress-pointer]", displayText(progress.current_particle_index, "-"));
  setText(runtime.root, "[data-progress-total]", `/ ${chapterRecords(chapter).length}`);
  const serviceState = chapter?.runtime_service_state || runtime.result.book?.runtime_service_state || null;
  const exhaustedBudget = budgetExhausted(chapter);
  const controlMode = deductionControlMode(chapter, {
    commandError: runtime.commandError,
    pauseRequested: runtime.pauseRequested,
    pausePending: runtime.pausePending,
    commandPending: runtime.commandPending,
    serviceState,
  });
  const runStatus = runtime.root.querySelector("#deduction-run-status");
  if (runStatus) {
    const statusError = runtime.pauseError ?? runtime.commandError;
    const statusAction = runtime.pauseError ? "pause" : runtime.lastCommand;
    const hasStatusError = Boolean(statusError?.message);
    runStatus.textContent = exhaustedBudget && !hasStatusError
      ? "本次 L1A 推演预算已用尽，已保存的颗粒仅供查看。"
      : deductionRunStatusText(
        serviceState || chapter?.run_status || chapter?.status,
        chapter?.deduction_locked,
        statusError,
        statusAction,
      );
    runStatus.classList.toggle("text-error", hasStatusError);
    runStatus.setAttribute("aria-live", "polite");
    if (hasStatusError) runStatus.setAttribute("role", "alert");
    else runStatus.removeAttribute("role");
  }

  const pause = runtime.root.querySelector("#toggle-deduction-btn");
  if (pause) {
    pause.removeAttribute("onclick");
    pause.disabled = controlMode === "unavailable" || controlMode === "pause_requested";
    pause.dataset.commandAction = controlMode;
    pause.title = controlMode === "pause"
      ? "暂停会等待当前颗粒完成，并经 FP008-03/04 保存合法检查点"
      : controlMode === "pause_requested"
        ? "正在等待当前颗粒完成并保存可恢复检查点"
        : controlMode === "start"
        ? "开始当前 L1A 的多角色推演"
        : controlMode === "resume"
          ? "从已保存的合法检查点继续当前 L1A"
          : exhaustedBudget
            ? "本次 L1A 推演预算已用尽，不能再发起新模型调用。"
            : "中断会等待当前颗粒完成并经 FP008-03/04 保存合法检查点；继续从该检查点恢复。";
    pause.setAttribute("aria-disabled", String(pause.disabled));
  }
  setText(runtime.root, "#deduction-icon", controlMode === "pause" ? "pause" : controlMode === "pause_requested" ? "hourglass_top" : controlMode === "start" || controlMode === "resume" ? "play_arrow" : "pause");
  setText(runtime.root, "#deduction-text", controlMode === "pause"
    ? "暂停推演"
    : controlMode === "pause_requested"
      ? "正在等待当前颗粒完成"
      : controlMode === "start"
      ? "开始推演"
      : controlMode === "resume"
        ? "继续推演"
        : exhaustedBudget
          ? "本次预算已用尽"
          : "中断/继续不可用");
  const failureRecoveryAction = deductionFailureRecoveryAction(chapter, runtime.commandError);
  const replanAction = failureRecoveryAction === "restart" ? null : creatorReplanAction(chapter);
  const regenerate = runtime.root.querySelector('[data-action="regenerate-deduction"]');
  if (regenerate) {
    regenerate.disabled = (failureRecoveryAction !== "restart" && replanAction !== "replan")
      || runtime.commandPending === true;
    regenerate.removeAttribute("onclick");
    regenerate.title = failureRecoveryAction === "restart"
      ? "模型连续调用失败；重新开始会从当前 L1A 的第一个颗粒运行，预算从零累计。"
      : replanAction === "replan"
        ? "提交方向后，系统会从当前 L1A 的第一个颗粒重新推演。"
        : "请先暂停或完成至少一个已保存的推演检查点。";
    regenerate.setAttribute("aria-disabled", String(regenerate.disabled));
  }
  const submit = runtime.root.ownerDocument.querySelector("#submit-replan-btn");
  if (submit) {
    const mode = submit.dataset.replanMode;
    const submitAction = mode === "technical"
      ? failureRecoveryAction
      : mode === "creator"
        ? replanAction
        : null;
    submit.disabled = submitAction !== "restart" && submitAction !== "replan" || runtime.commandPending === true;
    submit.removeAttribute("onclick");
    submit.textContent = mode === "creator" ? "提交方向并重新推演" : "重新开始";
    submit.title = submitAction === "restart"
      ? "从当前 L1A 的第一个颗粒重新开始推演。"
      : submitAction === "replan"
        ? "提交方向后开始当前 L1A 的整段重推。"
        : "当前状态不能提交重新推演。";
    submit.setAttribute("aria-disabled", String(submit.disabled));
  }
}

function startDeduction(runtime) {
  const chapter = selectedChapter(runtime);
  const action = deductionCommandAction(chapter);
  if (!action || runtime.commandPending === true) return;
  runtime.commandPending = true;
  runtime.pausePending = false;
  runtime.pauseRequested = false;
  runtime.pauseError = null;
  runtime.commandError = null;
  runtime.lastCommand = action;
  renderControls(runtime, chapter);
  schedulePolling(runtime);
  const endpoint = runtime.commandEndpoint || "http://127.0.0.1:5678/webhook/production_stage";
  void sendDeductionCommand(runtime.context, action, { fetchImpl: runtime.fetchImpl, endpoint })
    .catch((error) => {
      runtime.commandError = error;
      if (deductionFailureRecoveryAction(chapter, runtime.commandError) === "restart") {
        setDeductionContentVisible(runtime.root, true);
        return;
      }
      if (deductionResumeAfterError(chapter, runtime.commandError)) {
        runtime.root.querySelector("#deduction-state-overlay")?.remove();
        setDeductionContentVisible(runtime.root, true);
        return;
      }
      showState(runtime.root, "error", {
        detail: error?.message || "推演服务未能接受当前 L1A。",
        retry: () => {
          runtime.root.querySelector("#deduction-state-overlay")?.remove();
          setDeductionContentVisible(runtime.root, true);
          startDeduction(runtime);
        },
      });
    })
    .finally(() => {
      runtime.commandPending = false;
      runtime.pausePending = false;
      runtime.pauseRequested = false;
      runtime.pauseError = null;
      renderControls(runtime, selectedChapter(runtime));
      if (deductionFailureRecoveryAction(selectedChapter(runtime), runtime.commandError) === "restart") {
        openFailureRecoveryModal(runtime);
      }
      if (runtime.commandError) {
        stopPolling(runtime);
        void loadProjection(runtime, { background: true });
      } else if (!runtime.reviewNavigationStarted) {
        loadProjection(runtime, { background: true, scheduleNext: true });
      }
    });
}

function closeReplanModal(runtime) {
  const modal = runtime.root.ownerDocument.querySelector("#regenerate-modal");
  if (!modal) return;
  modal.classList.remove("flex");
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  const submit = modal.querySelector("#submit-replan-btn");
  if (submit) delete submit.dataset.replanMode;
}

function openFailureRecoveryModal(runtime) {
  if (runtime.commandPending === true
    || deductionFailureRecoveryAction(selectedChapter(runtime), runtime.commandError) !== "restart") return;
  const doc = runtime.root.ownerDocument;
  const modal = doc.querySelector("#regenerate-modal");
  if (!modal) return;
  const heading = modal.querySelector("h3");
  const detail = modal.querySelector("p");
  const direction = modal.querySelector("#re-deduction-direction");
  if (heading) heading.textContent = "重新开始当前 L1A";
  if (detail) detail.textContent = "模型连续调用失败。未保存的运行结果不会继续使用；将从第一个颗粒重新开始，本次预算从零累计。";
  if (direction) {
    direction.value = "";
    direction.hidden = true;
    direction.disabled = true;
    direction.setAttribute("aria-hidden", "true");
  }
  const submit = modal.querySelector("#submit-replan-btn");
  if (submit) submit.dataset.replanMode = "technical";
  modal.classList.remove("hidden");
  modal.classList.add("flex");
  modal.setAttribute("aria-hidden", "false");
  submit?.focus();
}

function openCreatorReplanModal(runtime) {
  const chapter = selectedChapter(runtime);
  if (runtime.commandPending === true || creatorReplanAction(chapter) !== "replan") return;
  const doc = runtime.root.ownerDocument;
  const modal = doc.querySelector("#regenerate-modal");
  if (!modal) return;
  const heading = modal.querySelector("h3");
  const detail = modal.querySelector("p");
  const direction = modal.querySelector("#re-deduction-direction");
  if (heading) heading.textContent = "重新推演当前 L1A";
  if (detail) detail.textContent = "提交方向后，会从第一个颗粒重新推演。已保存的推演结果将不再作为生产输入，本次预算从零累计。";
  if (direction) {
    direction.value = "";
    direction.hidden = false;
    direction.disabled = false;
    direction.removeAttribute("aria-hidden");
    direction.removeAttribute("aria-invalid");
  }
  const submit = modal.querySelector("#submit-replan-btn");
  if (submit) submit.dataset.replanMode = "creator";
  modal.classList.remove("hidden");
  modal.classList.add("flex");
  modal.setAttribute("aria-hidden", "false");
  direction?.focus();
}

function requestFailureRecovery(runtime) {
  const chapter = selectedChapter(runtime);
  const action = deductionFailureRecoveryAction(chapter, runtime.commandError);
  if (action !== "restart" || runtime.commandPending === true) return;
  closeReplanModal(runtime);
  runtime.commandPending = true;
  runtime.pausePending = false;
  runtime.pauseRequested = false;
  runtime.pauseError = null;
  runtime.commandError = null;
  runtime.lastCommand = action;
  renderControls(runtime, chapter);
  schedulePolling(runtime);
  const endpoint = runtime.commandEndpoint || "http://127.0.0.1:5678/webhook/production_stage";
  void sendDeductionCommand(runtime.context, action, { fetchImpl: runtime.fetchImpl, endpoint })
    .catch((error) => {
      runtime.commandError = error;
      if (deductionFailureRecoveryAction(chapter, runtime.commandError) === "restart") {
        setDeductionContentVisible(runtime.root, true);
        return;
      }
      showState(runtime.root, "error", {
        detail: error?.message || "重新开始当前 L1A 的请求未被推演服务接受。",
        retry: () => {
          runtime.root.querySelector("#deduction-state-overlay")?.remove();
          setDeductionContentVisible(runtime.root, true);
          requestFailureRecovery(runtime);
        },
      });
    })
    .finally(() => {
      runtime.commandPending = false;
      runtime.pausePending = false;
      runtime.pauseRequested = false;
      runtime.pauseError = null;
      renderControls(runtime, selectedChapter(runtime));
      if (deductionFailureRecoveryAction(selectedChapter(runtime), runtime.commandError) === "restart") {
        openFailureRecoveryModal(runtime);
      }
      if (!runtime.reviewNavigationStarted) loadProjection(runtime, { background: true, scheduleNext: true });
    });
}

function creatorReplanIdempotencyKey(runtime, direction) {
  if (runtime.creatorReplanDirection === direction && runtime.creatorReplanIdempotencyKey) {
    return runtime.creatorReplanIdempotencyKey;
  }
  const randomId = runtime.root.ownerDocument.defaultView?.crypto?.randomUUID?.();
  if (typeof randomId !== "string" || !randomId) {
    throw new DeductionDataError("IDEMPOTENCY_KEY_REQUIRED", "当前浏览器无法生成可重试标识，未提交重新推演。", 503);
  }
  runtime.creatorReplanDirection = direction;
  runtime.creatorReplanIdempotencyKey = `fp008-replan:${randomId}`;
  return runtime.creatorReplanIdempotencyKey;
}

function requestCreatorReplan(runtime) {
  const chapter = selectedChapter(runtime);
  if (creatorReplanAction(chapter) !== "replan" || runtime.commandPending === true) return;
  const modal = runtime.root.ownerDocument.querySelector("#regenerate-modal");
  const directionInput = modal?.querySelector("#re-deduction-direction");
  const direction = typeof directionInput?.value === "string" ? directionInput.value.trim() : "";
  if (!direction) {
    directionInput?.setAttribute("aria-invalid", "true");
    directionInput?.focus();
    return;
  }

  let idempotencyKey;
  try {
    idempotencyKey = creatorReplanIdempotencyKey(runtime, direction);
  } catch (error) {
    runtime.commandError = error;
    renderControls(runtime, chapter);
    return;
  }
  runtime.commandPending = true;
  runtime.pausePending = false;
  runtime.pauseRequested = false;
  runtime.pauseError = null;
  runtime.commandError = null;
  runtime.lastCommand = "replan";
  runtime.replanNavigationStarted = false;
  stopPolling(runtime, { abort: true });
  showState(runtime.root, "loading");
  renderControls(runtime, chapter);
  const endpoint = runtime.commandEndpoint || "http://127.0.0.1:5678/webhook/production_stage";
  void sendDeductionCommand(runtime.context, "replan", {
    fetchImpl: runtime.fetchImpl,
    endpoint,
    returnDirection: direction,
    idempotencyKey,
  })
    .then((payload) => {
      runtime.creatorReplanDirection = null;
      runtime.creatorReplanIdempotencyKey = null;
      closeReplanModal(runtime);
      navigateToCreatorReplanSuccessor(runtime, payload);
    })
    .catch((error) => {
      runtime.replanNavigationStarted = false;
      runtime.commandError = error;
      directionInput?.setAttribute("aria-invalid", "true");
    })
    .finally(() => {
      runtime.commandPending = false;
      runtime.pausePending = false;
      runtime.pauseRequested = false;
      runtime.pauseError = null;
      renderControls(runtime, selectedChapter(runtime));
      if (!runtime.reviewNavigationStarted && !runtime.replanNavigationStarted) {
        loadProjection(runtime, { background: true, scheduleNext: true });
      }
    });
}

function requestDeductionPause(runtime) {
  const chapter = selectedChapter(runtime);
  const serviceState = chapter?.runtime_service_state || runtime.result.book?.runtime_service_state || null;
  if (runtime.pausePending === true || runtime.pauseRequested === true) return;
  if (runtime.commandPending !== true && serviceState !== "running") return;
  runtime.pausePending = true;
  runtime.pauseError = null;
  renderControls(runtime, chapter);
  void sendDeductionPauseIntent(runtime.context, {
    fetchImpl: runtime.fetchImpl,
    endpoint: runtime.pauseEndpoint,
  })
    .then(() => {
      runtime.pauseRequested = true;
    })
    .catch((error) => {
      runtime.pauseError = error;
      runtime.pauseRequested = false;
    })
    .finally(() => {
      runtime.pausePending = false;
      renderControls(runtime, selectedChapter(runtime));
    });
}

function bindDeductionCommand(runtime) {
  const button = runtime.root.querySelector("#toggle-deduction-btn");
  if (!button || button.dataset.deductionCommandBound === "true") return;
  button.dataset.deductionCommandBound = "true";
  button.addEventListener("click", () => {
    const chapter = selectedChapter(runtime);
    const serviceState = chapter?.runtime_service_state || runtime.result.book?.runtime_service_state || null;
    if (runtime.commandPending === true || serviceState === "running") {
      requestDeductionPause(runtime);
      return;
    }
    startDeduction(runtime);
  });
}

function bindDeductionFailureRecovery(runtime) {
  const regenerate = runtime.root.querySelector('[data-action="regenerate-deduction"]');
  if (regenerate && regenerate.dataset.failureRecoveryBound !== "true") {
    regenerate.dataset.failureRecoveryBound = "true";
    regenerate.addEventListener("click", () => {
      if (deductionFailureRecoveryAction(selectedChapter(runtime), runtime.commandError) === "restart") {
        openFailureRecoveryModal(runtime);
        return;
      }
      openCreatorReplanModal(runtime);
    });
  }
  const submit = runtime.root.ownerDocument.querySelector("#submit-replan-btn");
  if (submit && submit.dataset.failureRecoveryBound !== "true") {
    submit.dataset.failureRecoveryBound = "true";
    submit.addEventListener("click", (event) => {
      event.preventDefault();
      if (submit.dataset.replanMode === "creator") requestCreatorReplan(runtime);
      else requestFailureRecovery(runtime);
    });
  }
  const dismiss = runtime.root.ownerDocument.querySelector('[data-action="close-replan"]');
  if (dismiss && dismiss.dataset.replanCloseBound !== "true") {
    dismiss.dataset.replanCloseBound = "true";
    dismiss.addEventListener("click", (event) => {
      event.preventDefault();
      closeReplanModal(runtime);
    });
  }
}

function renderTargets(runtime, chapter) {
  const target = section(runtime.root, "l1a-plan");
  if (!target) return;
  const doc = target.ownerDocument;
  const snapshot = asObject(chapter?.target_snapshot_json);
  const possible = [snapshot.goals, snapshot.core_goals, snapshot.target_items, snapshot.promises];
  const goals = possible.find(Array.isArray) || [];
  const header = createNode(doc, "div", "flex items-center gap-3 mb-3");
  const badge = createNode(doc, "div", "w-7 h-7 rounded-lg bg-base-100 border border-base-300 flex items-center justify-center text-base-content");
  badge.append(icon(doc, "task_alt"));
  header.append(badge, createNode(doc, "h3", "text-xs font-bold text-base-content tracking-normal", "本章目标与预算"));
  const list = createNode(doc, "div", "flex flex-col gap-1.5");
  goals.forEach((goal, index) => {
    const row = createNode(doc, "div", "flex items-center gap-3 p-2 rounded-box bg-base-100 border border-base-300");
    row.append(
      createNode(doc, "span", "text-[11px] text-base-content/45", String(index + 1)),
      createNode(doc, "span", "text-[10px] text-base-content/75 flex-1", displayText(firstPresent(asObject(goal), ["title", "content", "description", "goal"]) || goal)),
    );
    list.append(row);
  });
  if (!goals.length) list.append(createNode(doc, "p", "text-[10px] text-base-content/60 p-3 border border-base-300 rounded-box", "目标快照未提供可展示的目标数组。"));

  const progress = deductionDisplayProgress(chapter);
  const consumed = l1aTokenConsumed(chapter);
  const budget = Number(progress.token_budget || runtime.result.book?.token_budget);
  const budgetCard = createNode(doc, "div", "ui-data-cell border-base-300 bg-base-100 p-3 mt-3");
  const budgetRow = createNode(doc, "div", "flex items-center justify-between mb-2");
  budgetRow.append(
    createNode(doc, "span", "text-[11px] text-base-content/60", "当前 L1A 令牌消耗"),
    createNode(doc, "span", "text-[13px] font-bold text-base-content", Number.isFinite(consumed) ? consumed.toLocaleString("zh-CN") : "未提供"),
  );
  budgetCard.append(budgetRow);
  if (Number.isFinite(consumed) && Number.isFinite(budget) && budget > 0) {
    const bar = doc.createElement("progress");
    bar.className = "progress w-full";
    bar.max = budget;
    bar.value = consumed;
    budgetCard.append(bar, createNode(doc, "div", "mt-1 text-[11px] text-base-content/60 text-right", `预算 ${budget.toLocaleString("zh-CN")}`));
  } else {
    budgetCard.append(createNode(doc, "p", "text-[11px] text-base-content/55", "预算数据未完整返回。"));
  }
  target.replaceChildren(header, list, budgetCard);
}

function renderChapterList(runtime) {
  const target = section(runtime.root, "chapter-progress");
  if (!target) return;
  const doc = target.ownerDocument;
  const header = createNode(doc, "div", "flex items-center gap-3 mb-3");
  const badge = createNode(doc, "div", "w-7 h-7 rounded-lg bg-base-100 border border-base-300 flex items-center justify-center text-base-content");
  badge.append(icon(doc, "menu_book"));
  header.append(badge, createNode(doc, "h3", "text-xs font-bold text-base-content tracking-normal", "章节与推演进度"));
  const list = createNode(doc, "div", "flex flex-col gap-1.5");
  asArray(runtime.result.chapters).forEach((chapter) => {
    const selected = chapter.chapter_id === runtime.selectedChapterId;
    const button = createNode(doc, "button", "deduction-chapter-row flex items-center gap-3 p-2 rounded-box bg-base-100 border border-base-300 text-left");
    button.type = "button";
    button.dataset.chapterId = chapter.chapter_id;
    button.setAttribute("aria-current", String(selected));
    button.append(
      createNode(doc, "span", `status ${chapter.deduction_locked ? "status-success" : "status-neutral"}`),
      createNode(doc, "span", "text-[10px] text-base-content flex-1", `第 ${displayText(chapter.chapter_index, "-")} 章 ${displayText(chapter.title, "")}`.trim()),
      createNode(doc, "span", "badge badge-xs badge-outline", statusLabel(chapter.run_status || chapter.status, chapter.deduction_locked)),
    );
    button.addEventListener("click", () => {
      runtime.selectedChapterId = chapter.chapter_id;
      runtime.selectedParticleId = chooseInitialParticle(chapter);
      renderDeductionProjection(runtime);
    });
    list.append(button);
  });
  target.replaceChildren(header, list);
}

function diffItems(chapter, key) {
  return chapterRecords(chapter).flatMap((record) => {
    const value = record?.[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") return Object.entries(value).map(([name, detail]) => ({ name, detail }));
    return [];
  });
}

function renderGlobalChanges(runtime, chapter) {
  const target = section(runtime.root, "global-changes");
  if (!target) return;
  const doc = target.ownerDocument;
  const header = createNode(doc, "div", "flex items-center gap-3 mb-3");
  const badge = createNode(doc, "div", "w-7 h-7 rounded-lg bg-base-100 border border-base-300 flex items-center justify-center text-base-content");
  badge.append(icon(doc, "swap_horiz"));
  header.append(badge, createNode(doc, "h3", "text-xs font-bold text-base-content tracking-normal", "候选变化摘要"));
  const list = createNode(doc, "div", "flex flex-col gap-1 overflow-y-auto custom-scrollbar");
  const changes = [...diffItems(chapter, "state_diff"), ...diffItems(chapter, "relation_diff")];
  changes.forEach((change) => {
    const object = asObject(change);
    const subject = displayText(firstPresent(object, ["char_name", "character", "from", "name", "entity"]), "变化项");
    const detail = displayText(firstPresent(object, ["description", "change", "delta", "detail", "reason"]), typeof object.detail === "string" ? object.detail : "结构化变化已记录");
    const row = createNode(doc, "div", "flex items-start gap-2 p-2 rounded-lg border bg-base-100 border-base-300 text-[10px]");
    row.append(
      createNode(doc, "span", "text-base-content font-medium shrink-0", subject),
      createNode(doc, "span", "text-base-content/55 flex-1", detail),
    );
    list.append(row);
  });
  if (!changes.length) list.append(createNode(doc, "p", "text-[10px] text-base-content/60 p-3 border border-base-300 rounded-box", "候选快照尚未返回状态或关系变化。"));
  target.replaceChildren(header, list);
}

function renderNoChapter(runtime) {
  const doc = runtime.root.ownerDocument;
  for (const panel of ["#content-panel-1", "#content-panel-2", "#content-panel-3"]) {
    const node = runtime.root.querySelector(panel);
    node?.replaceChildren(createNode(doc, "p", "text-[11px] text-base-content/60 py-8 text-center", "请选择右侧章节查看真实推演数据。"));
  }
  renderCurrentParticle(runtime, null, null);
  renderControls(runtime, null);
  renderTargets(runtime, null);
  renderGlobalChanges(runtime, null);
}

function scrubPrototypeBusinessData(root) {
  const runtime = {
    root,
    result: { book: {}, chapters: [], characters: [] },
    selectedChapterId: null,
    selectedParticleId: null,
  };
  renderCurrentParticle(runtime, null, null);
  renderControls(runtime, null);
  renderParticlePanel(runtime, null);
  renderCharacterPanel(runtime);
  renderSummaryPanel(runtime, null);
  renderTargets(runtime, null);
  renderChapterList(runtime);
  renderGlobalChanges(runtime, null);
  bindReadonlyHeader(root, {});
  const bookLabel = root.ownerDocument.querySelector("[data-book-context]");
  if (bookLabel) bookLabel.textContent = "作品未确认";
  root.ownerDocument.querySelector("#toast-container")?.replaceChildren();
  const modal = root.ownerDocument.querySelector("#regenerate-modal");
  modal?.classList.add("hidden");
  modal?.classList.remove("flex");
  root.querySelectorAll("[data-static-mock]").forEach((node) => node.removeAttribute("data-static-mock"));
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
  if (runtime.reviewNavigationStarted) return;
  const view = runtime.root.ownerDocument.defaultView;
  if (!view || runtime.root.ownerDocument.hidden) return;
  runtime.pollTimer = view.setTimeout(async () => {
    runtime.pollTimer = null;
    await loadProjection(runtime, { background: true, scheduleNext: true });
  }, 5000);
}

function navigateToReviewWhenComplete(runtime) {
  const chapters = asArray(runtime.result.chapters);
  const complete = chapters.length > 0 && chapters.every(deductionReviewReady);
  if (!complete || runtime.reviewNavigationStarted) return false;
  const chapter = selectedChapter(runtime) || chapters[0];
  if (!chapter) return false;
  const destination = buildDeductionPageUrl(runtime.context.bookId, "deduction-review", {
    l1aUnitId: runtime.context.l1aUnitId,
    chapterId: chapter.chapter_id,
    chapterVersionId: chapter.candidate_version_id,
  });
  runtime.reviewNavigationStarted = true;
  stopPolling(runtime, { abort: true });
  if (typeof runtime.navigate === "function") runtime.navigate(destination);
  else if (typeof runtime.locationLike?.assign === "function") runtime.locationLike.assign(destination);
  else {
    runtime.reviewNavigationStarted = false;
    return false;
  }
  return true;
}

function navigateToCreatorReplanSuccessor(runtime, payload) {
  const destination = buildCreatorReplanSuccessorUrl(runtime.context, payload);
  runtime.replanNavigationStarted = true;
  stopPolling(runtime, { abort: true });
  if (typeof runtime.navigate === "function") {
    runtime.navigate(destination);
    return true;
  }
  if (typeof runtime.locationLike?.assign === "function") {
    runtime.locationLike.assign(destination);
    return true;
  }
  runtime.replanNavigationStarted = false;
  throw new DeductionDataError("NAVIGATION_UNAVAILABLE", "重新推演已返回后继候选，但当前页面无法切换到该候选。", 503);
}

function renderDeductionProjection(runtime) {
  const chapter = selectedChapter(runtime);
  bindBookContext(runtime);
  bindReadonlyHeader(runtime.root, asObject(runtime.result.book));
  renderChapterList(runtime);
  if (!chapter) {
    renderNoChapter(runtime);
    return;
  }

  if (runtime.selectedParticleId && !chapterRecords(chapter).some((record) => record?.particle_id === runtime.selectedParticleId)) {
    runtime.selectedParticleId = null;
  }
  const record = selectedParticle(runtime, chapter);
  renderCurrentParticle(runtime, chapter, record);
  renderControls(runtime, chapter);
  renderParticlePanel(runtime, chapter);
  renderCharacterPanel(runtime);
  renderSummaryPanel(runtime, chapter);
  renderTargets(runtime, chapter);
  renderGlobalChanges(runtime, chapter);
}

async function loadProjection(runtime, { background = false, scheduleNext = false } = {}) {
  runtime.controller?.abort();
  runtime.controller = new AbortController();
  if (!background) showState(runtime.root, "loading");
  try {
    const fetched = await fetchDeductionProjection(runtime.context, {
      fetchImpl: runtime.fetchImpl,
      endpointBase: runtime.endpointBase,
      signal: runtime.controller.signal,
    });
    const scoped = scopeDeductionProjection(runtime.context, fetched);
    const result = runtime.commandError ? deductionPersistedProjection(scoped.result) : scoped.result;
    runtime.context = scoped.context;
    const previousParticle = runtime.selectedParticleId;
    runtime.result = result;
    runtime.selectedChapterId = runtime.selectedChapterId && result.chapters.some((chapter) => chapter.chapter_id === runtime.selectedChapterId)
      ? runtime.selectedChapterId
      : chooseInitialChapter(result, runtime.context);
    const chapter = selectedChapter(runtime);
    runtime.selectedParticleId = chapter && chapterRecords(chapter).some((record) => record?.particle_id === previousParticle)
      ? previousParticle
      : chapter ? chooseInitialParticle(chapter) : null;

    runtime.root.querySelector("#deduction-state-overlay")?.remove();
    if (!result.chapters.length) {
      bindBookContext(runtime);
      bindReadonlyHeader(runtime.root, asObject(result.book));
      showState(runtime.root, "empty");
      if (scheduleNext) schedulePolling(runtime);
      return;
    }
    setDeductionContentVisible(runtime.root, true);
    runtime.root.dataset.pageState = "ready";
    renderDeductionProjection(runtime);
    if (navigateToReviewWhenComplete(runtime)) return;
    if (scheduleNext) schedulePolling(runtime);
  } catch (error) {
    if (error?.name === "AbortError") return;
    const contextError = error instanceof DeductionDataError && ["LOCAL_OPERATOR_REQUIRED", "BOOK_CONTEXT_REQUIRED"].includes(error.code);
    showState(runtime.root, contextError ? "context" : "error", {
      detail: error?.message,
      retry: contextError ? undefined : () => loadProjection(runtime, { scheduleNext: true }),
    });
  }
}

export async function bindDeductionPage({
  content,
  route,
  state = "normal",
  navigate,
  fetchImpl = globalThis.fetch,
  endpointBase = "/api/books",
  commandEndpoint = globalThis.window?.DEDUCTION_WEBHOOK_URL || "http://127.0.0.1:5678/webhook/production_stage",
  pauseEndpoint = globalThis.window?.FP008_SERVICE_URL || "http://127.0.0.1:4182/fp008-02",
  locationLike = globalThis.location,
  storage = globalThis.localStorage,
} = {}) {
  const doc = content?.ownerDocument || globalThis.document;
  const root = pageRoot(content, doc);
  if (!root) return false;
  ensurePageCss(doc);
  scrubPrototypeBusinessData(root);

  const forcedState = state === "normal" ? null : stateCopy[state] ? state : null;
  if (forcedState) {
    showState(root, forcedState);
    return true;
  }

  let context;
  try {
    context = await resolveDeductionContext({ route, locationLike, storage, fetchImpl });
  } catch (error) {
    const unavailableContext = error instanceof DeductionDataError
      && ["BOOK_CONTEXT_REQUIRED", "LOCAL_OPERATOR_REQUIRED"].includes(error.code);
    showState(root, unavailableContext ? "context" : "error", {
      detail: error.message,
      retry: unavailableContext ? undefined : () => bindDeductionPage({
        content, route, state: "normal", navigate, fetchImpl, endpointBase, locationLike, storage,
      }),
    });
    return false;
  }

  let runtime = pageRuntimes.get(root);
  if (!runtime) {
    runtime = { root, result: { book: {}, chapters: [], characters: [] } };
    pageRuntimes.set(root, runtime);
  }
  Object.assign(runtime, { context, navigate, fetchImpl, endpointBase, commandEndpoint, pauseEndpoint, locationLike });
  bindDeductionCommand(runtime);
  bindDeductionFailureRecovery(runtime);
  runtime.result = { book: { title: context.bookId }, chapters: [], characters: [] };
  bindBookContext(runtime);
  await loadProjection(runtime);
  schedulePolling(runtime);
  if (!runtime.lifecycleBound) {
    runtime.lifecycleBound = true;
    doc.addEventListener("visibilitychange", () => {
      if (doc.hidden) {
        stopPolling(runtime, { abort: true });
        return;
      }
      loadProjection(runtime, { background: true, scheduleNext: true });
    });
    doc.defaultView?.addEventListener("pagehide", () => stopPolling(runtime, { abort: true }), { once: true });
  }
  return true;
}

export async function renderPage(options) {
  return bindDeductionPage(options);
}

if (typeof window !== "undefined" && document.querySelector("#main-content")) {
  const state = new URLSearchParams(window.location.search).get("state") || "normal";
  bindDeductionPage({ state });
}

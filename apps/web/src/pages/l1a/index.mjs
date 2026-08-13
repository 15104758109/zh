import "../prototype/common/book-context.js";

const generateEndpoint = window.L1A_WEBHOOK_URL || "http://127.0.0.1:5678/webhook/generate_l1a";
const finalizeEndpoint = window.L1A_FINALIZE_WEBHOOK_URL || "http://127.0.0.1:5678/webhook/finalize_l1a";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const runtime = {
  activeId: null,
  book: null,
  chapters: [],
  characters: [],
  l1as: [],
  tab: "plot",
  sortDraft: null,
  sortBusy: false,
  mutationKeys: {
    generate: null,
    sort: null,
    finalize: null,
  },
};

// The prototype script is retained for its DOM and layout only. It must not seed
// business data before this module projects the scoped backend response.
window.l1aSettings = [];
window.activeL1aId = null;

function isUuid(value) {
  return typeof value === "string" && uuidPattern.test(value);
}

function currentBookContext() {
  return globalThis.ZHBookContext?.readMatchingBookContext?.({ requireRoute: true }) || null;
}

function correlation(prefix) {
  const suffix = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`.slice(0, 128);
}

function mutationKey(kind, prefix) {
  runtime.mutationKeys[kind] ||= correlation(prefix);
  return runtime.mutationKeys[kind];
}

function settleMutation(kind, error = null) {
  if (!error || error.code !== "L1A_SERVICE_UNAVAILABLE") runtime.mutationKeys[kind] = null;
}

function asText(value, fallback = "暂无数据") {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map((item) => asText(item, "")).filter(Boolean);
    return parts.length ? parts.join("\n") : fallback;
  }
  if (value && typeof value === "object") {
    const parts = Object.entries(value)
      .map(([key, item]) => {
        const text = asText(item, "");
        return text ? `${key}: ${text}` : "";
      })
      .filter(Boolean);
    return parts.length ? parts.join("\n") : fallback;
  }
  return fallback;
}

function findElement(selector) {
  return document.querySelector(selector);
}

function replaceText(selector, value) {
  const element = findElement(selector);
  if (element) element.textContent = value;
  return element;
}

function showState(kind, title, detail, retryable = false) {
  const overlay = findElement("#l1a-runtime-state");
  if (!overlay) return;
  overlay.hidden = kind === "ready";
  overlay.dataset.kind = kind;
  overlay.setAttribute("role", kind === "error" ? "alert" : "status");
  replaceText("#l1a-runtime-state-title", title);
  replaceText("#l1a-runtime-state-detail", detail);
  const retry = findElement("#l1a-runtime-state-retry");
  if (retry) retry.hidden = !retryable;
}

function showToast(title, message, type = "info") {
  const container = findElement("#toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast-item toast-${type}`;

  const icon = document.createElement("span");
  icon.className = "material-symbols-outlined shrink-0 text-lg mt-0.5";
  icon.textContent = type === "success" ? "check_circle" : type === "error" ? "error" : type === "warning" ? "warning" : "info";

  const toastContent = document.createElement("div");
  toastContent.className = "flex-1 min-w-0";
  const heading = document.createElement("div");
  heading.className = "text-xs font-bold text-base-content mb-0.5";
  heading.textContent = title;
  const detail = document.createElement("div");
  detail.className = "text-[10px] text-base-content opacity-50 leading-relaxed";
  detail.textContent = message;
  toastContent.append(heading, detail);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "text-base-content opacity-40 hover:text-base-content transition-colors shrink-0 self-start";
  close.setAttribute("aria-label", "关闭提示");
  close.textContent = "x";
  close.addEventListener("click", () => toast.remove());

  const progress = document.createElement("div");
  progress.className = "absolute bottom-0 left-0 h-0.5 bg-current animate-[toast-progress_3s_linear_forwards] w-full";
  toast.append(icon, toastContent, close, progress);
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("toast-show"));
  window.setTimeout(() => toast.remove(), 3300);
}

function normalizedError(payload, fallback) {
  const error = payload?.redacted_error || payload?.error;
  return {
    code: error?.code || "L1A_UNAVAILABLE",
    message: error?.message || fallback,
  };
}

function readableFailure(error, fallback) {
  const messages = {
    CANDIDATE_INCOMPLETE: "生成结果缺少必要承诺字段，未保存任何候选。",
    CONFIG_CONTRACT_BLOCKED: "当前 FP004-01 运行配置尚未就绪，不能发起冲突遍历。",
    CONTEXT_UNAVAILABLE: "当前作品的冲突遍历上下文暂时不可用。",
    L1A_LOCKED: "三线排序已确认，L1A 设计已锁定为只读。",
    L1A_SERVICE_UNAVAILABLE: "L1A 服务暂不可用，请稍后重试。",
    GENERATE_RESPONSE_INCOMPLETE: "生成响应未确认已保存的候选，页面没有显示成功。",
    READ_FAILED: "当前作品的 L1A 数据暂时无法读取。",
    SCOPE_REJECTED: "当前作品不可用，请从作品工作流重新进入。",
    UPSTREAM_INCOMPLETE: "请先完成世界设定和角色设定确认，再发起冲突遍历。",
    SORT_OUTPUT_INVALID: "三线排序结果不完整，未改变当前候选顺序。",
    SORT_FAILED: "三线排序未完成，请稍后重试。",
    SORT_WRITE_REJECTED: "完整排序修订未能保存，当前候选保持原状。",
    L1A_PLAN_INCOMPLETE: "当前排序没有覆盖全部候选，请重新执行三线排序。",
    DESIGN_STATE_CHANGED: "世界或角色设定已变化，请重新执行三线排序后再确认。",
    L1A_REJECTED: "当前排序包含不可确认的候选，请重新载入后再试。",
    WRITE_FAILED: "L1A 锁定未完成，当前设计仍可继续检查。",
  };
  if (!error) return fallback;
  if (messages[error.code]) return messages[error.code];
  if (error.message === "L1A_SERVICE_UNAVAILABLE") return fallback;
  return error.message || fallback;
}

async function post(endpoint, payload, { timeoutMs = 12000 } = {}) {
  let response;
  const controller = timeoutMs > 0 ? new AbortController() : null;
  const timeout = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
      ...(controller ? { signal: controller.signal } : {}),
    });
  } catch {
    const failure = new Error("L1A_SERVICE_UNAVAILABLE");
    failure.code = "L1A_SERVICE_UNAVAILABLE";
    throw failure;
  } finally {
    if (timeout !== null) window.clearTimeout(timeout);
  }

  const result = await response.json().catch(() => null);
  if (!response.ok || result?.ok !== true) {
    const error = normalizedError(result, "L1A 服务暂不可用，请稍后重试。");
    const failure = new Error(error.message);
    failure.code = error.code;
    throw failure;
  }
  return result;
}

function candidateStatus(l1a) {
  if (l1a.is_locked) return "已锁定";
  if (l1a.is_formal) return "已确认";
  if (l1a.source_type === "traversal") return "遍历候选";
  if (l1a.source_type === "manual") return "手动候选";
  return "候选";
}

function mapL1a(row, characters, chapters) {
  const participantIds = Array.isArray(row.participant_chars_json) ? row.participant_chars_json.map(String) : [];
  const byId = new Map(characters.map((item) => [String(item.id), item]));
  const rowCharacters = participantIds.map((id) => byId.get(id)).filter(Boolean);
  const rowChapters = chapters.filter((chapter) => String(chapter.l1a_unit_id) === String(row.id));
  const wordCount = rowChapters.reduce((total, chapter) => total + (Number.isFinite(Number(chapter.word_count)) ? Number(chapter.word_count) : 0), 0);
  return {
    raw: row,
    id: String(row.id),
    label: `L1A-${String(row.l1a_index ?? "-").padStart(3, "0")}`,
    title: asText(row.l1a_name, "未命名剧情段"),
    summary: asText(row.conflict_background),
    consequence: asText(row.irreversible_consequence),
    worldProgression: asText(row.world_progress_json, "暂无已确认世界推进"),
    milestoneTasks: asText(row.mid_goals, "暂无大事记忆"),
    plotContent: asText(row.plot_emotion_commit, "暂无情节承诺"),
    emotionContent: asText(row.emotion_type || row.plot_emotion_commit, "暂无情绪承诺"),
    characterContent: asText(row.role_arc_json || row.arc_requirement, "暂无角色弧光承诺"),
    isLocked: row.is_locked === true,
    isCandidate: row.is_formal !== true,
    status: candidateStatus(row),
    characters: rowCharacters,
    chapters: rowChapters,
    wordCount,
  };
}

function activeL1a() {
  return runtime.l1as.find((item) => item.id === runtime.activeId) || null;
}

function createCard(l1a) {
  const card = document.createElement("div");
  const active = l1a.id === runtime.activeId;
  const locked = l1a.isLocked;
  card.className = `ui-l1a-card w-48 shrink-0 p-4 cursor-pointer flex flex-col gap-2 relative ${locked ? "is-locked" : "is-editable"}${active ? " is-active" : ""}`;
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-pressed", String(active));
  const select = () => {
    runtime.activeId = l1a.id;
    window.activeL1aId = l1a.id;
    render();
  };
  card.addEventListener("click", select);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select();
    }
  });

  const header = document.createElement("div");
  header.className = "flex justify-between items-center";
  const label = document.createElement("span");
  label.className = `text-[11px] font-bold font-sans ${locked ? "text-neutral" : "text-success"}`;
  label.textContent = l1a.label;
  const badge = document.createElement("span");
  badge.className = `ui-badge ${locked ? "ui-badge-dark" : "ui-badge-success"}`;
  const badgeIcon = document.createElement("span");
  badgeIcon.className = "material-symbols-outlined text-[10px]";
  badgeIcon.textContent = locked ? "lock" : "edit";
  badge.append(badgeIcon, document.createTextNode(l1a.status));
  header.append(label, badge);

  const title = document.createElement("div");
  title.className = "text-[13px] font-bold text-base-content truncate";
  title.textContent = l1a.title;
  const summary = document.createElement("div");
  summary.className = "text-[11px] text-base-content opacity-50 line-clamp-2 leading-relaxed h-[34px]";
  summary.textContent = l1a.summary;
  card.append(header, title, summary);
  return card;
}

function renderCards() {
  const cardList = findElement("#l1a-card-list");
  if (!cardList) return;
  cardList.replaceChildren(...runtime.l1as.map(createCard));

  const locked = runtime.l1as.some((item) => item.isLocked);
  if (!locked) {
    const traversal = document.createElement("button");
    traversal.id = "edit-commit-btn";
    traversal.type = "button";
    traversal.className = "ui-l1a-card w-48 shrink-0 p-4 border-dashed cursor-pointer flex flex-col items-center justify-center gap-2 relative";
    const hasBookContext = Boolean(currentBookContext());
    traversal.disabled = !hasBookContext;
    traversal.setAttribute("aria-disabled", String(!hasBookContext));
    if (!hasBookContext) {
      traversal.title = "请先从已创建的作品进入 L1A 设置";
      traversal.classList.add("opacity-50", "cursor-not-allowed");
    }
    const icon = document.createElement("span");
    icon.id = "edit-commit-icon";
    icon.className = "material-symbols-outlined text-[28px]";
    icon.textContent = "explore";
    const text = document.createElement("span");
    text.id = "edit-commit-text";
    text.className = "text-xs font-bold uppercase tracking-wider";
    text.textContent = "冲突遍历";
    traversal.append(icon, text);
    traversal.addEventListener("click", runTraversal);
    cardList.appendChild(traversal);
  }
}

function renderStatus(l1a) {
  const badge = findElement("#l1a-status-badge");
  if (badge) {
    badge.replaceChildren();
    const status = document.createElement("span");
    status.className = `ui-badge ${l1a.isLocked ? "ui-badge-error" : "ui-badge-primary"}`;
    const icon = document.createElement("span");
    icon.className = "material-symbols-outlined text-[10px]";
    icon.textContent = l1a.isLocked ? "lock" : "edit";
    status.append(icon, document.createTextNode(l1a.status));
    badge.appendChild(status);
  }

  const progress = findElement("#l1a-stars-val");
  if (progress) {
    progress.replaceChildren();
    const status = document.createElement("span");
    status.className = `text-[11px] font-bold ${l1a.chapters.length ? "text-success" : "text-base-content opacity-50"}`;
    status.textContent = l1a.chapters.length ? `${l1a.chapters.length} 个关联章节` : "尚未推演";
    progress.appendChild(status);
  }
}

function renderTabs(l1a) {
  const value = runtime.tab === "plot" ? l1a.plotContent : runtime.tab === "emotion" ? l1a.emotionContent : l1a.characterContent;
  replaceText("#l1a-detail-content-val", value);
  for (const tab of ["plot", "emotion", "character"]) {
    const button = findElement(`#tab-${tab}`);
    if (!button) continue;
    const active = tab === runtime.tab;
    button.className = active ? "ui-tab is-active" : "ui-tab";
    button.setAttribute("aria-selected", String(active));
  }
}

function renderChapters(l1a) {
  const heading = findElement("#l1a-chapters-section h3");
  if (heading) heading.textContent = `关联章节 (${l1a.chapters.length})`;
  const container = findElement("#l1a-chapters-list");
  if (!container) return;
  container.replaceChildren();
  if (!l1a.chapters.length) {
    const empty = document.createElement("div");
    empty.className = "text-[10px] text-base-content opacity-50";
    empty.textContent = "暂无关联章节";
    container.appendChild(empty);
    return;
  }
  for (const chapter of l1a.chapters) {
    const row = document.createElement("div");
    row.className = "ui-data-cell p-3";
    const title = document.createElement("div");
    title.className = "text-xs font-bold text-base-content/95";
    title.textContent = `第${chapter.chapter_index ?? "-"}章：${asText(chapter.title, "未命名章节")}`;
    const detail = document.createElement("div");
    detail.className = "text-[10px] text-base-content opacity-50 mt-1";
    detail.textContent = chapter.formal_summary ? asText(chapter.formal_summary) : `状态: ${asText(chapter.status, "未知")}`;
    row.append(title, detail);
    container.appendChild(row);
  }
}

function renderCharacters(l1a) {
  const container = findElement("#l1a-characters-list");
  if (!container) return;
  container.replaceChildren();
  if (!l1a.characters.length) {
    const empty = document.createElement("div");
    empty.className = "text-xs text-base-content opacity-50 italic py-2 text-center w-full";
    empty.textContent = "暂无场景人物";
    container.appendChild(empty);
    return;
  }
  for (const character of l1a.characters) {
    const row = document.createElement("div");
    row.className = "ui-scene-row";
    const avatar = document.createElement("div");
    avatar.className = "w-10 h-10 rounded-full border border-base-content/5 bg-neutral text-neutral-content shrink-0 grid place-items-center text-xs font-bold";
    avatar.textContent = asText(character.char_name, "?").slice(0, 1);
    const body = document.createElement("div");
    body.className = "flex-1 min-w-0";
    const name = document.createElement("div");
    name.className = "text-xs font-bold text-base-content truncate";
    name.textContent = asText(character.char_name, "未命名角色");
    const role = document.createElement("div");
    role.className = "text-[10px] text-base-content opacity-50 truncate";
    role.textContent = asText(character.char_type, "参与角色");
    body.append(name, role);
    row.append(avatar, body);
    container.appendChild(row);
  }
}

function renderDetails() {
  const l1a = activeL1a();
  const detail = findElement("#l1a-detail-section");
  if (!l1a) {
    if (detail) detail.classList.add("opacity-50");
    replaceText("#l1a-id-val", "L1A");
    replaceText("#l1a-title-val", "暂无 L1A 条目");
    replaceText("#l1a-summary-val", "当前作品尚无可显示的 L1A 条目。");
    replaceText("#l1a-consequence-val", "暂无数据");
    replaceText("#l1a-world-val", "暂无数据");
    replaceText("#l1a-tasks-val", "暂无数据");
    replaceText("#l1a-detail-content-val", "暂无数据");
    replaceText("#l1a-wordcount-val", "0");
    const status = findElement("#l1a-status-badge");
    if (status) status.replaceChildren();
    const progress = findElement("#l1a-stars-val");
    if (progress) progress.textContent = "尚未推演";
    const chapterHeading = findElement("#l1a-chapters-section h3");
    if (chapterHeading) chapterHeading.textContent = "关联章节 (0)";
    const chapters = findElement("#l1a-chapters-list");
    if (chapters) chapters.replaceChildren();
    const characters = findElement("#l1a-characters-list");
    if (characters) characters.replaceChildren();
    return;
  }
  if (detail) detail.classList.remove("opacity-50");
  replaceText("#l1a-id-val", l1a.label);
  replaceText("#l1a-title-val", l1a.title);
  replaceText("#l1a-summary-val", l1a.summary);
  replaceText("#l1a-consequence-val", l1a.consequence);
  replaceText("#l1a-world-val", l1a.worldProgression);
  replaceText("#l1a-tasks-val", l1a.milestoneTasks);
  replaceText("#l1a-wordcount-val", l1a.wordCount.toLocaleString("zh-CN"));
  renderStatus(l1a);
  renderTabs(l1a);
  renderChapters(l1a);
  renderCharacters(l1a);
}

function render() {
  renderCards();
  renderDetails();
  renderSortControl();
}

function hasLockedPlan() {
  return runtime.book?.design_editable === false || runtime.l1as.some((item) => item.isLocked);
}

function setButtonDisabled(button, disabled) {
  if (!button) return;
  button.disabled = disabled;
  button.setAttribute("aria-disabled", String(disabled));
  button.classList.toggle("opacity-50", disabled);
  button.classList.toggle("cursor-not-allowed", disabled);
}

function renderSortReview() {
  const panel = findElement("#l1a-sort-review");
  if (!panel) return;
  const draft = runtime.sortDraft;
  panel.hidden = !draft;
  if (!draft) return;
  replaceText("#l1a-sort-review-status", "排序结果待创作者确认");
  const lines = draft.three_lines || {};
  replaceText(
    "#l1a-sort-review-lines",
    `时间线 ${lines.timeline?.length || 0} 项 · 故事线 ${lines.story?.length || 0} 项 · 人物线 ${lines.character?.length || 0} 项`,
  );
  const list = findElement("#l1a-sort-review-gaps");
  if (!list) return;
  list.replaceChildren();
  if (!draft.gaps.length) {
    const item = document.createElement("li");
    item.textContent = "未发现需要二次调整的结构缺口。";
    list.appendChild(item);
    return;
  }
  for (const gap of draft.gaps) {
    const item = document.createElement("li");
    item.textContent = `${asText(gap.summary, "结构缺口")}：${asText(gap.suggestion, "请检查当前排序")}`;
    list.appendChild(item);
  }
}

function renderSortControl() {
  const button = findElement("#triple-line-sort-btn");
  const icon = findElement("#triple-line-sort-icon");
  const text = findElement("#triple-line-sort-text");
  if (!button || !icon || !text) return;
  const locked = hasLockedPlan();
  if (locked) {
    icon.textContent = "lock";
    icon.classList.remove("animate-pulse");
    text.textContent = "L1A 已锁定";
    button.title = "剧情段承诺已经由创作者确认，当前页面只读。";
  } else if (runtime.sortDraft) {
    icon.textContent = "lock";
    icon.classList.remove("animate-pulse");
    text.textContent = "确认并锁定";
    button.title = "按当前排序正式锁定全部 L1A。";
  } else {
    icon.textContent = "density_medium";
    icon.classList.add("animate-pulse");
    text.textContent = runtime.sortBusy ? "正在排序" : "三线排序";
    button.title = "执行大事纪、前提、弧光、综合排序和缺口分析。";
  }
  setButtonDisabled(button, locked || runtime.sortBusy || runtime.l1as.length === 0);
  renderSortReview();
}

function bindCardListDrag() {
  const slider = findElement("#l1a-card-list");
  if (!slider || slider.dataset.dragBound === "true") return;
  slider.dataset.dragBound = "true";
  slider.style.cursor = "grab";
  slider.style.userSelect = "none";

  let dragging = false;
  let startX = 0;
  let startScrollLeft = 0;
  const stopDragging = () => {
    dragging = false;
    slider.style.cursor = "grab";
  };

  slider.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    dragging = true;
    slider.style.cursor = "grabbing";
    startX = event.pageX - slider.offsetLeft;
    startScrollLeft = slider.scrollLeft;
  });
  slider.addEventListener("mouseleave", stopDragging);
  window.addEventListener("mouseup", stopDragging);
  slider.addEventListener("mousemove", (event) => {
    if (!dragging) return;
    event.preventDefault();
    const walk = (event.pageX - slider.offsetLeft - startX) * 2;
    slider.scrollLeft = startScrollLeft - walk;
  });
}

function disableUnsupportedControl(selector, reason) {
  const control = findElement(selector);
  if (!control) return;
  control.removeAttribute("onclick");
  control.disabled = true;
  control.setAttribute("aria-disabled", "true");
  control.title = reason;
  control.classList.add("opacity-50", "cursor-not-allowed");
}

function bindControls() {
  for (const tab of ["plot", "emotion", "character"]) {
    const button = findElement(`#tab-${tab}`);
    if (!button) continue;
    button.removeAttribute("onclick");
    button.onclick = () => {
      runtime.tab = tab;
      const l1a = activeL1a();
      if (l1a) renderTabs(l1a);
    };
  }

  disableUnsupportedControl("#delete-current-l1a-btn", "候选删除尚无已接入的稳定工作流，不能伪造删除成功。");
  disableUnsupportedControl("#generate-variant-btn", "生成变体尚无已接入的稳定返回合同，不能伪造候选。");
  disableUnsupportedControl("#add-character-to-l1a-btn", "场景人物编辑尚无已接入的稳定候选写入合同。");
  const sort = findElement("#triple-line-sort-btn");
  if (sort) sort.addEventListener("click", runSortOrFinalize);

  const retry = findElement("#l1a-runtime-state-retry");
  if (retry) retry.addEventListener("click", loadProjection);
}

function bindBookNavigation(bookId) {
  if (!isUuid(bookId)) return;
  const routes = new Map([
    ["workbench.html", `/workbench?book_id=${encodeURIComponent(bookId)}`],
    ["world-settings-drag-binding.html", `/books/${encodeURIComponent(bookId)}/world`],
    ["world_creator.html", `/books/${encodeURIComponent(bookId)}/world`],
    ["character_settings.html", `/books/${encodeURIComponent(bookId)}/characters`],
    ["l1a_settings.html", `/books/${encodeURIComponent(bookId)}/l1a`],
    ["production_stage.html", `/books/${encodeURIComponent(bookId)}/production`],
    ["audit_stage.html", `/books/${encodeURIComponent(bookId)}/audit`],
  ]);
  for (const link of document.querySelectorAll("a[href]")) {
    const route = routes.get(link.getAttribute("href"));
    if (route) link.setAttribute("href", route);
  }
}

async function runTraversal() {
  const context = currentBookContext();
  if (!context) {
    showToast("无法发起冲突遍历", "当前作品上下文不可用，请从作品工作流重新进入。", "error");
    return;
  }
  const { bookId, localOperatorId: operatorId } = context;

  const trigger = findElement("#edit-commit-btn");
  if (trigger) trigger.disabled = true;
  try {
    runtime.sortDraft = null;
    const response = await post(generateEndpoint, {
      action: "generate",
      local_operator_id: operatorId,
      book_id: bookId,
      correlation_id: correlation("l1a-generate"),
      idempotency_key: mutationKey("generate", "l1a-generate-key"),
    }, { timeoutMs: 0 });
    const candidateIds = response?.ids?.l1a_candidate_ids || response?.result?.ids?.l1a_candidate_ids;
    const created = Array.isArray(candidateIds) ? candidateIds.length : 0;
    if (!created) {
      const failure = new Error("生成响应未返回已保存候选的标识。");
      failure.code = "GENERATE_RESPONSE_INCOMPLETE";
      throw failure;
    }
    settleMutation("generate");
    showToast("冲突遍历完成", `已生成 ${created} 条候选 L1A。`, "success");
    await loadProjection();
  } catch (error) {
    settleMutation("generate", error);
    showToast("冲突遍历未完成", readableFailure(error, "L1A 候选未生成。"), "error");
    if (trigger) trigger.disabled = false;
  }
}

function validSortResult(result) {
  const expected = new Set(runtime.l1as.map((item) => item.id));
  const ordered = result?.ordered_l1a_ids;
  const lines = result?.three_lines;
  const revisions = result?.candidate_revisions;
  const revisionIds = Array.isArray(revisions) ? revisions.map((item) => item?.l1a_id) : [];
  return Array.isArray(ordered)
    && ordered.length === expected.size
    && new Set(ordered).size === expected.size
    && ordered.every((id) => expected.has(id))
    && Array.isArray(revisions)
    && revisions.length === expected.size
    && revisionIds.every((id, index) => id === ordered[index])
    && new Set(revisionIds).size === expected.size
    && new Set(revisions.map((revision) => revision?.l1a_index)).size === expected.size
    && revisions.every((revision) => Number.isInteger(revision?.l1a_index)
      && revision.l1a_index >= 0
      && revision.plot_emotion_commit && typeof revision.plot_emotion_commit === "object" && !Array.isArray(revision.plot_emotion_commit) && Object.keys(revision.plot_emotion_commit).length > 0
      && revision.arc_requirement && typeof revision.arc_requirement === "object" && !Array.isArray(revision.arc_requirement) && Object.keys(revision.arc_requirement).length > 0
      && Array.isArray(revision.participant_chars_json) && revision.participant_chars_json.length > 0
      && new Set(revision.participant_chars_json).size === revision.participant_chars_json.length
      && revision.participant_chars_json.every(isUuid))
    && /^[0-9a-f]{64}$/.test(result?.design_fingerprint || "")
    && /^[0-9a-f]{64}$/.test(result?.candidate_fingerprint || "")
    && lines && ["timeline", "story", "character"].every((key) => Array.isArray(lines[key]))
    && Array.isArray(result?.gaps);
}

function acceptedSortDraft(result) {
  if (!validSortResult(result)) return null;
  return {
    ordered_l1a_ids: [...result.ordered_l1a_ids],
    three_lines: result.three_lines,
    gaps: result.gaps,
    candidate_revisions: result.candidate_revisions,
    design_fingerprint: result.design_fingerprint,
    candidate_fingerprint: result.candidate_fingerprint,
  };
}

async function runSort() {
  if (runtime.sortBusy) return;
  const context = currentBookContext();
  if (!context || !runtime.l1as.length || hasLockedPlan()) {
    showToast("无法执行三线排序", "当前作品没有可排序的未锁定 L1A 候选。", "error");
    return;
  }
  const { bookId, localOperatorId: operatorId } = context;
  runtime.sortBusy = true;
  renderSortControl();
  try {
    const response = await post(finalizeEndpoint, {
      action: "sort",
      local_operator_id: operatorId,
      book_id: bookId,
      correlation_id: correlation("l1a-sort"),
      idempotency_key: mutationKey("sort", "l1a-sort-key"),
    }, { timeoutMs: 0 });
    const result = response.result;
    if (!validSortResult(result)) {
      const failure = new Error("三线排序返回了不完整的候选集合。");
      failure.code = "SORT_OUTPUT_INVALID";
      throw failure;
    }
    const byId = new Map(runtime.l1as.map((item) => [item.id, item]));
    const revisions = new Map(result.candidate_revisions.map((item) => [item.l1a_id, item]));
    runtime.l1as = result.ordered_l1a_ids.map((id) => {
      const current = byId.get(id);
      const revision = revisions.get(id);
      return mapL1a({
        ...current.raw,
        id,
        l1a_index: revision.l1a_index,
        plot_emotion_commit: revision.plot_emotion_commit,
        arc_requirement: revision.arc_requirement,
        participant_chars_json: revision.participant_chars_json,
      }, runtime.characters, runtime.chapters);
    });
    runtime.activeId = runtime.l1as.some((item) => item.id === runtime.activeId) ? runtime.activeId : runtime.l1as[0]?.id || null;
    runtime.sortDraft = acceptedSortDraft(result);
    settleMutation("sort");
    render();
    showToast("三线排序完成", "排序和缺口分析已展示；请检查后再次点击确认并锁定。", "success");
  } catch (error) {
    settleMutation("sort", error);
    runtime.sortDraft = null;
    showToast("三线排序未完成", readableFailure(error, "当前候选顺序未改变。"), "error");
  } finally {
    runtime.sortBusy = false;
    renderSortControl();
  }
}

async function runFinalize() {
  if (runtime.sortBusy) return;
  const context = currentBookContext();
  const draft = runtime.sortDraft;
  if (!draft || !context || hasLockedPlan()) return;
  const { bookId, localOperatorId: operatorId } = context;
  runtime.sortBusy = true;
  renderSortControl();
  try {
    const response = await post(finalizeEndpoint, {
      action: "finalize",
      local_operator_id: operatorId,
      book_id: bookId,
      correlation_id: correlation("l1a-finalize"),
      idempotency_key: mutationKey("finalize", "l1a-finalize-key"),
      ordered_l1a_ids: draft.ordered_l1a_ids,
      design_fingerprint: draft.design_fingerprint,
      candidate_fingerprint: draft.candidate_fingerprint,
    }, { timeoutMs: 0 });
    if (response?.state?.design_locked !== true) {
      const failure = new Error("锁定响应未确认设计已经冻结。");
      failure.code = "WRITE_FAILED";
      throw failure;
    }
    settleMutation("finalize");
    runtime.sortDraft = null;
    showToast("L1A 已锁定", "当前排序已正式确认，世界、角色和剧情段设计进入只读。", "success");
    await loadProjection();
  } catch (error) {
    settleMutation("finalize", error);
    showToast("L1A 未锁定", readableFailure(error, "请检查排序后重试。"), "error");
  } finally {
    runtime.sortBusy = false;
    renderSortControl();
  }
}

function runSortOrFinalize() {
  if (runtime.sortBusy) return;
  if (runtime.sortDraft) return runFinalize();
  return runSort();
}

async function loadProjection() {
  const main = findElement("#main-content");
  const context = currentBookContext();
  if (main) main.setAttribute("aria-busy", "true");
  runtime.l1as = [];
  runtime.activeId = null;
  runtime.sortDraft = null;
  window.l1aSettings = [];
  window.activeL1aId = null;
  render();

  if (!context) {
    showState("error", "作品上下文不可用", "请从作品工作流重新进入 L1A 设置。", false);
    if (main) main.removeAttribute("aria-busy");
    return;
  }
  const { bookId, localOperatorId: operatorId } = context;

  showState("loading", "正在载入 L1A", "正在读取当前作品的 L1A 承诺包。");
  try {
    const response = await post(generateEndpoint, {
      action: "read",
      local_operator_id: operatorId,
      book_id: bookId,
      correlation_id: correlation("l1a-read"),
    });
    const result = response.result || {};
    runtime.book = result.book || null;
    runtime.characters = Array.isArray(result.characters) ? result.characters : [];
    runtime.chapters = Array.isArray(result.chapters) ? result.chapters : [];
    runtime.l1as = (Array.isArray(result.l1as) ? result.l1as : [])
      .map((row) => mapL1a(row, runtime.characters, runtime.chapters))
      .sort((left, right) => Number(left.raw.l1a_index) - Number(right.raw.l1a_index));
    runtime.sortDraft = hasLockedPlan() ? null : acceptedSortDraft(result.sort_draft);
    runtime.activeId = runtime.l1as.some((item) => item.id === runtime.activeId) ? runtime.activeId : runtime.l1as[0]?.id || null;
    window.l1aSettings = runtime.l1as;
    window.activeL1aId = runtime.activeId;
    const header = findElement("#header-book-name");
    if (header) header.textContent = asText(runtime.book?.title, bookId);
    if (main) main.dataset.bookId = bookId;
    bindBookNavigation(bookId);
    render();
    if (runtime.l1as.length) showState("ready", "", "");
    else showState("empty", "暂无 L1A 条目", "当前作品尚无可显示的 L1A 条目。", true);
  } catch (error) {
    showState("error", "L1A 投影不可用", readableFailure(error, "当前作品的 L1A 数据暂时无法读取。"), true);
  } finally {
    if (main) main.removeAttribute("aria-busy");
  }
}

function initialize() {
  bindControls();
  bindCardListDrag();
  loadProjection();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
else initialize();

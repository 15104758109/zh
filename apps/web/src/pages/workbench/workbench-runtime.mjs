const endpoint = window.WORKBENCH_WEBHOOK_URL || "http://127.0.0.1:5678/webhook/workbench";
const contextKey = "current_book_context";
const operatorKey = "zhreplan.local_operator_id.v1";
const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const templateTypes = Object.freeze(["感性文字", "简单逻辑", "重复指令", "复杂任务", "客观公正"]);
const controlledCredentialReferences = Object.freeze(new Map([
  ["https://openrouter.ai/api/v1", "n8n-credential:openai-account-v1"],
  ["https://api.relaycove.com/v1", "n8n-credential:relaycove-v1"],
]));
const newBookDraftKey = "zhreplan.new_book_draft.v1";
const newBookDraftIdempotencyKey = "zhreplan.new_book_draft.idempotency_key.v1";
const newBookGenreTags = Object.freeze({
  "科幻": ["黑科技", "都市", "文明升级", "星际扩张", "AI", "人类对抗/共生", "末世", "重生", "系统", "基建"],
  "玄幻": ["东方玄幻", "废柴逆袭", "异世大陆", "王朝争霸", "系统", "高武", "重生"],
  "言情": [],
  "武侠": [],
  "恐怖": [],
  "同人": [],
});
const stageDefinitions = Object.freeze({
  "设计阶段": Object.freeze({ id: "design", header: "设计流程节点设置" }),
  "生产阶段": Object.freeze({ id: "production", header: "生产流程节点设置" }),
  "审计阶段": Object.freeze({ id: "audit", header: "审计流程节点设置" }),
  "迭代管理": Object.freeze({ id: "iteration", header: "迭代管理节点设置" }),
  "独立节点": Object.freeze({ id: "independent", header: "独立节点设置" }),
});
const bookStageLabels = Object.freeze({
  design: "设计阶段",
  production: "生产阶段",
  audit: "审计阶段",
  iteration: "迭代管理",
});

const state = {
  activeNodeId: "node-simulate",
  activeStage: "design",
  bookBanner: null,
  bookContextSource: null,
  bookId: null,
  editingPrompt: false,
  modelTestEvidenceId: "",
  modalTemplate: "复杂任务",
  operatorId: "",
  projection: emptyProjection(),
  promptEdit: null,
};

function emptyProjection() {
  return { prompts: [], model_templates: [], node_bindings: [], book: null, budget: null };
}

function isUuid(value) {
  return uuidPattern.test(String(value || ""));
}

function valueFromId(id) {
  return document.getElementById(id);
}

function text(id, value) {
  const element = valueFromId(id);
  if (!element) return;
  const content = String(value ?? "");
  element.textContent = content;
  if (element.hasAttribute("data-full-text")) element.title = content;
}

function readContext() {
  try {
    const context = JSON.parse(localStorage.getItem(contextKey) || "null");
    if (isUuid(context?.local_operator_id) && isUuid(context?.current_book_id)) {
      return {
        local_operator_id: context.local_operator_id.toLowerCase(),
        current_book_id: context.current_book_id.toLowerCase(),
      };
    }
  } catch {
    // A malformed context is never allowed to select a book.
  }
  return null;
}

function validBookIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const bookId = params.get("book_id");
  return isUuid(bookId) ? bookId.toLowerCase() : null;
}

function restoreBookContext(operatorId) {
  const requestedBookId = validBookIdFromQuery();
  if (requestedBookId) return { local_operator_id: operatorId, current_book_id: requestedBookId, source: "route" };
  const existing = readContext();
  if (existing?.local_operator_id === operatorId) return { ...existing, source: "storage" };
  return null;
}

class WorkbenchError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function resultEnvelope(payload) {
  if (payload && typeof payload === "object" && payload.result && typeof payload.result === "object" && "ok" in payload.result) return payload.result;
  return payload;
}

async function callWorkbench(payload) {
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new WorkbenchError("WORKBENCH_UNAVAILABLE", "本地配置服务的请求结果未知，请重新读取当前有效配置后再决定是否重试。");
  }

  const raw = await response.json().catch(() => null);
  const result = resultEnvelope(raw);
  if (!response.ok || result?.ok !== true) {
    throw new WorkbenchError(
      result?.error?.code || "WORKBENCH_UNAVAILABLE",
      result?.error?.message || "本地配置服务没有返回可确认结果；请求结果未知，请重新读取当前有效配置后再决定是否重试。",
      result?.details,
    );
  }
  return result;
}

function idempotencyKey(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function statusClass(kind) {
  return `ui-inline-status--${["loading", "ready", "empty", "blocked", "failure"].includes(kind) ? kind : "empty"}`;
}

function setStatus(kind, message) {
  const element = valueFromId("workbenchRuntimeState");
  if (!element) return;
  element.dataset.state = kind;
  element.classList.remove(
    "ui-inline-status--loading", "ui-inline-status--ready", "ui-inline-status--empty",
    "ui-inline-status--blocked", "ui-inline-status--failure",
  );
  element.classList.add(statusClass(kind));
  element.textContent = message;
}

function humanError(error) {
  const message = error?.message || "本地配置服务未完成本次操作。";
  const guidance = {
    EFFECTIVE_CONFIG_UNAVAILABLE: "这个流程步骤还没有完整的有效配置，所以系统不会启动它。请先准备对应 Prompt、模型模板和节点绑定。",
    SCOPE_REJECTED: "当前作品不属于这个本地创作空间，没有读取或修改任何配置。",
    CONNECTION_TEST_EVIDENCE_REQUIRED: "这项模型配置还没有对相同地址、模型和安全凭据完成成功验证，因此没有保存。",
    MODEL_TEMPLATE_UNAVAILABLE: "所选模板还没有已验证的有效模型配置，因此没有建立节点绑定。",
    PROMPT_CONFIG_UNAVAILABLE: "这个流程步骤还没有有效 Prompt，因此没有建立节点绑定。",
    BOOK_BANNER_UNAVAILABLE: "当前作品的横幅信息未能由本地服务确认，因此页面没有显示旧值或猜测内容。",
    READ_ONLY_CONFIG: "每次 L1A 推演的 10000000 预算是固定合同，只能查看，不能在这里修改。",
    WORKBENCH_UNAVAILABLE: "无法连接本地配置服务，未修改任何配置。",
  };
  return guidance[error?.code] || message;
}

function setDisabled(element, disabled, title = "") {
  if (!element) return;
  if ("disabled" in element) element.disabled = disabled;
  element.setAttribute("aria-disabled", String(disabled));
  if (disabled) {
    element.tabIndex = -1;
    element.classList.add("opacity-50", "cursor-not-allowed");
    element.style.pointerEvents = "none";
  } else {
    element.removeAttribute("tabindex");
    element.classList.remove("opacity-50", "cursor-not-allowed");
    element.style.pointerEvents = "";
  }
  if (title) element.title = title;
  else element.removeAttribute("title");
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function objectOrEmpty(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function activeNode() {
  return valueFromId(state.activeNodeId);
}

function activeNodeCode() {
  const node = activeNode();
  return node?.dataset.nodeCode || "";
}

function nodeRelationText(node = activeNode()) {
  return node?.dataset.relationText?.trim() || "";
}

function nodeConfigurationRestriction(node = activeNode()) {
  const relation = nodeRelationText(node);
  if (!node) {
    return "这张画布卡尚未对应一个唯一的可配置业务步骤。可以查看画布，但不会读取或修改 Prompt、模型绑定。";
  }
  if (node.dataset.contractState === "pending") {
    return `${relation || "这一步的执行合同尚未接入。"} 当前只能查看这一步与上下游的关系，不能配置或绑定 Prompt、模型。`;
  }
  if (node.dataset.contractState === "relation") {
    return `${relation || "这是一个人工闸门或受控写入关系。"} 它不是模型节点，不能配置或绑定 Prompt、模型。`;
  }
  if (node.dataset.referenceOnly === "true") {
    return `${relation || "这是停用的参考流程。"} 当前只能查看，不会读取或修改 Prompt、模型绑定。`;
  }
  if (!node.dataset.nodeCode) {
    return `${relation || "这张画布卡尚未对应一个唯一的可配置业务步骤。"} 为避免把错误配置用于创作流程，系统没有读取或修改 Prompt、模型绑定。`;
  }
  return "";
}

function canConfigureActiveNode() {
  return !nodeConfigurationRestriction();
}

function selectModalTemplate(templateType) {
  const nextTemplate = templateTypes.includes(templateType) ? templateType : templateTypes[0];
  if (state.modalTemplate !== nextTemplate) state.modelTestEvidenceId = "";
  state.modalTemplate = nextTemplate;
  return nextTemplate;
}

function findPrompt(nodeCode = activeNodeCode()) {
  return safeArray(state.projection.prompts).find((item) => item?.fp_target === nodeCode) || null;
}

function findBinding(nodeCode = activeNodeCode()) {
  return safeArray(state.projection.node_bindings).find((item) => item?.node_code === nodeCode) || null;
}

function findModel(templateType) {
  return safeArray(state.projection.model_templates).find((item) => item?.template_type === templateType) || null;
}

function sourceLabel(item) {
  if (!item?.source_config_id) return "未配置";
  return `${item.source_config_id} / v${item.version ?? "-"}`;
}

function displayProvider(providerBaseUrl) {
  if (!providerBaseUrl) return "未配置";
  try {
    return new URL(providerBaseUrl).host || providerBaseUrl;
  } catch {
    return providerBaseUrl;
  }
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatTokens(value) {
  const number = numberOrNull(value);
  return number === null ? "-" : new Intl.NumberFormat("zh-CN").format(number);
}

function budgetSummary() {
  const budget = state.projection.budget;
  const value = budget?.effective_value;
  if (!value) return "尚未选择作品；选择作品后会显示该作品固定的 L1A 推演预算。";
  return `固定 L1A 推演预算：${formatTokens(value.token_budget)}，当前 L1A 已使用 ${formatTokens(value.current_l1a_token_consumed)}，版本 ${value.token_budget_version || budget.version || "-"}，来源 ${budget.source_config_id || "-"}。该预算只读。`;
}

function nodeSummary() {
  const node = activeNode();
  const restriction = nodeConfigurationRestriction(node);
  const relation = nodeRelationText(node);
  if (restriction) return restriction;
  const nodeCode = activeNodeCode();
  const prompt = findPrompt(nodeCode);
  const binding = findBinding(nodeCode);
  const model = findModel(binding?.effective_value?.template_type);
  if (!prompt || !binding || !model) {
    return `${relation ? `${relation} ` : ""}当前步骤 ${nodeCode} 尚未形成完整有效配置。系统不会用原型默认值代替后端数据。`;
  }
  return `${relation ? `${relation} ` : ""}当前步骤 ${nodeCode}：Prompt ${sourceLabel(prompt)}；模型模板 ${sourceLabel(model)}；节点绑定 ${sourceLabel(binding)}。`;
}

function renderBookContext() {
  const selected = Boolean(state.bookId);
  const banner = state.bookBanner
    && isUuid(state.bookBanner.book_id)
    && state.bookBanner.book_id.toLowerCase() === state.bookId
    ? state.bookBanner
    : null;
  const title = banner?.title?.trim() || (selected ? "作品横幅未加载" : "未选择本地作品");
  const progressPercent = numberOrNull(banner?.progress_percent);
  const latestChapter = objectOrEmpty(banner?.latest_chapter);
  const latestSummary = typeof latestChapter.prose_summary === "string" && latestChapter.prose_summary.trim()
    ? latestChapter.prose_summary.trim()
    : "尚无正式章节摘要";

  text("header-book-name", title);
  text("currentBookTitle", title);
  text("currentBookGenre", banner?.genre_main || (selected ? "作品范围已载入" : "请先创建或选择作品"));
  text("currentBookState", banner ? bookStageLabel(banner.stage_code) : (selected ? "作品横幅未加载" : "尚无 current_book_context"));
  text("currentBookProgressText", formatProgress(progressPercent));
  text("currentBookChapter", formatLatestChapter(latestChapter));
  text("currentBookChapterSummary", latestSummary);
  text("currentBookAi", formatCount(banner?.formal_asset_count));
  text("currentBookWords", formatWords(banner?.formal_word_count));
  text("currentBookL1a", formatCount(banner?.formal_l1a_count));
  text("currentBookL1aTarget", banner?.planned_l1a_count === null || banner?.planned_l1a_count === undefined
    ? "目标未定义"
    : `/ ${formatCount(banner.planned_l1a_count)}`);
  const progress = valueFromId("currentBookProgressBar");
  if (progress) progress.style.width = `${Math.min(100, Math.max(0, progressPercent ?? 0))}%`;

  const bookTrigger = document.querySelector("#bookDropdownContainer > div[onclick]");
  if (bookTrigger) {
    bookTrigger.setAttribute("aria-disabled", "true");
    bookTrigger.tabIndex = -1;
    bookTrigger.style.cursor = "not-allowed";
    bookTrigger.style.pointerEvents = "none";
    bookTrigger.title = "当前接口尚未提供作品列表；请从作品页面选择后再回到总控设置。";
  }
}

function bookStageLabel(stageCode) {
  return bookStageLabels[stageCode] || (stageCode ? String(stageCode) : "状态未定义");
}

function formatCount(value) {
  const number = numberOrNull(value);
  return number === null ? "-" : new Intl.NumberFormat("zh-CN").format(number);
}

function formatWords(value) {
  const count = formatCount(value);
  return count === "-" ? "-" : `${count} 字`;
}

function formatProgress(value) {
  const number = numberOrNull(value);
  if (number === null) return "-";
  return `${Number.isInteger(number) ? number : number.toFixed(1)}%`;
}

function formatLatestChapter(latestChapter) {
  const chapterIndex = numberOrNull(latestChapter.chapter_index);
  if (chapterIndex === null) return "尚无正式章节";
  const chapterTitle = typeof latestChapter.title === "string" ? latestChapter.title.trim() : "";
  return chapterTitle ? `第${chapterIndex}章：${chapterTitle}` : `第${chapterIndex}章`;
}

function renderAutomation() {
  const config = state.projection.book?.effective_value;
  const hasSelectedBook = Boolean(state.bookId);
  const hasCompleteSnapshot = Boolean(
    config
    && typeof config.auto_production === "boolean"
    && typeof config.auto_audit === "boolean"
    && typeof config.auto_iteration === "boolean"
    && numberOrNull(config.presentation_intensity) !== null,
  );
  const title = !hasSelectedBook
    ? "请先从作品页面选择作品；未选择作品时不能修改自动化配置。"
    : hasCompleteSnapshot
      ? `当前作品自动化配置 ${sourceLabel(state.projection.book)}。开关由创作者显式保存；何时实际触发仍由后端流程决定。`
      : "当前作品缺少完整有效的自动化配置投影。可以查看或尝试开关；保存时会被阻断，页面不会补默认值或自动启用任何流程。";
  const switchValues = {
    auto_production: config?.auto_production === true,
    auto_audit: config?.auto_audit === true,
    auto_iteration: config?.auto_iteration === true,
  };
  for (const [key, enabled] of Object.entries(switchValues)) {
    const control = document.querySelector(`[data-key="${key}"]`);
    if (!control) continue;
    control.setAttribute("role", "switch");
    control.setAttribute("aria-checked", String(enabled));
    control.classList.toggle("active", enabled);
    control.classList.toggle("on", enabled);
    setDisabled(control, !hasSelectedBook, title);
  }
  const apply = document.querySelector("#quick-settings-popover .settings-btn");
  setDisabled(apply, true, hasCompleteSnapshot
    ? "开关更改会立即保存为完整配置版本；这里没有待应用的临时配置。"
    : title);
  setDisabled(document.querySelector("button[aria-label='通知中心']"), true, "当前没有通知中心数据合同。 ");
}

function renderTemplateOptions() {
  const select = valueFromId("workbenchTemplateSelect");
  if (!select) return;
  const binding = findBinding();
  const selected = templateTypes.includes(binding?.effective_value?.template_type)
    ? binding.effective_value.template_type
    : "";
  const unbound = Object.assign(document.createElement("option"), {
    value: "",
    textContent: "选择模板以绑定",
    disabled: true,
  });
  select.replaceChildren(unbound, ...templateTypes.map((name) => Object.assign(document.createElement("option"), { value: name, textContent: name })));
  select.value = selected;
  if (selected) selectModalTemplate(selected);
  const restriction = nodeConfigurationRestriction();
  setDisabled(select, Boolean(restriction), restriction);
}

function renderTemplateDetails() {
  const restriction = nodeConfigurationRestriction();
  if (restriction) {
    text("detailModelName", "不适用");
    text("detailProviderName", "仅查看关系");
    text("detailTemperature", "不适用");
    return;
  }
  const binding = findBinding();
  if (!binding?.effective_value?.template_type) {
    text("detailModelName", "未绑定");
    text("detailProviderName", "未配置");
    text("detailTemperature", "未绑定");
    return;
  }
  const templateType = binding?.effective_value?.template_type || state.modalTemplate;
  const model = findModel(templateType);
  const value = model?.effective_value || {};
  text("detailModelName", model ? `${value.model_name || "未配置"} · v${model.version ?? "-"}` : "未配置");
  text("detailProviderName", model ? displayProvider(value.provider_base_url) : "未配置");
  const temperature = numberOrNull(binding?.effective_value?.temperature);
  text("detailTemperature", temperature === null ? "未配置" : `${temperature} · ${sourceLabel(binding)}`);
}

function renderPrompt() {
  const editor = valueFromId("promptEditor");
  if (!editor || state.editingPrompt) return;
  const restriction = nodeConfigurationRestriction();
  const nodeCode = activeNodeCode();
  const prompt = findPrompt(nodeCode);
  editor.style.whiteSpace = "pre-wrap";
  editor.contentEditable = "false";
  editor.setAttribute("aria-readonly", "true");
  if (restriction) {
    editor.dataset.empty = "true";
    editor.textContent = restriction;
    return;
  }
  if (!prompt?.effective_value?.prompt_text) {
    editor.dataset.empty = "true";
    editor.textContent = "尚无 active Prompt；双击填写后可保存为新的 active 版本。";
    return;
  }
  delete editor.dataset.empty;
  editor.textContent = prompt.effective_value.prompt_text;
}

function renderNodeActionAvailability() {
  const restriction = nodeConfigurationRestriction();
  document.querySelectorAll(".open-modal-btn").forEach((button) => {
    setDisabled(button, Boolean(restriction), restriction);
  });
  if (restriction) valueFromId("modelSettingsModal")?.classList.add("hidden");
}

function renderModalTemplate(templateType = state.modalTemplate) {
  selectModalTemplate(templateType);
  const model = findModel(state.modalTemplate);
  const value = model?.effective_value || {};
  const binding = findBinding();
  const modelSelect = valueFromId("modalModelSelect");
  if (modelSelect) {
    modelSelect.value = value.model_name || "";
    modelSelect.placeholder = "输入本地凭据可测试的模型名称";
    setDisabled(modelSelect, false);
  }
  const provider = valueFromId("modalProviderInput");
  if (provider) {
    provider.value = displayProvider(valueFromId("modalBaseUrlInput")?.value || value.provider_base_url);
    provider.placeholder = "由当前模板连接地址派生";
    provider.readOnly = true;
    provider.setAttribute("aria-readonly", "true");
    provider.title = "运营商名称由当前模型模板的连接地址派生，不单独保存。";
  }
  const baseUrl = valueFromId("modalBaseUrlInput");
  if (baseUrl) {
    baseUrl.value = value.provider_base_url || "";
    baseUrl.readOnly = false;
    baseUrl.removeAttribute("aria-readonly");
    baseUrl.placeholder = "https://provider.example/v1";
    baseUrl.title = "地址变更后必须重新完成受控连接测试。";
  }
  const credential = valueFromId("modalApiKeyInput");
  if (credential) {
    credential.value = "";
    credential.placeholder = "由本地受控凭据保管，页面不显示或提交";
    setDisabled(credential, true, "密钥由本地受控凭据保管，页面不显示或提交；连接测试和模板保存由受控后端执行。 ");
  }
  setDisabled(valueFromId("toggleEyeBtn"), true, "页面不会读取或显示模型密钥。");
  const temperature = valueFromId("modalTempRange");
  const configuredTemperature = binding?.effective_value?.template_type === state.modalTemplate
    ? numberOrNull(binding.effective_value.temperature)
    : numberOrNull(value?.parameters_jsonb?.temperature);
  if (temperature) {
    temperature.value = String(configuredTemperature === null ? 0.7 : configuredTemperature);
    setDisabled(temperature, false);
  }
  text("tempValDisplay", temperature?.value || configuredTemperature || "0.7");
  setDisabled(valueFromId("modalReasoningSelect"), true, "当前稳定合同未定义可保存的推理强度档位。");
  setDisabled(valueFromId("fetchModelsBtn"), true, "当前没有受控模型目录合同，不能伪造模型清单。 ");
  setDisabled(valueFromId("testConnectionBtn"), false);
  setDisabled(valueFromId("saveModelConfigurationBtn"), false);
  document.querySelectorAll("button[onclick^='applyRecommendedModel'], #modalCategoryList button[data-add-category]").forEach((button) => {
    setDisabled(button, true, "当前不能用原型推荐或新增模板代替受控模型配置。");
  });
  const title = valueFromId("modalConfigTitle");
  if (title) {
    title.textContent = ` · ${state.modalTemplate}`;
    title.classList.remove("hidden");
  }
}

function controlledCredentialReferenceForProvider(providerBaseUrl) {
  try {
    const normalized = new URL(providerBaseUrl).href.replace(/\/$/u, "");
    return controlledCredentialReferences.get(normalized) || "";
  } catch {
    return "";
  }
}

function modelConnectionInput() {
  const providerBaseUrl = String(valueFromId("modalBaseUrlInput")?.value || "").trim();
  const modelName = String(valueFromId("modalModelSelect")?.value || "").trim();
  if (!providerBaseUrl || !modelName) {
    throw new WorkbenchError("INVALID_REQUEST", "请输入连接地址和模型名称后再测试。密钥继续由本地受控凭据保管。 ");
  }
  const apiKeyRef = controlledCredentialReferenceForProvider(providerBaseUrl);
  if (!apiKeyRef) {
    throw new WorkbenchError("INVALID_REQUEST", "该连接地址没有可用的本地受控凭据，未发起测试。 ");
  }
  return { provider_base_url: providerBaseUrl, model_name: modelName, api_key_ref: apiKeyRef };
}

function resetModelTestEvidence() {
  state.modelTestEvidenceId = "";
  const provider = valueFromId("modalProviderInput");
  if (provider) provider.value = displayProvider(valueFromId("modalBaseUrlInput")?.value);
}

function renderModalCategories(selected = state.modalTemplate) {
  const selectedTemplate = selectModalTemplate(selected);
  const container = valueFromId("modalCategoryList");
  if (!container) return;
  container.replaceChildren();
  for (const templateType of templateTypes) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.category = templateType;
    button.className = templateType === selectedTemplate
      ? "sidebar-item active w-full text-left px-3 py-2 text-xs font-semibold bg-primary text-primary-content rounded-md shadow-sm transition-all"
      : "sidebar-item w-full text-left px-3 py-2 text-xs font-semibold rounded-md opacity-70 hover:opacity-100 hover:bg-base-content/5 transition-all";
    button.textContent = templateType;
    button.addEventListener("click", () => {
      selectModalTemplate(templateType);
      renderModalCategories(templateType);
    });
    container.append(button);
  }
  const addContainer = document.createElement("div");
  addContainer.id = "addCategoryContainer";
  addContainer.className = "mt-1 pt-1.5 border-t border-dashed border-base-content/5";
  const add = document.createElement("button");
  add.type = "button";
  add.dataset.addCategory = "true";
  add.className = "w-full py-1.5 text-xs text-base-content opacity-50 border border-dashed border-base-content/5 rounded flex items-center justify-center gap-1 cursor-not-allowed";
  add.innerHTML = '<span class="material-symbols-outlined text-[14px]">add</span>新增种类';
  setDisabled(add, true, "统一配置只允许五个已批准的模板类型。 ");
  addContainer.append(add);
  container.append(addContainer);
  renderModalTemplate(selectedTemplate);
}

function render() {
  renderBookContext();
  renderAutomation();
  renderTemplateOptions();
  renderTemplateDetails();
  renderPrompt();
  renderNodeActionAvailability();
  syncNodeHighlight();
  if (!valueFromId("modelSettingsModal")?.classList.contains("hidden")) renderModalCategories(state.modalTemplate);
}

function setBookNavigation(bookId) {
  const routes = [
    ["设计阶段：世界设定、角色设定、L1A剧情段", "world"],
    ["生产阶段：章节推演、多代理执行", "production"],
    ["审计阶段：正文审计、主编裁决", "audit"],
    ["迭代管理：提示词优化、失败样本分析", "iteration"],
  ];
  for (const [label, segment] of routes) {
    const link = document.querySelector(`a[aria-label="${label}"]`);
    if (!link) continue;
    if (bookId) {
      link.href = `/books/${encodeURIComponent(bookId)}/${segment}`;
      link.removeAttribute("aria-disabled");
      link.removeAttribute("title");
      link.classList.remove("opacity-40", "pointer-events-none");
      continue;
    }
    link.removeAttribute("href");
    link.setAttribute("aria-disabled", "true");
    link.title = "请先选择作品";
    link.classList.add("opacity-40", "pointer-events-none");
  }
}

async function ensureLocalOperator() {
  const stored = localStorage.getItem(operatorKey);
  const context = readContext();
  const candidate = isUuid(stored) ? stored : context?.local_operator_id;
  const body = { action: "operator" };
  if (isUuid(candidate)) body.local_operator_id = candidate;
  try {
    const result = await callWorkbench(body);
    const operatorId = result?.local_operator_id || result?.result?.local_operator_id;
    if (!isUuid(operatorId)) throw new WorkbenchError("OPERATOR_SERVICE_UNAVAILABLE", "本地配置服务没有返回有效的创作空间标识。");
    state.operatorId = operatorId.toLowerCase();
    localStorage.setItem(operatorKey, state.operatorId);
    return state.operatorId;
  } catch {
    throw new WorkbenchError("OPERATOR_SERVICE_UNAVAILABLE", "无法恢复本地创作空间，未读取或修改任何配置。");
  }
}

async function loadBookBanner() {
  state.bookBanner = null;
  if (!state.bookId) return null;
  const result = await callWorkbench({
    action: "book_banner",
    local_operator_id: state.operatorId,
    book_id: state.bookId,
  });
  const banner = result?.book_banner;
  if (!banner || !isUuid(banner.book_id) || banner.book_id.toLowerCase() !== state.bookId) {
    throw new WorkbenchError("BOOK_BANNER_UNAVAILABLE", "本地配置服务没有返回当前作品的可用横幅投影。");
  }
  state.bookBanner = banner;
  return banner;
}

function persistVerifiedBookContext() {
  if (!state.bookBanner || !isUuid(state.bookBanner.book_id) || !isUuid(state.operatorId)) return;
  const verifiedBookId = state.bookBanner.book_id.toLowerCase();
  if (verifiedBookId !== state.bookId) return;
  localStorage.setItem(contextKey, JSON.stringify({
    local_operator_id: state.operatorId,
    current_book_id: verifiedBookId,
  }));
}

async function loadProjection({ retryWithoutBook = true } = {}) {
  setStatus("loading", "正在读取本地创作空间的当前有效配置…");
  try {
    const operatorId = await ensureLocalOperator();
    const context = restoreBookContext(operatorId);
    state.bookId = context?.current_book_id || null;
    state.bookContextSource = context?.source || null;
    if (state.bookId) document.body.dataset.currentBookId = state.bookId;
    else delete document.body.dataset.currentBookId;
    setBookNavigation(state.bookId);
    await loadBookBanner();
    persistVerifiedBookContext();
    const request = { action: "read", local_operator_id: operatorId };
    if (state.bookId) request.book_id = state.bookId;
    const result = await callWorkbench(request);
    state.projection = { ...emptyProjection(), ...(result.effective_config || {}) };
    render();
    const hasConfig = safeArray(state.projection.prompts).length
      || safeArray(state.projection.model_templates).length
      || safeArray(state.projection.node_bindings).length
      || state.projection.book
      || state.projection.budget;
    setStatus(
      hasConfig ? "ready" : "empty",
      `${nodeSummary()} ${budgetSummary()}`,
    );
    return true;
  } catch (error) {
    if ((error?.code === "SCOPE_REJECTED" || error?.code === "BOOK_BANNER_UNAVAILABLE") && state.bookId && retryWithoutBook) {
      if (state.bookContextSource === "storage") localStorage.removeItem(contextKey);
      state.bookId = null;
      state.bookContextSource = null;
      return loadProjection({ retryWithoutBook: false });
    }
    state.projection = emptyProjection();
    state.bookBanner = null;
    render();
    setStatus(error?.code === "CONFIG_CONTRACT_BLOCKED" ? "blocked" : "failure", humanError(error));
    return false;
  }
}

function notifyUnmappedNode() {
  setStatus("blocked", nodeConfigurationRestriction() || "这张画布卡尚未对应一个唯一的可配置业务步骤。为避免把错误的 Prompt 或模型用于创作流程，系统没有修改任何配置。");
}

function beginPromptEdit() {
  const editor = valueFromId("promptEditor");
  const nodeCode = activeNodeCode();
  if (!editor || state.editingPrompt) return;
  if (!nodeCode || !canConfigureActiveNode()) return notifyUnmappedNode();
  const prompt = findPrompt(nodeCode);
  state.editingPrompt = true;
  state.promptEdit = {
    nodeCode,
    originalText: prompt?.effective_value?.prompt_text || "",
  };
  if (editor.dataset.empty === "true") editor.textContent = "";
  editor.contentEditable = "true";
  editor.removeAttribute("aria-readonly");
  editor.classList.remove("border-base-content/5");
  editor.classList.add("border-primary", "ring-2", "ring-primary/20", "bg-base-100");
  editor.focus();
}

function promptEditorText(editor) {
  return editor.innerText.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function finishPromptEdit({ cancelled = false } = {}) {
  const editor = valueFromId("promptEditor");
  const edit = state.promptEdit;
  if (!editor || !edit || !state.editingPrompt) return;
  state.editingPrompt = false;
  state.promptEdit = null;
  editor.contentEditable = "false";
  editor.setAttribute("aria-readonly", "true");
  editor.classList.remove("border-primary", "ring-2", "ring-primary/20", "bg-base-100");
  editor.classList.add("border-base-content/5");
  const promptText = promptEditorText(editor);
  if (cancelled || promptText === edit.originalText) {
    renderPrompt();
    return;
  }
  if (!promptText) {
    editor.textContent = edit.originalText;
    setStatus("failure", "Prompt 不能为空，因此没有保存任何版本。");
    return;
  }
  if (!window.confirm("提示词内容已修改，是否保存为新的 active 版本？")) {
    renderPrompt();
    return;
  }
  setStatus("loading", "正在保存新的 active Prompt 版本…");
  try {
    await callWorkbench({
      action: "save_prompt_active",
      local_operator_id: state.operatorId,
      fp_target: edit.nodeCode,
      prompt_text: promptText,
      idempotency_key: idempotencyKey("workbench-prompt"),
    });
    const refreshed = await loadProjection();
    if (!refreshed) {
      editor.textContent = promptText;
      delete editor.dataset.empty;
      setStatus("failure", "Prompt 保存请求已成功返回，但无法重新读取当前有效配置；页面没有将其显示为成功，请刷新后核对。");
      return;
    }
    setStatus("ready", `Prompt 已保存为 ${edit.nodeCode} 的新 active 版本。${nodeSummary()}`);
  } catch (error) {
    editor.textContent = promptText;
    delete editor.dataset.empty;
    setStatus("failure", humanError(error));
  }
}

async function bindNodeTemplate(templateType) {
  const nodeCode = activeNodeCode();
  if (!templateTypes.includes(templateType) || !nodeCode || !canConfigureActiveNode()) {
    renderTemplateOptions();
    renderTemplateDetails();
    return notifyUnmappedNode();
  }
  setStatus("loading", "正在把当前流程步骤绑定到选定模型模板…");
  try {
    const request = {
      action: "bind_node_template",
      local_operator_id: state.operatorId,
      node_code: nodeCode,
      template_type: templateType,
      idempotency_key: idempotencyKey("workbench-binding"),
    };
    const existingTemperature = findBinding(nodeCode)?.effective_value?.temperature;
    if (typeof existingTemperature === "number" && Number.isFinite(existingTemperature)) {
      request.temperature = existingTemperature;
    } else {
      const modelTemperature = numberOrNull(findModel(templateType)?.effective_value?.parameters_jsonb?.temperature);
      if (modelTemperature !== null) request.temperature = modelTemperature;
    }
    await callWorkbench(request);
    const refreshed = await loadProjection();
    if (!refreshed) {
      renderTemplateOptions();
      renderTemplateDetails();
      setStatus("failure", "节点模板绑定请求已成功返回，但无法重新读取当前有效配置；页面没有将其显示为成功，请刷新后核对。");
      return;
    }
    setStatus("ready", `已将 ${nodeCode} 绑定到“${templateType}”模板。${nodeSummary()}`);
  } catch (error) {
    renderTemplateOptions();
    renderTemplateDetails();
    setStatus("failure", humanError(error));
  }
}

async function testConnection(event) {
  event?.preventDefault();
  const templateType = state.modalTemplate;
  state.modelTestEvidenceId = "";
  setStatus("loading", "正在确认本地受控测试器是否可安全验证此模型配置…");
  try {
    const result = await callWorkbench({
      action: "test_connection",
      local_operator_id: state.operatorId,
      template_type: templateType,
      ...modelConnectionInput(),
    });
    const evidenceId = result?.connection_test?.connection_test_evidence_id;
    if (!isUuid(evidenceId)) {
      throw new WorkbenchError("CONNECTION_TEST_EVIDENCE_UNAVAILABLE", "受控测试没有返回可保存的验证证据，因此没有保存模型模板。");
    }
    state.modelTestEvidenceId = evidenceId;
    setStatus("ready", "模型连接测试成功；验证证据仅暂存在本页内存中，现在可以保存该模型模板。");
  } catch (error) {
    state.modelTestEvidenceId = "";
    setStatus(error?.code === "CONFIG_CONTRACT_BLOCKED" ? "blocked" : "failure", humanError(error));
  }
}

async function saveModelConfiguration() {
  const nodeCode = activeNodeCode();
  if (!nodeCode || !canConfigureActiveNode()) return notifyUnmappedNode();
  if (!state.operatorId || !isUuid(state.operatorId)) {
    setStatus("blocked", "本地创作空间尚未就绪，因此没有保存模型配置。");
    return;
  }
  const activeTemplate = findModel(state.modalTemplate)?.effective_value;
  const routingConfig = objectOrEmpty(activeTemplate?.routing_config_jsonb);
  const temperature = numberOrNull(valueFromId("modalTempRange")?.value);
  if (temperature === null) {
    setStatus("blocked", "温度设置无效，因此没有保存任何模型配置。 ");
    return;
  }
  const configuredBaseUrl = String(activeTemplate?.provider_base_url || "").trim();
  const configuredModelName = String(activeTemplate?.model_name || "").trim();
  const modelInput = modelConnectionInput();
  const selectedBaseUrl = modelInput.provider_base_url;
  const selectedModelName = modelInput.model_name;
  const unchangedModel = Boolean(
    configuredBaseUrl
    && configuredModelName
    && configuredBaseUrl === selectedBaseUrl
    && configuredModelName === selectedModelName,
  );

  if (unchangedModel) {
    setStatus("loading", "正在更新当前流程步骤的温度绑定…");
    try {
      await callWorkbench({
        action: "bind_node_template",
        local_operator_id: state.operatorId,
        node_code: nodeCode,
        template_type: state.modalTemplate,
        temperature,
        idempotency_key: idempotencyKey("workbench-binding"),
      });
      const refreshed = await loadProjection();
      if (!refreshed) {
        setStatus("failure", "温度绑定请求已被接收，但无法重新读取当前有效配置；页面没有把它显示为成功，请刷新后核对。");
        return;
      }
      setStatus("ready", `已更新 ${nodeCode} 的温度绑定为 ${temperature}；当前模型模板未变更。`);
    } catch (error) {
      setStatus("failure", humanError(error));
    }
    return;
  }

  const evidenceId = state.modelTestEvidenceId;
  if (!state.operatorId || !isUuid(evidenceId)) {
    setStatus("blocked", "连接地址或模型名称变更后，请先完成受控连接测试。页面不会读取、保存或发送模型密钥，也不会自行补造验证证据。");
    return;
  }
  const modelParameters = { ...objectOrEmpty(activeTemplate?.parameters_jsonb), temperature };
  setStatus("loading", "正在使用本页暂存的验证证据保存模型模板…");
  try {
    await callWorkbench({
      action: "save_model_template",
      local_operator_id: state.operatorId,
      template_type: state.modalTemplate,
      ...modelInput,
      connection_test_evidence_id: evidenceId,
      routing_config_jsonb: routingConfig,
      parameters_jsonb: modelParameters,
      idempotency_key: idempotencyKey("workbench-model"),
    });
    await callWorkbench({
      action: "bind_node_template",
      local_operator_id: state.operatorId,
      node_code: nodeCode,
      template_type: state.modalTemplate,
      temperature,
      idempotency_key: idempotencyKey("workbench-binding"),
    });
    state.modelTestEvidenceId = "";
    const refreshed = await loadProjection();
    if (!refreshed) {
      setStatus("failure", "模型模板请求已被接收，但无法重新读取当前有效配置；页面没有把它显示为成功，请刷新后核对。");
      return;
    }
    setStatus("ready", `“${state.modalTemplate}”模型模板已保存为新的 active 版本。`);
  } catch (error) {
    setStatus("failure", humanError(error));
  }
}

async function saveBookConfig(key) {
  const config = state.projection.book?.effective_value;
  const current = {
    auto_production: config?.auto_production,
    auto_audit: config?.auto_audit,
    auto_iteration: config?.auto_iteration,
    presentation_intensity: numberOrNull(config?.presentation_intensity),
  };
  if (!state.bookId || !state.operatorId || !Object.values(current).slice(0, 3).every((value) => typeof value === "boolean") || current.presentation_intensity === null) {
    renderAutomation();
    setStatus("blocked", state.bookId
      ? "当前作品还没有完整有效的自动化配置投影，页面没有替你补默认值，也没有保存任何改动。"
      : "请先从作品页面选择作品；未选择作品时不能修改自动化配置。");
    return;
  }
  if (!(key in current) || key === "presentation_intensity") return;

  const next = { ...current, [key]: !current[key] };
  setStatus("loading", "正在保存当前作品的完整自动化配置版本…");
  try {
    await callWorkbench({
      action: "save_book_config",
      local_operator_id: state.operatorId,
      book_id: state.bookId,
      ...next,
      idempotency_key: idempotencyKey("workbench-book"),
    });
    const refreshed = await loadProjection();
    if (!refreshed) {
      setStatus("failure", "配置请求已被接收，但无法重新读取当前有效配置；页面没有把它显示为成功，请刷新后核对。 ");
      return;
    }
    setStatus("ready", "自动化配置已保存为当前作品的新版本；后端会在其自身流程条件满足时决定是否触发。 ");
  } catch (error) {
    renderAutomation();
    setStatus("failure", humanError(error));
  }
}

function saveBookConfigUnavailable() {
  setStatus("blocked", state.bookId
    ? "当前作品还没有完整有效的自动化配置投影，页面没有替你补默认值，也没有保存任何改动。"
    : "请先从作品页面选择作品；未选择作品时不能修改自动化配置。");
}

function stageDefinition(stageLabel) {
  if (stageDefinitions[stageLabel]) return { label: stageLabel, ...stageDefinitions[stageLabel] };
  const matched = Object.entries(stageDefinitions).find(([, definition]) => definition.id === stageLabel);
  return matched ? { label: matched[0], ...matched[1] } : { label: "设计阶段", ...stageDefinitions["设计阶段"] };
}

function titleForNode(node) {
  const title = node?.querySelector(".node-title");
  if (!title) return "";
  const copy = title.cloneNode(true);
  copy.querySelector(".material-symbols-outlined")?.remove();
  return copy.textContent.trim();
}

function syncRightPanelTitle(node = activeNode()) {
  const title = titleForNode(node);
  if (title) text("rightPanelTitle", title);
}

function syncNodeHighlight() {
  const selected = activeNode();
  document.querySelectorAll(".workflow-node").forEach((node) => {
    const isSelected = node === selected;
    node.classList.toggle("bg-primary/5", isSelected);
    node.classList.toggle("border-primary/30", isSelected);
    node.classList.toggle("ring-1", isSelected);
    node.classList.toggle("ring-primary/20", isSelected);
    const title = node.querySelector(".node-title");
    title?.classList.toggle("text-primary", isSelected);
  });
  document.querySelectorAll(".node-path").forEach((path) => {
    const isActive = path.dataset.source === state.activeNodeId || path.dataset.target === state.activeNodeId;
    path.classList.toggle("active", isActive);
    if (isActive) {
      path.setAttribute("stroke", "url(#active-line)");
      path.setAttribute("stroke-width", "2");
    } else {
      path.removeAttribute("stroke");
      path.removeAttribute("stroke-width");
    }
  });
}

function openModelSettings() {
  if (!canConfigureActiveNode()) return notifyUnmappedNode();
  const bindingTemplate = findBinding()?.effective_value?.template_type;
  if (templateTypes.includes(bindingTemplate)) selectModalTemplate(bindingTemplate);
  const modal = valueFromId("modelSettingsModal");
  if (modal) {
    state.modelSettingsReturnFocus = document.activeElement;
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
  }
  renderModalCategories(state.modalTemplate);
  valueFromId("closeModalBtn")?.focus();
}

function closeModelSettings() {
  const modal = valueFromId("modelSettingsModal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  if (state.modelSettingsReturnFocus?.isConnected) state.modelSettingsReturnFocus.focus();
  state.modelSettingsReturnFocus = null;
}

function installCanvasNavigation() {
  const viewport = valueFromId("canvasViewport");
  const content = valueFromId("canvasContent");
  if (!viewport || !content) return;
  let scale = 1;
  let translateX = 0;
  let translateY = 0;
  let drag = null;
  const paint = () => {
    content.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
  };
  viewport.addEventListener("wheel", (event) => {
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const canvasX = (mouseX - translateX) / scale;
    const canvasY = (mouseY - translateY) / scale;
    scale = Math.min(3, Math.max(0.2, scale - event.deltaY * 0.001));
    translateX = mouseX - canvasX * scale;
    translateY = mouseY - canvasY * scale;
    paint();
  }, { passive: false });
  viewport.addEventListener("mousedown", (event) => {
    if (event.button !== 0 || event.target.closest(".workflow-node, button, select, input, textarea")) return;
    drag = { x: event.clientX, y: event.clientY, originX: translateX, originY: translateY };
    viewport.style.cursor = "grabbing";
  });
  window.addEventListener("mousemove", (event) => {
    if (!drag) return;
    translateX = drag.originX + event.clientX - drag.x;
    translateY = drag.originY + event.clientY - drag.y;
    paint();
  });
  window.addEventListener("mouseup", () => {
    drag = null;
    viewport.style.cursor = "grab";
  });
}

function installNewBookHandoff() {
  const modal = valueFromId("newBookModal");
  const titleInput = valueFromId("modalBookTitle");
  const targetWordsInput = valueFromId("modalTargetWords");
  const mainGenreContainer = valueFromId("mainGenreContainer");
  const subGenreContainer = valueFromId("subGenreContainer");
  if (!modal || !titleInput || !targetWordsInput || !mainGenreContainer || !subGenreContainer) return;

  let selectedMainGenre = "科幻";
  let selectedSubGenres = [];
  const affinityTags = {
    S: {
      "科幻": ["黑科技", "文明升级", "星际扩张", "AI", "人类对抗/共生"],
      "玄幻": ["东方玄幻", "废柴逆袭", "异世大陆", "高武"],
      "言情": [],
      "武侠": [],
      "恐怖": [],
      "同人": [],
    },
    A: {
      "科幻": ["都市", "末世", "重生", "系统", "基建"],
      "玄幻": ["系统", "重生", "王朝争霸"],
      "言情": [],
      "武侠": [],
      "恐怖": [],
      "同人": [],
    },
  };
  const affinity = (tag) => {
    if (affinityTags.S[selectedMainGenre]?.includes(tag)) return "S";
    if (affinityTags.A[selectedMainGenre]?.includes(tag)) return "A";
    return ["重生", "系统", "无限流"].includes(tag) ? "B" : "C";
  };

  const renderMainGenres = () => {
    mainGenreContainer.innerHTML = "";
    Object.keys(newBookGenreTags).forEach((genre) => {
      const isActive = genre === selectedMainGenre;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ui-choice-chip";
      button.setAttribute("aria-pressed", String(isActive));
      button.textContent = genre;
      button.addEventListener("click", () => {
        selectedMainGenre = genre;
        selectedSubGenres = [];
        renderMainGenres();
        renderSubGenres();
      });
      mainGenreContainer.appendChild(button);
    });
  };

  const renderSubGenres = () => {
    subGenreContainer.innerHTML = "";
    const tags = [...new Set(Object.values(newBookGenreTags).flat())]
      .sort((left, right) => ({ S: 4, A: 3, B: 2, C: 1 }[affinity(right)] - { S: 4, A: 3, B: 2, C: 1 }[affinity(left)]));
    tags.forEach((tag) => {
      const selected = selectedSubGenres.includes(tag);
      const tagAffinity = affinity(tag);
      const affinityClass = {
        S: "text-warning font-extrabold",
        A: "text-warning font-bold",
        B: "text-info",
        C: "text-base-content opacity-50",
      }[tagAffinity];
      const tagButton = document.createElement("button");
      tagButton.type = "button";
      tagButton.className = "ui-choice-chip";
      tagButton.setAttribute("aria-pressed", String(selected));
      tagButton.innerHTML = `<span>${tag}</span><span class="ui-badge ${affinityClass}">${tagAffinity}</span>`;
      tagButton.addEventListener("click", () => {
        selectedSubGenres = selected
          ? selectedSubGenres.filter((value) => value !== tag)
          : [...selectedSubGenres, tag];
        renderSubGenres();
      });
      subGenreContainer.appendChild(tagButton);
    });
  };

  window.openNewBookModal = () => {
    modal.classList.remove("hidden");
    titleInput.value = "";
    targetWordsInput.value = "100";
    selectedMainGenre = "科幻";
    selectedSubGenres = [];
    renderMainGenres();
    renderSubGenres();
  };
  window.closeNewBookModal = () => modal.classList.add("hidden");
  window.createNewBook = () => {
    const title = titleInput.value.trim();
    const targetWords = targetWordsInput.value.trim();
    if (!title) {
      window.alert("请输入书名");
      return;
    }
    if (!selectedMainGenre) {
      window.alert("请选择主题材");
      return;
    }
    if (!targetWords) {
      window.alert("请输入目标字数");
      return;
    }

    const newBookDraft = {
      version: 1,
      origin: {
        title,
        genre: selectedMainGenre,
        subGenre: selectedSubGenres.join("、"),
        targetWords: String(Number(targetWords) * 10000),
        chapterWords: "2000",
        creativeIntent: "",
        sellingPoint: "",
        forbid: "",
      },
      world: { cards: [], bindings: [] },
      characters: [],
      relation_states: [],
      active_character_index: 0,
      conflict_entries: [],
      initial_l1a: null,
      chat: [],
      current_step: 0,
      locked_steps: [],
    };

    localStorage.removeItem("temp_new_book");
    localStorage.removeItem("NEW_BOOK_WIZARD_STATE_V7");
    localStorage.removeItem("NEW_BOOK_CHAR_STATE_V7");
    localStorage.removeItem(newBookDraftIdempotencyKey);
    localStorage.setItem(newBookDraftKey, JSON.stringify(newBookDraft));
    window.location.assign("/books/new");
  };
}

function installModalInteractions() {
  const modal = valueFromId("modelSettingsModal");
  document.querySelectorAll(".open-modal-btn").forEach((button) => button.addEventListener("click", openModelSettings));
  valueFromId("closeModalBtn")?.addEventListener("click", closeModelSettings);
  modal?.addEventListener("click", (event) => {
    if (event.target === modal) closeModelSettings();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal?.classList.contains("hidden")) closeModelSettings();
  });
}

function nodesForStage(stageId) {
  return [...document.querySelectorAll(".workflow-node")]
    .filter((node) => node.dataset.workbenchStage === stageId);
}

function syncStagePaths(stageId) {
  document.querySelectorAll(".node-path").forEach((path) => {
    const source = valueFromId(path.dataset.source);
    const target = valueFromId(path.dataset.target);
    const isInternalStagePath = source?.dataset.workbenchStage === stageId && target?.dataset.workbenchStage === stageId;
    path.classList.toggle("hidden", !isInternalStagePath);
  });
}

function chooseStageNode(nodes) {
  const ordered = [...nodes].sort((left, right) => left.offsetTop - right.offsetTop || left.offsetLeft - right.offsetLeft);
  return ordered.find((node) => node.dataset.nodeCode && !node.dataset.contractState && node.dataset.referenceOnly !== "true") || ordered[0] || null;
}

function activateNode(node) {
  if (!node) return;
  state.activeNodeId = node.id;
  window.activeNodeId = node.id;
  syncRightPanelTitle(node);
  node.click();
}

function selectStage(stageLabel) {
  const stage = stageDefinition(stageLabel);
  if (state.editingPrompt) void finishPromptEdit({ cancelled: true });
  state.activeStage = stage.id;
  text("currentStageText", stage.label);
  text("canvasHeaderTitle", stage.header);
  valueFromId("stageDropdown")?.classList.add("hidden");
  valueFromId("stageDropdownTrigger")?.setAttribute("aria-expanded", "false");

  const nodes = nodesForStage(stage.id);
  document.querySelectorAll(".workflow-node").forEach((node) => {
    node.classList.toggle("hidden", node.dataset.workbenchStage !== stage.id);
  });
  syncStagePaths(stage.id);

  const current = activeNode();
  if (!current || current.dataset.workbenchStage !== stage.id) {
    activateNode(chooseStageNode(nodes));
  } else {
    window.activeNodeId = current.id;
    syncRightPanelTitle(current);
    render();
  }

  syncNodeHighlight();

  const status = valueFromId("workbenchRuntimeState");
  if (status?.dataset.state !== "loading") {
    setStatus(nodeConfigurationRestriction() ? "blocked" : "ready", `${nodeSummary()} ${budgetSummary()}`);
  }
}

function installPrototypeOverrides() {
  window.loadNodePrompt = () => renderPrompt();
  window.onWorkbenchTemplateChange = () => renderTemplateDetails();
  window.updateWorkbenchTemplateOptions = () => renderTemplateOptions();
  window.loadCategoryConfig = (templateType) => {
    selectModalTemplate(templateType);
    renderModalTemplate(state.modalTemplate);
  };
  window.renderModalCategories = (templateType) => renderModalCategories(templateType || state.modalTemplate);
  window.saveCurrentFormToMemory = () => undefined;
  window.saveModalConfiguration = saveModelConfiguration;
  window.testConnection = testConnection;
  window.fetchModelList = (event) => {
    event?.preventDefault();
    setStatus("blocked", "当前没有受控模型目录合同，不能把原型中的模拟清单当作真实模型列表。 ");
  };
  window.applyRecommendedModel = () => {
    setStatus("blocked", "原型推荐模型不是当前有效配置，不会作为真实模型选择保存。 ");
  };
  window.showAddCategoryInput = () => {
    setStatus("blocked", "统一配置只允许五个已批准模板，不能新增第六种模板。 ");
  };
  window.handleNewCategoryKey = (event) => {
    event?.preventDefault();
    window.showAddCategoryInput();
  };
  window.toggleAutoSwitch = (key) => void saveBookConfig(key);
  window.toggleQuickSettings = (event) => {
    event?.stopPropagation();
    valueFromId("quick-settings-popover")?.classList.toggle("hidden");
  };
  window.selectStage = selectStage;
}

function installListeners() {
  const templateSelect = valueFromId("workbenchTemplateSelect");
  const modelName = valueFromId("modalModelSelect");
  const modelBaseUrl = valueFromId("modalBaseUrlInput");
  const modelTemperature = valueFromId("modalTempRange");
  const refreshIcon = [...document.querySelectorAll(".material-symbols-outlined")].find((icon) => icon.textContent.trim() === "refresh");
  const refreshButton = refreshIcon?.closest("button");

  if (refreshButton) {
    setDisabled(refreshButton, false, "重新读取当前有效配置。 ");
    refreshButton.setAttribute("aria-label", "重新读取当前有效配置");
    refreshButton.addEventListener("click", () => loadProjection());
  }
  const stageTrigger = valueFromId("stageDropdownTrigger");
  const stageDropdown = valueFromId("stageDropdown");
  stageTrigger?.addEventListener("click", () => {
    const open = stageDropdown?.classList.toggle("hidden") === false;
    stageTrigger.setAttribute("aria-expanded", String(Boolean(open)));
  });
  if (templateSelect) {
    templateSelect.addEventListener("change", () => {
      if (templateSelect.value) void bindNodeTemplate(templateSelect.value);
    });
  }
  for (const input of [modelName, modelBaseUrl]) {
    input?.addEventListener("input", resetModelTestEvidence);
  }
  modelTemperature?.addEventListener("input", () => text("tempValDisplay", modelTemperature.value));
  document.querySelectorAll(".workflow-node").forEach((node) => {
    node.setAttribute("role", "button");
    node.tabIndex = 0;
    node.setAttribute("aria-label", `选择流程节点：${titleForNode(node)}`);
    node.addEventListener("click", () => {
      state.activeNodeId = node.id;
      window.activeNodeId = node.id;
      syncRightPanelTitle(node);
      syncNodeHighlight();
      queueMicrotask(() => {
        renderTemplateOptions();
        renderTemplateDetails();
        renderPrompt();
        if (!activeNodeCode()) setStatus("blocked", nodeSummary());
        else setStatus("ready", `${nodeSummary()} ${budgetSummary()}`);
      });
    });
    node.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      node.click();
    });
  });
  document.addEventListener("dblclick", (event) => {
    const prompt = valueFromId("promptEditor");
    if (!prompt || !prompt.contains(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    beginPromptEdit();
  }, true);
  document.addEventListener("focusout", (event) => {
    const prompt = valueFromId("promptEditor");
    if (!prompt || event.target !== prompt) return;
    event.stopImmediatePropagation();
    void finishPromptEdit();
  }, true);
  document.addEventListener("keydown", (event) => {
    const prompt = valueFromId("promptEditor");
    if (!prompt || event.target !== prompt) return;
    if (!state.editingPrompt && (event.key === "Enter" || event.key === " " || event.key === "F2")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      beginPromptEdit();
      return;
    }
    if (!state.editingPrompt) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      void finishPromptEdit({ cancelled: true });
      prompt.blur();
    } else if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      event.stopImmediatePropagation();
      void finishPromptEdit();
    }
  }, true);
  document.addEventListener("click", (event) => {
    const stageContainer = valueFromId("stageDropdownContainer");
    if (stageContainer && !stageContainer.contains(event.target)) valueFromId("stageDropdown")?.classList.add("hidden");
    const quickSettings = valueFromId("quick-settings-popover");
    const quickButton = valueFromId("quick-settings-btn");
    if (quickSettings && !quickSettings.contains(event.target) && !quickButton?.contains(event.target)) quickSettings.classList.add("hidden");
    const disabledLink = event.target.closest("a[aria-disabled='true']");
    if (!disabledLink) return;
    event.preventDefault();
    setStatus("blocked", disabledLink.title || "该入口尚未接入当前路由。 ");
  }, true);
}

let listenersInstalled = false;

function mount({ reload = true } = {}) {
  installPrototypeOverrides();
  if (!listenersInstalled) {
    installNewBookHandoff();
    installListeners();
    installModalInteractions();
    installCanvasNavigation();
    listenersInstalled = true;
  }
  selectStage(state.activeStage);
  if (reload) void loadProjection();
  else render();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount, { once: true });
} else {
  mount();
  // The transplanted prototype initializes its globals on DOMContentLoaded.
  // Reapply the runtime adapters after that initializer without refetching.
  document.addEventListener("DOMContentLoaded", () => mount({ reload: false }), { once: true });
}

window.addEventListener("storage", (event) => {
  if (event.key === contextKey || event.key === operatorKey) loadProjection();
});

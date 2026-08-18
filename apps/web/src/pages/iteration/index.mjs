const UUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function asText(value, fallback = "—") {
  return typeof value === "string" && value.trim() ? value.trim() : value == null ? fallback : String(value);
}

function safeJson(value) {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); } catch { return "—"; }
}

export function normalizeIterationProjection(payload, expectedBookId = null) {
  if (!payload || payload.ok !== true || !payload.result || typeof payload.result !== "object") return null;
  const book = payload.result.book && typeof payload.result.book === "object" ? payload.result.book : null;
  if (!book || !UUID_PATTERN.test(String(book.id || ""))) return null;
  if (expectedBookId && String(book.id).toLowerCase() !== String(expectedBookId).toLowerCase()) return null;
  const samples = Array.isArray(payload.result.samples)
    ? payload.result.samples.filter((sample) => sample && UUID_PATTERN.test(String(sample.id || "")) && String(sample.book_id || book.id).toLowerCase() === String(book.id).toLowerCase())
    : [];
  const poolingContract = payload.result.pooling_contract && typeof payload.result.pooling_contract === "object"
    ? payload.result.pooling_contract
    : { code: "ITERATION_RETRY_CONTRACT_UNRESOLVED", message: "V7 尚未定义可验证的第三次失败证据。" };
  return {
    book: { id: String(book.id).toLowerCase(), title: asText(book.title, "未命名作品"), auto_iteration: book.auto_iteration === true },
    samples,
    automatic_pooling: payload.result.automatic_pooling === true,
    pooling_contract: { code: asText(poolingContract.code, "ITERATION_RETRY_CONTRACT_UNRESOLVED"), message: asText(poolingContract.message, "当前自动入池合同不可验证。") },
  };
}

export function iterationState(projection, contextError = false) {
  if (contextError) return "context";
  if (!projection) return "error";
  return projection.samples.length ? "ready" : "blocked";
}

export function selectIterationSample(projection, sampleId) {
  return projection?.samples.find((sample) => String(sample.id).toLowerCase() === String(sampleId || "").toLowerCase()) || null;
}

function routeContext() {
  const match = window.location.pathname.match(/^\/books\/([^/]+)\/iteration\/?$/);
  let bookId = "";
  try { bookId = decodeURIComponent(match?.[1] || ""); } catch { return null; }
  let localOperatorId = "";
  try {
    localOperatorId = localStorage.getItem("zhreplan.local_operator_id.v1") || "";
    const stored = JSON.parse(localStorage.getItem("current_book_context") || "null");
    if (!stored || String(stored.current_book_id || "").toLowerCase() !== bookId.toLowerCase()) return null;
    if (String(stored.local_operator_id || "").toLowerCase() !== localOperatorId.toLowerCase()) return null;
  } catch { return null; }
  return UUID_PATTERN.test(bookId) && UUID_PATTERN.test(localOperatorId) ? { bookId: bookId.toLowerCase(), localOperatorId: localOperatorId.toLowerCase() } : null;
}

function setStatus(message, tone = "info") {
  const status = document.getElementById("iteration-status");
  if (!status) return;
  status.textContent = message;
  status.className = `ui-alert ui-alert-${tone}`;
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function renderMetrics(projection) {
  setText("metric-samples", projection ? String(projection.samples.length) : "—");
  setText("metric-pooling", projection ? (projection.automatic_pooling ? "已启用" : "未启用") : "—");
  setText("metric-book", projection ? projection.book.title : "—");
  setText("metric-actions", projection?.samples.length ? "仅查看" : "无");
  setText("sample-count", projection ? String(projection.samples.length) : "0");
  setText("contract-message", projection?.pooling_contract?.message || "读取后端合同状态中…");
  const name = document.getElementById("header-book-name");
  if (name && projection) name.textContent = projection.book.title;
}

function sampleLabel(sample) {
  return asText(sample.source_fp, "未标记来源");
}

function renderSamples(projection, selectedId, onSelect, emptyMessage = "当前没有可合法入池的失败样本。") {
  const list = document.getElementById("sample-list");
  if (!list) return;
  list.replaceChildren();
  if (!projection?.samples.length) {
    const empty = document.createElement("div");
    empty.className = "panel-empty";
    empty.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">inbox</span><p></p>';
    empty.querySelector("p").textContent = emptyMessage;
    list.append(empty);
    return;
  }
  for (const [index, sample] of projection.samples.entries()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sample-card";
    button.dataset.sampleId = sample.id;
    button.setAttribute("aria-selected", String(sample.id === selectedId));
    button.setAttribute("aria-label", `选择样本 ${index + 1}，${sampleLabel(sample)}`);
    button.innerHTML = `<span class="sample-id">${asText(sample.id).slice(0, 13)}</span><div class="sample-title"></div><div class="sample-meta"></div>`;
    button.querySelector(".sample-title").textContent = sampleLabel(sample);
    button.querySelector(".sample-meta").textContent = `${asText(sample.iter_type)} · ${asText(sample.review_status)}`;
    button.addEventListener("click", () => onSelect(sample.id));
    list.append(button);
  }
}

function renderDetail(sample) {
  const detail = document.getElementById("sample-detail");
  if (!detail) return;
  if (!sample) {
    detail.innerHTML = '<div class="detail-empty"><span class="material-symbols-outlined" aria-hidden="true">ads_click</span><p>选择一个真实样本后查看快照。</p></div>';
    setText("selected-sample-label", "未选择");
    return;
  }
  setText("selected-sample-label", asText(sample.review_status));
  detail.innerHTML = `<dl class="detail-fields"><div class="detail-field"><dt>样本标识</dt><dd data-field="id"></dd></div><div class="detail-field"><dt>来源 FP</dt><dd data-field="source"></dd></div><div class="detail-field"><dt>类型</dt><dd data-field="type"></dd></div><div class="detail-field"><dt>执行结果</dt><dd data-field="result"></dd></div></dl><div id="old-input-col" class="detail-block"><h4>输入快照</h4><pre id="old-input-content" data-field="snapshot"></pre></div><div id="new-prompt-col" class="detail-block"><h4>提示词变化</h4><pre id="new-prompt-content" data-field="prompts"></pre></div><div id="new-output-col" class="detail-block"><h4>结果指标</h4><pre id="new-output-content" data-field="metrics"></pre></div>`;
  detail.querySelector('[data-field="id"]').textContent = asText(sample.id);
  detail.querySelector('[data-field="source"]').textContent = sampleLabel(sample);
  detail.querySelector('[data-field="type"]').textContent = asText(sample.iter_type);
  detail.querySelector('[data-field="result"]').textContent = asText(sample.exec_result);
  detail.querySelector('[data-field="snapshot"]').textContent = safeJson(sample.snapshot_jsonb);
  detail.querySelector('[data-field="prompts"]').textContent = `before:\n${asText(sample.before_prompt)}\n\nafter:\n${asText(sample.after_prompt)}`;
  detail.querySelector('[data-field="metrics"]').textContent = safeJson(sample.after_metric_json);
}

function setActionAvailability(enabled) {
  for (const id of ["experiment-btn", "discard-btn", "adopt-btn"]) {
    const button = document.getElementById(id);
    if (!button) continue;
    button.disabled = !enabled;
    button.setAttribute("aria-disabled", String(!enabled));
  }
}

async function loadProjection(context) {
  const url = `/api/books/${encodeURIComponent(context.bookId)}/iteration?local_operator_id=${encodeURIComponent(context.localOperatorId)}`;
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const code = payload?.redacted_error?.code;
    if (code === "SCOPE_REJECTED" || code === "INVALID_ITERATION_CONTEXT") throw new Error("当前作品上下文无效，未读取或修改任何样本。");
    throw new Error("迭代样本服务暂时不可用，未展示任何样本。");
  }
  return normalizeIterationProjection(payload, context.bookId);
}

async function mount() {
  const refresh = document.getElementById("refresh-btn");
  let projection = null;
  let selectedId = null;
  const refreshPage = async () => {
    const context = routeContext();
    if (!context) {
      renderMetrics(null);
      setActionAvailability(false);
      setText("header-book-name", "作品未确认");
      setText("contract-message", "当前作品上下文无效，未读取或修改任何样本。");
      renderSamples(null, null, () => {}, "请先从总控设置进入一个有效作品。");
      setStatus("当前作品上下文无效，请从总控设置进入作品后重试。", "error");
      return;
    }
    setStatus("正在读取当前作品的合法迭代样本…", "info");
    refresh.disabled = true;
    try {
      projection = await loadProjection(context);
      if (!projection) throw new Error("迭代数据格式无效，页面未展示任何样本。");
      selectedId = projection.samples.some((sample) => sample.id === selectedId) ? selectedId : projection.samples[0]?.id || null;
      renderMetrics(projection);
      const selectAndRender = (id) => {
        selectedId = id;
        renderSamples(projection, selectedId, selectAndRender);
        renderDetail(selectIterationSample(projection, selectedId));
      };
      renderSamples(projection, selectedId, selectAndRender);
      renderDetail(selectIterationSample(projection, selectedId));
      setActionAvailability(false);
      if (projection.samples.length) setStatus("已读取合法样本。当前页面只提供只读核验，写入动作仍需 V7 合同。", "info");
      else setStatus("当前没有可合法入池的失败样本；系统没有生成虚假样本或实验结果。", "warning");
    } catch (error) {
      projection = null;
      renderMetrics(null);
      setText("header-book-name", "作品未确认");
      setText("contract-message", "当前作品样本不可用，未展示或修改任何数据。");
      renderSamples(null, null, () => {}, "无法读取当前作品样本，未展示任何样本。");
      renderDetail(null);
      setActionAvailability(false);
      setStatus(error?.message || "迭代样本服务暂时不可用。", "error");
    } finally {
      refresh.disabled = false;
    }
  };
  refresh?.addEventListener("click", refreshPage);
  const settingsButton = document.getElementById("quick-settings-btn");
  const popover = document.getElementById("quick-settings-popover");
  settingsButton?.addEventListener("click", (event) => { event.stopPropagation(); const hidden = popover?.classList.toggle("hidden"); settingsButton.setAttribute("aria-expanded", String(!hidden)); });
  document.addEventListener("click", (event) => { if (popover && !popover.contains(event.target) && event.target !== settingsButton && !settingsButton?.contains(event.target)) { popover.classList.add("hidden"); settingsButton?.setAttribute("aria-expanded", "false"); } });
  document.querySelectorAll(".step-button[data-step]").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll(".step-button[data-step]").forEach((step) => {
      if (step === button) step.setAttribute("aria-current", "step");
      else step.removeAttribute("aria-current");
    });
    setStatus(`当前定位到第 ${button.dataset.step} 步。页面仍遵守 V7 只读与合同边界。`, "info");
  }));
  await refreshPage();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
}

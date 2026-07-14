const ENDPOINT = "/webhook/create_book";
const DATA = window.NEW_BOOK_WIZARD_DATA;
const runtime = document.querySelector("#newBookRuntime");
const params = new URLSearchParams(location.search);
const allowedStates = new Set(["normal", "empty", "loading", "failed", "returned", "restored", "disabled", "completed", "blocked", "duplicate"]);
const OPERATOR_STORAGE_KEY = "zhreplan.local_operator_id.v1";
const DRAFT_IDEMPOTENCY_STORAGE_KEY = "zhreplan.new_book_draft.idempotency_key.v1";
const runtimeCapabilities = window.NEW_BOOK_RUNTIME_CAPABILITIES;
const canRunCreation = runtimeCapabilities?.creation_available !== false;
const canRunGeneration = Boolean(runtimeCapabilities?.active_skill && runtimeCapabilities?.active_config && runtimeCapabilities?.budget_available);
let state = allowedStates.has(params.get("state")) ? params.get("state") : "normal";

function stableUuid(storageKey) {
  const existing = localStorage.getItem(storageKey);
  if (existing) return existing;
  const value = crypto.randomUUID();
  localStorage.setItem(storageKey, value);
  return value;
}

const localOperatorId = stableUuid(OPERATOR_STORAGE_KEY);
let draftIdempotencyKey = stableUuid(DRAFT_IDEMPOTENCY_STORAGE_KEY);

function rotateDraftIdempotencyKey() {
  draftIdempotencyKey = crypto.randomUUID();
  localStorage.setItem(DRAFT_IDEMPOTENCY_STORAGE_KEY, draftIdempotencyKey);
}

function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function statusCopy(current) {
  return {
    normal: ["草稿编辑中", "原型内容仅作可编辑初值，尚未成为作品事实。"],
    empty: ["空白新书", "尚未填写基础资料。先在创作原点录入作品意图。"],
    loading: ["正在提交", "正在等待受控建书流程完成；请勿重复确认。"],
    failed: ["创建未完成", "暂时无法完成创建，草稿仍保留。请检查后重试。"],
    returned: ["已退回补全", "后端要求补齐缺失项；当前草稿未入库。"],
    restored: ["草稿已恢复", "已恢复上次未确认的本地草稿，仍需终审确认。"],
    disabled: ["创建暂不可用", "当前流程不可提交，请等待所需配置恢复。"],
    completed: ["新书已创建", "当前操作书上下文已切换，后续操作将使用该作品。"],
    blocked: ["BLOCKED", "缺少 active 系统内置技能、有效配置或可用预算；系统不会伪造生成结果。"],
    duplicate: ["同名作品", "当前本地操作者已有同名作品；未创建重复作品。"],
  }[current];
}

function renderRuntime(detail = "") {
  if (!runtime) return;
  const [title, body] = statusCopy(state);
  runtime.dataset.state = state;
  runtime.innerHTML = `<div class="runtime-status runtime-${state}"><strong>${safeText(title)}</strong><span>${safeText(detail || body)}</span></div>`;
  document.body.classList.toggle("new-book-disabled", state === "loading" || state === "disabled" || state === "blocked" || state === "completed");
}

function numericValue(value) {
  const parsed = Number.parseInt(String(value ?? "").replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function originFields() {
  const origin = DATA?.stages?.find((step) => step.key === "creative_origin");
  const fields = origin?.fields || [];
  return {
    creative_intent: fields[0]?.value?.trim() || "",
    selling_point: fields[1]?.value?.trim() || "",
    forbid: fields[3]?.value?.trim() || "",
  };
}

const WORLD_BOARD_TYPES = Object.freeze({
  "规则": "rule",
  "地理": "geography",
  "资源": "resource",
  "势力": "faction",
  "职业": "profession",
  "职业/超能": "profession",
  "怪物": "monster",
  "怪物/灾难": "monster",
  "大事": "chronicle",
  "大事记": "chronicle",
});

function characterType(value) {
  return value === "support" ? "supporting" : value;
}

function worldAssetContent(card) {
  const { id, title, description, text, board_type, category, atom_type, ...fields } = card;
  const affordanceDims = window.WIZARD_DATA?.WORLD_SCHEMA?.boards?.[board_type || category]?.default_affordance_dims || [];
  return { summary: description || text || "", ...fields, affordance_dims: affordanceDims };
}

function atomTypeFor(boardType) {
  if (boardType === "rule") return "rule";
  if (boardType === "resource") return "resource";
  return "fact";
}

function mapWorldAssets(world) {
  return (world?.cards || []).map((card) => {
    const boardType = WORLD_BOARD_TYPES[card.board_type || card.category];
    return {
      board_type: boardType,
      atom_type: atomTypeFor(boardType),
      item_name: card.title,
      item_content: worldAssetContent(card),
    };
  });
}

function mapCharacter(character) {
  const knowledgeBoundary = character.knowledge_boundary || character.knowledge_boundary_json;
  const fiveLayers = {
    L0: character.philosophy,
    L1: character.L1 || { desire: character.arc?.desire, core_motivation: character.background },
    L2: character.L2 || { resources: character.bindRes, factions: character.bindForce, occupations: character.bindJob },
    L3: character.L3 || { relations: character.relations },
  };
  const mapped = {
    client_ref: character.id,
    name: character.name,
    char_type: characterType(character.char_type),
    gender: character.gender,
    five_layers: fiveLayers,
    knowledge_boundary: knowledgeBoundary,
  };
  if (character.decide_init) mapped.decide_init = character.decide_init;
  if (character.background || character.role || character.traitTags?.length) {
    mapped.origin_memory = {
      background: character.background,
      role: character.role,
      trait_tags: character.traitTags || [],
    };
  }
  if (character.conflict_seed) mapped.conflict_seed = character.conflict_seed;
  if (character.arc) mapped.char_arc = JSON.stringify(character.arc);
  return mapped;
}

function mapRelations(characters) {
  const references = new Set((characters?.characters || []).map((character) => character.id).filter(Boolean));
  const relations = [];
  for (const character of characters?.characters || []) {
    for (const [toRef, relation] of Object.entries(character.relations || {})) {
      if (!references.has(character.id) || !references.has(toRef) || !relation || Array.isArray(relation)) continue;
      const required = ["intimacy", "trust", "dependence", "support_level", "emotional_bond"];
      if (!required.every((field) => Number.isFinite(relation[field]))) continue;
      const mapped = Object.fromEntries(required.map((field) => [field, relation[field]]));
      mapped.from_ref = character.id;
      mapped.to_ref = toRef;
      for (const field of ["relation_type", "relation_hierarchy", "role_assign"]) if (relation[field] != null) mapped[field] = relation[field];
      relations.push(mapped);
    }
  }
  return relations;
}

function mapSegmentPromises(conflicts) {
  return (conflicts?.conflictEntries || [])
    .filter((entry) => entry.title && entry.summary && entry.stake_cost)
    .map((entry, index) => ({
      l1a_seq: index + 1,
      l1a_name: entry.title,
      conflict_background: { summary: entry.summary, parties: entry.parties, interest_gap: entry.interest_gap },
      stakes: { stake_cost: entry.stake_cost },
      irreversible_consequences: { stake_cost: entry.stake_cost },
      escalation_path: { intensity: entry.intensity, robustness: entry.robustness },
      plot_promise: { interest_gap: entry.interest_gap || entry.summary, resource_point: entry.resource_point || "" },
      emotion_promise: { types: entry.types || [], intensity: entry.intensity },
      role_arc: { parties: entry.parties },
      world_progress: { resource_point: entry.resource_point || "" },
    }));
}

function collectPayload() {
  const origin = originFields();
  const world = DATA?.stages?.find((step) => step.key === "world_settings");
  const characters = DATA?.stages?.find((step) => step.key === "characters");
  const conflicts = DATA?.stages?.find((step) => step.key === "conflict_seed");
  const title = String(DATA?.book?.bookName || DATA?.book?.title || "").trim();
  const genreMain = DATA?.book?.intent_json?.genre || "";
  const subGenre = DATA?.book?.intent_json?.subGenre || "";
  return {
    local_operator_id: localOperatorId,
    title,
    idempotency_key: draftIdempotencyKey,
    intent: { genre_main: genreMain, summary: [origin.creative_intent, subGenre].filter(Boolean).join("\n") },
    forbid: { lines: origin.forbid ? [origin.forbid] : [] },
    selling_points: origin.selling_point ? [origin.selling_point] : [],
    target_words: numericValue(DATA?.book?.targetWords),
    chapter_words: numericValue(DATA?.book?.chapterWords),
    world_assets: mapWorldAssets(world),
    characters: (characters?.characters || []).map(mapCharacter),
    relations: mapRelations(characters),
    segment_promises: mapSegmentPromises(conflicts),
  };
}

function clientGate(payload) {
  if (!payload.title || !payload.intent.summary || !payload.selling_points.length || !payload.forbid.lines.length || !payload.target_words || !payload.chapter_words) return { state: "returned", message: "请先补齐创作原点中的必填信息。" };
  const missingCharacterData = payload.characters.some((character) => !character.client_ref || !character.name || !character.char_type || !character.gender || !["L0", "L1", "L2", "L3"].every((layer) => character.five_layers?.[layer] && Object.keys(character.five_layers[layer]).length) || !["knows", "unknown", "false_belief", "reasonable_suspect"].every((field) => Array.isArray(character.knowledge_boundary?.[field]) && character.knowledge_boundary[field].length));
  if (missingCharacterData) return { state: "blocked", message: "角色 L0-L3 或知识边界四象限不完整，未提交创建请求。" };
  if (payload.world_assets.some((asset) => !asset.board_type || !asset.atom_type || !asset.item_name || !asset.item_content || typeof asset.item_content !== "object" || Array.isArray(asset.item_content) || !Array.isArray(asset.item_content.affordance_dims) || !asset.item_content.affordance_dims.length)) return { state: "blocked", message: "世界设定条目缺少可用戏剧维度，未提交创建请求。" };
  return null;
}

function currentBook(bookId) {
  const context = { local_operator_id: localOperatorId, current_book_id: bookId };
  localStorage.setItem("current_book_context", JSON.stringify(context));
  window.dispatchEvent(new CustomEvent("new-book:created", { detail: context }));
}

async function createBook() {
  if (["loading", "disabled", "completed"].includes(state)) return;
  if (!canRunCreation) { state = "disabled"; renderRuntime("本地建书服务不可用，草稿未提交。"); return; }
  const payload = collectPayload();
  const issue = clientGate(payload);
  if (issue) { state = issue.state; renderRuntime(issue.message); return; }
  state = "loading";
  renderRuntime();
  try {
    const envelope = { action: "confirm_create", form_data: payload };
    const response = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify(envelope) });
    const result = await response.json().catch(() => ({}));
    if (response.status === 409 || result?.error?.code === "DUPLICATE_TITLE") { state = "duplicate"; renderRuntime(); return; }
    if (response.status === 422 || result?.route === "FP001-03") { state = "returned"; renderRuntime("后端要求补齐资料；草稿未入库。"); return; }
    if (!response.ok || !result?.book_id) { state = "failed"; renderRuntime(); return; }
    currentBook(result.book_id);
    rotateDraftIdempotencyKey();
    state = "completed";
    renderRuntime(`已切换至当前作品：${result.book_id}`);
  } catch {
    state = "failed";
    renderRuntime();
  }
}

function blockFabricatedAi() {
  window.aiAddWorldItem = () => { state = "blocked"; renderRuntime(canRunGeneration ? "当前页面未接入真实 AI 补全通道，未生成任何候选结果。" : "AI 补全缺少 active 技能、配置或预算，未生成任何候选结果。"); };
  window.runIntegrityAnalysis = () => { state = "blocked"; renderRuntime(canRunGeneration ? "当前页面未接入真实完整性分析通道，未生成任何候选结果。" : "完整性分析缺少 active 技能、配置或预算，未生成任何候选结果。"); };
  window.sendChat = (event) => {
    event.preventDefault();
    state = "blocked";
    renderRuntime(canRunGeneration ? "当前页面未接入真实 AI 问答通道，未发送请求也未伪造 AI 回复。" : "AI 问答缺少 active 技能、配置或预算，未发送请求也未伪造 AI 回复。");
  };
}

function bindCreation() {
  const original = window.startProduction;
  window.startProduction = () => createBook();
  document.querySelectorAll("button").forEach((button) => {
    if (/开始创作|确认创建|创建新书/.test(button.textContent || "")) button.addEventListener("click", createBook);
  });
  window.__newBookOriginalStartProduction = original;
}

blockFabricatedAi();
bindCreation();
renderRuntime();

export { collectPayload, createBook };

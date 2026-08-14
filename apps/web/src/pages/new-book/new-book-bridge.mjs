const ENDPOINT = window.NEW_BOOK_WEBHOOK_URL || "http://127.0.0.1:5678/webhook/create_book";
const OPERATOR_ENDPOINT = window.NEW_BOOK_OPERATOR_URL || "/api/skill-library";
const OPERATOR_TIMEOUT_MS = 15000;
const DATA = window.NEW_BOOK_WIZARD_DATA;
const OPERATOR_STORAGE_KEY = "zhreplan.local_operator_id.v1";
const BOOK_CONTEXT_STORAGE_KEY = "current_book_context";
const DRAFT_STORAGE_KEY = "zhreplan.new_book_draft.v1";
const DRAFT_IDEMPOTENCY_STORAGE_KEY = "zhreplan.new_book_draft.idempotency_key.v1";
const DRAFT_CORRELATION_STORAGE_KEY = "zhreplan.new_book_draft.correlation_id.v1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
let state = "loading";
let localOperatorId = validUuid(localStorage.getItem(OPERATOR_STORAGE_KEY)) ? localStorage.getItem(OPERATOR_STORAGE_KEY).toLowerCase() : "";
let draftIdempotencyKey = validToken(localStorage.getItem(DRAFT_IDEMPOTENCY_STORAGE_KEY))
  ? localStorage.getItem(DRAFT_IDEMPOTENCY_STORAGE_KEY)
  : crypto.randomUUID();
let draftCorrelationId = validToken(localStorage.getItem(DRAFT_CORRELATION_STORAGE_KEY))
  ? localStorage.getItem(DRAFT_CORRELATION_STORAGE_KEY)
  : `book-${crypto.randomUUID()}`;
let createdBookSummary = "";
let draftSaveTimer = 0;

localStorage.setItem(DRAFT_IDEMPOTENCY_STORAGE_KEY, draftIdempotencyKey);
localStorage.setItem(DRAFT_CORRELATION_STORAGE_KEY, draftCorrelationId);

function validUuid(value) {
  return UUID_PATTERN.test(String(value || ""));
}

function validToken(value) {
  return TOKEN_PATTERN.test(String(value || ""));
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function statusRegion() {
  const host = document.querySelector("#toastContainer");
  if (!host) return null;
  let region = host.querySelector("[data-new-book-runtime]");
  if (!region) {
    region = document.createElement("div");
    region.dataset.newBookRuntime = "true";
    region.className = "toast-item toast-info";
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    host.append(region);
  }
  return region;
}

function statusCopy(current) {
  return {
    normal: ["草稿编辑中", "尚未创建作品。"],
    empty: ["空白新书", "请从创作原点补充作品资料。"],
    loading: ["正在准备", "正在连接本地创作空间，请勿重复操作。"],
    failed: ["请求未完成", "草稿仍保留，可检查连接后重试。"],
    returned: ["已退回补全", "当前草稿未满足确认条件，尚未入库。"],
    restored: ["草稿已恢复", "已恢复上次未确认的本地草稿。"],
    disabled: ["创建暂不可用", "本地操作者范围暂不可用，草稿未提交。"],
    completed: ["新书已创建", "当前作品上下文已切换。"],
    blocked: ["预览被阻断", "后端未提供可用候选，草稿未改变。"],
    duplicate: ["同名作品", "当前本地操作者已有同名作品，未创建重复作品。"],
  }[current];
}

function renderRuntime(detail = "") {
  const region = statusRegion();
  const inactive = ["loading", "disabled", "completed"].includes(state);
  const [statusTitle, body] = statusCopy(state);
  document.body.dataset.newBookState = state;
  if (region) {
    region.hidden = state === "normal";
    region.classList.toggle("show", state !== "normal");
    region.dataset.state = state;
    region.textContent = state === "normal" ? "" : `${statusTitle}: ${detail || body}`;
  }
  window.__newBookRuntime?.syncConfirmAction?.();
  const sendButton = document.querySelector('form.chat-input button[type="submit"]');
  if (sendButton) {
    sendButton.disabled = inactive;
    sendButton.setAttribute("aria-disabled", String(inactive));
    sendButton.title = inactive ? `${statusTitle}: ${detail || body}` : "";
  }
  const bookTitle = document.querySelector("#sideBookTitle");
  if (bookTitle && state === "completed") bookTitle.textContent = createdBookSummary || "新书已创建";
}

function numericValue(value) {
  const parsed = Number.parseInt(String(value ?? "").replace(/[^0-9]/g, ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function originFields() {
  const fields = DATA?.stages?.find((step) => step.key === "creative_origin")?.fields || [];
  return Object.fromEntries(fields.filter((field) => field.key).map((field) => [field.key, String(field.value ?? "").trim()]));
}

function canonicalGenre(value) {
  const genre = String(value || "");
  return ["科幻", "玄幻", "言情", "武侠", "恐怖", "同人"].find((item) => genre.includes(item)) || genre;
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
  "大事": "event",
  "大事记": "event",
});
const ATOM_TYPES = Object.freeze({ rule: "rule", geography: "geo", resource: "resource", faction: "faction", profession: "job", monster: "monster", event: "event" });
const CANONICAL_ATOM_TYPES = new Set([...Object.values(ATOM_TYPES), "fact"]);

function worldAffordanceDims(card) {
  if (Array.isArray(card.affordance_dims)) return card.affordance_dims.filter((value) => typeof value === "string" && value.trim());
  return [];
}

function mapWorldStates(world) {
  return (world?.cards || []).flatMap((card) => {
    const boardType = WORLD_BOARD_TYPES[card.board_type || card.category];
    const clientRef = String(card.client_ref || card.id || "").trim();
    const atomKey = String(card.atom_key || card.item_name || card.title || "").trim();
    const suppliedAtomType = String(card.atom_type || "").trim();
    // The page/prototype names these visual atom types differently from the
    // V7 PostgreSQL catalog. This only normalizes their stable meanings.
    const isPrototypeOccupation = boardType === "profession" && suppliedAtomType === "occupation";
    const isPrototypeProfession = boardType === "profession" && suppliedAtomType === "profession";
    const isPrototypeLocation = boardType === "geography" && suppliedAtomType === "location";
    const isPrototypeGeography = boardType === "geography" && suppliedAtomType === "geography";
    const isPrototypePhenomenon = boardType === "monster" && suppliedAtomType === "phenomenon";
    const isPrototypeDisaster = boardType === "monster" && suppliedAtomType === "disaster";
    const atomType = isPrototypeOccupation || isPrototypeProfession
      ? "job"
      : isPrototypeLocation || isPrototypeGeography
        ? "geo"
        : isPrototypePhenomenon || isPrototypeDisaster
          ? "monster"
          : CANONICAL_ATOM_TYPES.has(suppliedAtomType)
            ? suppliedAtomType
            : ATOM_TYPES[boardType];
    const itemContent = plainObject(card.atom_value_jsonb)
      ? card.atom_value_jsonb
      : plainObject(card.item_content)
        ? card.item_content
        : { summary: String(card.description || card.text || "").trim() };
    if (!boardType || !clientRef || !atomKey) return [];
    return [{
      client_ref: clientRef,
      board_type: boardType,
      atom_type: atomType,
      atom_key: atomKey,
      atom_value_jsonb: itemContent,
      affordance_dims: worldAffordanceDims(card),
      source_type: String(card.source_type || "manual"),
      ...(plainObject(card.knowledge_boundary_json) ? { knowledge_boundary_json: card.knowledge_boundary_json } : {}),
      ...(plainObject(card.apply_scope_json) ? { apply_scope_json: card.apply_scope_json } : {}),
      ...(plainObject(card.violate_cost_json) ? { violate_cost_json: card.violate_cost_json } : {}),
    }];
  });
}

function mapWorldBindings(world, worldStates, characters) {
  const refs = new Map(worldStates.map((item) => [item.client_ref, item.atom_key]));
  const worldKeys = new Set(worldStates.map((item) => item.atom_key));
  const characterRefs = new Set((characters?.characters || []).map((character) => String(character.client_ref || character.id || "").trim()).filter(Boolean));
  const endpoint = (binding, side) => {
    const suppliedType = String(binding[`${side}_ref_type`] || "").trim();
    const suppliedRef = String(binding[`${side}_ref_id`] || binding[side] || binding[`${side}_ref`] || "").trim();
    const worldRef = refs.get(suppliedRef) || (worldKeys.has(suppliedRef) ? suppliedRef : "");
    const refType = suppliedType || (worldRef ? "world" : characterRefs.has(suppliedRef) ? "character" : "");
    const refId = refType === "world" ? worldRef : refType === "character" && characterRefs.has(suppliedRef) ? suppliedRef : "";
    return { refType, refId };
  };
  return (world?.bindings || DATA?.worldBindings || []).flatMap((binding) => {
    const from = endpoint(binding, "from");
    const to = endpoint(binding, "to");
    if (!from.refId || !to.refId || !String(binding.type || binding.binding_type || "").trim()) return [];
    const strength = String(binding.strength || binding.binding_strength || "").trim();
    const allowedStrengths = new Set(["strong", "medium", "weak", "强", "中", "弱"]);
    return [{
      from_ref_type: from.refType,
      from_ref_id: from.refId,
      to_ref_type: to.refType,
      to_ref_id: to.refId,
      binding_type: String(binding.type || binding.binding_type).trim(),
      binding_strength: allowedStrengths.has(strength) ? strength : "",
    }];
  });
}

const CHARACTER_TYPES = Object.freeze({
  "核心主角": "protagonist",
  "主角": "protagonist",
  protagonist: "protagonist",
  "重要配角": "supporting",
  "配角": "supporting",
  "搭档": "supporting",
  "导师": "supporting",
  support: "supporting",
  supporting: "supporting",
  "反派大佬": "antagonist",
  "反派": "antagonist",
  "宿敌": "antagonist",
  antagonist: "antagonist",
  "常驻NPC": "ensemble",
  "群像": "ensemble",
  ensemble: "ensemble",
});

function mapCharacter(character) {
  const suppliedLayers = plainObject(character.five_layers_json) ? character.five_layers_json : {};
  const fiveLayers = {
    ...(Object.hasOwn(suppliedLayers, "L0") ? { L0: suppliedLayers.L0 } : { L0: character.philosophy || {} }),
    ...(Object.hasOwn(suppliedLayers, "L1") ? { L1: suppliedLayers.L1 } : character.L1 ? { L1: character.L1 } : {}),
    ...(Object.hasOwn(suppliedLayers, "L2") ? { L2: suppliedLayers.L2 } : character.L2 ? { L2: character.L2 } : {}),
    ...(Object.hasOwn(suppliedLayers, "L3") ? { L3: suppliedLayers.L3 } : character.L3 ? { L3: character.L3 } : {}),
  };
  return {
    client_ref: String(character.client_ref || character.id || "").trim(),
    char_name: String(character.char_name || character.name || "").trim(),
    char_type: CHARACTER_TYPES[character.char_type] || CHARACTER_TYPES[character.role] || character.char_type,
    gender: character.gender,
    five_layers_json: fiveLayers,
    knowledge_boundary_json: character.knowledge_boundary_json || character.knowledge_boundary || {},
    arc_json: character.arc_json || character.arc || {},
  };
}

function mapRelations(characters) {
  const references = new Set((characters?.characters || []).map((character) => String(character.client_ref || character.id || "")).filter(Boolean));
  const seen = new Set();
  const canonical = (characters?.relation_states || []).flatMap((relation) => {
    if (!plainObject(relation)) return [];
    const fromRef = String(relation.char_a_ref || relation.char_a || "");
    const toRef = String(relation.char_b_ref || relation.char_b || "");
    const pairKey = [fromRef, toRef].sort().join("::");
    if (!references.has(fromRef) || !references.has(toRef) || fromRef === toRef || seen.has(pairKey)) return [];
    const event = plainObject(relation.change_event_json)
      ? relation.change_event_json
      : relation.change_event
        ? { summary: String(relation.change_event) }
        : null;
    if (!event || !String(relation.relation_type || "").trim() || !String(relation.relation_hierarchy || "").trim()) return [];
    seen.add(pairKey);
    const item = {
      char_a_ref: fromRef,
      char_b_ref: toRef,
      relation_type: String(relation.relation_type),
      relation_hierarchy: String(relation.relation_hierarchy),
      relation_origin: relation.relation_origin,
      relation_overview: relation.relation_overview,
      change_event_json: event,
      trust: relation.trust,
      intimacy: relation.intimacy,
      power_balance: relation.power_balance,
      dependence: relation.dependence,
      hostility: relation.hostility,
      common_goal: relation.common_goal,
      secret_known: relation.secret_known,
      emotional_bond: relation.emotional_bond,
    };
    return [Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined))];
  });
  const legacy = (characters?.characters || []).flatMap((character) => {
    const fromRef = String(character.client_ref || character.id || "");
    return Object.entries(character.relations || {}).flatMap(([toRef, relation]) => {
      if (!references.has(fromRef) || !references.has(toRef) || !plainObject(relation)) return [];
      const pairKey = [fromRef, toRef].sort().join("::");
      if (seen.has(pairKey)) return [];
      seen.add(pairKey);
      const event = plainObject(relation.change_event_json)
        ? relation.change_event_json
        : relation.change_event
          ? { summary: String(relation.change_event) }
          : null;
      if (!event || !String(relation.relation_type || "").trim() || !String(relation.relation_hierarchy || "").trim()) return [];
      const item = {
        char_a_ref: fromRef,
        char_b_ref: toRef,
        relation_type: String(relation.relation_type),
        relation_hierarchy: String(relation.relation_hierarchy),
        relation_origin: relation.relation_origin,
        relation_overview: relation.relation_overview,
        change_event_json: event,
        trust: relation.trust,
        intimacy: relation.intimacy,
        power_balance: relation.power_balance,
        dependence: relation.dependence,
        hostility: relation.hostility,
        common_goal: relation.common_goal,
        secret_known: relation.secret_known,
        emotional_bond: relation.emotional_bond,
      };
      return [Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined))];
    });
  });
  return [...canonical, ...legacy];
}

function mapInitialL1a(conflicts, characters) {
  const supplied = plainObject(conflicts?.initial_l1a) ? conflicts.initial_l1a : null;
  const entry = supplied || (conflicts?.conflictEntries || []).find((candidate) => plainObject(candidate) && (candidate.l1a_name || candidate.title || candidate.summary));
  if (!entry) return undefined;
  const knownCharacterRefs = new Set((characters?.characters || []).map((character) => String(character.client_ref || character.id || "")).filter(Boolean));
  const participantRefs = (entry.participant_char_refs || entry.involved_chars || []).filter((value) => knownCharacterRefs.has(String(value))).map(String);
  const l1a = {
    l1a_index: 1,
    l1a_name: String(entry.l1a_name || entry.title || entry.summary || "").trim(),
    scene_location: String(entry.scene_location || "").trim(),
    conflict_background: String(entry.conflict_background || entry.summary || "").trim(),
    escalation_path: String(entry.escalation_path || entry.escalation || "").trim(),
    stakes: String(entry.stakes || entry.stake_cost || "").trim(),
    irreversible_consequence: String(entry.irreversible_consequence || entry.consequences || "").trim(),
    plot_emotion_commit: plainObject(entry.plot_emotion_commit) ? entry.plot_emotion_commit : {},
    arc_requirement: plainObject(entry.arc_requirement) ? entry.arc_requirement : {},
    info_reveal_boundary: plainObject(entry.info_reveal_boundary) ? entry.info_reveal_boundary : {},
    role_arc_json: plainObject(entry.role_arc_json) ? entry.role_arc_json : {},
    participant_char_refs: participantRefs,
  };
  return l1a;
}

function collectPayload() {
  const origin = originFields();
  const world = DATA?.stages?.find((step) => step.key === "world_settings");
  const characters = DATA?.stages?.find((step) => step.key === "characters");
  const conflicts = DATA?.stages?.find((step) => step.key === "conflict_seed");
  const worldStates = mapWorldStates(world);
  const initialL1aCandidate = mapInitialL1a(conflicts, characters);
  const initialL1a = conflicts?.initial_l1a_adopted === true
    ? initialL1aCandidate
    : undefined;
  const payload = {
    local_operator_id: localOperatorId,
    correlation_id: draftCorrelationId,
    idempotency_key: draftIdempotencyKey,
    title: String(origin.title || DATA?.book?.bookName || "").trim(),
    intent_json: {
      genre_main: canonicalGenre(origin.genre || DATA?.book?.intent_json?.genre),
      core_conflict: DATA?.book?.intent_json?.core_conflict || origin.creativeIntent || "",
      forbidden_direction: DATA?.book?.intent_json?.forbidden_direction || origin.forbid || "",
      target_emotion: DATA?.book?.intent_json?.target_emotion || "",
      core_selling_point: DATA?.book?.intent_json?.core_selling_point || origin.sellingPoint || "",
      creative_intent: DATA?.book?.intent_json?.creative_intent || origin.creativeIntent || "",
      genre_sub: origin.subGenre || "",
    },
    forbid_json: DATA?.book?.forbid_json || { rules: origin.forbid ? [origin.forbid] : [] },
    selling_points_json: origin.sellingPoint ? [origin.sellingPoint] : [],
    target_words: numericValue(origin.targetWords || DATA?.book?.targetWords),
    chapter_words: numericValue(origin.chapterWords || DATA?.book?.chapterWords),
    world_states: worldStates,
    world_bindings: mapWorldBindings(world, worldStates, characters),
    characters: (characters?.characters || []).map(mapCharacter),
    relations: mapRelations(characters),
    initial_memories: [],
    initial_l1a: initialL1a,
  };
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}

function hasKeys(value, keys) {
  return plainObject(value) && keys.every((key) => Object.hasOwn(value, key));
}

function completeCharacter(character) {
  const layers = ["L0", "L1", "L2", "L3"];
  const quadrants = ["knows", "unknown", "false_belief", "reasonable_suspect"];
  return Boolean(
    character.client_ref
    && character.char_name
    && ["protagonist", "supporting", "ensemble", "antagonist"].includes(character.char_type)
    && hasKeys(character.five_layers_json, layers)
    && layers.every((key) => plainObject(character.five_layers_json[key]) && Object.keys(character.five_layers_json[key]).length > 0)
    && hasKeys(character.knowledge_boundary_json, quadrants)
    && quadrants.every((key) => Array.isArray(character.knowledge_boundary_json[key]))
    && plainObject(character.arc_json)
    && Object.keys(character.arc_json).length > 0,
  );
}

function completeInitialL1a(value) {
  return Boolean(
    value?.l1a_name
    && value?.scene_location
    && value?.conflict_background
    && value?.escalation_path
    && value?.stakes
    && value?.irreversible_consequence
    && plainObject(value.plot_emotion_commit) && Object.keys(value.plot_emotion_commit).length > 0
    && plainObject(value.arc_requirement) && Object.keys(value.arc_requirement).length > 0
    && plainObject(value.info_reveal_boundary) && Object.keys(value.info_reveal_boundary).length > 0
    && plainObject(value.role_arc_json) && Object.keys(value.role_arc_json).length > 0
    && Array.isArray(value.participant_char_refs) && value.participant_char_refs.length > 0,
  );
}

const WORLD_L1_FIELDS = Object.freeze({
  rule: ["violate_cost", "apply_scope", "rule_type"],
  geography: ["danger_level", "location_text"],
  resource: ["scarcity_level", "usability"],
  faction: ["faction_status", "stance"],
  profession: ["cost_mechanism", "is_system"],
  monster: ["threat_level", "counter_text"],
  event: ["event_era"],
});

function completeWorldL1Value(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (plainObject(value)) return Object.keys(value).length > 0;
  return typeof value === "number" ? Number.isFinite(value) : typeof value === "boolean";
}

function completeWorldState(value) {
  const atomTypes = ["rule", "fact", "resource", "event", "faction", "job", "monster", "geo"];
  const requiredL1Fields = WORLD_L1_FIELDS[value?.board_type] || [];
  return Boolean(
    value?.board_type
    && requiredL1Fields.length > 0
    && atomTypes.includes(value?.atom_type)
    && value?.atom_key
    && plainObject(value.atom_value_jsonb)
    && Object.keys(value.atom_value_jsonb).length > 0
    && requiredL1Fields.every((field) => completeWorldL1Value(value.atom_value_jsonb[field]))
    && Array.isArray(value.affordance_dims)
    && value.affordance_dims.length > 0
    && value.affordance_dims.every((dimension) => typeof dimension === "string" && dimension.trim())
    && (value.atom_type !== "fact" || plainObject(value.knowledge_boundary_json)),
  );
}

function completeWorldBinding(value) {
  return Boolean(
    ["world", "character"].includes(value?.from_ref_type)
    && value?.from_ref_id
    && ["world", "character"].includes(value?.to_ref_type)
    && value?.to_ref_id
    && value?.binding_type
    && ["strong", "medium", "weak", "强", "中", "弱"].includes(value?.binding_strength),
  );
}

function traceableCharacterResources(payload) {
  const resourceKeys = new Set(payload.world_states
    .filter((world) => world.board_type === "resource" && world.atom_type === "resource")
    .map((world) => world.atom_key));
  return payload.characters.every((character) => {
    const resources = character.five_layers_json?.L2?.resources;
    if (resources === undefined) return true;
    if (!Array.isArray(resources)) return false;
    return resources.every((resourceRef) => (
      typeof resourceRef === "string"
      && resourceRef.trim()
      && resourceKeys.has(resourceRef)
      && payload.world_bindings.some((binding) => (
        binding.from_ref_type === "character"
        && binding.from_ref_id === character.client_ref
        && binding.to_ref_type === "world"
        && binding.to_ref_id === resourceRef
      ))
    ));
  });
}

function completeRelation(value) {
  const signed = ["trust", "intimacy", "power_balance", "dependence", "emotional_bond"];
  const unsigned = ["hostility", "common_goal", "secret_known"];
  return Boolean(
    value?.char_a_ref
    && value?.char_b_ref
    && value.char_a_ref !== value.char_b_ref
    && value?.relation_type
    && value?.relation_hierarchy
    && plainObject(value.change_event_json)
    && Object.keys(value.change_event_json).length > 0
    && signed.every((key) => Number.isInteger(value[key]) && value[key] >= -100 && value[key] <= 100)
    && unsigned.every((key) => Number.isInteger(value[key]) && value[key] >= 0 && value[key] <= 100),
  );
}

function clientGate(payload, action = "confirm_create") {
  const origin = originFields();
  if (!canonicalGenre(payload.intent_json?.genre_main)) {
    return { state: "returned", message: "请先在“创作原点”选择主题材，系统需要据此加载有效题材技能。" };
  }
  if (action === "preview") return null;
  const locks = window.__newBookRuntime?.lockedStages?.() || [];
  if ([0, 1, 2, 3].some((index) => !locks.includes(index))) {
    return { state: "returned", message: "请先逐步检查并锁定创作原点、世界设定、角色设定与冲突种子。草稿已保留。" };
  }
  const missingOrigin = [
    ...["title", "genre", "targetWords", "chapterWords", "creativeIntent", "sellingPoint", "forbid"].filter((key) => !origin[key]),
    ...(!String(payload.intent_json?.target_emotion ?? "").trim() ? ["\u76ee\u6807\u60c5\u7eea"] : []),
  ];
  if (missingOrigin.length) {
    return { state: "returned", message: `创作原点仍缺少：${missingOrigin.join("、")}。草稿已保留。` };
  }
  const requiredBoards = ["rule", "geography", "resource", "faction", "profession", "monster", "event"];
  const suppliedBoards = new Set(payload.world_states.map((item) => item.board_type));
  const missingBoards = requiredBoards.filter((board) => !suppliedBoards.has(board));
  if (missingBoards.length || payload.world_states.some((item) => !completeWorldState(item))) {
    return { state: "returned", message: "世界设定必须包含七个板块，并补齐各板块用于下游推演的必需属性；草稿未提交。" };
  }
  if (payload.world_bindings.some((binding) => !completeWorldBinding(binding))) {
    return { state: "returned", message: "每条世界绑定都需要明确两端、类型与强度；页面不会把缺失强度默认为中等。" };
  }
  if (!payload.characters.length || payload.characters.some((character) => !completeCharacter(character))) {
    return { state: "returned", message: "每个初始角色都需要完整的 L0-L3、知识边界四象限与弧光；草稿未提交。" };
  }
  if (!traceableCharacterResources(payload)) {
    return { state: "returned", message: "角色 L2 中的每项具体资源都必须对应当前世界资源，并保留该角色到资源的绑定；草稿未提交。" };
  }
  if (payload.relations.some((relation) => !completeRelation(relation))) {
    return { state: "returned", message: "每条初始关系都需要创作者确认八项关系数值、关系类型、层级与变化依据。" };
  }
  if (!completeInitialL1a(payload.initial_l1a)) {
    return {
      state: "returned",
      message: "当前草稿缺少已由创作者确认的单个初始 L1A。AI 返回仍是未保存候选，页面不会擅自把候选写入正式提交包；草稿已保留。",
    };
  }
  return null;
}

function appendChat(role, text) {
  if (!text) return;
  if (window.__newBookRuntime?.appendChat) {
    window.__newBookRuntime.appendChat(role, text);
    return;
  }
  const history = document.querySelector("#chatHistory");
  if (!history) return;
  if (history.querySelector(".chat-empty")) history.textContent = "";
  const item = document.createElement("div");
  item.className = `chat ${role === "user" ? "chat-end" : "chat-start"}`;
  const label = document.createElement("div");
  label.className = "chat-header";
  label.textContent = role === "user" ? "作者" : "AI 向导";
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${role === "user" ? "chat-bubble-primary" : ""}`;
  bubble.textContent = text;
  item.append(label, bubble);
  history.append(item);
  history.scrollTop = history.scrollHeight;
}

function persistDraftNow() {
  window.clearTimeout(draftSaveTimer);
  const snapshot = window.__newBookRuntime?.exportDraft?.();
  if (!snapshot || !window.__newBookRuntime?.hasDraftContent?.()) {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
    return;
  }
  localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ ...snapshot, saved_at: new Date().toISOString() }));
}

function draftContainsBaseline(current, baseline) {
  if (!plainObject(baseline)) return true;
  if (!plainObject(current)) return false;
  const baselineOrigin = plainObject(baseline.origin) ? baseline.origin : {};
  const currentOrigin = plainObject(current.origin) ? current.origin : {};
  if (Object.entries(baselineOrigin).some(([key, value]) => String(value || "").trim() && currentOrigin[key] !== value)) return false;
  const baselineChat = Array.isArray(baseline.chat) ? baseline.chat : [];
  const currentChat = Array.isArray(current.chat) ? current.chat : [];
  if (currentChat.length < baselineChat.length) return false;
  if (baselineChat.some((item, index) => currentChat[index]?.role !== item?.role || currentChat[index]?.text !== item?.text)) return false;
  for (const key of ["characters", "relation_states", "conflict_entries"]) {
    if ((baseline[key]?.length || 0) > (current[key]?.length || 0)) return false;
  }
  if ((baseline.world?.cards?.length || 0) > (current.world?.cards?.length || 0)) return false;
  if ((baseline.world?.bindings?.length || 0) > (current.world?.bindings?.length || 0)) return false;
  if (plainObject(baseline.initial_l1a) && !plainObject(current.initial_l1a)) return false;
  return true;
}

function captureRequestDraft() {
  const snapshot = window.__newBookRuntime?.exportDraft?.();
  if (!snapshot || window.__newBookRuntime?.hasDraftContent?.() !== true) return null;
  try {
    return JSON.parse(JSON.stringify(snapshot));
  } catch {
    return snapshot;
  }
}

function preserveRequestDraft(snapshot) {
  if (snapshot) {
    const current = window.__newBookRuntime?.exportDraft?.();
    if (!draftContainsBaseline(current, snapshot)) window.__newBookRuntime?.restoreDraft?.(snapshot);
  }
  persistDraftNow();
}

function markDraftChanged() {
  if (state === "completed") return;
  if (["empty", "failed", "returned", "restored", "blocked", "duplicate"].includes(state)) {
    state = "normal";
    renderRuntime();
  }
  window.__newBookRuntime?.syncConfirmAction?.();
  window.clearTimeout(draftSaveTimer);
  draftSaveTimer = window.setTimeout(persistDraftNow, 120);
}

function restoreDraft() {
  let snapshot = null;
  try {
    snapshot = JSON.parse(localStorage.getItem(DRAFT_STORAGE_KEY) || "null");
  } catch {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
  }
  const restored = snapshot ? window.__newBookRuntime?.restoreDraft?.(snapshot) === true : false;
  return restored || window.__newBookRuntime?.hasDraftContent?.() === true;
}

function candidateMessage(result, application) {
  const lockedStages = window.__newBookRuntime?.lockedStages?.() || [];
  const skippedLockedStages = Array.isArray(application?.skipped_locked_stages)
    ? application.skipped_locked_stages.filter(Boolean)
    : [];
  if (lockedStages.length) {
    return "系统仅允许把本轮候选合并到未锁定的本地草稿；当前已锁定阶段保持不变。请在阶段面板核对本轮结果。";
  }
  if (skippedLockedStages.length) {
    return `本轮模型建议涉及已锁定的${skippedLockedStages.join("、")}，浏览器已忽略这些改写；锁定阶段未改变。未锁定阶段的候选已照常显示，请核对后再锁定。`;
  }
  if (result.lock_respected === false) {
    return "本轮模型建议含有对已锁定阶段的改写，系统已忽略这些内容；锁定阶段未改变。未锁定阶段的候选已照常显示，请核对后再锁定。";
  }
  return result.chat_message || "后端已返回本地候选草稿。";
}

function projectPreview(result) {
  const missing = Array.isArray(result.missing_items)
    ? result.missing_items
    : Array.isArray(result.missing_fields)
      ? result.missing_fields
      : [];
  const application = window.__newBookRuntime?.applyCandidateUpdates?.(result.incremental_updates, result.lock_respected) || null;
  const appliedCandidate = Array.isArray(application?.applied_stages) && application.applied_stages.length > 0;
  state = appliedCandidate ? "normal" : missing.length ? "returned" : "normal";
  appendChat("assistant", candidateMessage(result, application));
  window.__newBookRuntime?.showPreview?.(result, application);
  persistDraftNow();
  const localDraft = application?.applied_stages?.length
    ? "本轮候选已合并至本地草稿，请在阶段中核对并确认锁定；尚未入库。"
    : "本轮未更改本地草稿；尚未入库。";
  if (missing.length) appendChat("assistant", `待补充：${missing.join("、")}`);
  renderRuntime(appliedCandidate ? localDraft : missing.length ? `仍有 ${missing.length} 项待补充，请查看对话中的完整清单。` : localDraft);
}

const errorMessages = Object.freeze({
  INVALID_REQUEST: "提交内容不符合当前开书合同，草稿已保留。",
  UNSUPPORTED_GENRE: "当前主题材没有可用的系统内置技能；请检查题材选择或补齐题材技能后重试，草稿未改变。",
  SCOPE_REJECTED: "当前本地操作者范围不可用，草稿未提交。",
  LOCAL_OPERATOR_MISMATCH: "当前浏览器保存的本地操作者与此安装不一致，草稿未提交。",
  INITIAL_DATA_INCOMPLETE: "开书数据仍不完整，草稿已保留，请按阶段继续补全。",
  DUPLICATE_TITLE: "当前本地操作者已有同名作品，请修改书名后重试。",
  ACTIVE_SKILL_UNAVAILABLE: "当前题材缺少可用的系统内置技能，AI 预览已停止，草稿未改变。",
  ACTIVE_CONFIG_UNAVAILABLE: "当前 Prompt 或模型模板尚未形成有效绑定，AI 预览已停止，草稿未改变。",
  PREVIEW_OUTPUT_INVALID: "AI 返回未通过候选格式校验，页面未采用该结果。",
  WRITE_FAILED: "开书事务未完成，未产生半完成作品，草稿已保留。",
  RPC_UNAVAILABLE: "服务暂时不可用，草稿已保留；请恢复后重试。",
});

function errorCopy(result, fallbackCode = "WRITE_FAILED") {
  const error = result?.redacted_error || result?.error || {};
  const code = error.code || result?.code || fallbackCode;
  return { code, message: errorMessages[code] || error.message || result?.message || errorMessages[fallbackCode] };
}

function projectBlocked(result) {
  const error = errorCopy(result, result?.code || "PREVIEW_OUTPUT_INVALID");
  state = "blocked";
  persistDraftNow();
  renderRuntime(`${error.code}: ${error.message}`);
}

function clearDraftStorage() {
  localStorage.removeItem(DRAFT_STORAGE_KEY);
  localStorage.removeItem(DRAFT_CORRELATION_STORAGE_KEY);
  localStorage.removeItem("NEW_BOOK_WIZARD_STATE_V7");
  localStorage.removeItem("NEW_BOOK_CHAR_STATE_V7");
}

function currentBook(bookId) {
  const context = { local_operator_id: localOperatorId, current_book_id: bookId };
  localStorage.setItem(BOOK_CONTEXT_STORAGE_KEY, JSON.stringify(context));
  window.dispatchEvent(new CustomEvent("new-book:created", { detail: context }));
}

async function request(action, creatorMessage = "") {
  if (!["preview", "confirm_create"].includes(action) || ["loading", "disabled", "completed"].includes(state)) return;
  if (!validUuid(localOperatorId)) {
    state = "disabled";
    renderRuntime("本地操作者范围不可用；草稿未提交。");
    return;
  }
  const payload = collectPayload();
  const issue = clientGate(payload, action);
  if (issue) {
    state = issue.state;
    persistDraftNow();
    renderRuntime(issue.message);
    return;
  }
  const requestDraft = captureRequestDraft();
  persistDraftNow();
  state = "loading";
  renderRuntime(action === "preview" ? "正在生成未保存候选。" : "正在执行原子开书事务。" );
  const previewPayload = action === "preview"
    ? { ...payload, locked_stages: window.__newBookRuntime?.lockedStages?.() || [] }
    : payload;
  const envelope = { action, form_data: previewPayload };
  if (action === "preview" && creatorMessage) envelope.creator_message = creatorMessage;
  let response;
  let result;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(envelope),
    });
    result = await response.json().catch(() => ({}));
  } catch {
    state = "failed";
    preserveRequestDraft(requestDraft);
    renderRuntime(errorMessages.RPC_UNAVAILABLE);
    return;
  }
  preserveRequestDraft(requestDraft);
  if (result?.status === "preview") {
    try {
      projectPreview(result);
    } catch {
      state = "failed";
      preserveRequestDraft(requestDraft);
      renderRuntime(errorMessages.PREVIEW_OUTPUT_INVALID);
    }
    return result;
  }
  if (result?.status === "BLOCKED") {
    projectBlocked(result);
    return result;
  }
  const failure = errorCopy(result, action === "preview" ? "RPC_UNAVAILABLE" : "WRITE_FAILED");
  if (response.status === 409 || failure.code === "DUPLICATE_TITLE") {
    state = "duplicate";
    persistDraftNow();
    renderRuntime(failure.message);
    return result;
  }
  if (!response.ok || result?.ok !== true || !validUuid(result?.book_id)) {
    state = failure.code === "INITIAL_DATA_INCOMPLETE" || failure.code === "INVALID_REQUEST" ? "returned" : "failed";
    persistDraftNow();
    renderRuntime(`${failure.code}: ${failure.message}`);
    return result;
  }
  currentBook(result.book_id.toLowerCase());
  createdBookSummary = `${String(DATA?.book?.bookName || DATA?.book?.title || "新书")} · ${result.book_id}`;
  draftIdempotencyKey = crypto.randomUUID();
  localStorage.setItem(DRAFT_IDEMPOTENCY_STORAGE_KEY, draftIdempotencyKey);
  clearDraftStorage();
  state = "completed";
  renderRuntime(`已切换至当前作品：${result.book_id}`);
  window.setTimeout(() => location.assign(`/books/${encodeURIComponent(result.book_id)}/world`), 600);
  return result;
}

async function previewFromChat(event) {
  event?.preventDefault();
  const input = document.querySelector("#chatInput");
  const value = input?.value.trim();
  if (!value) return;
  appendChat("user", value);
  input.value = "";
  persistDraftNow();
  await request("preview", value);
}

function bindChatForm() {
  const form = document.querySelector("form.chat-input");
  if (!form) return;
  form.removeAttribute("onsubmit");
  const submitPreview = (event) => {
    event.preventDefault();
    void previewFromChat(event).catch((error) => {
      state = "failed";
      persistDraftNow();
      renderRuntime(error?.message || errorMessages.RPC_UNAVAILABLE);
    });
  };
  window.__newBookPreviewFromChat = submitPreview;
  if (form.dataset.newBookChatBound === "true") return;
  form.dataset.newBookChatBound = "true";
  form.addEventListener("submit", submitPreview);
}

function requestCreateFromPage() {
  void request("confirm_create").catch((error) => {
    state = "failed";
    persistDraftNow();
    renderRuntime(error?.message || errorMessages.RPC_UNAVAILABLE);
  });
}

function bindCreateButtons(root = document) {
  root.querySelectorAll?.('[data-new-book-action="confirm-create"]').forEach((button) => {
    const issue = clientGate(collectPayload(), "confirm_create");
    button.disabled = Boolean(issue);
    button.setAttribute("aria-disabled", String(Boolean(issue)));
    if (issue) button.title = issue.message;
    else button.removeAttribute("title");
    if (button.dataset.newBookCreateBound === "true") return;
    button.dataset.newBookCreateBound = "true";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      requestCreateFromPage();
    });
  });
}

function bindExistingControls() {
  window.__newBookDraftChanged = markDraftChanged;
  window.__newBookCanAdoptInitialL1a = () => completeInitialL1a(mapInitialL1a(
    DATA?.stages?.find((step) => step.key === "conflict_seed"),
    DATA?.stages?.find((step) => step.key === "characters"),
  ));
  window.__newBookCanLockStage = (index) => {
    const payload = collectPayload();
    if (index === 0) {
      const origin = originFields();
      const missing = [
        ...["title", "genre", "targetWords", "chapterWords", "creativeIntent", "sellingPoint", "forbid"].filter((key) => !origin[key]),
        ...(!String(payload.intent_json?.target_emotion ?? "").trim() ? ["\u76ee\u6807\u60c5\u7eea"] : []),
      ];
      return missing.length ? { ok: false, message: `创作原点仍缺少：${missing.join("、")}` } : { ok: true };
    }
    if (index === 1) {
      const boards = new Set(payload.world_states.map((item) => item.board_type));
      return boards.size === 7
          && payload.world_states.every(completeWorldState)
          && payload.world_bindings.every(completeWorldBinding)
        ? { ok: true }
        : { ok: false, message: "请先补齐世界设定七个板块及各板块必需属性，并明确已有绑定的两端、类型和强度。" };
    }
    if (index === 2) {
      return payload.characters.length
          && payload.characters.every(completeCharacter)
          && payload.relations.every(completeRelation)
        ? { ok: true }
        : { ok: false, message: "请先补齐角色 L0-L3、知识边界四象限、弧光与已提交关系的完整数值。" };
    }
    if (index === 3) {
      return completeInitialL1a(payload.initial_l1a)
        ? { ok: true }
        : { ok: false, message: "缺少已由创作者确认的单个初始 L1A；AI 候选不会被自动采用。" };
    }
    return { ok: true };
  };
  window.sendChat = previewFromChat;
  window.runIntegrityAnalysis = () => request("preview");
  window.aiAddWorldItem = () => request("preview", "请基于当前草稿给出一条世界设定候选，不要覆盖已锁定阶段。");
  window.charAdd = () => request("preview", "请基于当前草稿给出一名角色候选，不要覆盖已锁定阶段。");
  window.startProduction = requestCreateFromPage;
  window.openWorkbench = () => location.assign("/workbench");
  bindChatForm();
  bindCreateButtons();
  new MutationObserver((records) => {
    records.forEach((record) => record.addedNodes.forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE) bindCreateButtons(node);
    }));
  }).observe(document.body, { childList: true, subtree: true });
}

async function ensureLocalOperator(retried = false) {
  state = "loading";
  renderRuntime("正在创建或恢复本地操作者范围。" );
  const body = { action: "operator" };
  if (validUuid(localOperatorId)) body.local_operator_id = localOperatorId;
  try {
    const response = await requestOperator(body);
    const result = await response.json().catch(() => ({}));
    const operatorId = result?.local_operator_id || result?.result?.local_operator_id;
    if (!response.ok || result?.ok !== true || !validUuid(operatorId)) {
      const failure = errorCopy(result, "RPC_UNAVAILABLE");
      if (!retried && failure.code === "LOCAL_OPERATOR_MISMATCH") {
        localStorage.removeItem(OPERATOR_STORAGE_KEY);
        localOperatorId = "";
        return ensureLocalOperator(true);
      }
      throw new Error(failure.message);
    }
    localOperatorId = operatorId.toLowerCase();
    localStorage.setItem(OPERATOR_STORAGE_KEY, localOperatorId);
    const restored = restoreDraft();
    state = restored ? "restored" : "empty";
    renderRuntime();
  } catch (error) {
    state = "disabled";
    const message = error?.name === "AbortError" ? errorMessages.RPC_UNAVAILABLE : error?.message || errorMessages.RPC_UNAVAILABLE;
    renderRuntime(message);
  }
}

async function requestOperator(body) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), OPERATOR_TIMEOUT_MS);
  try {
    return await fetch(OPERATOR_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

bindExistingControls();
renderRuntime();
ensureLocalOperator();

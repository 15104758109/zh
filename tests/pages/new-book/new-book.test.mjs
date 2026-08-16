import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const page = readFileSync(path.join(root, "apps/web/src/pages/new-book/index.html"), "utf8");
const data = readFileSync(path.join(root, "apps/web/src/pages/new-book/new_book_wizard_data.js"), "utf8");
const bridge = readFileSync(path.join(root, "apps/web/src/pages/new-book/new-book-bridge.mjs"), "utf8");
const promptDocument = readFileSync(path.join(root, "docs/后端/对齐版提示词.md"), "utf8");

function extractFp00103Prompt(source) {
  const sectionStart = source.indexOf("### FP001-03");
  const sectionEnd = source.indexOf("### FP001-05", sectionStart);
  assert.notEqual(sectionStart, -1, "FP001-03 section must exist");
  assert.notEqual(sectionEnd, -1, "FP001-03 section must end before FP001-05");
  const section = source.slice(sectionStart, sectionEnd);
  const fencedBlock = (heading) => {
    const headingIndex = section.indexOf(`#### ${heading}`);
    const fenceStart = section.indexOf("```", headingIndex) + 3;
    const fenceEnd = section.indexOf("```", fenceStart);
    assert.ok(headingIndex >= 0 && fenceStart >= 3 && fenceEnd > fenceStart, `${heading} fenced block must exist inside FP001-03`);
    return section.slice(fenceStart, fenceEnd).trim().replaceAll("\r\n", "\n");
  };
  return [
    "System Prompt:",
    fencedBlock("System Prompt"),
    "",
    "User Prompt Template:",
    fencedBlock("User Prompt"),
  ].join("\n");
}

const newBookPrompt = extractFp00103Prompt(promptDocument);

test("new book starts empty rather than presenting fabricated business content", () => {
  assert.match(data, /bookName:\s*""/);
  assert.match(data, /chat:\s*\[\s*\]/);
  assert.match(data, /cards:\s*\[\s*\]/);
  assert.match(data, /characters:\s*\[\s*\]/);
  assert.match(data, /conflictEntries:\s*\[\s*\]/);
  assert.match(data, /prototypeRisks:\s*\[\s*\]/);
  assert.match(page, /尚无对话记录/);
});

test("bridge sends the live ZH01 creation shape instead of the superseded request shape", () => {
  assert.match(bridge, /function mapWorldStates/);
  assert.match(bridge, /world_states: worldStates/);
  assert.match(bridge, /function mapInitialL1a/);
  assert.match(bridge, /return l1a;/);
  assert.match(bridge, /intent_json: \{\s*\n\s*genre_main:/);
  assert.match(bridge, /char_a_ref:/);
  assert.match(bridge, /change_event_json:/);
  assert.match(bridge, /participant_char_refs:/);
  assert.match(page, /scene_location: candidate\.scene_location/);
  assert.match(bridge, /"大事": "event"/);
  assert.doesNotMatch(bridge, /world_atoms/);
});

test("one local new-book draft keeps its ZH01 correlation across preview turns and refresh", () => {
  assert.match(bridge, /const DRAFT_CORRELATION_STORAGE_KEY = "zhreplan\.new_book_draft\.correlation_id\.v1"/);
  assert.match(bridge, /let draftCorrelationId = validToken\(localStorage\.getItem\(DRAFT_CORRELATION_STORAGE_KEY\)\)/);
  assert.match(bridge, /correlation_id: draftCorrelationId/);
  assert.doesNotMatch(bridge, /correlation_id:\s*`book-\$\{crypto\.randomUUID\(\)\}`/);
  assert.match(bridge, /localStorage\.removeItem\(DRAFT_CORRELATION_STORAGE_KEY\)/);
});

test("initial L1A preserves a real scene location and rejects an incomplete production handoff", () => {
  const mapSource = bridge.slice(
    bridge.indexOf("function mapInitialL1a"),
    bridge.indexOf("function collectPayload"),
  );
  const completeSource = bridge.slice(
    bridge.indexOf("function completeInitialL1a"),
    bridge.indexOf("function clientGate"),
  );
  const helpers = new Function(
    "plainObject",
    `${mapSource}\n${completeSource}\nreturn { mapInitialL1a, completeInitialL1a };`,
  )((value) => value !== null && typeof value === "object" && !Array.isArray(value));
  const entry = {
    l1a_name: "灰港断电夜",
    scene_location: "江城市灰港变电站",
    conflict_background: "尸潮切断火种计划的电力。",
    escalation_path: "抢修、诱敌、守住主变压器。",
    stakes: "方舟失去能源。",
    irreversible_consequence: "失败会暴露地下交通网。",
    plot_emotion_commit: { plot: "restore power", emotion: "limited trust" },
    arc_requirement: { direction: "growth" },
    info_reveal_boundary: { reveal: ["energy is decaying"] },
    role_arc_json: { lead: "growth" },
    participant_char_refs: ["lead"],
  };

  const mapped = helpers.mapInitialL1a({ initial_l1a: entry }, { characters: [{ client_ref: "lead" }] });
  assert.equal(mapped.scene_location, entry.scene_location);
  assert.equal(helpers.completeInitialL1a(mapped), true);
  assert.equal(helpers.completeInitialL1a({ ...mapped, scene_location: "" }), false);
  assert.equal(helpers.completeInitialL1a({ ...mapped, plot_emotion_commit: {} }), false);
  assert.equal(helpers.completeInitialL1a({ ...mapped, participant_char_refs: [] }), false);
});

test("new-book client completeness matches the canonical non-empty character and world contract", () => {
  const characterSource = bridge.slice(
    bridge.indexOf("function hasKeys"),
    bridge.indexOf("function completeInitialL1a"),
  );
  const worldContractStart = bridge.indexOf("const WORLD_L1_FIELDS");
  const worldSource = bridge.slice(
    worldContractStart >= 0 ? worldContractStart : bridge.indexOf("function completeWorldState"),
    bridge.indexOf("function clientGate"),
  );
  const completeCharacter = new Function(
    "plainObject",
    `${characterSource}\nreturn completeCharacter;`,
  )((value) => value !== null && typeof value === "object" && !Array.isArray(value));
  const completeness = new Function(
    "plainObject",
    `${worldSource}\nreturn { completeWorldState, completeWorldBinding, completeRelation };`,
  )((value) => value !== null && typeof value === "object" && !Array.isArray(value));
  const character = {
    client_ref: "lead",
    char_name: "Lead",
    char_type: "protagonist",
    five_layers_json: { L0: { belief: "build" }, L1: { desire: "survive" }, L2: { role: "engineer" }, L3: { bond: "alliance" } },
    knowledge_boundary_json: { knows: [], unknown: [], false_belief: [], reasonable_suspect: [] },
    arc_json: { direction: "growth" },
  };
  assert.equal(completeCharacter(character), true);
  assert.equal(completeCharacter({ ...character, arc_json: {} }), false);
  assert.equal(completeCharacter({ ...character, five_layers_json: { ...character.five_layers_json, L2: {} } }), false);
  assert.equal(completeCharacter({ ...character, knowledge_boundary_json: { ...character.knowledge_boundary_json, knows: {} } }), false);

  const worldItems = [
    ["rule", "rule", { violate_cost: "resource loss", apply_scope: "the district", rule_type: "rationing" }],
    ["geography", "geo", { danger_level: "high", location_text: "the district checkpoint" }],
    ["resource", "resource", { scarcity_level: "scarce", usability: "identity evidence" }],
    ["faction", "faction", { faction_status: "stable", stance: "defensive" }],
    ["profession", "job", { cost_mechanism: "credibility", is_system: false }],
    ["monster", "monster", { threat_level: "high", counter_text: "sealed filters" }],
    ["event", "event", { event_era: "opening" }],
  ].map(([board_type, atom_type, atom_value_jsonb]) => ({
    board_type,
    atom_type,
    atom_key: `${board_type}.initial`,
    atom_value_jsonb,
    affordance_dims: ["documented-use"],
  }));
  for (const world of worldItems) {
    assert.equal(completeness.completeWorldState(world), true, world.board_type);
    const [requiredField] = Object.keys(world.atom_value_jsonb);
    assert.equal(completeness.completeWorldState({
      ...world,
      atom_value_jsonb: Object.fromEntries(Object.entries(world.atom_value_jsonb).filter(([key]) => key !== requiredField)),
    }), false, `${world.board_type} must require ${requiredField}`);
  }
  const rule = worldItems[0];
  assert.equal(completeness.completeWorldState({ ...rule, atom_value_jsonb: {} }), false);
  assert.equal(completeness.completeWorldState({ ...rule, affordance_dims: [] }), false);
  assert.equal(completeness.completeWorldState({ ...rule, atom_type: "fact" }), false);
  assert.equal(completeness.completeWorldState({ ...rule, atom_type: "fact", knowledge_boundary_json: {} }), true);
  assert.equal(completeness.completeWorldBinding({
    from_ref_type: "world", from_ref_id: "rule.energy", to_ref_type: "world", to_ref_id: "resource.core",
    binding_type: "limits", binding_strength: "strong",
  }), true);
  assert.equal(completeness.completeWorldBinding({
    from_ref_type: "world", from_ref_id: "rule.energy", to_ref_type: "world", to_ref_id: "resource.core",
    binding_type: "limits", binding_strength: "",
  }), false);
  const relation = {
    char_a_ref: "lead", char_b_ref: "rival", relation_type: "alliance", relation_hierarchy: "peer",
    trust: 10, intimacy: 0, power_balance: 0, dependence: 20, hostility: 5, common_goal: 70,
    secret_known: 0, emotional_bond: 10, change_event_json: { summary: "Temporary cooperation" },
  };
  assert.equal(completeness.completeRelation(relation), true);
  assert.equal(completeness.completeRelation({ ...relation, trust: undefined }), false);
  assert.match(bridge, /binding_strength: allowedStrengths\.has\(strength\) \? strength : ""/);
  assert.doesNotMatch(bridge, /default_affordance_dims/);
  assert.doesNotMatch(bridge, /irreversible_consequence \|\| entry\.consequences \|\| entry\.stake_cost/);
  assert.match(bridge, /payload\.world_states\.every\(completeWorldState\)[\s\S]*payload\.world_bindings\.every\(completeWorldBinding\)/);
  assert.match(bridge, /payload\.characters\.every\(completeCharacter\)[\s\S]*payload\.relations\.every\(completeRelation\)/);
});

test("the profession candidate adapter normalizes the existing FP001 occupation label to V7 job", () => {
  assert.match(bridge, /const suppliedAtomType = String\(card\.atom_type \|\| ""\)\.trim\(\)/);
  assert.match(bridge, /boardType === "profession" && suppliedAtomType === "occupation"/);
  assert.match(bridge, /\? "job"/);
  assert.match(bridge, /atom_type: atomType/);
});

test("the geography candidate adapter normalizes the existing FP001 location label to V7 geo", () => {
  assert.match(bridge, /boardType === "geography" && suppliedAtomType === "location"/);
  assert.match(bridge, /\? "geo"/);
  assert.match(bridge, /atom_type: atomType/);
});

test("the geography candidate adapter normalizes the FP001 geography label to V7 geo", () => {
  const mappingSource = bridge.slice(
    bridge.indexOf("const WORLD_BOARD_TYPES"),
    bridge.indexOf("function mapWorldBindings"),
  );
  const mapWorldStates = new Function(
    "plainObject",
    `${mappingSource}\nreturn mapWorldStates;`,
  )((value) => value !== null && typeof value === "object" && !Array.isArray(value));

  const states = mapWorldStates({
    cards: [{
      id: "geography-card",
      board_type: "\u5730\u7406",
      atom_type: "geography",
      title: "Fog Harbor",
      item_content: { summary: "A coastal industrial district" },
      affordance_dims: ["terrain"],
    }],
  });

  assert.deepEqual(states.map((state) => state.atom_type), ["geo"]);
});

test("the new-book adapter normalizes prototype profession, phenomenon, and disaster candidates to V7 atoms", () => {
  const mappingSource = bridge.slice(
    bridge.indexOf("const WORLD_BOARD_TYPES"),
    bridge.indexOf("function mapWorldBindings"),
  );
  const mapWorldStates = new Function(
    "plainObject",
    `${mappingSource}\nreturn mapWorldStates;`,
  )((value) => value !== null && typeof value === "object" && !Array.isArray(value));

  const states = mapWorldStates({
    cards: [
      {
        id: "profession-card",
        category: "职业/超能",
        atom_type: "profession",
        title: "维修员",
        item_content: { summary: "维护设施" },
        affordance_dims: ["权限边界"],
      },
      {
        id: "phenomenon-card",
        category: "怪物/灾难",
        atom_type: "phenomenon",
        title: "雾化回声体",
        item_content: { summary: "造成错认" },
        affordance_dims: ["认知风险"],
      },
      {
        id: "disaster-card",
        category: "怪物/灾难",
        atom_type: "disaster",
        title: "工业废墟链式坍塌",
        item_content: { summary: "拆解与熔炼会触发局部坍塌" },
        affordance_dims: ["资源压力"],
      },
    ],
  });

  assert.deepEqual(states.map((state) => state.atom_type), ["job", "monster", "monster"]);
});

test("the new-book adapter maps model-specific atom labels onto the V7 board contract", () => {
  const mappingSource = bridge.slice(
    bridge.indexOf("const WORLD_BOARD_TYPES"),
    bridge.indexOf("function mapWorldBindings"),
  );
  const mapWorldStates = new Function(
    "plainObject",
    `${mappingSource}\nreturn mapWorldStates;`,
  )((value) => value !== null && typeof value === "object" && !Array.isArray(value));

  const cards = [
    ["\u89c4\u5219", "model_rule_label"],
    ["\u5730\u7406", "model_location_label"],
    ["\u8d44\u6e90", "model_resource_label"],
    ["\u52bf\u529b", "model_faction_label"],
    ["\u804c\u4e1a/\u8d85\u80fd", "model_job_label"],
    ["\u602a\u7269/\u707e\u96be", "model_threat_label"],
    ["\u5927\u4e8b\u8bb0", "model_event_label"],
  ].map(([board_type, atom_type], index) => ({
    id: `model-card-${index}`,
    board_type,
    atom_type,
    title: `item-${index}`,
    item_content: { summary: `summary-${index}` },
    affordance_dims: ["pressure"],
  }));

  const states = mapWorldStates({ cards });
  assert.deepEqual(states.map((state) => state.atom_type), [
    "rule", "geo", "resource", "faction", "job", "monster", "event",
  ]);
});

test("the new-book adapter preserves character-to-resource bindings in the create DTO", () => {
  const mappingSource = bridge.slice(
    bridge.indexOf("function mapWorldBindings"),
    bridge.indexOf("const CHARACTER_TYPES"),
  );
  const mapWorldBindings = new Function(
    "DATA",
    `${mappingSource}\nreturn mapWorldBindings;`,
  )({ worldBindings: [] });
  const bindings = mapWorldBindings({ bindings: [{
    from_ref_type: "character",
    from_ref_id: "hero",
    to_ref_type: "world",
    to_ref_id: "resource.credential",
    binding_type: "持有",
    binding_strength: "strong",
  }] }, [{ client_ref: "resource-card", atom_key: "resource.credential" }], {
    characters: [{ client_ref: "hero" }],
  });

  assert.deepEqual(bindings, [{
    from_ref_type: "character",
    from_ref_id: "hero",
    to_ref_type: "world",
    to_ref_id: "resource.credential",
    binding_type: "持有",
    binding_strength: "strong",
  }]);
});

test("the final page gate rejects an L2 resource without its character binding", () => {
  const gateSource = bridge.slice(
    bridge.indexOf("function traceableCharacterResources"),
    bridge.indexOf("function completeRelation"),
  );
  const traceableCharacterResources = new Function(`${gateSource}\nreturn traceableCharacterResources;`)();
  const payload = {
    world_states: [{ board_type: "resource", atom_type: "resource", atom_key: "resource.credential" }],
    characters: [{ client_ref: "hero", five_layers_json: { L2: { resources: ["resource.credential"] } } }],
    world_bindings: [],
  };

  assert.equal(traceableCharacterResources(payload), false);
  payload.world_bindings.push({
    from_ref_type: "character",
    from_ref_id: "hero",
    to_ref_type: "world",
    to_ref_id: "resource.credential",
  });
  assert.equal(traceableCharacterResources(payload), true);
});

test("FP001 candidate application keeps stable world atom keys and binding edges", () => {
  assert.match(page, /const atomKey = candidateText\(candidate\.atom_key\)/);
  assert.match(page, /card\.atom_key = atomKey/);
  assert.match(page, /function mergeWorldBindingCandidate\(update\)/);
  assert.match(page, /updates\.world_bindings \|\| updates\.world_binding, mergeWorldBindingCandidate/);
  assert.match(newBookPrompt, /`world_bindings`/);
  assert.match(newBookPrompt, /from_ref_type=character/);
});

test("preview keeps the creator message outside form_data and confirm never sends it", () => {
  assert.match(bridge, /async function request\(action, creatorMessage = ""\)/);
  assert.match(bridge, /if \(action === "preview" && creatorMessage\) envelope\.creator_message = creatorMessage/);
  assert.match(bridge, /\? \{ \.\.\.payload, locked_stages: window\.__newBookRuntime\?\.lockedStages\?\.\(\) \|\| \[\] \}/);
  assert.match(bridge, /await request\("preview", value\)/);
  assert.match(bridge, /window\.startProduction = requestCreateFromPage/);
  assert.doesNotMatch(bridge, /form_data:\s*\{[^}]*creator_message/s);
});

test("preview candidates merge only into the unlocked local draft before formal submission", () => {
  assert.match(bridge, /applyCandidateUpdates\?\.\(result\.incremental_updates, result\.lock_respected\)/);
  assert.match(bridge, /window\.__newBookRuntime\?\.showPreview\?\.\(result, application\)/);
  assert.match(page, /function applyCandidateUpdates\(updates, lockRespected\)/);
  assert.match(page, /if \(lockedSteps\.has\(index\)\)/);
  assert.match(page, /applyStage\(0, "创作原点", updates\.book_project, mergeBookProjectCandidate\)/);
  assert.match(page, /applyStage\(1, "世界设定", updates\.world_state \|\| updates\.world_states, mergeWorldCandidate\)/);
  assert.match(page, /applyStage\(2, "角色设定", updates\.characters, mergeCharacterCandidate\)/);
  assert.match(page, /applyStage\(3, "冲突种子", updates\.l1a_unit_initial \|\| updates\.initial_l1a, mergeInitialL1aCandidate\)/);
  assert.match(page, /relation_states: cloneDraftValue/);
  assert.match(page, /applyCandidateUpdates,/);
  assert.match(page, /data\.previewCandidate/);
  assert.match(page, /本轮候选已合并到本地草稿/);
  assert.doesNotMatch(page, /页面不会自动写入表单或正式提交包/);
  assert.match(bridge, /尚未入库/);
});

test("a later character candidate removes only an untouched generic protagonist placeholder", () => {
  const helperSource = page.slice(
    page.indexOf("function isEmptyCandidateCharacterPlaceholder"),
    page.indexOf("function findCandidateCharacter"),
  );
  const discardEmptyCharacterPlaceholders = new Function(
    "candidateText",
    "isObject",
    `${helperSource}\nreturn discardEmptyCharacterPlaceholders;`,
  )(
    (value) => typeof value === "string" || typeof value === "number" ? String(value).trim() : "",
    (value) => value !== null && typeof value === "object" && !Array.isArray(value),
  );
  const placeholder = {
    client_ref: "candidate-character-1",
    char_name: "主角",
    name: "主角",
    five_layers_json: {},
    knowledge_boundary_json: {},
    arc_json: {},
    relations: {},
    traitTags: [],
    bindRes: [],
    bindForce: [],
    bindJob: [],
  };
  const step = {
    activeCharIndex: 0,
    characters: [placeholder, { client_ref: "candidate-character-2", char_name: "江枫" }],
    relation_states: [],
  };

  assert.equal(discardEmptyCharacterPlaceholders(step), true);
  assert.deepEqual(step.characters.map((character) => character.char_name), ["江枫"]);
  assert.equal(step.activeCharIndex, 0);

  const referenced = { ...placeholder, client_ref: "candidate-character-3" };
  const referencedStep = {
    activeCharIndex: 0,
    characters: [referenced, { client_ref: "candidate-character-2", char_name: "江枫" }],
    relation_states: [{ char_a_ref: referenced.client_ref, char_b_ref: "candidate-character-2" }],
  };
  assert.equal(discardEmptyCharacterPlaceholders(referencedStep), false);
  assert.equal(referencedStep.characters.length, 2);
});

test("the new-book character panel restores the prototype candidate-delete interaction", () => {
  assert.match(page, /aria-label="删除角色/);
  assert.match(page, /window\.deleteCharacter = \(id\) =>/);
  assert.match(page, /relation_states = .*\.filter\(\(relation\) =>/);
  assert.match(page, /showToast\(`已删除角色/);
  assert.match(page, /id="charCount"/);
  assert.match(page, /charCount\.textContent = `\$\{\(item\.characters \|\| \[\]\)\.length\} 人`/);
});

test("preview request outcomes preserve the pre-request form and chat baseline", () => {
  const helperSource = bridge.slice(
    bridge.indexOf("function draftContainsBaseline"),
    bridge.indexOf("function captureRequestDraft"),
  );
  const draftContainsBaseline = new Function(
    "plainObject",
    `${helperSource}\nreturn draftContainsBaseline;`,
  )((value) => value !== null && typeof value === "object" && !Array.isArray(value));
  const baseline = {
    origin: { title: "熔炼末世", creativeIntent: "文明在灾变中重建" },
    chat: [
      { role: "user", text: "世界观材料" },
      { role: "assistant", text: "已生成候选" },
    ],
  };
  assert.equal(draftContainsBaseline(baseline, baseline), true);
  assert.equal(draftContainsBaseline({ origin: { title: "", creativeIntent: "" }, chat: [] }, baseline), false);
  assert.equal(draftContainsBaseline({
    origin: baseline.origin,
    chat: [...baseline.chat, { role: "assistant", text: "新候选" }],
  }, baseline), true);

  const requestSource = bridge.slice(
    bridge.indexOf("async function request"),
    bridge.indexOf("async function previewFromChat"),
  );
  assert.match(requestSource, /const requestDraft = captureRequestDraft\(\)/);
  assert.match(requestSource, /catch \{[\s\S]*preserveRequestDraft\(requestDraft\)/);
  assert.match(requestSource, /preserveRequestDraft\(requestDraft\);\s*if \(result\?\.status === "preview"\)/);
  assert.match(requestSource, /if \(result\?\.status === "BLOCKED"\)/);
  assert.match(requestSource, /if \(!response\.ok \|\| result\?\.ok !== true/);
});

test("the chat form is listener-owned and cannot navigate while waiting for ZH01", async () => {
  assert.doesNotMatch(page, /<form class="chat-input" onsubmit=/);
  assert.match(bridge, /function bindChatForm\(\)/);
  assert.match(bridge, /form\.removeAttribute\("onsubmit"\)/);
  assert.match(bridge, /form\.addEventListener\("submit", submitPreview\)/);
  assert.match(page, /onclick="window\.__newBookPreviewFromChat\?\.\(event\)"/);
  assert.match(bridge, /window\.__newBookPreviewFromChat = submitPreview/);
  assert.match(bridge, /void previewFromChat\(event\)\.catch/);

  const source = bridge.slice(bridge.indexOf("function bindChatForm"), bridge.indexOf("function requestCreateFromPage"));
  let submitListener;
  let removedInlineHandler = false;
  let previewCalls = 0;
  const form = {
    dataset: {},
    removeAttribute(name) { if (name === "onsubmit") removedInlineHandler = true; },
    addEventListener(name, listener) { if (name === "submit") submitListener = listener; },
    querySelector() { return null; },
  };
  const bindChatForm = new Function(
    "document",
    "window",
    "previewFromChat",
    `${source}\nreturn bindChatForm;`,
  )(
    { querySelector: () => form },
    {},
    async () => { previewCalls += 1; },
  );
  bindChatForm();
  let prevented = false;
  submitListener({ preventDefault() { prevented = true; } });
  await Promise.resolve();
  assert.equal(removedInlineHandler, true);
  assert.equal(prevented, true);
  assert.equal(previewCalls, 1);

  const reboundWindow = {};
  const alreadyBoundForm = {
    dataset: { newBookChatBound: "true" },
    removeAttribute() {},
    addEventListener() { throw new Error("an existing listener must not be duplicated"); },
    querySelector() { return null; },
  };
  const bindAlreadyBoundChatForm = new Function(
    "document",
    "window",
    "previewFromChat",
    `${source}\nreturn bindChatForm;`,
  )(
    { querySelector: () => alreadyBoundForm },
    reboundWindow,
    async () => {},
  );
  bindAlreadyBoundChatForm();
  assert.equal(typeof reboundWindow.__newBookPreviewFromChat, "function");

});

test("preview waiting disables only the chat send button", () => {
  const renderSource = bridge.slice(
    bridge.indexOf("function renderRuntime"),
    bridge.indexOf("function numericValue"),
  );
  assert.match(renderSource, /document\.querySelector\('form\.chat-input button\[type="submit"\]'\)/);
  assert.match(renderSource, /sendButton\.disabled = inactive/);
  assert.match(renderSource, /sendButton\.setAttribute\("aria-disabled", String\(inactive\)\)/);
  assert.match(renderSource, /sendButton\.title = inactive/);
  assert.match(page, /\.chat-input button\[type="submit"\]:disabled/);
  assert.match(page, /cursor: not-allowed/);
  assert.doesNotMatch(renderSource, /#workspace|querySelectorAll/);
});

test("incremental null or omitted fields retain existing candidates while a complete v2 object accumulates", () => {
  const helperSource = page.slice(
    page.indexOf("function mergeCandidateObject"),
    page.indexOf("function draftField"),
  );
  const mergeCandidateObject = new Function(
    "isObject",
    "cloneDraftValue",
    `${helperSource}\nreturn mergeCandidateObject;`,
  )(
    (value) => value !== null && typeof value === "object" && !Array.isArray(value),
    (value, fallback) => {
      try { return JSON.parse(JSON.stringify(value)); } catch { return fallback; }
    },
  );
  const existing = {
    char_name: "顾长明",
    five_layers_json: { L0: { agency: 30 } },
    knowledge_boundary_json: { knows: ["避难所位置"] },
  };
  const merged = mergeCandidateObject(existing, {
    char_name: null,
    five_layers_json: { L1: { desire: "守住火种" } },
    knowledge_boundary_json: undefined,
    arc_json: { direction: "成长" },
  });
  assert.equal(merged.char_name, "顾长明");
  assert.deepEqual(merged.five_layers_json, { L0: { agency: 30 }, L1: { desire: "守住火种" } });
  assert.deepEqual(merged.knowledge_boundary_json, { knows: ["避难所位置"] });
  assert.deepEqual(merged.arc_json, { direction: "成长" });
  assert.match(page, /const explicitName = candidateText\(candidate\.char_name \|\| candidate\.name\)/);
  assert.match(page, /if \(explicitName\) \{\s*character\.char_name = explicitName/);
  assert.match(page, /const participantRefs = candidateStringList[\s\S]*participant_char_refs: participantRefs\.length \? participantRefs : undefined/);
});

test("a regenerated initial L1A replaces stale nested commitments from the prior candidate", () => {
  const objectMergeSource = page.slice(
    page.indexOf("function mergeCandidateObject"),
    page.indexOf("function draftField"),
  );
  const source = page.slice(
    page.indexOf("function mergeInitialL1aCandidate"),
    page.indexOf("function refreshCandidateDraft"),
  );
  const conflict = {
    key: "conflict_seed",
    initial_l1a: {
      l1a_name: "冷库停机前的三小时",
      role_arc_json: { lead: { direction: "new" }, stale: { direction: "old" } },
      participant_char_refs: ["lead", "stale"],
    },
    conflictEntries: [],
  };
  const characters = {
    key: "characters",
    characters: [{ id: "lead", client_ref: "lead", char_name: "江枫" }],
  };
  const mergeInitialL1aCandidate = new Function(
    "steps",
    "candidateList",
    "isObject",
    "candidateText",
    "candidateStringList",
    "findCandidateCharacter",
    "cloneDraftValue",
    `${objectMergeSource}\n${source}\nreturn mergeInitialL1aCandidate;`,
  )(
    [conflict, characters],
    (value) => Array.isArray(value) ? value : [value],
    (value) => value !== null && typeof value === "object" && !Array.isArray(value),
    (value) => String(value ?? "").trim(),
    (value) => Array.isArray(value) ? value.map(String) : [],
    (step, reference) => step?.characters?.find((item) => item.client_ref === reference),
    (value, fallback) => {
      try { return JSON.parse(JSON.stringify(value)); } catch { return fallback; }
    },
  );

  assert.equal(mergeInitialL1aCandidate({
    l1a_name: "冷库停机前的三小时",
    scene_location: "废弃冷链园区",
    conflict_background: "药品冷库即将断电",
    escalation_path: "确认缺口、抢修、恢复供电",
    stakes: "药品失效",
    irreversible_consequence: "共同账本首次约束江枫",
    plot_emotion_commit: { ending: "有限协作" },
    arc_requirement: { lead: "接受共同约束" },
    info_reveal_boundary: { forbidden: ["灾难最终来源"] },
    role_arc_json: { lead: { direction: "接受共同约束" } },
    participant_char_refs: ["lead"],
  }), true);
  assert.deepEqual(conflict.initial_l1a.role_arc_json, { lead: { direction: "接受共同约束" } });
  assert.deepEqual(conflict.initial_l1a.participant_char_refs, ["lead"]);
});

test("ZH01 canonical world board types update the matching prototype card", () => {
  const categorySource = page.slice(
    page.indexOf("function worldCategoryName"),
    page.indexOf("function normalizeWorldStep"),
  );
  const objectMergeSource = page.slice(
    page.indexOf("function mergeCandidateObject"),
    page.indexOf("function draftField"),
  );
  const worldMergeSource = page.slice(
    page.indexOf("function mergeWorldCandidate"),
    page.indexOf("function isEmptyCandidateCharacterPlaceholder"),
  );
  const world = {
    categories: ["规则", "地理", "资源", "势力", "职业/超能", "怪物/灾难", "大事记"],
    cards: [{
      id: "event-1",
      category: "大事记",
      board_type: "大事",
      atom_type: "event",
      title: "全球晶核能量持续递减",
      item_content: { summary: "旧候选" },
      affordance_dims: [],
    }],
    bindings: [],
  };
  const mergeWorldCandidate = new Function(
    "getWorldStep",
    "candidateList",
    "isObject",
    "candidateText",
    "cloneDraftValue",
    "nextCandidateId",
    "normalizeWorldStep",
    "persistWorldState",
    `${categorySource}\n${objectMergeSource}\n${worldMergeSource}\nreturn mergeWorldCandidate;`,
  )(
    () => world,
    (value) => Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [],
    (value) => value !== null && typeof value === "object" && !Array.isArray(value),
    (value) => String(value ?? "").trim(),
    (value, fallback) => {
      try { return JSON.parse(JSON.stringify(value)); } catch { return fallback; }
    },
    () => "unused-new-card-id",
    () => {},
    () => {},
  );

  const changed = mergeWorldCandidate({
    board_type: "event",
    atom_type: "event",
    atom_key: "event.energy-decline",
    item_name: "全球晶核能量持续递减",
    item_content: { summary: "新候选", purpose: "形成长期结构压力" },
    affordance_dims: ["资源压力", "时间压力", "制度压力", "文明压力"],
  });

  assert.equal(changed, true);
  assert.equal(world.cards.length, 1);
  assert.equal(world.cards[0].item_content.summary, "新候选");
  assert.equal(world.cards[0].item_content.purpose, "形成长期结构压力");
  assert.deepEqual(world.cards[0].affordance_dims, ["资源压力", "时间压力", "制度压力", "文明压力"]);
});

test("FP001-03 core conflict fills the visible intent and reaches the create RPC", () => {
  assert.match(
    page,
    /setDraftField\(\s*origin,\s*"creativeIntent",[\s\S]*update\.intent_json\?\.core_conflict/,
  );
  assert.match(
    page,
    /core_conflict: values\.creativeIntent \|\| ""/,
  );
  assert.match(
    bridge,
    /core_conflict: DATA\?\.book\?\.intent_json\?\.core_conflict \|\| origin\.creativeIntent \|\| ""/,
  );
});

test("FP001-03 target emotion is projected into the existing tags and survives draft restore", () => {
  assert.match(page, /function setTargetEmotion\(value\)/);
  assert.match(page, /setTargetEmotion\(update\.intent_json\?\.target_emotion\)/);
  assert.match(page, /target_emotion: cloneDraftValue\(data\.book\.intent_json\?\.target_emotion, ""\)/);
  assert.match(page, /if \(snapshot\.target_emotion !== undefined\) setTargetEmotion\(snapshot\.target_emotion\)/);
  assert.match(page, /field\.key === "targetEmotion"/);
});

test("target emotion remains a creator-editable field while preserving the existing tag presentation", () => {
  assert.match(data, /key: "targetEmotion", type: "tags", label: "目标情绪", value: ""/);
  assert.match(page, /field\.key === "targetEmotion"/);
  assert.match(page, /target_emotion: values\.targetEmotion \|\| ""/);
  assert.match(page, /class="ui-textarea editable-field target-emotion-input"/);
  assert.match(page, /data-target-emotion-tags/);
  assert.match(page, /function renderTargetEmotionTags\(field\)/);
  assert.match(page, /renderTargetEmotionTags\(item\.fields\[index\]\)/);
});

test("target emotion is required before the creative origin can lock or create a book", () => {
  const targetEmotionGate = /!String\(payload\.intent_json\?\.target_emotion \?\? ""\)\.trim\(\) \? \["\\u76ee\\u6807\\u60c5\\u7eea"\] : \[\]/g;
  assert.equal((bridge.match(targetEmotionGate) || []).length, 2);
  assert.match(page, /window\.__newBookCanLockStage\?\.\(index\)\?\.ok !== true/);
  assert.match(page, /current = lockedSteps\.size/);
});

test("a complete initial L1A still requires one explicit creator adoption before stage lock", () => {
  assert.match(page, /data-new-book-action="adopt-initial-l1a"/);
  assert.match(page, /window\.adoptInitialL1aCandidate = \(\) => \{/);
  assert.match(page, /window\.__newBookCanAdoptInitialL1a\?\.\(\)/);
  assert.match(page, /conflict\.initial_l1a_adopted = false/);
  assert.match(page, /initial_l1a_adopted: conflicts\?\.initial_l1a_adopted === true/);
  assert.match(page, /conflicts\.initial_l1a_adopted = snapshot\.initial_l1a_adopted === true/);
  assert.match(bridge, /const initialL1a = conflicts\?\.initial_l1a_adopted === true\s*\? initialL1aCandidate\s*:\s*undefined/);
  assert.match(bridge, /window\.__newBookCanAdoptInitialL1a = \(\) => completeInitialL1a\(mapInitialL1a/);
});

test("L0 candidates with value and delta render the business value instead of an object string", () => {
  const source = page.slice(
    page.indexOf("function philosophyDisplayValue"),
    page.indexOf("function getQuadrantStyle"),
  );
  const philosophyDisplayValue = new Function(
    "isObject",
    `${source}\nreturn philosophyDisplayValue;`,
  )((value) => value !== null && typeof value === "object" && !Array.isArray(value));
  assert.equal(philosophyDisplayValue({ value: 72, delta: 8 }), 72);
  assert.equal(philosophyDisplayValue({ stance: 68, delta: 8 }), 68);
  assert.equal(philosophyDisplayValue({ delta: -20, summary: "回避责任" }), 30);
  assert.equal(philosophyDisplayValue({ delta: 80, summary: "极端主动" }), 100);
  assert.equal(philosophyDisplayValue(50), 50);
  assert.match(page, /const val = philosophyDisplayValue\(philValues\[name\] \?\? 50\)/);
});

test("character candidates expose their V7 review data before a stage can lock", () => {
  const source = page.slice(
    page.indexOf("function characterReviewValue"),
    page.indexOf("function getQuadrantStyle"),
  );
  const characterReviewSectionsTemplate = new Function(
    "isObject",
    "candidateText",
    "escapeHtml",
    `${source}\nreturn characterReviewSectionsTemplate;`,
  )(
    (value) => value !== null && typeof value === "object" && !Array.isArray(value),
    (value) => typeof value === "string" || typeof value === "number" ? String(value).trim() : "",
    (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;"),
  );
  const review = characterReviewSectionsTemplate({
    five_layers_json: {
      L0: { "主体能动性": { delta: 38, summary: "主动追溯异常" } },
      L1: { "欲望": "查明记录" },
      L2: { "能力": "检修供氧设备" },
      L3: { "同盟": "与妹妹协作" },
    },
    knowledge_boundary_json: {
      knows: ["氧气配额稀缺"],
      unknown: ["事故真相"],
      false_belief: ["只是设备老化"],
      reasonable_suspect: ["委员会隐藏信息"],
    },
    arc_json: { direction: "成长", stakes: "失去信任" },
  });
  assert.match(review, /L0 哲学底盘/);
  assert.match(review, /L1 驱动层/);
  assert.match(review, /L2 世界作用位/);
  assert.match(review, /L3 关系作用位/);
  assert.match(review, /氧气配额稀缺/);
  assert.match(review, /委员会隐藏信息/);
  assert.match(review, /失去信任/);
  assert.doesNotMatch(review, /\[object Object\]/);
  assert.match(page, /\$\{characterReviewSectionsTemplate\(char\)\}/);
});

test("an initial L1A exposes every V7 commitment before the creator adopts it", () => {
  const source = page.slice(
    page.indexOf("function l1aReviewValue"),
    page.indexOf("function conflictSeedTemplate"),
  );
  const initialL1aCandidateReviewTemplate = new Function(
    "isObject",
    "candidateText",
    "escapeHtml",
    `${source}\nreturn initialL1aCandidateReviewTemplate;`,
  )(
    (value) => value !== null && typeof value === "object" && !Array.isArray(value),
    (value) => typeof value === "string" || typeof value === "number" ? String(value).trim() : "",
    (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;"),
  );
  const review = initialL1aCandidateReviewTemplate({
    escalation_path: "先验证，再公开",
    stakes: "居民氧气配额受影响",
    irreversible_consequence: "离站资格冻结",
    plot_emotion_commit: { primary_emotion: "克制希望", reader_promise: "每次验证都有代价" },
    arc_requirement: { required_shift: "承担公共责任", forbidden_shortcut: "不得凭巧合解决" },
    info_reveal_boundary: { may_reveal: ["存在隐藏记录"], must_not_reveal: ["事故完整真相"] },
    role_arc_json: { lead: { starting_position: "维护员", required_arc: "承担选择" } },
    participant_char_refs: ["lead"],
  }, [{ client_ref: "lead", name: "林澈" }]);
  for (const text of ["先验证，再公开", "居民氧气配额受影响", "离站资格冻结", "克制希望", "承担公共责任", "事故完整真相", "林澈"]) {
    assert.match(review, new RegExp(text));
  }
  assert.doesNotMatch(review, /\[object Object\]/);
  assert.match(page, /initialL1aCandidateReviewTemplate\(initialL1a, chars\)/);
});

test("FP001-03 requests a complete candidate package that the existing page and FP001-07 can review", () => {
  assert.doesNotMatch(newBookPrompt, /\u8840\u7f18\/\u793e\u4f1a\/\u5951\u7ea6/);
  assert.equal(newBookPrompt.length, 7082);
  assert.equal(Buffer.byteLength(newBookPrompt, "utf8"), 13260);
  assert.equal(createHash("sha256").update(newBookPrompt, "utf8").digest("hex"), "09d2b01cce6318516cc7ff0da98d621f59f486a284c5b6f37671f7154feb56e6");
  for (const field of [
    "char_name",
    "char_a_ref",
    "relation_type",
    "relation_hierarchy",
    "relation_origin",
    "power_balance",
    "common_goal",
    "atom_type",
    "atom_key",
    "world_bindings",
    "scene_location",
    "irreversible_consequence",
    "plot_emotion_commit",
    "info_reveal_boundary",
    "participant_char_refs",
  ]) assert.match(newBookPrompt, new RegExp("`" + field + "`"));
  assert.match(newBookPrompt, /直接输出完整的\*\*候选\*\*字段/);
  assert.match(newBookPrompt, /已锁定阶段的数据只读/);
  assert.match(newBookPrompt, /不编造未来剧情或 L1A 分配/);
  assert.match(newBookPrompt, /候选输出不得被下游当正式事实/);
  assert.match(newBookPrompt, /`locked_stages` 只限制其同名已锁定阶段/);
  assert.match(newBookPrompt, /明确要求补齐尚未锁定的“冲突种子”或“初始 L1A”时，必须输出 `incremental_updates\.l1a_unit_initial`/);
  assert.match(newBookPrompt, /不得因已锁定阶段尚可继续细化而停止该未锁定候选/);
  assert.match(newBookPrompt, /不得把不影响上述字段的世界参数、容量、库存、人口、敌人数值、未来章节安排/);
  assert.match(newBookPrompt, /`plot_emotion_commit`、`arc_requirement`、`info_reveal_boundary`、`role_arc_json` 必须都是非空 JSON 对象，绝不能写成自然语言字符串/);
  assert.match(newBookPrompt, /输出前必须在内部对完整对象执行 `JSON\.parse` 语法校验/);
  assert.match(newBookPrompt, /不得输出多余的闭合花括号/);
  for (const field of [
    "violate_cost", "apply_scope", "rule_type", "danger_level", "location_text",
    "scarcity_level", "usability", "faction_status", "stance", "cost_mechanism",
    "is_system", "threat_level", "counter_text", "event_era",
  ]) assert.match(newBookPrompt, new RegExp("`" + field + "`"));
  assert.match(page, /candidate\.scene_location/);
  assert.match(bridge, /participant_char_refs:/);
});

test("FP001-03 keeps missing explanations out of reviewable candidate business fields", () => {
  assert.match(newBookPrompt, /incremental_updates.*具体业务候选/s);
  assert.match(newBookPrompt, /不得填写“来源未明确”.*“待确认”.*“未知”.*“TODO”/s);
  assert.match(newBookPrompt, /来源没有逐字写出数值或句子，并不等于不能生成候选/);
  assert.match(newBookPrompt, /在 `chat_message` 中清楚说明该值仅供页面审阅和修改/);
  assert.match(newBookPrompt, /省略该字段或返回 `null`.*只在 `missing_items` 和追问中说明/s);
  assert.match(newBookPrompt, /`空字符串` 不是缺失值.*必须在 `missing_items` 中列出对应字段路径/s);
  assert.match(newBookPrompt, /本节点只生成候选，不自动入库/);
  assert.match(newBookPrompt, /最终响应只能是一个 JSON 对象/);
  assert.match(newBookPrompt, /字段合同，不是可复制的业务值示例/);
  assert.doesNotMatch(newBookPrompt, /主角\|配角1/);
  assert.doesNotMatch(newBookPrompt, /"[^"\n]*"\s*:\s*""/);
  assert.doesNotMatch(newBookPrompt, /"[^"\n]*"\s*:\s*0(?:\s*[,}])/);
});

test("long preview gaps stay in the chat flow instead of covering the page", () => {
  const projection = bridge.slice(
    bridge.indexOf("function projectPreview"),
    bridge.indexOf("const errorMessages"),
  );
  assert.match(projection, /const appliedCandidate = Array\.isArray\(application\?\.applied_stages\) && application\.applied_stages\.length > 0/);
  assert.match(projection, /state = appliedCandidate \? "normal" : missing\.length \? "returned" : "normal"/);
  assert.match(projection, /if \(missing\.length\) appendChat\("assistant", `待补充：\$\{missing\.join\("、"\)\}`\)/);
  assert.match(projection, /renderRuntime\(appliedCandidate \? localDraft : missing\.length \? `仍有 \$\{missing\.length\} 项待补充，请查看对话中的完整清单。` : localDraft\)/);
  assert.doesNotMatch(projection, /renderRuntime\(missing\.length \? `待补充：/);
});

test("preview never turns an absent creator word target into a zero default", () => {
  assert.match(page, /function candidatePositiveInteger\(value\)/);
  assert.match(page, /setDraftField\(origin, "targetWords", candidatePositiveInteger\(update\.target_words\)\)/);
  assert.match(page, /setDraftField\(origin, "chapterWords", candidatePositiveInteger\(update\.chapter_words\)\)/);
});

test("new books start with editable 1000000/2000 planning defaults and derive 500 chapters plus 167 L1As", () => {
  assert.match(data, /targetWords:\s*"1000000"/);
  assert.match(data, /chapterWords:\s*"2000"/);
  assert.match(data, /key:\s*"targetWords"[^\n]*value:\s*"1000000"/);
  assert.match(data, /key:\s*"chapterWords"[^\n]*value:\s*"2000"/);

  const helperSource = page.slice(
    page.indexOf("function derivePlanningCounts"),
    page.indexOf("function renderBookMeta"),
  );
  const derivePlanningCounts = new Function(`${helperSource}\nreturn derivePlanningCounts;`)();
  assert.deepEqual(derivePlanningCounts("1000000", "2000"), {
    chapterCount: 500,
    l1aTargetCount: 167,
  });
  assert.deepEqual(derivePlanningCounts("10001", "2000"), {
    chapterCount: 6,
    l1aTargetCount: 2,
  });
  assert.equal(derivePlanningCounts("", "2000"), null);
  assert.match(page, /预计\s*\$\{planning\.chapterCount\.toLocaleString\("zh-CN"\)\}\s*章/);
  assert.match(page, /L1A\s*目标\s*\$\{planning\.l1aTargetCount\.toLocaleString\("zh-CN"\)\}/);
});

test("prototype material icons stay visible and icon-only modal controls are named", () => {
  const iconRule = page.slice(
    page.indexOf(".material-symbols-outlined {"),
    page.indexOf(".cyber-grid {"),
  );

  assert.match(page, /<link rel="stylesheet" href="\/vendor\/font-fallback\.css">/);
  assert.match(iconRule, /font-family:\s*"Material Symbols Outlined"/);
  assert.match(iconRule, /font-size:\s*20px/);
  assert.doesNotMatch(iconRule, /font-size:\s*0(?:\s*!important)?/);
  assert.doesNotMatch(page, /localIconMap|localizeMaterialIcons/);
  assert.match(
    page,
    /<button class="ui-icon-button ui-button-quiet" type="button" onclick="closeConfirmModal\(\)" aria-label="关闭阶段编辑面板">/,
  );
});

test("a model claim that violates a stage lock is not shown as a completed change", () => {
  assert.match(bridge, /function candidateMessage\(result, application\)/);
  assert.match(bridge, /const lockedStages = window\.__newBookRuntime\?\.lockedStages\?\.\(\) \|\| \[\];/);
  assert.match(bridge, /if \(lockedStages\.length\)/);
  assert.match(bridge, /当前已锁定阶段保持不变/);
  assert.match(bridge, /application\?\.skipped_locked_stages/);
  assert.match(bridge, /candidateMessage\(result, application\)/);
  assert.match(bridge, /if \(result\.lock_respected === false\)/);
  assert.match(bridge, /模型建议含有对已锁定阶段的改写/);
  assert.match(bridge, /锁定阶段未改变/);
  assert.match(page, /function restoredChatText\(item\)/);
  assert.match(page, /当前已锁定阶段保持不变，请以阶段面板显示为准/);
  assert.match(page, /text: restoredChatText\(item\)/);
});

test("optional FP001-05 advice is displayed as advice and never becomes a candidate write", () => {
  assert.match(page, /commercial_potential: isObject\(result\?\.commercial_potential\)/);
  assert.match(page, /shangye_deduction_reasons/);
  assert.match(page, /adjustment_suggestions/);
  assert.match(page, /cross_stage_conflicts/);
  assert.doesNotMatch(page, /applyStage\([^\n]*commercial_potential/);
  assert.doesNotMatch(bridge, /commercial_potential.*confirm_create/s);
});

test("genre dependency failures explain the missing active skill without promising a false fix", () => {
  assert.match(bridge, /UNSUPPORTED_GENRE: "当前主题材没有可用的系统内置技能；请检查题材选择或补齐题材技能后重试，草稿未改变。"/);
});

test("a preview transport failure never claims that the create transaction ran", () => {
  assert.match(bridge, /RPC_UNAVAILABLE: "服务暂时不可用，草稿已保留；请恢复后重试。"/);
  assert.match(bridge, /const failure = errorCopy\(result, action === "preview" \? "RPC_UNAVAILABLE" : "WRITE_FAILED"\);/);
});

test("operator initialization retries once without a stale local operator ID", () => {
  assert.match(bridge, /const OPERATOR_ENDPOINT = window\.NEW_BOOK_OPERATOR_URL \|\| "\/api\/skill-library"/);
  assert.match(bridge, /const OPERATOR_TIMEOUT_MS = 15000/);
  assert.match(bridge, /const body = \{ action: "operator" \}/);
  assert.match(bridge, /async function requestOperator\(body\)/);
  assert.match(bridge, /window\.setTimeout\(\(\) => controller\.abort\(\), OPERATOR_TIMEOUT_MS\)/);
  assert.match(bridge, /signal: controller\.signal/);
  assert.match(bridge, /window\.clearTimeout\(timeoutId\)/);
  assert.match(bridge, /error\?\.name === "AbortError" \? errorMessages\.RPC_UNAVAILABLE/);
  assert.match(bridge, /localStorage\.setItem\(OPERATOR_STORAGE_KEY, localOperatorId\)/);
  assert.match(bridge, /async function ensureLocalOperator\(retried = false\)/);
  assert.match(bridge, /if \(!retried && failure\.code === "LOCAL_OPERATOR_MISMATCH"\)/);
  assert.match(bridge, /localStorage\.removeItem\(OPERATOR_STORAGE_KEY\);\s*localOperatorId = "";\s*return ensureLocalOperator\(true\);/);
  assert.doesNotMatch(bridge, /localOperatorId\s*=\s*crypto\.randomUUID/);
  assert.doesNotMatch(bridge, /LOCAL_OPERATOR_MISMATCH[\s\S]{0,280}(?:clearDraftStorage|DRAFT_STORAGE_KEY|DRAFT_IDEMPOTENCY_STORAGE_KEY)/);
});

test("successful RPC response switches only the stable cross-page book context", () => {
  assert.match(bridge, /result\?\.ok !== true \|\| !validUuid\(result\?\.book_id\)/);
  assert.match(bridge, /const context = \{ local_operator_id: localOperatorId, current_book_id: bookId \}/);
  assert.match(bridge, /localStorage\.setItem\(BOOK_CONTEXT_STORAGE_KEY, JSON\.stringify\(context\)\)/);
  assert.match(bridge, /location\.assign\(`\/books\/\$\{encodeURIComponent\(result\.book_id\)\}\/world`\)/);
  assert.doesNotMatch(bridge, /result\?\.result\?\.status/);
});

test("an incomplete review returns visible feedback before it can create a book", () => {
  assert.equal((page.match(/data-new-book-action="confirm-create"/g) || []).length, 2);
  assert.match(bridge, /if \(\[0, 1, 2, 3\]\.some\(\(index\) => !locks\.includes\(index\)\)\)/);
  assert.match(bridge, /请先逐步检查并锁定创作原点、世界设定、角色设定与冲突种子。草稿已保留。/);
  assert.match(bridge, /state = issue\.state;\s*persistDraftNow\(\);\s*renderRuntime\(issue\.message\);/);
  assert.match(bridge, /region\.classList\.toggle\("show", state !== "normal"\)/);
  assert.match(page, /\.toast-container \[data-new-book-runtime\][\s\S]*pointer-events: none/);
  assert.match(page, /\.toast-container \[data-new-book-runtime\][\s\S]*right: calc\(316px \+ 40px\)/);
  assert.match(bridge, /function bindCreateButtons\(root = document\)/);
  assert.match(bridge, /const issue = clientGate\(collectPayload\(\), "confirm_create"\)/);
  assert.match(bridge, /button\.disabled = Boolean\(issue\)/);
  assert.match(bridge, /button\.setAttribute\("aria-disabled", String\(Boolean\(issue\)\)\)/);
  assert.match(bridge, /button\.addEventListener\("click", \(event\) => \{/);
  assert.match(bridge, /button\.dataset\.newBookCreateBound = "true"/);
  assert.match(bridge, /new MutationObserver\(\(records\) => \{/);
  assert.match(bridge, /requestCreateFromPage\(\);/);
});

test("an incomplete preview disables the visible stage confirmation action", () => {
  assert.match(page, /function syncConfirmAction\(\)/);
  assert.match(page, /const blocked = Boolean\(gate && !gate\.ok\)/);
  assert.match(page, /confirmAction\.disabled = blocked/);
  assert.match(page, /confirmAction\.setAttribute\("aria-disabled", String\(blocked\)\)/);
  assert.match(page, /showPreview\(result, application\)[\s\S]*syncConfirmAction\(\)/);

  const start = page.indexOf("function syncConfirmAction");
  const end = page.indexOf("function editorTemplate", start);
  const attributes = new Map();
  const button = {
    disabled: false,
    title: "stale",
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); },
  };
  let gate = { ok: false, message: "请先补全当前阶段" };
  const syncConfirmAction = new Function(
    "uiGet",
    "window",
    "viewing",
    `${page.slice(start, end)}\nreturn syncConfirmAction;`,
  )(
    () => button,
    { __newBookCanLockStage: () => gate },
    0,
  );
  syncConfirmAction();
  assert.equal(button.disabled, true);
  assert.equal(attributes.get("aria-disabled"), "true");
  assert.equal(button.title, "请先补全当前阶段");
  gate = { ok: true };
  syncConfirmAction();
  assert.equal(button.disabled, false);
  assert.equal(attributes.get("aria-disabled"), "false");
  assert.equal(attributes.has("title"), false);
});

test("the prototype shell exposes local draft recovery and explicit front-end stage locks", () => {
  assert.match(page, /const lockedSteps = new Set\(\)/);
  assert.match(page, /function exportDraft\(\)/);
  assert.match(page, /function restoreDraft\(snapshot\)/);
  assert.match(page, /lockedStages: \(\) => \[\.\.\.lockedSteps\]/);
  assert.match(bridge, /DRAFT_STORAGE_KEY = "zhreplan\.new_book_draft\.v1"/);
  assert.match(bridge, /window\.__newBookCanLockStage/);
  assert.match(bridge, /state = restored \? "restored" : "empty"/);
});

test("existing prototype controls bind to real actions without a parallel page tree", () => {
  assert.match(page, /<script src="\/pages\/new-book\/new-book-bridge\.mjs\?v=20260816-chat-form-rebind-1"><\/script>/);
  assert.doesNotMatch(page, /<script type="module" src="\/pages\/new-book\/new-book-bridge\.mjs/);
  assert.doesNotMatch(bridge, /^export\s/m);
  for (const handler of ["sendChat", "runIntegrityAnalysis", "aiAddWorldItem", "charAdd", "startProduction", "openWorkbench"]) {
    assert.match(bridge, new RegExp(`window\\.${handler}\\s*=`));
  }
  assert.doesNotMatch(bridge, /(?:document\.)?(?:main|workspace|content)\.innerHTML/);
  assert.doesNotMatch(bridge, /outerHTML|replaceChildren|insertAdjacentHTML/);
});

test("the page does not invent manual creation controls, extra knowledge fields, or URL-forced states", () => {
  assert.doesNotMatch(page, /window\.addWorldItem|window\.addCharacter|window\.updateWorldItem/);
  assert.doesNotMatch(page, /char-knowledge-section|world-item-input/);
  assert.doesNotMatch(bridge, /forcedState|allowedStates|URLSearchParams\(location\.search\)/);
});

test("all required visible runtime states remain available without replacing the prototype", () => {
  for (const state of ["normal", "empty", "loading", "failed", "returned", "restored", "disabled", "completed", "blocked"]) {
    assert.match(bridge, new RegExp(`${state}: \\[`));
  }
  assert.match(bridge, /document\.body\.dataset\.newBookState = state/);
  assert.match(bridge, /region\.classList\.toggle\("show", state !== "normal"\)/);
  assert.match(bridge, /host\.append\(region\)/);
});

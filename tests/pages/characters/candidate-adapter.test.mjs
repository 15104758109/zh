import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInitialMemoryConfirmation,
  displayCharacterValue,
  normalizeCharacterCandidates,
  normalizeCharacterSnapshot,
} from "../../../apps/web/src/pages/characters/candidate-adapter.mjs";

test("normalizes a V7 transient character candidate without inventing relation state", () => {
  const [sena, tavi] = normalizeCharacterCandidates({
    characters: [
      {
        client_ref: "sena-ref",
        char_name: "Sena",
        char_type: "supporting",
        five_layers_json: {
          L0: { "自由与责任": { value: 73, delta: 8, basis: "恢复同意并承担公开风险" } },
          L1: { "核心动机": "夺回表达权", "欲望": "确认同意", "恐惧": "再次被代表" },
          L2: { "能力": "核验伤痕", "资源": "伤痕账本", "代价": "公开私人记忆" },
          L3: { "同盟": "候选工人", "纠葛": "不愿被公共利益替代授权" },
        },
        knowledge_boundary_json: {
          knows: ["气闸公投即将发生"],
          unknown: ["控制者身份"],
          false_belief: ["公开一人伤痕即可恢复所有同意"],
          reasonable_suspect: ["记录可能被伪造"],
        },
        arc_json: { direction: "成长" },
      },
      {
        client_ref: "tavi-ref",
        char_name: "Tavi",
        char_type: "supporting",
        five_layers_json: { L0: {}, L1: {}, L2: {}, L3: {} },
        knowledge_boundary_json: { knows: [], unknown: [], false_belief: [], reasonable_suspect: [] },
        arc_json: {},
      },
    ],
    relations: [
      { from_ref: "sena-ref", to_ref: "tavi-ref", change_event_json: "候选变更：共同界定公开边界" },
    ],
    initial_memories: [
      { char_ref: "sena-ref", memory_content: "候选初始记忆：曾看见同意状态与选择不一致。" },
    ],
  });

  assert.equal(sena.l0["自由与责任"].value, 73);
  assert.equal(sena.l0["自由与责任"].basis, "恢复同意并承担公开风险");
  assert.equal(sena.l1.innerDrive, "夺回表达权");
  assert.equal(sena.l1.desire, "确认同意");
  assert.equal(sena.l1.fear, "再次被代表");
  assert.equal(sena.resource, "伤痕账本");
  assert.equal(sena.l2["代价"], "公开私人记忆");
  assert.equal(sena.l3["纠葛"], "不愿被公共利益替代授权");
  assert.deepEqual(sena.arc, { direction: "成长" });
  assert.deepEqual(sena.initialMemories, ["候选初始记忆：曾看见同意状态与选择不一致。"]);
  assert.deepEqual(sena.knowledge.confirmed, ["气闸公投即将发生"]);
  assert.deepEqual(sena.candidateRelations, [{ counterpart: "Tavi", description: "候选变更：共同界定公开边界" }]);
  assert.equal("trust" in sena.candidateRelations[0], false);
  assert.deepEqual(tavi.initialMemories, []);
});

test("normalizes a persisted snapshot by stable IDs without synthesizing initial memories", () => {
  const [lead, rival] = normalizeCharacterSnapshot({
    state: "candidate",
    characters: [
      {
        id: "33333333-3333-3333-3333-333333333333",
        char_name: "Lead",
        char_type: "protagonist",
        five_layers_json: { L0: {}, L1: {}, L2: {}, L3: {} },
        knowledge_boundary_json: { knows: [], unknown: [], false_belief: [], reasonable_suspect: [] },
        arc_json: {},
      },
      {
        id: "44444444-4444-4444-4444-444444444444",
        char_name: "Rival",
        char_type: "antagonist",
        five_layers_json: { L0: {}, L1: {}, L2: {}, L3: {} },
        knowledge_boundary_json: { knows: [], unknown: [], false_belief: [], reasonable_suspect: [] },
        arc_json: {},
      },
    ],
    relations: [{
      id: "55555555-5555-5555-5555-555555555555",
      char_a_id: "33333333-3333-3333-3333-333333333333",
      char_b_id: "44444444-4444-4444-4444-444444444444",
      change_event_json: { description: "A saved relationship event." },
    }],
    initial_memories: [],
  });

  assert.equal(lead.snapshotState, "candidate");
  assert.equal(lead.candidateId, "33333333-3333-3333-3333-333333333333");
  assert.deepEqual(lead.initialMemories, []);
  assert.deepEqual(lead.candidateRelations, [{ counterpart: "Rival", description: "A saved relationship event." }]);
  assert.equal(rival.snapshotState, "candidate");
});

test("preserves a formal V7 snapshot with scalar L0 values, L2 world slots, and L3 summaries", () => {
  const [lead] = normalizeCharacterSnapshot({
    state: "formal",
    characters: [{
      id: "33333333-3333-3333-3333-333333333333",
      char_name: "江枫",
      char_type: "protagonist",
      five_layers_json: {
        L0: { "底层信念": "只有公平才能延续文明", "复仇观": 0, "价值排序": ["公平", "生存"] },
        L1: { "核心动机": "打造公平系统", "欲望": "重建秩序", "恐惧": "能量枯竭" },
        L2: { "能力": "熔炼重构", "代价": "晶核消耗", "资源": "晶核" },
        L3: { "同盟": ["叶凡"], "对立": [], "关系数值摘要": { trust: 50, common_goal: 70 } },
      },
      knowledge_boundary_json: { knows: ["晶核能量守恒"], unknown: [], false_belief: [], reasonable_suspect: [] },
      arc_json: {},
    }],
    relations: [],
    initial_memories: [{ char_id: "33333333-3333-3333-3333-333333333333", memory_content: "公开晶核余量。" }],
  });

  assert.equal(lead.snapshotState, "formal");
  assert.equal(lead.l0["底层信念"], "只有公平才能延续文明");
  assert.equal(lead.l0["复仇观"], 0);
  assert.equal(lead.l1.innerDrive, "打造公平系统");
  assert.equal(lead.l1.desire, "重建秩序");
  assert.equal(lead.l1.fear, "能量枯竭");
  assert.equal(lead.l2["能力"], "熔炼重构");
  assert.deepEqual(lead.l3["同盟"], ["叶凡"]);
  assert.deepEqual(lead.l3["关系数值摘要"], { trust: 50, common_goal: 70 });
  assert.deepEqual(lead.initialMemories, ["公开晶核余量。"]);
  assert.equal(displayCharacterValue(lead.l0["价值排序"]), "公平；生存");
  assert.equal(displayCharacterValue(lead.l3["关系数值摘要"]), "trust：50；common_goal：70");
});

test("accepts stable character and relation aliases from a formal read projection", () => {
  const [lead] = normalizeCharacterSnapshot({
    state: "formal",
    characters: [{
      character_id: "33333333-3333-3333-3333-333333333333",
      char_name: "江枫",
      char_type: "protagonist",
      five_layers_json: { L0: { "底层信念": "公平" }, L1: { "欲望": "重建秩序" }, L2: { "资源": "晶核" }, L3: { "同盟": ["叶凡"] } },
      knowledge_boundary_json: { knows: ["能量守恒"], unknown: [], false_belief: [], reasonable_suspect: [] },
      arc_json: { direction: "成长" },
    }],
    relations: [],
    initial_memories: [{ character_id: "33333333-3333-3333-3333-333333333333", memory_content: "公开晶核余量。" }],
  });

  assert.equal(lead.id, "33333333-3333-3333-3333-333333333333");
  assert.equal(lead.l0["底层信念"], "公平");
  assert.equal(lead.l1.desire, "重建秩序");
  assert.equal(lead.l2["资源"], "晶核");
  assert.deepEqual(lead.l3["同盟"], ["叶凡"]);
  assert.deepEqual(lead.initialMemories, ["公开晶核余量。"]);
});

test("preserves V7 initial-memory metadata when preparing a character confirmation", () => {
  assert.deepEqual(
    buildInitialMemoryConfirmation([
      {
        char_ref: "sena-ref",
        memory_type: "event",
        truth_status: "true",
        memory_content: "A concrete initial memory.",
      },
    ], { "sena-ref": "33333333-3333-3333-3333-333333333333" }),
    [{
      char_id: "33333333-3333-3333-3333-333333333333",
      memory_type: "event",
      truth_status: "true",
      memory_content: "A concrete initial memory.",
    }],
  );
});

test("does not invent missing V7 initial-memory metadata", () => {
  assert.deepEqual(
    buildInitialMemoryConfirmation([
      { char_ref: "sena-ref", memory_content: "A memory without required metadata." },
    ], { "sena-ref": "33333333-3333-3333-3333-333333333333" }),
    [{
      char_id: "33333333-3333-3333-3333-333333333333",
      memory_type: "",
      truth_status: "",
      memory_content: "A memory without required metadata.",
    }],
  );
});

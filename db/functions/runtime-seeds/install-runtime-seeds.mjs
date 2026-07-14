import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const database = process.env.ZH_RUNTIME_SEEDS_DATABASE ?? "zh_narrative_test";
if (!new Set(["zh_narrative", "zh_narrative_test"]).has(database)) throw new Error("ZH_RUNTIME_SEEDS_DATABASE must be zh_narrative or zh_narrative_test");
const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../..");
const schemaSql = readFileSync(path.join(directory, "install-runtime-seeds.sql"), "utf8");
const prototype = readFileSync(path.join(root, "docs", "前端原型_v2", "pages", "skill_library.html"), "utf8").replaceAll("\r\n", "\n");
const start = prototype.indexOf("const defaultSkillData =");
const end = prototype.indexOf("\n    };\n\n    let activeCategory", start);
if (start < 0 || end < 0) throw new Error("defaultSkillData was not found in the prototype");
const context = {};
vm.runInNewContext(`${prototype.slice(start, end + 7).replace("const defaultSkillData =", "defaultSkillData =")};`, context);
const source = context.defaultSkillData;
const expected = { "theme-combos": 54, "chapter-expansion": 8, "art-presentation": 6, "camera-language": 4 };
for (const [category, count] of Object.entries(expected)) if (!Array.isArray(source[category]) || source[category].length !== count) throw new Error(`unexpected ${category} count`);

const categories = { "theme-combos": "题材组合", "chapter-expansion": "章节展开", "art-presentation": "艺术呈现", "camera-language": "镜头语言" };
const sourceLocator = "docs/前端原型_v2/pages/skill_library.html#defaultSkillData";
const sourceSha256 = createHash("sha256").update(JSON.stringify(source), "utf8").digest("hex");
const reviewDate = "2026-07-14";

// Ratings are display metadata only. The fixed identity set preserves the approved 24/48 decision,
// while these rules state why a candidate belongs in that decision rather than merely how to use it.
const optimizedIds = new Set(["tc-4", "tc-27", "tc-29", "tc-1", "tc-17", "tc-28", "tc-41", "tc-16", "tc-23", "ce-2", "ce-4", "ce-5", "ce-7", "ce-8", "ap-1", "ap-2", "ap-3", "ap-4", "ap-5", "ap-6", "cl-1", "cl-2", "cl-3", "cl-4"]);
const ruleCatalog = {
  DIRECT_PRESENTATION: "艺术呈现和镜头语言是局部表现技术；它们只改变已验证场景的叙述、感官或镜头组织，不主张新增世界事实、资源或权限，因此可直接优化使用。",
  RESOURCE_PRODUCTION_LOOP: "资源、生产、经营闭环把投入、消耗、产出或组织能力写成可核验的因果链；在正式设定和已验证资源内可优化使用。",
  TEAM_CAPABILITY_RESOURCE_LOOP: "团队角色、能力互补和探索资源闭环只编排已验证成员、能力、风险与补给；不预设队伍权限或战果，因此可优化使用。",
  REUSABLE_CAUSAL_ARC: "可复用因果弧以已发生的压力、选择、代价和结果组织节奏；不需要预设超规格权限，因此可优化使用。",
  SYSTEM_OR_HIGH_ASSUMPTION: "依赖系统权限、重生先知、全知 AI、军事或机构能力、超规格资源或高设定前提的候选，不能把题材标签当成事实，必须约束使用。",
  SETTING_SPECIFIC_TROPE: "该题材组合预设特定作品的世界规则、冲突关系或结果走向；这些前提不能由技能标签补造，必须受正式设定和已验证场景约束。",
  FACE_SLAP_OR_REVERSAL: "打脸或反转弧容易把预设胜利、对手失智或未铺垫真相写成既定结果，必须以已验证动机、线索和因果约束使用。"
};
const resourceLoopIds = new Set(["tc-4", "tc-27", "tc-1", "tc-17", "tc-28", "tc-41", "tc-16", "tc-23"]);
const teamCapabilityResourceLoopIds = new Set(["tc-29"]);
const causalArcIds = new Set(["ce-2", "ce-4", "ce-5", "ce-7", "ce-8"]);
const highAssumptionIds = new Set(["tc-44", "tc-50", "tc-3", "tc-6", "tc-8", "tc-24", "tc-26", "tc-36", "tc-39", "tc-43", "tc-45", "tc-47", "tc-49", "tc-52", "tc-2", "tc-7", "tc-9", "tc-11", "tc-13", "tc-20", "tc-21", "tc-31", "tc-35", "tc-40", "tc-46", "tc-51", "tc-12", "tc-14", "tc-22", "tc-25", "tc-42", "tc-10"]);
const revisedConstraints = {
  "tc-50": "系统面板、任务奖励和越级成长只在本书已确认的魔法体系与代价规则中使用，不能把系统权限当作现实或跨书事实。",
  "tc-6": "都市巨型系统的调度、资源与制度影响必须由本书已写明的组织能力支持，不能凭系统标签补造现实机构权限。",
  "tc-43": "无限副本的规则、惩罚和回归条件必须来自当前作品已锁定的副本设定，不能把未声明的任务机制写成既定事实。",
  "tc-45": "末世黑科技仅可引用作品内已验证的技术来源、能耗和失效边界，不能将原型中的技术能力自动视为可用资源。",
  "tc-46": "AI 威胁、算力和控制范围必须符合本书已确认的网络与设备条件，不能由题材标签推出全知或全域控制。",
  "tc-51": "玄幻系统的兑换、面板与升级条件须受已锁定的修行体系和代价约束，不能绕过角色现有境界或世界规则。",
  "tc-54": "它从都市金融、舆情和控制权对抗展开，不要求 tc-35 的重生信息差与早期资本积累，因此保留为独立技能而非别名。",
  "tc-22": "军事系统只可在作品已经确认的指挥链、装备和授权范围内调用，不能把系统显示的态势当作未验证的战场事实。",
  "tc-25": "星际战争的舰队、航线和武器能力必须由正式作品设定和当前场景资源证明，不能凭星际题材直接补足军事能力。",
  "ce-6": "其轻视到补刀的节拍与 ce-1 的场景/弧结构不同；反派反应仍须符合利益博弈和角色心理，不能以震惊体替代因果。"
};
function evidenceFor(raw) {
  const fields = ["logic", "arc", "strategy", "conflict", "taboo", "keyPoint"].filter((field) => typeof raw[field] === "string" && raw[field].trim());
  return Object.fromEntries(fields.map((field) => [field, raw[field]]));
}
function evidenceSummary(evidence) {
  const [field, value] = Object.entries(evidence)[0] ?? ["title", "无额外字段"];
  return `${field}=${value.slice(0, 120)}`;
}
function classificationRule(raw, category, optimized) {
  if (category === "art-presentation" || category === "camera-language") return "DIRECT_PRESENTATION";
  if (resourceLoopIds.has(raw.id)) return "RESOURCE_PRODUCTION_LOOP";
  if (teamCapabilityResourceLoopIds.has(raw.id)) return "TEAM_CAPABILITY_RESOURCE_LOOP";
  if (causalArcIds.has(raw.id)) return "REUSABLE_CAUSAL_ARC";
  if (["ce-1", "ce-3", "ce-6"].includes(raw.id)) return "FACE_SLAP_OR_REVERSAL";
  if (highAssumptionIds.has(raw.id)) return "SYSTEM_OR_HIGH_ASSUMPTION";
  if (!optimized) return "SETTING_SPECIFIC_TROPE";
  throw new Error(`no classification rule for ${raw.id}`);
}
function riskFlags(raw, ruleId) {
  const text = Object.values(evidenceFor(raw)).join(" ");
  const flags = [];
  if (ruleId === "FACE_SLAP_OR_REVERSAL") flags.push("preset_victory_or_unearned_reversal");
  if (/系统|面板|任务|兑换/.test(text)) flags.push("system_permission");
  if (/重生|前世|全知|未来/.test(text)) flags.push("foreknowledge");
  if (/AI|算力/.test(text)) flags.push("ai_omniscience_or_control");
  if (/军事|军队|舰队|国家|军阀|战场/.test(text)) flags.push("military_or_institutional_authority");
  if (/黑科技|星际|神级|超越世界|高维|巨型系统/.test(text)) flags.push("overspec_resource_or_setting");
  return flags.length ? flags : ["candidate_preference_only"];
}
function optimizationActions(raw, ruleId) {
  const actions = ["Keep raw_source byte-for-field faithful; use only as a candidate preference."];
  if (ruleId === "DIRECT_PRESENTATION") actions.push("Apply presentation choices only to a verified scene and POV.");
  if (ruleId === "RESOURCE_PRODUCTION_LOOP") actions.push("Require explicit inputs, costs, outputs, and elapsed capability before proposing progression.");
  if (ruleId === "TEAM_CAPABILITY_RESOURCE_LOOP") actions.push("Require verified members, complementary abilities, expedition risks, and resources before proposing team progression.");
  if (ruleId === "REUSABLE_CAUSAL_ARC") actions.push("Bind each beat to verified prior causes, stakes, and consequences.");
  if (ruleId === "SYSTEM_OR_HIGH_ASSUMPTION") actions.push("Convert any implied permission, foreknowledge, capability, or resource into a verified precondition.");
  if (ruleId === "SETTING_SPECIFIC_TROPE") actions.push("Treat implied world rules, conflicts, and outcomes as verified preconditions, never as generated facts.");
  if (ruleId === "FACE_SLAP_OR_REVERSAL") actions.push("Require verified motive, clues, and causal reversal before proposing payoff.");
  if (raw.id === "ce-5") actions.push("Derived-only normalization: interpret raw keyPoint typo '资源资源消耗出口' as '资源消耗出口'; raw_source remains unchanged.");
  return actions;
}
const rows = Object.entries(source).flatMap(([prototype_category, skills]) => skills.map((raw) => {
  const optimized = optimizedIds.has(raw.id);
  const classification_rule_id = classificationRule(raw, prototype_category, optimized);
  const evidence_fields = evidenceFor(raw);
  const constraints = [raw.conflict, raw.taboo, raw.keyPoint].filter(Boolean);
  const classification_reason = `${raw.id}《${raw.title}》适用 ${classification_rule_id}：${ruleCatalog[classification_rule_id]} 原型字段证据：${evidenceSummary(evidence_fields)}。`;
  const use_constraints = ["candidate preference only", "formal setting required", "verified scene required", "POV boundary required", "no new facts", "fail closed when a precondition is missing", revisedConstraints[raw.id]].filter(Boolean);
  const research = {
    decision: optimized ? "ACTIVE_OPTIMIZED" : "ACTIVE_CONSTRAINED",
    classification_rule_id,
    classification_reason,
    risk_flags: riskFlags(raw, classification_rule_id),
    evidence_fields,
    optimization_actions: optimizationActions(raw, classification_rule_id),
    use_constraints,
    source_locator: sourceLocator,
    source_sha256: sourceSha256,
    review_protocol: "STATIC_RULE_REVIEW_V1: fixed rule catalog; evidence is read only from defaultSkillData fields; ratings excluded from evidence.",
    review_date: reviewDate,
    // Compatibility with existing consumers; classification_reason is authoritative.
    reason: classification_reason,
    constraints
  };
  return {
    skill_code: `runtime-seeds:skill-library:${prototype_category}:${raw.id}`,
    version_no: 1,
    skill_name: raw.title,
    skill_category: categories[prototype_category],
    skill_description: raw.essence ?? raw.arc ?? raw.strategy ?? raw.logic ?? raw.title,
    skill_config_jsonb: { raw_source: raw, research },
    input_requirements: { required: ["formal_work_setting", "verified_scene_context", "pov_boundary"], no_new_facts: true },
    execution_steps: raw.logic ?? raw.arc ?? raw.strategy ?? [],
    output_structure: { candidate_only: true, raw_source: raw },
    applicable_scenes: { tag: raw.tag ?? null, scene: raw.scene ?? null, conflict: raw.conflict ?? null },
    rollback_strategy: { mode: "fail_closed", on_missing_setting: "BLOCKED" },
    eval_criteria: { reason: classification_reason, constraints },
    genre_main: prototype_category === "theme-combos" ? raw.tag : null,
    genre_sub_tags: raw.subGenres ? raw.subGenres.split("+") : [raw.tag].filter(Boolean),
    combo_logic: raw.logic ? { logic: raw.logic } : null,
    fun_source: raw.attraction ?? null,
    essence: raw.essence ?? null,
    candidate_status: "committed",
    source_type: "system_builtin",
    lifecycle_status: "active"
  };
}));
if (rows.length !== 72) throw new Error("prototype identity count must be 72");
if (rows.filter((row) => row.skill_config_jsonb.research.decision === "ACTIVE_OPTIMIZED").length !== 24) throw new Error("optimized identity count must be 24");
const encoded = Buffer.from(JSON.stringify(rows), "utf8").toString("base64");
const sql = `BEGIN;
SET LOCAL zh.bypass_rpc = 'true';
${schemaSql}
DELETE FROM public.t_repertoire_assets WHERE source_type = 'system_builtin' AND skill_code LIKE 'prototype:skill-library:%';
WITH seed AS (SELECT value AS item FROM jsonb_array_elements(convert_from(decode('${encoded}', 'base64'), 'UTF8')::jsonb))
INSERT INTO public.t_repertoire_assets (skill_code, version_no, skill_name, skill_category, skill_description, skill_config_jsonb, input_requirements, execution_steps, output_structure, applicable_scenes, rollback_strategy, eval_criteria, genre_main, genre_sub_tags, combo_logic, fun_source, essence, candidate_status, source_type, owner_local_operator_id, lifecycle_status)
SELECT item->>'skill_code', (item->>'version_no')::integer, item->>'skill_name', item->>'skill_category', item->>'skill_description', item->'skill_config_jsonb', item->'input_requirements', to_jsonb(item->'execution_steps'), item->'output_structure', item->'applicable_scenes', item->'rollback_strategy', item->'eval_criteria', item->>'genre_main', item->'genre_sub_tags', item->'combo_logic', item->>'fun_source', item->>'essence', item->>'candidate_status', item->>'source_type', NULL, item->>'lifecycle_status' FROM seed
ON CONFLICT (skill_code, version_no) DO UPDATE SET skill_name = EXCLUDED.skill_name, skill_category = EXCLUDED.skill_category, skill_description = EXCLUDED.skill_description, skill_config_jsonb = EXCLUDED.skill_config_jsonb, input_requirements = EXCLUDED.input_requirements, execution_steps = EXCLUDED.execution_steps, output_structure = EXCLUDED.output_structure, applicable_scenes = EXCLUDED.applicable_scenes, rollback_strategy = EXCLUDED.rollback_strategy, eval_criteria = EXCLUDED.eval_criteria, genre_main = EXCLUDED.genre_main, genre_sub_tags = EXCLUDED.genre_sub_tags, combo_logic = EXCLUDED.combo_logic, fun_source = EXCLUDED.fun_source, essence = EXCLUDED.essence, candidate_status = EXCLUDED.candidate_status, lifecycle_status = EXCLUDED.lifecycle_status, updated_at = clock_timestamp()
WHERE public.t_repertoire_assets.source_type = 'system_builtin';
COMMIT;`;
execFileSync("docker", ["exec", "-i", process.env.ZH_RUNTIME_SEEDS_POSTGRES_CONTAINER ?? "n8n-pgvector", "sh", "-lc", `exec psql -X -q -v ON_ERROR_STOP=1 -U \"$POSTGRES_USER\" -d ${database} -f -`], { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });

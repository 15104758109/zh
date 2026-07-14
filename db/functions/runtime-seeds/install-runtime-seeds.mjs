import { execFileSync } from "node:child_process";
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
// These are the previously reviewed optimized identities; source ratings are display metadata, not quality evidence.
const optimizedIds = new Set(["tc-4", "tc-27", "tc-29", "tc-1", "tc-17", "tc-28", "tc-41", "tc-16", "tc-23", "ce-2", "ce-4", "ce-5", "ce-7", "ce-8", "ap-1", "ap-2", "ap-3", "ap-4", "ap-5", "ap-6", "cl-1", "cl-2", "cl-3", "cl-4"]);
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
const rows = Object.entries(source).flatMap(([prototype_category, skills]) => skills.map((raw) => {
  const optimized = optimizedIds.has(raw.id);
  const constraints = [raw.conflict, raw.taboo, raw.keyPoint].filter(Boolean);
  const reason = revisedConstraints[raw.id] ?? `${raw.title} 的具体冲突/禁忌是：${constraints.join("；")}。仅在当前作品已确认的正式设定、已验证资源与 POV 边界内作为候选偏好使用，不构成新事实。`;
  return {
    skill_code: `runtime-seeds:skill-library:${prototype_category}:${raw.id}`,
    version_no: 1,
    skill_name: raw.title,
    skill_category: categories[prototype_category],
    skill_description: raw.essence ?? raw.arc ?? raw.strategy ?? raw.logic ?? raw.title,
    skill_config_jsonb: { raw_source: raw, research: { decision: optimized ? "ACTIVE_OPTIMIZED" : "ACTIVE_CONSTRAINED", reason, constraints } },
    input_requirements: { required: ["formal_work_setting", "verified_scene_context", "pov_boundary"], no_new_facts: true },
    execution_steps: raw.logic ?? raw.arc ?? raw.strategy ?? [],
    output_structure: { candidate_only: true, raw_source: raw },
    applicable_scenes: { tag: raw.tag ?? null, scene: raw.scene ?? null, conflict: raw.conflict ?? null },
    rollback_strategy: { mode: "fail_closed", on_missing_setting: "BLOCKED" },
    eval_criteria: { reason, constraints },
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

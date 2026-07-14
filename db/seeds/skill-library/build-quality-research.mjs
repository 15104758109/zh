import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const rawSeed = JSON.parse(readFileSync(path.join(here, "default-skill-data.json"), "utf8"));
const semantic = JSON.parse(readFileSync(path.join(root, "docs", "skill-library", "semantic-skill-research.json"), "utf8"));
const expectedCounts = { ACTIVE_OPTIMIZED: 24, ACTIVE_CONSTRAINED: 38, INACTIVE_ALIAS: 2, INACTIVE_UNSAFE: 8 };
const categoryMap = {
  "theme-combos": "题材组合",
  "chapter-expansion": "章节展开",
  "art-presentation": "艺术呈现",
  "camera-language": "镜头语言",
};
const rawRows = Object.entries(rawSeed).flatMap(([prototypeCategory, items]) => items.map((raw) => ({ prototypeCategory, raw })));
const researchRows = semantic.decisions;
if (rawRows.length !== 72 || researchRows.length !== 72) throw new Error("semantic research/raw seed must contain 72 rows");
const counts = researchRows.reduce((result, row) => {
  result[row.decision] = (result[row.decision] ?? 0) + 1;
  return result;
}, {});
for (const [key, value] of Object.entries(expectedCounts)) if (counts[key] !== value) throw new Error(`semantic decision count mismatch for ${key}`);
const byId = new Map(researchRows.map((row) => [row.id, row]));
if (byId.size !== 72 || rawRows.some(({ raw }) => !byId.has(raw.id))) throw new Error("semantic decisions do not cover raw seed exactly");

function deriveSteps(category, raw) {
  const source = category === "theme-combos" ? raw.logic : category === "chapter-expansion" ? raw.arc : raw.strategy;
  if (!source) return [];
  const parts = source.split(category === "theme-combos" ? /\s*(?:->|→)\s*/ : /\s*(?:→|\/|；|;)\s*/).map((part) => part.trim()).filter(Boolean);
  return parts.map((instruction, index) => ({ order: index + 1, instruction, source_field: category === "theme-combos" ? "logic" : category === "chapter-expansion" ? "arc" : "strategy" }));
}

function status(decision) {
  return decision === "ACTIVE_OPTIMIZED" ? { candidate_status: "committed", lifecycle_status: "active", quality_status: "optimized" }
    : decision === "ACTIVE_CONSTRAINED" ? { candidate_status: "committed", lifecycle_status: "active", quality_status: "constrained" }
      : { candidate_status: "draft", lifecycle_status: "draft", quality_status: decision === "INACTIVE_ALIAS" ? "alias" : "unsafe" };
}

const records = rawRows.map(({ prototypeCategory, raw }) => {
  const research = byId.get(raw.id);
  const state = status(research.decision);
  const category = categoryMap[prototypeCategory];
  const rawSource = raw;
  return {
    skill_code: `prototype:skill-library:${prototypeCategory}:${raw.id}`,
    version_no: 1,
    prototype_category: prototypeCategory,
    skill_category: category,
    skill_name: raw.title,
    decision: research.decision,
    alias_of: research.alias_of ?? null,
    input_requirements: {
      required_inputs: ["locked_stage", "scene_context", "source_facts", "active_world_state", "active_character_state"],
      provenance_required: true,
      no_new_facts: true,
      candidate_only: true,
      specific_gate: research.specific_gate,
      genre_main: research.genre_main,
      subtags: research.subtags,
    },
    execution_steps: deriveSteps(prototypeCategory, raw),
    output_structure: {
      schema_version: "skill-result/v1",
      candidate_only: true,
      closed_fields: ["selected_scene", "applied_steps", "facts_used", "facts_added", "constraints_checked", "failure_reason"],
      facts_added_policy: "must remain empty unless separately approved; never overwrite user intent or create unprovided world facts",
      raw_source: rawSource,
    },
    applicable_scenes: { specific_applicability: research.specific_applicability, genre_main: research.genre_main, subtags: research.subtags },
    failure_samples: [
      "Missing required gate evidence -> fail closed and return the missing fields.",
      "Candidate or alias content presented as formal fact -> reject without active mutation.",
      "Specific eval check fails or taboo/conflict boundary is violated -> rollback to last formal snapshot.",
    ],
    rollback_strategy: {
      mode: "fail_closed_transaction",
      on_failure: "emit no active result and retain last formal snapshot",
      inactive_policy: research.decision.startsWith("INACTIVE") ? "candidate_status=draft; lifecycle_status=draft; exclude from active retrieval" : "discard candidate delta",
    },
    eval_criteria: {
      specific_eval_check: research.eval_check,
      reason: research.reason,
      gate_must_pass: research.specific_gate,
      output_closed: "facts_added is empty and raw_source is the only source payload",
    },
    optimization_notes: research.reason,
    quality_status: state.quality_status,
    quality_score: null,
    research: {
      reason: research.reason,
      specific_gate: research.specific_gate,
      eval_check: research.eval_check,
      canonical_category: research.canonical_category,
    },
    genre_main: prototypeCategory === "theme-combos" ? (research.genre_main?.[0] ?? null) : null,
    genre_sub_tags: research.subtags ?? [],
    source_type: "system_builtin",
    owner_local_operator_id: null,
    candidate_status: state.candidate_status,
    lifecycle_status: state.lifecycle_status,
  };
});

const categorySummary = Object.fromEntries(Object.entries(categoryMap).map(([prototypeCategory, canonicalCategory]) => {
  const rows = records.filter((row) => row.prototype_category === prototypeCategory);
  return [canonicalCategory, {
    prototype_category: prototypeCategory,
    total: rows.length,
    ACTIVE_OPTIMIZED: rows.filter((row) => row.decision === "ACTIVE_OPTIMIZED").length,
    ACTIVE_CONSTRAINED: rows.filter((row) => row.decision === "ACTIVE_CONSTRAINED").length,
    INACTIVE_ALIAS: rows.filter((row) => row.decision === "INACTIVE_ALIAS").length,
    INACTIVE_UNSAFE: rows.filter((row) => row.decision === "INACTIVE_UNSAFE").length,
  }];
}));
const report = {
  protocol: "r3-skill-quality-research/v1",
  source: "docs/前端原型_v2/pages/skill_library.html#defaultSkillData",
  semantic_source: "docs/skill-library/semantic-skill-research.json",
  count_note: "V7页面27/8/6/4为历史展示口径；原型实际54/8/6/4，未裁剪。",
  decision_counts: counts,
  canonical_categories: categoryMap,
  category_summary: categorySummary,
  duplicate_groups: semantic.duplicate_groups,
  decisions: records.map((row) => ({
    id: row.output_structure.raw_source.id,
    decision: row.decision,
    canonical_category: row.research.canonical_category,
    reason: row.research.reason,
    specific_gate: row.research.specific_gate,
    eval_check: row.research.eval_check,
    alias_of: row.alias_of,
  })),
  unresolved_candidates: records.filter((row) => row.lifecycle_status === "draft").map((row) => ({ id: row.output_structure.raw_source.id, decision: row.decision, reason: row.research.reason, specific_gate: row.research.specific_gate })),
};

mkdirSync(path.join(root, "docs", "skill-library"), { recursive: true });
writeFileSync(path.join(here, "optimized-skill-data.json"), `${JSON.stringify(records, null, 2)}\n`, "utf8");
writeFileSync(path.join(root, "docs", "skill-library", "prototype-skill-quality-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
const setupSql = `-- Runtime installer setup. Data is loaded from optimized-skill-data.json by install-prototype-skill-library.mjs.\nBEGIN;\nSET LOCAL zh.bypass_rpc = 'true';\nALTER TABLE public.t_repertoire_assets ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'user_managed';\nALTER TABLE public.t_repertoire_assets ADD COLUMN IF NOT EXISTS owner_local_operator_id text NULL;\nALTER TABLE public.t_repertoire_assets ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'active';\nALTER TABLE public.t_repertoire_assets DROP CONSTRAINT IF EXISTS t_repertoire_assets_lifecycle_status_check;\nUPDATE public.t_repertoire_assets SET lifecycle_status = CASE lifecycle_status WHEN 'inactive' THEN 'draft' WHEN 'deprecated' THEN 'archived' ELSE lifecycle_status END WHERE source_type = 'system_builtin' AND skill_code LIKE 'prototype:skill-library:%' AND lifecycle_status IN ('inactive', 'deprecated');\nALTER TABLE public.t_repertoire_assets DROP CONSTRAINT IF EXISTS t_repertoire_assets_skill_category_check, ADD CONSTRAINT t_repertoire_assets_skill_category_check CHECK (skill_category IN ('commercial', 'chapter', 'world', '题材组合', '章节展开', '艺术呈现', '镜头语言'));\nALTER TABLE public.t_repertoire_assets DROP CONSTRAINT IF EXISTS t_repertoire_assets_source_type_check, ADD CONSTRAINT t_repertoire_assets_source_type_check CHECK (source_type IN ('system_builtin', 'user_managed'));\nALTER TABLE public.t_repertoire_assets ADD CONSTRAINT t_repertoire_assets_lifecycle_status_check CHECK (lifecycle_status IN ('active', 'draft', 'archived', 'inactive', 'deprecated'));\nALTER TABLE public.t_repertoire_assets DROP CONSTRAINT IF EXISTS t_repertoire_assets_system_builtin_owner_check, ADD CONSTRAINT t_repertoire_assets_system_builtin_owner_check CHECK (source_type <> 'system_builtin' OR owner_local_operator_id IS NULL);\nCREATE UNIQUE INDEX IF NOT EXISTS t_repertoire_assets_skill_code_version_no_uidx ON public.t_repertoire_assets (skill_code, version_no);\nCOMMIT;\n`;
writeFileSync(path.join(root, "db", "functions", "skill-library", "install-prototype-skill-library.sql"), setupSql, "utf8");

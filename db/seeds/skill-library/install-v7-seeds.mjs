import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const database = process.env.ZH_V7_DATABASE ?? "zh_narrative";
const container = process.env.ZH_V7_POSTGRES_CONTAINER ?? "n8n-pgvector";
if (database !== "zh_narrative") throw new Error("ZH_V7_DATABASE must be zh_narrative");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const prototypePath = path.join(root, "docs", "前端原型_v2", "pages", "skill_library.html");
const prototype = readFileSync(prototypePath, "utf8").replaceAll("\r\n", "\n");
const start = prototype.indexOf("const defaultSkillData =");
const end = prototype.indexOf("\n    };\n\n    let activeCategory", start);
if (start < 0 || end < 0) throw new Error("defaultSkillData was not found");
const context = {};
vm.runInNewContext(`${prototype.slice(start, end + 7).replace("const defaultSkillData =", "defaultSkillData =")};`, context);
const source = context.defaultSkillData;
const categoryMap = {
  "theme-combos": "题材组合",
  "chapter-expansion": "章节展开",
  "art-presentation": "艺术呈现",
  "camera-language": "镜头语言",
};
const sourceLocator = "docs/前端原型_v2/pages/skill_library.html#defaultSkillData";
const sourceSha256 = createHash("sha256").update(JSON.stringify(source), "utf8").digest("hex");

function uuidFrom(value) {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

const rows = Object.entries(source).flatMap(([prototypeCategory, skills]) => skills.map((raw) => {
  const category = categoryMap[prototypeCategory];
  const slug = `builtin-${prototypeCategory}-${raw.id}`;
  const description = raw.essence ?? raw.arc ?? raw.strategy ?? raw.logic ?? raw.title;
  const evidence = Object.fromEntries(["logic", "arc", "strategy", "conflict", "taboo", "keyPoint"]
    .filter((key) => typeof raw[key] === "string" && raw[key].trim())
    .map((key) => [key, raw[key]]));
  const constraints = ["candidate_only", "formal_setting_required", "verified_scene_required", "pov_boundary_required", "no_new_facts", "fail_closed_when_missing", ...[raw.conflict, raw.taboo, raw.keyPoint].filter(Boolean)];
  return {
    skill_id: uuidFrom(`skill:${raw.id}`),
    stable_slug: slug,
    version: 1,
    source_type: "system_builtin",
    source_locator: sourceLocator,
    source_sha256: sourceSha256,
    skill_name: raw.title,
    skill_category: category,
    skill_description: description,
    applicable_stages: [category === "题材组合" ? "design" : "production", "audit"],
    applicable_scopes: { genre: raw.tag ?? null, scene: raw.scene ?? null, conflict: raw.conflict ?? null },
    constraint_fields: constraints,
    template_fields: { raw_source_fields: Object.keys(raw), raw_source_id: raw.id },
    skill_config_jsonb: { raw_source: raw, seed_review: "V7_STATIC_SOURCE_REVIEW_V1", evidence },
  };
}));
if (rows.length === 0) throw new Error("skill source is empty");

const encoded = Buffer.from(JSON.stringify(rows), "utf8").toString("base64");
const sql = `BEGIN;
DELETE FROM public.skill WHERE source_type = 'system_builtin';
WITH seed AS (
  SELECT value AS item FROM jsonb_array_elements(convert_from(decode('${encoded}', 'base64'), 'UTF8')::jsonb)
)
INSERT INTO public.skill (skill_id, stable_slug, version, source_type, owner_local_operator_id, source_locator, source_sha256, skill_name, skill_category, skill_description, applicable_stages, applicable_scopes, constraint_fields, template_fields, skill_config_jsonb, lifecycle_status)
SELECT (item->>'skill_id')::uuid, item->>'stable_slug', (item->>'version')::integer, item->>'source_type', NULL, item->>'source_locator', item->>'source_sha256', item->>'skill_name', item->>'skill_category', item->>'skill_description', item->'applicable_stages', item->'applicable_scopes', item->'constraint_fields', item->'template_fields', item->'skill_config_jsonb', 'active'
FROM seed;
INSERT INTO public.v7_install_metadata(install_key, description) VALUES ('v7-skill-seeds', 'Idempotent system_builtin seeds from the static skill_library prototype.');
COMMIT;`;

execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "n8n", "-d", database, "-f", "-"], {
  cwd: root,
  input: sql,
  encoding: "utf8",
  stdio: ["pipe", "inherit", "inherit"],
});
process.stdout.write(`Seeded ${rows.length} system_builtin skills in ${database}\n`);

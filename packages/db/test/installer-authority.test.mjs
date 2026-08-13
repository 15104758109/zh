import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { docker, dockerLong, isDockerUnavailable, runtimeUnavailableMessage } from "../../../tests/support/docker-runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const rebuildSource = readFileSync(path.join(root, "packages/db/src/rebuild-v7.mjs"), "utf8");
const installerSource = readFileSync(path.join(root, "db/install/v7-data-rpc-contract.sql"), "utf8");
const contractRoot = path.join(root, "packages/contracts/src");

function jsonContracts(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? jsonContracts(target) : entry.name.endsWith(".json") ? [target] : [];
  });
}

test("db:v7:rebuild has one canonical executable entry", () => {
  assert.equal(packageJson.scripts["db:v7:rebuild"], "node packages/db/src/rebuild-v7.mjs");
  assert.match(rebuildSource, /v7-data-rpc-contract\.sql/);
  assert.doesNotMatch(rebuildSource, /v7-product\.sql/);
  assert.doesNotMatch(rebuildSource, /install-v7-seeds\.mjs/);
});

test("test:db runs only the current V7 installer guard and isolated business journey", () => {
  const command = packageJson.scripts["test:db"];
  assert.match(command, /packages\/db\/test\/installer-authority\.test\.mjs/);
  assert.match(command, /tests\/business\/v7-data-rpc\/v7-data-rpc\.test\.mjs/);
  assert.match(command, /tests\/business\/v7-data-rpc\/journey-b5-b8\.test\.mjs/);
  assert.doesNotMatch(command, /migrations\.test\.mjs/);
  assert.doesNotMatch(command, /journey-b1-b4|world-confirm-serialization/);
});

test("the rebuild installer contains the full V7 chain and approved seed boundary", () => {
  for (const marker of [
    "CREATE OR REPLACE FUNCTION public.rpc_create_book_project",
    "CREATE OR REPLACE FUNCTION public.rpc_select_l1a_for_production",
    "CREATE OR REPLACE FUNCTION public.rpc_commit_chapter",
    "CREATE OR REPLACE FUNCTION public.rpc_record_iteration_sample",
    "V7_SKILL_SEED_REQUIRED: expected 72 approved system_builtin skills",
  ]) {
    assert.ok(installerSource.includes(marker), `canonical installer is missing ${marker}`);
  }
});

test("the UTF-8 canonical installer rebuilds the approved skill source in an empty database", (t) => {
  const container = process.env.ZH_V7_POSTGRES_CONTAINER ?? "n8n-pgvector";
  const database = `zh_v7_installer_${process.pid}_${randomUUID().replaceAll("-", "")}`;
  let postgresUser;
  let created = false;

  try {
    postgresUser = docker(["exec", container, "sh", "-lc", "printf '%s' \"$POSTGRES_USER\""]).trim();
    if (!postgresUser) throw new Error("PostgreSQL runtime unavailable: POSTGRES_USER missing");
    dockerLong(["exec", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-q", "-U", postgresUser, "-d", "postgres", "-c", `CREATE DATABASE \"${database}\"`]);
    created = true;
    dockerLong([
      "exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-q",
      "-U", postgresUser, "-d", database,
    ], { input: installerSource });

    const rows = docker([
      "exec", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-q",
      "-U", postgresUser, "-d", database, "-At", "-F", "|", "-c",
      "SELECT skill_category, count(*) FROM public.skill WHERE source_type='system_builtin' AND lifecycle_status='active' GROUP BY skill_category ORDER BY skill_category",
    ]).trim().split("\n");
    assert.deepEqual(rows, ["章节展开|8", "艺术呈现|6", "镜头语言|4", "题材组合|54"]);

    const approved = docker([
      "exec", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-q",
      "-U", postgresUser, "-d", database, "-At", "-c",
      "SELECT count(*) FROM public.skill WHERE source_type='system_builtin' AND lifecycle_status='active' AND owner_local_operator_id IS NULL AND source_locator='docs/前端原型_v2/pages/skill_library.html#defaultSkillData' AND source_file_sha256='e8dae19b8d83c1bc52bb51954f0c327c00e48699e55564b223da8f571835a6ef'",
    ]).trim();
    assert.equal(approved, "72");
  } catch (error) {
    if (!isDockerUnavailable(error)) throw error;
    return t.skip(runtimeUnavailableMessage(error, "PostgreSQL"));
  } finally {
    if (created) {
      try {
        dockerLong(["exec", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-q", "-U", postgresUser, "-d", "postgres", "-c", `DROP DATABASE IF EXISTS \"${database}\" WITH (FORCE)`]);
      } catch (error) {
        if (!isDockerUnavailable(error)) throw error;
      }
    }
  }
});

test("the installed ZH05-ZH06 adjacent RPC and P0 trigger definitions match live", (t) => {
  const container = process.env.ZH_V7_POSTGRES_CONTAINER ?? "n8n-pgvector";
  const liveDatabase = process.env.ZH_V7_LIVE_DATABASE ?? "zh_narrative";
  const database = `zh_v7_adjacent_${process.pid}_${randomUUID().replaceAll("-", "")}`;
  const definitionQuery = `
WITH function_defs AS (
  SELECT jsonb_build_object(
    'kind', 'function',
    'name', p.proname,
    'identity_args', pg_get_function_identity_arguments(p.oid),
    'result', pg_get_function_result(p.oid),
    'language', l.lanname,
    'volatility', p.provolatile,
    'security_definer', p.prosecdef,
    'config', to_jsonb(p.proconfig),
    'source', p.prosrc
  ) AS definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language l ON l.oid = p.prolang
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'rpc_finalize_deduction_snapshot',
      'rpc_persist_candidate_text',
      'rpc_confirm_audit_result',
      'rpc_record_chapter_review_evidence',
      'rpc_continue_chapter',
      'rpc_archive_shadow_version',
      'rpc_commit_chapter',
      'v7_audit_p0_immutable'
    )
), trigger_defs AS (
  SELECT jsonb_build_object(
    'kind', 'trigger',
    'name', t.tgname,
    'table', c.relname,
    'definition', pg_get_triggerdef(t.oid, true)
  ) AS definition
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND NOT t.tgisinternal
    AND t.tgname = 'v7_audit_p0_immutable'
)
SELECT COALESCE(
  jsonb_agg(definition ORDER BY definition->>'kind', definition->>'name'),
  '[]'::jsonb
)::text
FROM (
  SELECT definition FROM function_defs
  UNION ALL
  SELECT definition FROM trigger_defs
) definitions`;
  let postgresUser;
  let created = false;

  const readDefinitions = (targetDatabase) => JSON.parse(dockerLong([
    "exec", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-q",
    "-U", postgresUser, "-d", targetDatabase, "-At", "-c", definitionQuery,
  ]).trim());

  try {
    postgresUser = docker(["exec", container, "sh", "-lc", "printf '%s' \"$POSTGRES_USER\""]).trim();
    if (!postgresUser) throw new Error("PostgreSQL runtime unavailable: POSTGRES_USER missing");
    dockerLong(["exec", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-q", "-U", postgresUser, "-d", "postgres", "-c", `CREATE DATABASE "${database}"`]);
    created = true;
    dockerLong([
      "exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-q",
      "-U", postgresUser, "-d", database,
    ], { input: installerSource });

    const installedDefinitions = readDefinitions(database);
    const liveDefinitions = readDefinitions(liveDatabase);

    assert.equal(installedDefinitions.length, 9, "canonical install must expose eight functions and the P0 trigger");
    assert.deepEqual(
      liveDefinitions,
      installedDefinitions,
      `live ${liveDatabase} ZH05-ZH06 adjacent definitions drift from the canonical installer`,
    );
  } catch (error) {
    if (!isDockerUnavailable(error)) throw error;
    return t.skip(runtimeUnavailableMessage(error, "PostgreSQL"));
  } finally {
    if (created) {
      try {
        dockerLong(["exec", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-q", "-U", postgresUser, "-d", "postgres", "-c", `DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`]);
      } catch (error) {
        if (!isDockerUnavailable(error)) throw error;
      }
    }
  }
});

test("ledger-backed mutations use semantic idempotency replay", () => {
  assert.match(installerSource, /CREATE OR REPLACE FUNCTION public\.v7_request_intent/);
  assert.match(installerSource, /CREATE OR REPLACE FUNCTION public\.v7_replay_product_request/);
  assert.match(installerSource, /'IDEMPOTENCY_CONFLICT'/);
  assert.doesNotMatch(
    installerSource,
    /SELECT\s+result\s+INTO\s+v_result\s+FROM\s+public\.product_request_log/i,
  );
  for (const rpc of [
    "rpc_create_book_project",
    "rpc_commit_world_settings",
    "rpc_commit_character_settings",
    "rpc_generate_l1a_conflicts",
    "rpc_finalize_l1a",
    "rpc_select_l1a_for_production",
    "rpc_persist_chapter_execution_plan",
    "rpc_finalize_deduction_snapshot",
    "rpc_persist_candidate_text",
    "rpc_confirm_audit_result",
    "rpc_record_chapter_review_evidence",
    "rpc_archive_shadow_version",
    "rpc_manage_skill",
    "rpc_save_prompt_candidate",
    "rpc_promote_prompt_config",
  ]) {
    const start = installerSource.indexOf(`CREATE OR REPLACE FUNCTION public.${rpc}`);
    const end = installerSource.indexOf("CREATE OR REPLACE FUNCTION public.", start + 1);
    const body = installerSource.slice(start, end < 0 ? undefined : end);
    assert.ok(start >= 0, `${rpc} must exist in the canonical installer`);
    assert.match(body, /v7_replay_product_request/, `${rpc} must replay through the semantic helper`);
    assert.match(body, /v7_request_intent|v_audit_intent/, `${rpc} must persist normalized or content-hashed request intent`);
  }
});

test("machine contracts describe the current unversioned B1-B4 RPC DTOs only", () => {
  const files = jsonContracts(contractRoot);
  for (const file of files) JSON.parse(readFileSync(file, "utf8"));

  const v7Directory = path.join(contractRoot, "v7-data-rpc");
  for (const obsolete of [
    "create-book-request.schema.json",
    "l1a-review-request.schema.json",
    "finalize-book-design-request.schema.json",
    "finalize-book-design-success.schema.json",
  ]) {
    assert.equal(existsSync(path.join(v7Directory, obsolete)), false, `${obsolete} is an obsolete compatibility contract`);
  }

  const currentSources = [
    readFileSync(path.join(contractRoot, "new-book/create-book-request.schema.json"), "utf8"),
    readFileSync(path.join(v7Directory, "world-request.schema.json"), "utf8"),
    readFileSync(path.join(v7Directory, "character-request.schema.json"), "utf8"),
    readFileSync(path.join(v7Directory, "l1a-request.schema.json"), "utf8"),
    readFileSync(path.join(v7Directory, "l1a-finalize-request.schema.json"), "utf8"),
  ].join("\n");
  assert.match(currentSources, /world_states/);
  assert.match(currentSources, /ordered_l1a_ids/);
  assert.match(currentSources, /design_fingerprint/);
  assert.doesNotMatch(currentSources, /world_version_id|character_version_id|current_l1a_id|read_versions|restore/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { docker, isDockerUnavailable, runtimeUnavailableMessage } from "../support/docker-runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const container = process.env.ZH_V7_POSTGRES_CONTAINER ?? "n8n-pgvector";
const workflow = JSON.parse(readFileSync(path.join(root, "docs/后端/n8n/ZH04-生产拆解.json"), "utf8"));
// The editable n8n attachment intentionally omits live instance metadata.
const productionWorkflowId = "26518707-d485-4140-af04-ff1444edb9d5";
const deductionWorkflow = JSON.parse(readFileSync(path.join(root, "docs/后端/n8n/ZH05-正文推演.json"), "utf8"));
const auditWorkflow = JSON.parse(readFileSync(path.join(root, "docs/后端/n8n/ZH06-审计阶段.json"), "utf8"));
const designWorkflows = [
  "ZH01-新书创建.json",
  "世界设定生成助手.json",
  "角色设定生成助手.json",
  "ZH02-L1A生成.json",
  "ZH03-三线排序.json",
].map((file) => JSON.parse(readFileSync(path.join(root, "docs/后端/n8n", file), "utf8")));

function sql(database, statement, postgresUser) {
  return docker([
    "exec", container, "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1",
    "-U", postgresUser, "-d", database, "-c", statement,
  ]).trim();
}

function readLiveWorkflow(workflowId, postgresUser) {
  const workflowJson = sql(
    "n8n",
    `SELECT json_build_object('id', id, 'active', active, 'nodes', nodes, 'connections', connections)::text
     FROM public.workflow_entity WHERE id = '${workflowId}';`,
    postgresUser,
  );
  assert.ok(workflowJson, `live workflow ${workflowId} must exist`);
  return JSON.parse(workflowJson);
}

function auditBusinessCounts(postgresUser) {
  return JSON.parse(sql(
    "zh_narrative",
    `SELECT json_build_object(
      'audit_attempt_log', (SELECT count(*) FROM public.audit_attempt_log),
      'editor_log', (SELECT count(*) FROM public.editor_log),
      'chapter_version', (SELECT count(*) FROM public.chapter_version)
    )::text;`,
    postgresUser,
  ));
}

function comparableNode(node) {
  const { position, ...businessNode } = node;
  return businessNode;
}

test("n8n attachment comparison ignores only editor coordinates", () => {
  const source = {
    id: "node-1",
    name: "Documented node",
    type: "n8n-nodes-base.code",
    parameters: { jsCode: "return items;" },
    position: [0, 0],
  };
  const moved = { ...source, position: [-128, 16] };
  const changed = { ...moved, parameters: { jsCode: "return [];" } };

  assert.deepEqual(comparableNode(moved), comparableNode(source));
  assert.notDeepEqual(comparableNode(changed), comparableNode(source));
});

function assertLiveWorkflowMatchesAttachment(source, live, postgresUser) {
  assert.equal(live.active, true, `live ${source.name} must be active`);
  assert.equal(live.nodes.length, source.nodes.length, `live ${source.name} node count drifted`);
  assert.deepEqual(live.connections, source.connections, `live ${source.name} connections drifted`);
  const sourceById = new Map(source.nodes.map((node) => [node.id, node]));
  const liveById = new Map(live.nodes.map((node) => [node.id, node]));
  assert.deepEqual([...liveById.keys()].sort(), [...sourceById.keys()].sort(), `live ${source.name} node identities drifted`);
  for (const [id, sourceNode] of sourceById) {
    assert.deepEqual(comparableNode(liveById.get(id)), comparableNode(sourceNode), `live ${source.name} node parameters drifted: ${sourceNode.name}`);
  }

  const webhook = source.nodes.filter((node) => node.type === "n8n-nodes-base.webhook");
  assert.equal(webhook.length, 1, `${source.name} must have one user-entry webhook`);
  const webhookPath = webhook[0].parameters?.path;
  const method = webhook[0].parameters?.httpMethod || "GET";
  assert.ok(webhookPath, `${source.name} webhook path must be explicit`);
  const storedWebhookPath = String(webhookPath).replace(/^\/+/, "");
  const registered = sql(
    "n8n",
    `SELECT count(*)::text FROM public.webhook_entity
     WHERE "workflowId" = '${source.id}'
       AND "webhookPath" = '${storedWebhookPath}'
       AND method = '${method}';`,
    postgresUser,
  );
  assert.equal(registered, "1", `live ${source.name} must register ${method} /${storedWebhookPath}`);
}

test("live B1-B4 entry workflows match their attachments and register their webhooks", (t) => {
  let postgresUser;
  try {
    postgresUser = docker(["exec", container, "printenv", "POSTGRES_USER"]).trim();
    assert.ok(postgresUser, "POSTGRES_USER must be available in the PostgreSQL container");
  } catch (error) {
    if (isDockerUnavailable(error)) return t.skip(runtimeUnavailableMessage(error, "PostgreSQL"));
    throw error;
  }

  for (const source of designWorkflows) {
    assertLiveWorkflowMatchesAttachment(source, readLiveWorkflow(source.id, postgresUser), postgresUser);
  }
});

test("live ZH04 and RPC-007 conform to the checked-in V7 production contract", (t) => {
  let postgresUser;
  try {
    postgresUser = docker(["exec", container, "printenv", "POSTGRES_USER"]).trim();
    assert.ok(postgresUser, "POSTGRES_USER must be available in the PostgreSQL container");
  } catch (error) {
    if (isDockerUnavailable(error)) return t.skip(runtimeUnavailableMessage(error, "PostgreSQL"));
    throw error;
  }

  const workflowJson = sql(
    "n8n",
    `SELECT json_build_object(
      'id', id,
      'active', active,
      'nodes', nodes,
      'connections', connections
    )::text
    FROM public.workflow_entity
    WHERE id = '${productionWorkflowId}';`,
    postgresUser,
  );
  assert.ok(workflowJson, `live workflow ${productionWorkflowId} must exist`);
  const live = JSON.parse(workflowJson);
  assert.equal(live.active, true, "the local production workflow must be active");
  assert.equal(live.nodes.length, workflow.nodes.length, "live ZH04 node count drifted");
  assert.deepEqual(live.connections, workflow.connections, "live ZH04 connections drifted");

  const registeredWebhook = sql(
    "n8n",
    `SELECT count(*)::text
     FROM public.webhook_entity
     WHERE "workflowId" = '${productionWorkflowId}'
       AND "webhookPath" = 'content_production'
       AND method = 'POST';`,
    postgresUser,
  );
  assert.equal(registeredWebhook, "1", "live ZH04 must have a registered content_production webhook");

  const sourceById = new Map(workflow.nodes.map((node) => [node.id, node]));
  const liveById = new Map(live.nodes.map((node) => [node.id, node]));
  assert.deepEqual([...liveById.keys()].sort(), [...sourceById.keys()].sort(), "live ZH04 node identities drifted");
  for (const [id, sourceNode] of sourceById) {
    assert.deepEqual(comparableNode(liveById.get(id)), comparableNode(sourceNode), `live ZH04 node parameters drifted: ${sourceNode.name}`);
  }

  const functionDefinition = sql(
    "zh_narrative",
    `SELECT pg_get_functiondef(p.oid)
     FROM pg_proc AS p
     JOIN pg_namespace AS n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'rpc_persist_chapter_execution_plan'
       AND pg_get_function_identity_arguments(p.oid) = 'p_request jsonb';`,
    postgresUser,
  );
  assert.match(functionDefinition, /scene_condition_package/);
  assert.match(functionDefinition, /PLAN_INCOMPLETE/);
  assert.match(functionDefinition, /'视觉', '听觉', '嗅觉', '触觉', '味觉'/u);
  assert.match(functionDefinition, /v_switch_rule = '无'/u);
});

test("live ZH05 preserves its topology and current deduction input guards", (t) => {
  let postgresUser;
  try {
    postgresUser = docker(["exec", container, "printenv", "POSTGRES_USER"]).trim();
    assert.ok(postgresUser, "POSTGRES_USER must be available in the PostgreSQL container");
  } catch (error) {
    if (isDockerUnavailable(error)) return t.skip(runtimeUnavailableMessage(error, "PostgreSQL"));
    throw error;
  }

  const workflowJson = sql(
    "n8n",
    `SELECT json_build_object(
      'id', id,
      'active', active,
      'nodes', nodes,
      'connections', connections
    )::text
    FROM public.workflow_entity
    WHERE id = '${deductionWorkflow.id}';`,
    postgresUser,
  );
  assert.ok(workflowJson, `live workflow ${deductionWorkflow.id} must exist`);
  const live = JSON.parse(workflowJson);
  assert.equal(live.active, true, "the local deduction workflow must be active");
  assert.equal(live.nodes.length, deductionWorkflow.nodes.length, "live ZH05 node count drifted");
  assert.deepEqual(live.connections, deductionWorkflow.connections, "live ZH05 connections drifted");

  const registeredWebhook = sql(
    "n8n",
    `SELECT count(*)::text
     FROM public.webhook_entity
     WHERE "workflowId" = '${deductionWorkflow.id}'
       AND "webhookPath" = 'production_stage'
       AND method = 'POST';`,
    postgresUser,
  );
  assert.equal(registeredWebhook, "1", "live ZH05 must have one production_stage POST webhook");

  const sourceById = new Map(deductionWorkflow.nodes.map((node) => [node.id, node]));
  const liveById = new Map(live.nodes.map((node) => [node.id, node]));
  assert.deepEqual([...liveById.keys()].sort(), [...sourceById.keys()].sort(), "live ZH05 node identities drifted");
  for (const [id, sourceNode] of sourceById) {
    assert.deepEqual(comparableNode(liveById.get(id)), comparableNode(sourceNode), `live ZH05 node parameters drifted: ${sourceNode.name}`);
  }

  const functionDefinition = sql(
    "zh_narrative",
    `SELECT pg_get_functiondef(p.oid)
     FROM pg_proc AS p
     JOIN pg_namespace AS n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'rpc_finalize_deduction_snapshot'
       AND pg_get_function_identity_arguments(p.oid) = 'p_request jsonb';`,
    postgresUser,
  );
  assert.match(functionDefinition, /v_l1a uuid/);
  assert.match(functionDefinition, /p_request->'chapters'/);
  assert.match(functionDefinition, /L1A_CHAPTER_SCOPE_REJECTED/);
  assert.match(functionDefinition, /fixed 3000000 token budget/);
  assert.match(functionDefinition, /mvp-fixed-3000000/);
  assert.match(functionDefinition, /candidate_truth_ledger/);
  assert.match(functionDefinition, /v_action = 'replan'/);
  assert.match(functionDefinition, /return_direction/);
  assert.match(functionDefinition, /DEDUCTION_REPLAN_NOT_AVAILABLE/);
  assert.doesNotMatch(functionDefinition, /800000|mvp-fixed-800000/);
});

test("live ZH06 matches its V7 audit attachment and registers its webhook", (t) => {
  let postgresUser;
  try {
    postgresUser = docker(["exec", container, "printenv", "POSTGRES_USER"]).trim();
    assert.ok(postgresUser, "POSTGRES_USER must be available in the PostgreSQL container");
  } catch (error) {
    if (isDockerUnavailable(error)) return t.skip(runtimeUnavailableMessage(error, "PostgreSQL"));
    throw error;
  }

  assertLiveWorkflowMatchesAttachment(
    auditWorkflow,
    readLiveWorkflow(auditWorkflow.id, postgresUser),
    postgresUser,
  );

  const continuationRpc = sql(
    "zh_narrative",
    `SELECT pg_get_functiondef(p.oid)
     FROM pg_proc AS p
     JOIN pg_namespace AS n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'rpc_continue_chapter'
       AND pg_get_function_identity_arguments(p.oid) = 'p_request jsonb';`,
    postgresUser,
  );
  assert.match(continuationRpc, /continue_next_chapter/);
  assert.match(continuationRpc, /current L1A latest formal chapter/);
  assert.match(continuationRpc, /chapter_header/);

  const auditHandoffColumn = sql(
    "zh_narrative",
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'audit_attempt_log'
       AND column_name = 'audited_handoff_package_jsonb';`,
    postgresUser,
  );
  assert.equal(auditHandoffColumn, "audited_handoff_package_jsonb");

  const objectiveAuditRpc = sql(
    "zh_narrative",
    `SELECT pg_get_functiondef(p.oid)
     FROM pg_proc AS p
     JOIN pg_namespace AS n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'rpc_confirm_audit_result'
       AND pg_get_function_identity_arguments(p.oid) = 'p_request jsonb';`,
    postgresUser,
  );
  assert.match(objectiveAuditRpc, /audited_handoff_package_jsonb/);
  assert.match(objectiveAuditRpc, /candidate_asset_id/);

  const commitRpc = sql(
    "zh_narrative",
    `SELECT pg_get_functiondef(p.oid)
     FROM pg_proc AS p
     JOIN pg_namespace AS n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'rpc_commit_chapter'
       AND pg_get_function_identity_arguments(p.oid) = 'p_request jsonb';`,
    postgresUser,
  );
  assert.match(commitRpc, /audited_handoff_package_jsonb/);
  assert.match(commitRpc, /v7_count_han_and_punctuation/);
  assert.match(commitRpc, /writeback_log/);
  assert.doesNotMatch(commitRpc, /WORD_COUNT_CONTRACT_UNRESOLVED/);

  const archiveRpc = sql(
    "zh_narrative",
    `SELECT pg_get_functiondef(p.oid)
     FROM pg_proc AS p
     JOIN pg_namespace AS n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'rpc_archive_shadow_version'
       AND pg_get_function_identity_arguments(p.oid) = 'p_request jsonb';`,
    postgresUser,
  );
  assert.doesNotMatch(archiveRpc, /FORMAL_ROLLBACK_CONTRACT_INCOMPLETE/);
  assert.match(archiveRpc, /FORMAL_ROLLBACK_LEDGER_INCOMPLETE/);
  assert.match(archiveRpc, /SET version_state = 'shadow'/);
  assert.match(archiveRpc, /'candidate', false, false, true/);
  assert.match(archiveRpc, /set_config\('v7\.formal_rollback', 'on', true\)/);
  assert.match(archiveRpc, /writeback_log/);
});

test("live ZH06 webhook returns a redacted zero-write preflight failure", async (t) => {
  let postgresUser;
  try {
    postgresUser = docker(["exec", container, "printenv", "POSTGRES_USER"]).trim();
    assert.ok(postgresUser, "POSTGRES_USER must be available in the PostgreSQL container");
  } catch (error) {
    if (isDockerUnavailable(error)) return t.skip(runtimeUnavailableMessage(error, "PostgreSQL"));
    throw error;
  }

  const before = auditBusinessCounts(postgresUser);
  const response = await fetch(process.env.ZH06_WEBHOOK_URL ?? "http://127.0.0.1:5678/webhook/audit_stage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      local_operator_id: "11111111-1111-4111-8111-111111111111",
      book_id: "22222222-2222-4222-8222-222222222222",
      chapter_id: "33333333-3333-4333-8333-333333333333",
      chapter_version_id: "44444444-4444-4444-8444-444444444444",
      idempotency_key: "zh06-redacted-preflight-live",
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, false);
  assert.ok(body.redacted_error && typeof body.redacted_error.code === "string");
  assert.ok(typeof body.redacted_error.message === "string");
  assert.doesNotMatch(JSON.stringify(body), /runtime_bindings|prompt_text|api_key_ref|"context"|"error"/u);
  assert.deepEqual(auditBusinessCounts(postgresUser), before);
});

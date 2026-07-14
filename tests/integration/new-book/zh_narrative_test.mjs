import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const database = "zh_narrative_test";
const prefix = `new-book-it-${process.pid}`;
const sqlPrefix = `new_book_it_${process.pid}`;

function sql(statement) {
  return execFileSync("docker", ["exec", "-i", "n8n-pgvector", "sh", "-lc",
    `exec psql -X -q -v ON_ERROR_STOP=1 -U \"$POSTGRES_USER\" -d ${database} -At -f -`,
  ], { cwd: root, input: statement, encoding: "utf8" }).trim();
}

function install() {
  const source = readFileSync(path.join(root, "db/functions/new-book/install.sql"), "utf8");
  sql(source);
}

function query(functionInput) {
  const encoded = Buffer.from(JSON.stringify(functionInput), "utf8").toString("base64");
  return JSON.parse(sql(`SELECT public.rpc_create_book_project(convert_from(decode('${encoded}', 'base64'), 'UTF8')::jsonb)::text;`));
}

function payload(suffix, overrides = {}) {
  return {
    local_operator_id: "11111111-1111-1111-1111-111111111111",
    title: `${prefix} ${suffix}`,
    idempotency_key: `${prefix}-${suffix}`,
    intent: { genre_main: "fantasy", summary: "A controlled integration test." },
    forbid: { lines: [] },
    selling_points: ["test"], target_words: 100000, chapter_words: 2000,
    characters: [
      { client_ref: "lead", name: "Lead", char_type: "protagonist", five_layers: { L0: {}, L1: {}, L2: {}, L3: {} }, knowledge_boundary: { knows: [], unknown: [], false_belief: [], reasonable_suspect: [] } },
      { client_ref: "rival", name: "Rival", char_type: "antagonist", five_layers: { L0: {}, L1: {}, L2: {}, L3: {} }, knowledge_boundary: { knows: [], unknown: [], false_belief: [], reasonable_suspect: [] } },
    ],
    world_assets: [{ board_type: "rule", atom_type: "rule", item_name: "Cost", item_content: { price: "truth" } }],
    relations: [{ from_ref: "lead", to_ref: "rival", intimacy: -1, trust: -2, dependence: 1, support_level: 0, emotional_bond: 2 }],
    segment_promises: [{ l1a_seq: 1, l1a_name: "Opening conflict", conflict_background: {}, stakes: {}, irreversible_consequences: {}, escalation_path: {}, plot_promise: {}, emotion_promise: {}, role_arc: {}, world_progress: {} }],
    ...overrides,
  };
}

function count(bookId, table) {
  return Number(sql(`SELECT count(*) FROM public.${table} WHERE book_id='${bookId}';`));
}

function cleanup() {
  sql(`BEGIN;
SET LOCAL zh.bypass_rpc = 'true';
DELETE FROM public.t_writeback_logs WHERE book_id IN (SELECT book_id FROM public.t_book_projects WHERE idempotency_key LIKE '${prefix}%');
DELETE FROM public.t_relation_states WHERE book_id IN (SELECT book_id FROM public.t_book_projects WHERE idempotency_key LIKE '${prefix}%');
DELETE FROM public.t_segment_promises WHERE book_id IN (SELECT book_id FROM public.t_book_projects WHERE idempotency_key LIKE '${prefix}%');
DELETE FROM public.t_world_assets WHERE book_id IN (SELECT book_id FROM public.t_book_projects WHERE idempotency_key LIKE '${prefix}%');
DELETE FROM public.t_character_profiles WHERE book_id IN (SELECT book_id FROM public.t_book_projects WHERE idempotency_key LIKE '${prefix}%');
DELETE FROM public.t_book_projects WHERE idempotency_key LIKE '${prefix}%';
COMMIT;`);
}

before(() => { install(); cleanup(); });
after(() => { cleanup(); });

test("success creates all S1 records atomically", () => {
  const result = query(payload("success"));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.idempotent, false);
  assert.match(result.book_id, /^[0-9a-f-]{36}$/);
  for (const table of ["t_character_profiles", "t_world_assets", "t_relation_states", "t_segment_promises", "t_writeback_logs"]) assert.ok(count(result.book_id, table) > 0, table);
});

test("invalid input is closed and leaves no book", () => {
  const bad = payload("invalid", { title: "", idempotency_key: `${prefix}-invalid` });
  const result = query(bad);
  assert.deepEqual(result, { ok: false, error: { code: "INVALID_REQUEST", message: "The request could not be accepted." } });
  assert.equal(Number(sql(`SELECT count(*) FROM public.t_book_projects WHERE idempotency_key='${prefix}-invalid';`)), 0);
});

test("FP001-05 commercial score is rejected and a prefixed operator is invalid", () => {
  const commercial = query(payload("commercial", { commercial_score: 7, idempotency_key: `${prefix}-commercial` }));
  assert.equal(commercial.error.code, "INVALID_REQUEST");
  const prefixed = query(payload("operator", { local_operator_id: "operator:11111111-1111-1111-1111-111111111111", idempotency_key: `${prefix}-operator` }));
  assert.equal(prefixed.error.code, "INVALID_REQUEST");
});

test("normalized duplicate title is rejected in operator scope", () => {
  query(payload("duplicate-one", { title: `${prefix} Duplicate`, idempotency_key: `${prefix}-duplicate-one` }));
  const result = query(payload("duplicate-two", { title: `  ${prefix}   duplicate  `, idempotency_key: `${prefix}-duplicate-two` }));
  assert.equal(result.error.code, "DUPLICATE_TITLE");
});

test("repeat confirmation returns the original book without a duplicate", () => {
  const first = query(payload("idem"));
  const replay = query(payload("idem"));
  assert.equal(replay.ok, true);
  assert.equal(replay.idempotent, true);
  assert.equal(replay.book_id, first.book_id);
  assert.deepEqual(replay.current_book, first.current_book);
  assert.equal(Number(sql(`SELECT count(*) FROM public.t_book_projects WHERE idempotency_key='${prefix}-idem';`)), 1);
});

test("write failure rolls all six table writes back and redacts internals", () => {
  sql(`CREATE FUNCTION public.${sqlPrefix}_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced SQL failure with secret'; END; $$;
CREATE TRIGGER ${sqlPrefix}_fail BEFORE INSERT ON public.t_writeback_logs FOR EACH ROW EXECUTE FUNCTION public.${sqlPrefix}_fail();`);
  try {
    const result = query(payload("rollback"));
    assert.equal(result.error.code, "WRITE_FAILED");
    assert.equal(JSON.stringify(result).includes("secret"), false);
    assert.equal(Number(sql(`SELECT count(*) FROM public.t_book_projects WHERE idempotency_key='${prefix}-rollback';`)), 0);
  } finally {
    sql(`DROP TRIGGER IF EXISTS ${sqlPrefix}_fail ON public.t_writeback_logs; DROP FUNCTION IF EXISTS public.${sqlPrefix}_fail();`);
  }
});

test("request, preview, blocked, success, error and canonical workflow contracts are closed", () => {
  const schemas = ["create-book-request", "create-book-preview", "create-book-blocked", "create-book-success", "create-book-error"].map((name) => JSON.parse(readFileSync(path.join(root, `packages/contracts/src/new-book/${name}.schema.json`), "utf8")));
  for (const schema of schemas) assert.equal(schema.additionalProperties, false, schema.$id);
  assert.deepEqual(Object.keys(payload("contract")).sort(), schemas[0].required.slice().sort());
  assert.equal(Object.hasOwn(schemas[0].properties, "extra"), false);
  const workflow = JSON.parse(readFileSync(path.join(root, "docs/后端/n8n/ZH01-新书创建.json"), "utf8"));
  assert.equal(existsSync(path.join(root, "orchestration/workflows/new-book/create-book.json")), false);
  const names = new Set(workflow.nodes.map((node) => node.name));
  for (const name of ["Webhook：POST /create_book", "FP001-02 closed validation and route", "FP001-03 active dependency lookup", "FP001-03 dependency gate", "FP001-03 开书表单抽取补全", "FP001-07 PostgreSQL RPC", "Respond"]) assert.ok(names.has(name), name);
  assert.equal(names.has("FP001-05 商业潜力评价"), false);
  const webhook = workflow.nodes.find((node) => node.name === "Webhook：POST /create_book");
  assert.equal(webhook.parameters.httpMethod, "POST");
  assert.equal(webhook.parameters.path, "create_book");
  const postgres = workflow.nodes.find((node) => node.name === "FP001-07 PostgreSQL RPC");
  assert.match(postgres.parameters.query, /rpc_create_book_project/);
  assert.equal(postgres.parameters.options.queryReplacement, "={{ [JSON.stringify($json.rpc_request)] }}");
  const incomplete = workflow.connections["FP001-02 confirm route"].main[1][0];
  assert.equal(incomplete.node, "FP001-03 active dependency lookup");
  assert.equal(workflow.connections["FP001-03 agent route"].main[1][0].node, "Respond");
  const prompt = workflow.nodes.find((node) => node.name === "FP001-03 开书表单抽取补全").parameters.options.systemMessage;
  assert.equal(prompt, "你是纵横叙事引擎的新书创建向导。核心职责：通过苏格拉底提问法深度挖掘用户创作意图，每轮对话输出结构化 JSON 回填前端表单 + 累积跨阶段全量数据项。");
  const preview = { status: "preview", missing_fields: ["characters"] };
  const blocked = { status: "BLOCKED", code: "ACTIVE_SKILL_UNAVAILABLE", message: "The preview dependencies are not available." };
  assert.equal(schemas[1].properties.status.const, preview.status);
  assert.equal(schemas[2].properties.status.const, blocked.status);
  assert.ok(schemas[2].properties.code.enum.includes(blocked.code));
  assert.equal(JSON.stringify(workflow).includes("password"), false);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const workflow = JSON.parse(readFileSync(path.join(root, "docs/后端/n8n/ZH01-新书创建.json"), "utf8"));
const schemaPath = (name) => path.join(root, "packages/contracts/src/new-book", `${name}.schema.json`);
const newBookData = readFileSync(path.join(root, "apps/web/src/pages/new-book/new_book_wizard_data.js"), "utf8");
const newBookBridge = readFileSync(path.join(root, "apps/web/src/pages/new-book/new-book-bridge.mjs"), "utf8");
const skillLibraryPage = readFileSync(path.join(root, "apps/web/src/pages/skill-library/index.html"), "utf8");

const names = Object.freeze({
  format: "整理前端格式化表单",
  route: "FP001-02",
  dependencies: "读库题材技能",
  dialogueModel: "读题材技能",
  dialogue: "FP001-03 开书表单抽取补全",
  commercial: "FP001-05 商业潜力评价",
  normalizer: "JSON 修复 / 输出校验",
  response: "Respond：返回前端",
  compiler: "编译正式提交包",
  write: "FP001-07",
});

function node(name) {
  const value = workflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(value, `missing workflow node: ${name}`);
  return value;
}

function runCode(name, input, sources = {}, executionId = "b1-business-test") {
  const source = (sourceName) => {
    if (!Object.hasOwn(sources, sourceName)) throw new Error(`source not executed: ${sourceName}`);
    return { item: { json: sources[sourceName] } };
  };
  return new Function("$input", "$execution", "$", node(name).parameters.jsCode)(
    { item: { json: input } },
    { id: executionId },
    source,
  );
}

test("only the creator's terminal confirmation can reach the atomic book RPC", () => {
  const formData = {
    local_operator_id: "11111111-1111-4111-8111-111111111111",
    idempotency_key: "b1-confirm",
    title: "A complete draft",
    intent_json: { genre_main: "科幻" },
    forbid_json: {},
  };
  const preview = runCode(names.format, {
    action: "preview",
    form_data: formData,
    creator_message: "继续完善角色动机。",
    correlation_id: "preview-1",
  })[0].json;
  assert.equal(preview.route, "preflight");
  assert.equal(preview.creator_message, "继续完善角色动机。");
  assert.equal(Object.hasOwn(preview.form_data, "creator_message"), false);

  const confirmed = runCode(names.format, {
    action: "confirm_create",
    form_data: formData,
    creator_message: "这句话不能进入正式提交包。",
    correlation_id: "confirm-1",
  })[0].json;
  assert.equal(confirmed.route, "confirm");
  const compiled = runCode(names.compiler, confirmed)[0].json;
  assert.deepEqual(compiled.create_request, { ...formData, correlation_id: "confirm-1" });
  assert.equal(Object.hasOwn(compiled.create_request, "creator_message"), false);

  const outputs = workflow.connections[names.route].main;
  assert.equal(outputs[0][0].node, names.compiler);
  assert.equal(outputs[1][0].node, names.dependencies);
  assert.equal(outputs[3][0].node, names.response);
  assert.equal(workflow.connections[names.compiler].main[0][0].node, names.write);
  assert.equal(node(names.write).parameters.query, "SELECT public.rpc_create_book_project($1::jsonb) AS response");
});

test("preview dependencies are scoped, configured, and fail closed before model use", () => {
  const query = node(names.dependencies).parameters.query;
  assert.match(query, /rpc_workbench\(jsonb_build_object\(/);
  assert.match(query, /FP001-03/);
  assert.match(query, /FP001-05/);
  assert.match(query, /source_type='system_builtin'/);
  assert.match(query, /lifecycle_status='active'/);
  assert.match(query, /skill_category='题材组合'/);
  assert.match(query, /ACTIVE_SKILL_UNAVAILABLE/);
  assert.match(query, /ACTIVE_CONFIG_UNAVAILABLE/);
  assert.doesNotMatch(query, /\b(?:INSERT|UPDATE|DELETE|MERGE)\b/i);
  assert.doesNotMatch(JSON.stringify(workflow), /deepseek-v4-flash-free|maxTokens|80,?000/i);

  const dialogueModel = node(names.dialogueModel);
  assert.equal(dialogueModel.parameters.options.timeout, 60000);

  const invalid = runCode(names.format, { action: "unsupported", correlation_id: "invalid-1" })[0].json;
  assert.equal(invalid.route, "blocked");
  assert.equal(workflow.connections[names.route].main[3][0].node, names.response);
  assert.equal(node(names.response).parameters.responseBody, "={{ $json.response || $json }}");
});

test("malformed dialogue output cannot become a preview or a write", () => {
  const sources = {
    [names.dependencies]: { correlation_id: "preview-invalid" },
    [names.dialogue]: { output: "not-json" },
    [names.commercial]: { output: JSON.stringify({ shangye: 8 }) },
  };
  const result = runCode(names.normalizer, {}, sources)[0].json;
  assert.deepEqual(result, {
    status: "BLOCKED",
    code: "PREVIEW_OUTPUT_INVALID",
    message: "The preview could not be produced.",
    correlation_id: "preview-invalid",
  });
  assert.equal(workflow.connections[names.normalizer].main[0][0].node, names.response);
  assert.notEqual(workflow.connections[names.normalizer].main[0][0].node, names.write);
});

test("published new-book envelopes stay closed and use the six V7 primary genres", () => {
  const schemas = [
    "create-book-request",
    "create-book-preview",
    "create-book-blocked",
    "create-book-error",
    "create-book-success",
  ].map((name) => JSON.parse(readFileSync(schemaPath(name), "utf8")));

  for (const schema of schemas) assert.equal(schema.additionalProperties, false, schema.$id);
  assert.deepEqual(
    schemas[0].properties.intent_json.properties.genre_main.enum,
    ["科幻", "玄幻", "言情", "武侠", "恐怖", "同人"],
  );
  assert.deepEqual(schemas[0].properties.intent_json.required, ["genre_main", "target_emotion"]);
  assert.equal(schemas[0].properties.intent_json.properties.target_emotion.type, "string");
  const error = schemas[3];
  assert.equal(error.properties.ok.const, false);
  assert.equal(error.properties.error.additionalProperties, false);
  assert.equal(error.properties.error.properties.code.type, "string");

  const success = schemas[4];
  assert.equal(success.properties.state.properties.token_budget.const, 10000000);
});

test("book and managed-skill controls use the creator-approved genres without guessing builtin remaps", () => {
  const expected = '["科幻", "玄幻", "言情", "武侠", "恐怖", "同人"]';
  assert.match(newBookData, new RegExp(`options: \\["", ${expected.slice(1)}`));
  assert.match(newBookData, new RegExp(`GENRE_TYPES: ${expected.replaceAll("[", "\\[").replaceAll("]", "\\]")}`));
  assert.match(newBookBridge, new RegExp(`return ${expected.replaceAll("[", "\\[").replaceAll("]", "\\]")}`));
  assert.match(skillLibraryPage, /const primaryGenres = \['科幻', '玄幻', '言情', '武侠', '恐怖', '同人'\]/);
  assert.match(skillLibraryPage, /现有系统内置技能未覆盖该主类/);
});

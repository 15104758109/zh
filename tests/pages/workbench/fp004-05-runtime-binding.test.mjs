import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const docs = path.join(root, "docs");
const n8nDirectory = readdirSync(docs, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(docs, entry.name, "n8n"))
  .find((candidate) => existsSync(candidate));

const readerNodeId = "4c9473a4-02dd-4cb2-a3ad-6394bb29fc7a";
const modelNodeId = "60cd1c56-8b45-4cd4-9771-88139bf1a668";
const resultNodeId = "8f872140-0f58-44aa-847c-1f4a63a2c2ab";

function workflow() {
  const file = readdirSync(n8nDirectory)
    .map((name) => path.join(n8nDirectory, name))
    .find((candidate) => {
      if (!candidate.endsWith(".json")) return false;
      return JSON.parse(readFileSync(candidate, "utf8")).nodes?.some(
        (node) => node.id === readerNodeId,
      );
    });
  assert.ok(file, "the FP004-05 workflow attachment must exist");
  return JSON.parse(readFileSync(file, "utf8"));
}

function nodeById(value, id) {
  const node = value.nodes.find((entry) => entry.id === id);
  assert.ok(node, `missing workflow node ${id}`);
  return node;
}

function edgeCount(value) {
  let count = 0;
  for (const outputs of Object.values(value.connections ?? {})) {
    for (const groups of Object.values(outputs ?? {})) {
      for (const group of groups ?? []) count += group.length;
    }
  }
  return count;
}

test("FP004-05 preserves its existing five-node workflow shape", () => {
  const value = workflow();
  assert.equal(value.nodes.length, 5);
  assert.equal(Object.keys(value.connections ?? {}).length, 4);
  assert.equal(edgeCount(value), 4);
  assert.equal(value.nodes[0].parameters.responseMode, "responseNode");
});

test("FP004-05 reads scoped live context and its active runtime binding", () => {
  const value = workflow();
  const reader = nodeById(value, readerNodeId);
  const query = reader.parameters.query;

  assert.equal(reader.parameters.operation, "executeQuery");
  assert.equal(reader.parameters.options.queryReplacement, "={{ [JSON.stringify($json.body ?? $json)] }}");
  assert.match(query, /public\.v_prompt_runtime_binding/u);
  assert.match(query, /FP004-05/u);
  assert.match(query, /public\.l1a_unit/u);
  assert.match(query, /public\.character/u);
  assert.match(query, /public\.world_state/u);
  assert.match(query, /l\.is_valid/u);
  assert.match(query, /NOT l\.is_shadow/u);
  assert.match(query, /c\.is_formal/u);
  assert.match(query, /ws\.is_formal/u);
  assert.match(query, /DESIGN_LOCKED/u);
  assert.match(query, /CONFIG_CONTRACT_BLOCKED/u);
  assert.deepEqual(reader.credentials, {
    postgres: { id: "kitjw53XlibTPzxM", name: "zh-database" },
  });
});

test("FP004-05 invokes only the configured model and returns a non-persistent candidate result", () => {
  const value = workflow();
  const model = nodeById(value, modelNodeId);
  const serialized = JSON.stringify(model.parameters);

  assert.match(serialized, /runtime_binding/u);
  assert.match(serialized, /model_name/u);
  assert.match(serialized, /provider_base_url/u);
  assert.match(serialized, /prompt_text/u);
  assert.match(serialized, /temperature/u);
  assert.match(serialized, /CONFIG_CONTRACT_BLOCKED/u);
  assert.doesNotMatch(serialized, /deepseek|gpt-5\.6-luna/iu);
  assert.equal(model.onError, "continueRegularOutput");
  assert.deepEqual(model.credentials, {
    openAiApi: { id: "ktkbgOI2RQI4Y8QK", name: "OpenAI account" },
  });

  const result = nodeById(value, resultNodeId).parameters.jsCode;
  assert.match(result, /MODEL_OUTPUT_INVALID/u);
  assert.match(result, /MODEL_CALL_FAILED/u);
  assert.match(result, /context\.redacted_error/u);
  assert.doesNotMatch(result, /\b(?:INSERT|UPDATE|DELETE)\b/u);
});

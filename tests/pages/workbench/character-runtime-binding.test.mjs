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

const contextNodeId = "e8d86faa-42a5-4ed9-9792-5f1da5c4d03b";
const gateNodeId = "characters-runtime-config";
const modelNodeId = "62400ffa-b505-4f64-a5aa-da21b5027d36";

function workflow() {
  const file = readdirSync(n8nDirectory)
    .map((name) => path.join(n8nDirectory, name))
    .find((candidate) => {
      if (!candidate.endsWith(".json")) return false;
      return JSON.parse(readFileSync(candidate, "utf8")).nodes?.some((node) => node.id === contextNodeId);
    });
  assert.ok(file, "the FP003-04 workflow attachment must exist");
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

test("FP003-04 reads the stable binding without changing its workflow topology", () => {
  const value = workflow();
  assert.equal(value.nodes.length, 12);
  assert.equal(Object.keys(value.connections ?? {}).length, 11);
  assert.equal(edgeCount(value), 18);

  const query = nodeById(value, contextNodeId).parameters.query;
  assert.match(query, /public\.v_prompt_runtime_binding/u);
  assert.match(query, /b\.node_code = 'FP003-04'/u);
  assert.match(query, /b\.prompt_status = 'active'/u);
  assert.match(query, /public\.v7_design_editable/u);
  assert.doesNotMatch(query, /public\.model_runtime_binding/u);
  assert.doesNotMatch(query, /public\.model_sync_config|public\.prompt_config/u);
});

test("FP003-04 blocks candidate generation without a complete binding", () => {
  const gate = nodeById(workflow(), gateNodeId).parameters.jsCode;
  assert.match(gate, /CONFIG_CONTRACT_BLOCKED/u);
  assert.match(gate, /FP003-04/u);
  assert.match(gate, /runtime\.model_name/u);
  assert.match(gate, /runtime\.provider_base_url/u);
  assert.match(gate, /runtime\.prompt_text/u);
  assert.match(gate, /runtime\.api_key_ref/u);
  assert.doesNotMatch(gate, /deepseek|gpt-5|default/iu);
});

test("FP003-04 uses the model, provider, temperature, and prompt from the binding", () => {
  const modelNode = nodeById(workflow(), modelNodeId);
  const parameters = modelNode.parameters;
  assert.match(parameters.modelId.value, /runtime\.model_name/u);
  assert.match(parameters.responses.values[0].content, /runtime\.prompt_text/u);
  assert.match(parameters.options.baseURL, /runtime\.provider_base_url/u);
  assert.match(parameters.options.temperature, /runtime\.temperature/u);
  assert.doesNotMatch(JSON.stringify(parameters), /deepseek|gpt-5\.6-luna/iu);
  assert.deepEqual(modelNode.credentials, {
    openAiApi: { id: "ktkbgOI2RQI4Y8QK", name: "OpenAI account" },
  });
});

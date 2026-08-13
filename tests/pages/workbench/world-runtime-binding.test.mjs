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

const contextNodeId = "31438258-b7d9-4a35-945c-f19137f27735";
const gateNodeId = "0d89b85d-bcea-49bb-9c5f-3a23e6b00f1a";
const modelNodeId = "47c13991-fe1a-46a6-8c20-fe98b855d184";

function workflow() {
  const file = readdirSync(n8nDirectory)
    .map((name) => path.join(n8nDirectory, name))
    .find((candidate) => {
      if (!candidate.endsWith(".json")) return false;
      return JSON.parse(readFileSync(candidate, "utf8")).nodes?.some((node) => node.id === contextNodeId);
    });
  assert.ok(file, "the FP002-04 workflow attachment must exist");
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

test("FP002-04 reads the stable runtime binding and preserves workflow topology", () => {
  const value = workflow();
  assert.equal(value.nodes.length, 12);
  assert.equal(Object.keys(value.connections ?? {}).length, 11);
  assert.equal(edgeCount(value), 17);

  const query = nodeById(value, contextNodeId).parameters.query;
  assert.match(query, /public\.v_prompt_runtime_binding/u);
  assert.match(query, /b\.node_code = 'FP002-04'/u);
  assert.match(query, /b\.prompt_status = 'active'/u);
  assert.doesNotMatch(query, /public\.model_runtime_binding/u);
  assert.doesNotMatch(query, /public\.model_sync_config/u);
  assert.doesNotMatch(query, /public\.prompt_config/u);
  for (const field of ["model_name", "provider_base_url", "prompt_text", "api_key_ref", "temperature"]) {
    assert.match(query, new RegExp(`'${field}'`, "u"));
  }
});

test("FP002-04 blocks before an LLM call when the active binding is incomplete", () => {
  const gate = nodeById(workflow(), gateNodeId).parameters.jsCode;
  assert.match(gate, /CONFIG_CONTRACT_BLOCKED/u);
  assert.match(gate, /binding\?\.model_name/u);
  assert.match(gate, /binding\?\.provider_base_url/u);
  assert.match(gate, /binding\?\.prompt_text/u);
  assert.match(gate, /binding\?\.api_key_ref/u);
  assert.doesNotMatch(gate, /deepseek|gpt-5|default_prompt/iu);
});

test("FP002-04 supplies model, provider, temperature, and prompt from the active binding", () => {
  const model = nodeById(workflow(), modelNodeId).parameters;
  assert.equal(model.modelId.value, "={{ $('Validate Effective Model Config').item.json.model_config.model_name }}");
  assert.match(model.responses.values[0].content, /model_config\.prompt_text/u);
  assert.match(model.options.baseURL, /model_config\.provider_base_url/u);
  assert.match(model.options.temperature, /model_config\.temperature/u);
  assert.doesNotMatch(JSON.stringify(model), /deepseek|gpt-5\.6-luna/iu);
});

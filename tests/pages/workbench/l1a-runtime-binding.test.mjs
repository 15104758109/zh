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

const contextNodeId = "c5d49ae6-0d7d-4d80-ad82-1a387d6015c6";
const gateNodeId = "a7576dfb-f0df-4569-ab36-a5d0e1fd42d1";
const modelNodeId = "67cde73a-d79f-4e66-b957-ca680fa3333c";

function workflow() {
  const file = readdirSync(n8nDirectory)
    .map((name) => path.join(n8nDirectory, name))
    .find((candidate) => {
      if (!candidate.endsWith(".json")) return false;
      return JSON.parse(readFileSync(candidate, "utf8")).nodes?.some((node) => node.id === contextNodeId);
    });
  assert.ok(file, "the FP004-01 workflow attachment must exist");
  return JSON.parse(readFileSync(file, "utf8"));
}

function nodeById(value, id) {
  const node = value.nodes.find((entry) => entry.id === id);
  assert.ok(node, `missing workflow node ${id}`);
  return node;
}

function edgeCount(value) {
  return Object.values(value.connections ?? {}).reduce((total, outputs) => (
    total + Object.values(outputs ?? {}).reduce((groupTotal, groups) => (
      groupTotal + groups.reduce((edgeTotal, group) => edgeTotal + group.length, 0)
    ), 0)
  ), 0);
}

test("FP004-01 preserves the existing L1A workflow topology while reading the stable binding", () => {
  const value = workflow();
  assert.equal(value.nodes.length, 16);
  assert.equal(Object.keys(value.connections ?? {}).length, 15);
  assert.equal(edgeCount(value), 22);

  const query = nodeById(value, contextNodeId).parameters.query;
  assert.match(query, /public\.v_prompt_runtime_binding/u);
  assert.match(query, /binding\.node_code = 'FP004-01'/u);
  assert.match(query, /binding\.prompt_status = 'active'/u);
  assert.doesNotMatch(query, /public\.model_runtime_binding/u);
  assert.doesNotMatch(query, /public\.model_sync_config|public\.prompt_config/u);
  assert.equal(
    nodeById(value, contextNodeId).parameters.options.queryReplacement,
    "={{ [JSON.stringify($json.request)] }}",
  );
});

test("FP004-01 has no default model or prompt when its binding is absent", () => {
  const gate = nodeById(workflow(), gateNodeId).parameters.jsCode;
  assert.match(gate, /CONFIG_CONTRACT_BLOCKED/u);
  assert.match(gate, /FP004-01/u);
  assert.match(gate, /binding\.model_name/u);
  assert.match(gate, /binding\.provider_base_url/u);
  assert.match(gate, /binding\.prompt_text/u);
  assert.match(gate, /binding\.api_key_ref/u);
  assert.doesNotMatch(gate, /deepseek|gpt-5|default/iu);
});

test("FP004-01 invokes the provider with the active model, prompt, URL, and temperature", () => {
  const modelNode = nodeById(workflow(), modelNodeId);
  const parameters = modelNode.parameters;
  assert.equal(modelNode.type, "n8n-nodes-base.httpRequest");
  assert.equal(parameters.method, "POST");
  assert.equal(parameters.authentication, "predefinedCredentialType");
  assert.equal(parameters.nodeCredentialType, "openAiApi");
  assert.match(parameters.url, /runtime_binding\.provider_base_url/u);
  assert.match(parameters.url, /chat\\\/completions/u);
  assert.match(parameters.jsonBody, /runtime_binding\.prompt_text/u);
  assert.match(parameters.jsonBody, /runtime_binding\.model_name/u);
  assert.match(parameters.jsonBody, /runtime_binding\.temperature/u);
  assert.doesNotMatch(JSON.stringify(parameters), /deepseek|gpt-5\.6-luna/iu);
  assert.deepEqual(modelNode.credentials, {
    openAiApi: { id: "ktkbgOI2RQI4Y8QK", name: "OpenAI account" },
  });
});

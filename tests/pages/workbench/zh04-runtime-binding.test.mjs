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

const loaderNodeId = "e2b252ed-31f0-43e0-91fd-71c0835e99a0";
const materializationNodeId = "f6c75e19-e537-4e6c-aca3-56ba2124df15";
const presentationNodeId = "273ce2a9-3a92-48f5-9c64-91bfe5d3a0f9";
const actionRouteNodeId = "13c6301c-7613-4586-8778-e56bb6aed03f";
const approvalRouteNodeId = "a5b0c1df-ca67-4ac8-a7b0-685aebcd2b67";
const responseNodeId = "94840c52-69dd-4ffe-9192-ab524ee9c880";
const worldMaterializationNodeId = "d02111c6-3ef5-4bf5-b8ce-2bdc5bece554";
const targetNodes = [
  ["d02111c6-3ef5-4bf5-b8ce-2bdc5bece554", "FP005-01"],
  ["73c95996-64b3-4bb6-8c5b-119d80c55732", "FP006-01"],
  ["eb626387-b909-4254-ab59-5932bba7448c", "FP007-01"],
  ["14cd7dda-b21d-437c-ad70-95f8c7340580", "FP007-01"],
];

function workflow() {
  const file = readdirSync(n8nDirectory)
    .map((name) => path.join(n8nDirectory, name))
    .find((candidate) => {
      if (!candidate.endsWith(".json")) return false;
      return JSON.parse(readFileSync(candidate, "utf8")).nodes?.some((node) => node.id === loaderNodeId);
    });
  assert.ok(file, "the ZH04 workflow attachment must exist");
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

test("ZH04 resolves all production bindings from the stable view through the two-request path", () => {
  const value = workflow();
  assert.equal(value.nodes.length, 19);
  assert.equal(Object.keys(value.connections ?? {}).length, 16);
  assert.equal(edgeCount(value), 17);
  const loaderName = nodeById(value, loaderNodeId).name;
  const actionRouteName = nodeById(value, actionRouteNodeId).name;
  const approvalRouteName = nodeById(value, approvalRouteNodeId).name;
  const worldMaterializationName = nodeById(value, worldMaterializationNodeId).name;
  const presentationName = nodeById(value, presentationNodeId).name;
  const responseName = nodeById(value, responseNodeId).name;
  assert.deepEqual(value.connections[loaderName].main[0][0], { node: actionRouteName, type: "main", index: 0 });
  assert.deepEqual(value.connections[actionRouteName].main.map((group) => group[0]?.node), [worldMaterializationName, approvalRouteName]);
  assert.deepEqual(value.connections[presentationName].main[0][0], { node: responseName, type: "main", index: 0 });

  const query = nodeById(value, loaderNodeId).parameters.query;
  assert.match(query, /public\.v_prompt_runtime_binding/u);
  assert.match(query, /'FP005-01', 'FP006-01', 'FP007-01'/u);
  assert.match(query, /a\.runtime_bindings \?& ARRAY/u);
  assert.match(query, /CONFIG_CONTRACT_BLOCKED/u);
  assert.doesNotMatch(query, /model_runtime_binding/u);
  assert.doesNotMatch(query, /deepseek|gpt-5\.6-luna/iu);
});

test("ZH04 carries bindings through its existing local data adapters", () => {
  const materialization = nodeById(workflow(), materializationNodeId).parameters.jsCode;
  const presentation = nodeById(workflow(), presentationNodeId).parameters.jsCode;
  assert.match(materialization, /runtime_bindings: context\.runtime_bindings/u);
  assert.match(presentation, /runtime_bindings: upstream\.runtime_bindings/u);
});

test("ZH04 LLM nodes use their active binding and block before a provider call when absent", () => {
  const value = workflow();
  for (const [id, fp] of targetNodes) {
    const node = nodeById(value, id);
    const serialized = JSON.stringify(node.parameters);
    assert.match(serialized, new RegExp(`runtime_bindings[^]*${fp}`, "u"));
    assert.match(serialized, /prompt_text/u);
    assert.match(serialized, /provider_base_url/u);
    assert.match(serialized, /temperature/u);
    assert.match(serialized, /CONFIG_CONTRACT_BLOCKED/u);
    assert.doesNotMatch(serialized, /deepseek|gpt-5\.6-luna/iu);
    assert.doesNotMatch(serialized, /JSON\?\?/u);
    assert.deepEqual(node.credentials, {
      openAiApi: { id: "ktkbgOI2RQI4Y8QK", name: "OpenAI account" },
    });
  }
});

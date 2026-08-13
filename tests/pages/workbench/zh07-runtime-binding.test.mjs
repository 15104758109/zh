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

const bindingLoaderId = "edc8bfa7-a94e-4d73-a788-2077aa895460";
const analysisNodeId = "c22c6fe0-c1ff-4ea1-a9a9-667688f2bb62";
const blockedExperimentNodeIds = [
  "17097fba-b323-4b4e-8a96-e6927e96e7fc",
  "f2876b24-51f6-4b0b-b6ef-c40894888993",
];

function workflow() {
  const file = readdirSync(n8nDirectory)
    .map((name) => path.join(n8nDirectory, name))
    .find((candidate) => {
      if (!candidate.endsWith(".json")) return false;
      return JSON.parse(readFileSync(candidate, "utf8")).nodes?.some(
        (node) => node.id === bindingLoaderId,
      );
    });
  assert.ok(file, "the ZH07 workflow attachment must exist");
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

test("ZH07 preserves its existing node and connection topology", () => {
  const value = workflow();
  assert.equal(value.nodes.length, 27);
  assert.equal(Object.keys(value.connections ?? {}).length, 24);
  assert.equal(edgeCount(value), 29);
});

test("ZH07 resolves FP014-01 from the active prompt runtime binding", () => {
  const value = workflow();
  const loader = nodeById(value, bindingLoaderId);
  const query = loader.parameters.query;

  assert.equal(loader.parameters.operation, "executeQuery");
  assert.match(query, /public\.v_prompt_runtime_binding/u);
  assert.match(query, /FP014-01/u);
  assert.match(query, /prompt_status = 'active'/u);
  assert.match(query, /model_name/u);
  assert.match(query, /provider_base_url/u);
  assert.match(query, /prompt_text/u);
  assert.match(query, /api_key_ref/u);
  assert.match(query, /CONFIG_CONTRACT_BLOCKED/u);
  assert.equal(loader.parameters.options.queryReplacement, "={{ [JSON.stringify($json.body ?? $json)] }}");
  assert.deepEqual(loader.credentials, {
    postgres: { id: "kitjw53XlibTPzxM", name: "zh-database" },
  });

  const analysis = nodeById(value, analysisNodeId);
  const serialized = JSON.stringify(analysis.parameters);
  assert.match(serialized, /runtime_binding/u);
  assert.match(serialized, /model_name/u);
  assert.match(serialized, /provider_base_url/u);
  assert.match(serialized, /prompt_text/u);
  assert.match(serialized, /temperature/u);
  assert.match(serialized, /CONFIG_CONTRACT_BLOCKED/u);
  assert.doesNotMatch(serialized, /deepseek|gpt-5\.6-luna/iu);
  assert.deepEqual(analysis.credentials, {
    openAiApi: { id: "ktkbgOI2RQI4Y8QK", name: "OpenAI account" },
  });
});

test("ZH07 blocks FP014-02 before an LLM call while no active Prompt contract exists", () => {
  const value = workflow();

  for (const id of blockedExperimentNodeIds) {
    const node = nodeById(value, id);
    const serialized = JSON.stringify(node.parameters);
    assert.match(serialized, /CONFIG_CONTRACT_BLOCKED/u);
    assert.match(serialized, /no active prompt runtime binding/u);
    assert.doesNotMatch(serialized, /deepseek|gpt-5\.6-luna/iu);
    assert.deepEqual(node.credentials, {
      openAiApi: { id: "ktkbgOI2RQI4Y8QK", name: "OpenAI account" },
    });
  }
});

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

const loaderIds = [
  "189865e3-2c21-407f-ab81-6e46dfc61489",
  "be602323-61a1-419e-b214-7cd4c0b4ccf7",
];
const particleModelIds = [
  "71aa2b58-10c7-400a-adca-238bd8178425",
];
const credentialRouteIds = [
  "zh05-route-fp008-01-credential",
  "zh05-route-fp008-03-start-credential",
  "zh05-route-fp008-03-resume-credential",
];
const resumeParticleSnapshotId = "aa14c168-7552-424b-b1c9-c288124929ad";
const engineRequestIds = [
  "a23c1f7a-e88d-468f-93c1-1f65ee9654fc",
  "32e53a03-04bb-40cb-a77d-90117fc79068",
];

function workflow() {
  const file = readdirSync(n8nDirectory)
    .map((name) => path.join(n8nDirectory, name))
    .find((candidate) => {
      if (!candidate.endsWith(".json")) return false;
      return JSON.parse(readFileSync(candidate, "utf8")).nodes?.some((node) => node.id === loaderIds[0]);
    });
  assert.ok(file, "the ZH05 workflow attachment must exist");
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

test("ZH05 reads the active FP008 bindings and preserves its workflow topology", () => {
  const value = workflow();
  assert.equal(value.nodes.length, 37);
  assert.equal(Object.keys(value.connections ?? {}).length, 33);
  assert.equal(edgeCount(value), 46);

  for (const id of loaderIds) {
    const query = nodeById(value, id).parameters.query;
    assert.match(query, /public\.v_prompt_runtime_binding/u);
    assert.match(query, /'FP008-01', 'FP008-02'/u);
    assert.match(query, /source_node_code/u);
    assert.match(query, /'NODE_05'/u);
    assert.match(query, /'NODE_06'/u);
    assert.match(query, /runtime_bindings/u);
    assert.match(query, /CONFIG_CONTRACT_BLOCKED/u);
    assert.doesNotMatch(query, /model_runtime_binding/u);
  }
});

test("ZH05 consumes the active credential reference through its approved static credential routes", () => {
  const value = workflow();
  for (const id of credentialRouteIds) {
    const route = nodeById(value, id);
    assert.equal(route.type, "n8n-nodes-base.switch");
    assert.equal(route.parameters.options.fallbackOutput, "extra");
    assert.match(JSON.stringify(route.parameters), /api_key_ref/u);
    assert.match(JSON.stringify(route.parameters), /n8n-credential:openai-account-v1/u);
    assert.match(JSON.stringify(route.parameters), /n8n-credential:relaycove-v1/u);
  }
  const relayNodes = value.nodes.filter((node) => node.name.endsWith(" RelayCove"));
  assert.equal(relayNodes.length, 3);
  for (const relayNode of relayNodes) {
    assert.deepEqual(relayNode.credentials, {
      openAiApi: { id: "ZpJ7ejgoXbQb5xUW", name: "RelayCove account" },
    });
    const serialized = JSON.stringify(relayNode.parameters);
    assert.match(serialized, /runtime_bindings/u);
    assert.doesNotMatch(serialized, /https:\/\/api\.relaycove|gpt-5\.6-terra/u);
  }
});

test("the FP008-01 start model node uses only the active database binding", () => {
  const value = workflow();
  for (const id of particleModelIds) {
    const node = nodeById(value, id);
    const serialized = JSON.stringify(node.parameters);
    assert.match(serialized, /runtime_bindings/u);
    assert.match(serialized, /FP008-01/u);
    assert.match(serialized, /prompt_text/u);
    assert.match(serialized, /provider_base_url/u);
    assert.match(serialized, /temperature/u);
    assert.match(serialized, /CONFIG_CONTRACT_BLOCKED/u);
    assert.doesNotMatch(serialized, /deepseek|gpt-5\.6-luna/iu);
    assert.deepEqual(node.credentials, {
      openAiApi: { id: "ktkbgOI2RQI4Y8QK", name: "OpenAI account" },
    });
  }
});

test("the FP008 resume node has no provider binding and reuses the persisted checkpoint input", () => {
  const value = workflow();
  const node = nodeById(value, resumeParticleSnapshotId);
  assert.equal(node.type, "n8n-nodes-base.code");
  assert.equal(node.typeVersion, 1);
  assert.equal(Object.hasOwn(node, "credentials"), false);
  assert.match(node.parameters.jsCode, /deduction_input_snapshot/u);
  assert.doesNotMatch(JSON.stringify(node), /provider_base_url|openAiApi|runtime_bindings/u);
});

test("FP008-02 receives the active binding adapter and does not call its service on a blocked mapping", () => {
  const value = workflow();
  for (const id of engineRequestIds) {
    const body = nodeById(value, id).parameters.body;
    assert.match(body, /mapping_ok === true/u);
    assert.match(body, /engine_request/u);
  }
  const particleAdapter = nodeById(value, "64fb6f8a-de62-4543-a426-953bccbb6a20").parameters.jsCode;
  assert.match(particleAdapter, /model_bindings: context\.model_bindings/u);
  assert.match(particleAdapter, /context\.redacted_error/u);
});

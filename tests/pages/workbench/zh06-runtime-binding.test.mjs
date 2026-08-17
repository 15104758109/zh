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

const loaderNodeId = "0310e89d-f966-40e7-a45f-b212b1307784";
const targetNodes = [
  ["8fc054d6-81f4-4c24-a7c8-a1215523b9fb", "FP009-01"],
  ["b11fc283-6990-4fb9-bba6-96f55b25d670", "FP010-01"],
  ["52a778a0-b4a9-4a67-b373-de31c96b2291", "FP011-01"],
  ["586e9ec8-0a4d-47b1-b010-33d183abe036", "FP011-02"],
  ["01d2c0a6-6811-44ad-b97e-81497d3a99fc", "FP012-01"],
  ["b11e8ec4-b0d1-43c2-a8c4-7f2aec19a950", "FP013-01"],
  ["2bdee308-b64e-4ba6-9326-1daa5519fc0a", "FP013-01"],
];

function workflow() {
  const file = readdirSync(n8nDirectory)
    .map((name) => path.join(n8nDirectory, name))
    .find((candidate) => {
      if (!candidate.endsWith(".json")) return false;
      return JSON.parse(readFileSync(candidate, "utf8")).nodes?.some((node) => node.id === loaderNodeId);
    });
  assert.ok(file, "the ZH06 workflow attachment must exist");
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

test("ZH06 resolves the active audit bindings at its existing input node", () => {
  const value = workflow();
  assert.equal(value.nodes.length, 31);
  assert.equal(Object.keys(value.connections ?? {}).length, 30);
  assert.equal(edgeCount(value), 40);

  const loader = nodeById(value, loaderNodeId);
  const query = loader.parameters.query;
  assert.equal(loader.parameters.operation, "executeQuery");
  assert.match(query, /public\.v_prompt_runtime_binding/u);
  for (const fp of ["FP009-01", "FP010-01", "FP011-01", "FP011-02", "FP012-01", "FP013-01"]) {
    assert.match(query, new RegExp(fp, "u"));
  }
  assert.match(query, /CONFIG_CONTRACT_BLOCKED/u);
  assert.match(query, /binding_count = 6/u);
  assert.doesNotMatch(query, /model_runtime_binding/u);
  assert.deepEqual(loader.credentials, {
    postgres: { id: "kitjw53XlibTPzxM", name: "zh-database" },
  });
});

test("ZH06 audit and presentation LLM nodes dynamically use their corresponding binding", () => {
  const value = workflow();
  for (const [id, fp] of targetNodes) {
    const node = nodeById(value, id);
    assert.equal(node.type, "n8n-nodes-base.httpRequest", `${fp} must use the Chat Completions adapter`);
    assert.equal(node.typeVersion, 4.2, `${fp} must use the supported HTTP Request version`);
    const serialized = JSON.stringify(node.parameters);
    assert.match(serialized, new RegExp(`runtime_bindings[^]*${fp}`, "u"));
    assert.match(serialized, /prompt_text/u);
    assert.match(serialized, /provider_base_url/u);
    assert.match(serialized, /temperature/u);
    assert.match(node.parameters.url, /chat\/completions/u, `${fp} must target Chat Completions`);
    assert.match(node.parameters.jsonBody, /choices|messages/u, `${fp} must send a Chat Completions request`);
    assert.match(serialized, /CONFIG_CONTRACT_BLOCKED/u);
    assert.doesNotMatch(serialized, /deepseek|gpt-5\.6-luna/iu);
    const usesRelayCove = [
      "8fc054d6-81f4-4c24-a7c8-a1215523b9fb",
      "b11fc283-6990-4fb9-bba6-96f55b25d670",
      "b11e8ec4-b0d1-43c2-a8c4-7f2aec19a950",
    ].includes(id);
    assert.deepEqual(node.credentials, {
      openAiApi: usesRelayCove
        ? { id: "ZpJ7ejgoXbQb5xUW", name: "RelayCove account" }
        : { id: "ktkbgOI2RQI4Y8QK", name: "OpenAI account" },
    });
  }

  const presentation = nodeById(value, "8fc054d6-81f4-4c24-a7c8-a1215523b9fb");
  assert.equal(
    presentation.parameters.options.response.response.responseFormat,
    "text",
    "FP009 prose is free text; the JSON parser modes are reserved for FP010-FP012",
  );
});

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

const readerNodeId = "41dd188b-e192-4295-9a5a-3c944810203a";
const modelNodeId = "a462595a-20a1-490d-b4b5-1c11a4a2f155";
const resultNodeId = "ad36130d-2a0a-455e-9e98-b3be7cb98aae";

function workflow() {
  const file = readdirSync(n8nDirectory)
    .map((name) => path.join(n8nDirectory, name))
    .find((candidate) => {
      if (!candidate.endsWith(".json")) return false;
      return JSON.parse(readFileSync(candidate, "utf8")).nodes?.some(
        (node) => node.id === readerNodeId,
      );
    });
  assert.ok(file, "the FP012-03 workflow attachment must exist");
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

test("FP012-03 preserves the existing five-node shadow-analysis workflow", () => {
  const value = workflow();
  assert.equal(value.nodes.length, 5);
  assert.equal(Object.keys(value.connections ?? {}).length, 4);
  assert.equal(edgeCount(value), 4);
  assert.equal(value.nodes[0].parameters.responseMode, "responseNode");
});

test("FP012-03 reads only the verified second-return evidence and its active runtime binding", () => {
  const value = workflow();
  const reader = nodeById(value, readerNodeId);
  const query = reader.parameters.query;

  assert.equal(reader.parameters.operation, "executeQuery");
  assert.equal(reader.parameters.options.queryReplacement, "={{ [JSON.stringify($json.body ?? $json)] }}");
  assert.match(query, /public\.v_prompt_runtime_binding/u);
  assert.match(query, /FP012-03/u);
  assert.match(query, /public\.chapter_version/u);
  assert.match(query, /public\.audit_attempt_log/u);
  assert.match(query, /public\.editor_log/u);
  assert.match(query, /public\.narrative_asset/u);
  assert.match(query, /cv\.version_state = 'candidate'/u);
  assert.match(query, /cv\.version_state = 'shadow'/u);
  assert.match(query, /previous\.version_state = 'formal'/u);
  assert.match(query, /previous\.is_valid/u);
  assert.match(query, /NOT previous\.is_shadow/u);
  assert.match(query, /reject_count = 1/u);
  assert.match(query, /e\.creator_confirmed/u);
  assert.match(query, /decision_json->>'verdict' = 'N'/u);
  assert.match(query, /RETURN_NOT_CONFIRMED/u);
  assert.match(query, /CONFIG_CONTRACT_BLOCKED/u);
  assert.deepEqual(reader.credentials, {
    postgres: { id: "kitjw53XlibTPzxM", name: "zh-database" },
  });
});

test("FP012-03 blocks before an unconfigured model call and never writes shadow analysis to the database", () => {
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

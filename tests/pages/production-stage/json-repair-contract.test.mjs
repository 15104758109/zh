import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const n8n = path.join(root, "docs", "\u540e\u7aef", "n8n");

function codeSource(file, name) {
  const workflow = JSON.parse(readFileSync(path.join(n8n, file), "utf8"));
  const source = workflow.nodes.find((node) => node.name === name)?.parameters?.jsCode;
  assert.equal(typeof source, "string", `${file}/${name}`);
  return source;
}

const legacyParsers = [
  ["\u4e3b\u89d2\u5de5\u4f5c\u5668.json", "JSON\u4fee\u590d", "repaired_json"],
  ["\u53cd\u6d3e_\u73af\u5883\u538b\u529b\u5de5\u4f5c\u5668.json", "JSON\u4fee\u590d", "candidate_paths"],
  ["\u7fa4\u50cf\u5de5\u4f5c\u5668.json", "JSON\u4fee\u590d", "candidate"],
];

function runLegacy(source, value) {
  const item = { json: { output: value } };
  return new Function("$input", source)({ all: () => [item] })[0].json;
}

test("pure JSON repair workers share a complete-single-root contract", () => {
  const complete = JSON.stringify({
    value: true,
    quote: "this text contains { [ and a closing ] }",
    nested: [{ id: 1 }],
  });
  const decorated = `model note\n\uFEFF\`\`\`json\n${complete}\n\`\`\`\nend note [ordinary prose`;

  for (const [file, name, field] of legacyParsers) {
    const source = codeSource(file, name);
    assert.match(source, /balancedRoot/);
    assert.match(source, /repairJsonSyntax\(root\.source\)/);
    assert.match(source, /JSON\.parse\(repaired\)/);
    assert.doesNotMatch(source, /match\(\/\\\\\{\[\\\\s\\\\S\]\*\\\\\}/);

    const accepted = runLegacy(source, decorated);
    assert.deepEqual(accepted[field], JSON.parse(complete), `${file} accepts one root`);

    const rejected = runLegacy(source, `${complete}\n${JSON.stringify({ second: true })}`);
    if (file.includes("\u4e3b\u89d2")) assert.equal(rejected[field].error, "JSON\u65e0\u6cd5\u89e3\u6790");
    else if (file.includes("\u53cd\u6d3e")) assert.equal(rejected[field].fixed, false);
    else assert.equal(rejected.success, false);
  }
});

test("all JSON repair code nodes use the shared balanced-root boundary", () => {
  const offenders = [];
  for (const file of readdirSync(n8n).filter((candidate) => candidate.endsWith(".json"))) {
    const workflow = JSON.parse(readFileSync(path.join(n8n, file), "utf8"));
    for (const node of workflow.nodes ?? []) {
      const source = node.parameters?.jsCode;
      if (typeof source !== "string" || !/json/i.test(String(node.name ?? "")) || !/JSON\.parse\s*\(/.test(source)) continue;
      const transportEnvelopeOnly = /Object\.hasOwn\(source, 'data'\)/.test(source)
        && /source\.statusCode/.test(source)
        && /JSON\.parse\(source\.data\)/.test(source)
        && /candidateText/.test(source);
      if (transportEnvelopeOnly) continue;
      if (!/balancedRoot/.test(source) || /JSON\.parse\s*\(\s*(?:raw|providerPayload|candidate)\b/.test(source)) {
        offenders.push(`${file}/${node.name}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

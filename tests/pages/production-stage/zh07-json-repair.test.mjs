import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflowPath = new URL("../../../docs/后端/n8n/ZH07-迭代阶段.json", import.meta.url);

async function parserSources() {
  const workflow = JSON.parse(await readFile(workflowPath, "utf8"));
  return workflow.nodes
    .filter((node) => typeof node.name === "string" && node.name.includes("JSON修复"))
    .map((node) => node.parameters?.jsCode)
    .filter((source) => typeof source === "string");
}

function runParser(source, value) {
  const items = [{ json: { output: value, untouched: "kept" } }];
  const result = new Function("items", source)(items);
  return Array.isArray(result) ? result[0].json : result.json;
}

test("ZH07 JSON repair nodes accept one complete fenced root with BOM and prose", async () => {
  const sources = await parserSources();
  assert.equal(sources.length, 3);
  for (const source of sources) {
    const result = runParser(source, "说明文本\n\uFEFF```json\n{\"has_value\":true,\"items\":[1]}\n```\n结束");
    assert.equal(result.has_value, true);
    assert.deepEqual(result.items, [1]);
    assert.equal(result.untouched, "kept");
  }
});

test("ZH07 JSON repair nodes fail closed on multiple roots instead of merging them", async () => {
  const sources = await parserSources();
  for (const source of sources) {
    const result = runParser(source, '{"has_value":true}{"unexpected":true}');
    assert.equal(result.has_value, false);
    assert.equal(result.error, "Failed to parse JSON");
    assert.equal(result.unexpected, undefined);
  }
});

test("ZH07 JSON repair nodes scan balanced roots without treating braces in JSON strings as boundaries", async () => {
  const sources = await parserSources();
  const complete = JSON.stringify({
    note: "literal { and [ stay inside this string",
    nested: [{ value: true }],
  });
  for (const source of sources) {
    const accepted = runParser(source, `prefix \uFEFF\`\`\`json\n${complete}\n\`\`\` suffix [ordinary prose`);
    assert.equal(accepted.note, "literal { and [ stay inside this string");
    assert.deepEqual(accepted.nested, [{ value: true }]);

    const truncated = runParser(source, complete.slice(0, -1));
    assert.equal(truncated.has_value, false);
    assert.equal(truncated.error, "Failed to parse JSON");

    const separatedRoots = runParser(source, `${complete}\nmodel commentary\n${JSON.stringify({ second: true })}`);
    assert.equal(separatedRoots.has_value, false);
    assert.equal(separatedRoots.second, undefined);
  }
});

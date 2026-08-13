import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "../..");
const workflowDirectory = path.join(root, "docs/后端/n8n");
const attachments = [
  "ZH01-新书创建.json",
  "ZH03-三线排序.json",
  "ZH04-生产拆解.json",
  "ZH05-正文推演.json",
  "ZH06-审计阶段.json",
  "ZH07-迭代阶段.json",
  "世界设定生成助手.json",
  "主角工作器.json",
  "前端变体_主线健康助手.json",
  "反派_环境压力工作器.json",
  "影子融合工具.json",
  "群像工作器.json",
];

function workflows() {
  return attachments.map((name) => JSON.parse(readFileSync(path.join(workflowDirectory, name), "utf8")));
}

function parserNodes() {
  return workflows().flatMap((workflow) => workflow.nodes
    .filter((node) => node.type === "n8n-nodes-base.code" && /parseSingleJson/u.test(node.parameters?.jsCode ?? ""))
    .map((node) => ({ workflow, node })));
}

function execute(node, input) {
  return vm.runInNewContext(`(() => {\n${node.parameters.jsCode}\n})()`, {
    $input: { all: () => [{ json: input }], first: () => ({ json: input }) },
    $json: input,
  });
}

test("every model-text JSON repair node carries the bounded syntax repair helper", () => {
  const nodes = parserNodes();
  assert.equal(nodes.length, 29);
  for (const { workflow, node } of nodes) {
    assert.match(node.parameters.jsCode, /repairJsonSyntax/u, `${workflow.name}/${node.name}`);
  }
});

test("the representative worker parser repairs only safe JSON syntax noise", () => {
  const worker = workflows().find((workflow) => workflow.name === "主角工作器");
  const node = worker.nodes.find((candidate) => candidate.name === "JSON修复");
  assert.ok(node);

  const repaired = JSON.parse(JSON.stringify(execute(node, { output: "{foo: 'bar', trailing: true,}" })[0].json.repaired_json));
  assert.deepEqual(repaired, { foo: "bar", trailing: true });

  const fenced = JSON.parse(JSON.stringify(execute(node, { output: "```json\n{'foo': 'bar',}\n```" })[0].json.repaired_json));
  assert.deepEqual(fenced, { foo: "bar" });

  const truncated = JSON.parse(JSON.stringify(execute(node, { output: "{foo: 'bar'" })[0].json.repaired_json));
  assert.equal(truncated.error, "JSON无法解析");

  const multiple = JSON.parse(JSON.stringify(execute(node, { output: "{\"foo\":1}{\"bar\":2}" })[0].json.repaired_json));
  assert.equal(multiple.error, "JSON无法解析");
});

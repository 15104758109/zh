import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const WORKFLOW = path.join(ROOT, "orchestration/workflows/production-base/f0-06-production-base.json");
const CONTRACTS = path.join(ROOT, "packages/contracts/src/production-base");
const contractsRequire = createRequire(path.join(ROOT, "packages/contracts/package.json"));
const { default: Ajv2020 } = contractsRequire("ajv/dist/2020");

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function workflowAndNodes() {
  const workflow = await readJson(WORKFLOW);
  const codeNodes = workflow.nodes.filter((node) => node.type === "n8n-nodes-base.code");
  assert.equal(codeNodes.length, 1, "workflow must contain exactly one Code node");
  const respondNodes = workflow.nodes.filter((node) => node.type === "n8n-nodes-base.respondToWebhook");
  assert.equal(respondNodes.length, 1, "workflow must contain exactly one Respond node");
  return { workflow, code: codeNodes[0], respond: respondNodes[0] };
}

async function executeWorkflowCode(request) {
  const { code } = await workflowAndNodes();
  const jsCode = code.parameters.jsCode;
  assert.equal(typeof jsCode, "string");
  const context = vm.createContext({ $input: { first: () => ({ json: { body: request } }) } });
  const result = new vm.Script(`(function () { ${jsCode} })()`).runInContext(context, { timeout: 1000 });
  assert.equal(Array.isArray(result), true);
  assert.equal(result.length, 1);
  return JSON.parse(JSON.stringify(result[0].json));
}

function compile(schema) {
  return new Ajv2020({ allErrors: true, strict: true }).compile(schema);
}

test("F0-06 import shape is an inactive webhook to Code to Respond workflow", async () => {
  const { workflow, code, respond } = await workflowAndNodes();
  assert.equal(workflow.id, "f0-06-production-base");
  assert.equal(workflow.name, "F0-06 Production Base");
  assert.equal(workflow.active, false);
  assert.deepEqual(workflow.nodes.map((node) => node.type), ["n8n-nodes-base.webhook", "n8n-nodes-base.code", "n8n-nodes-base.respondToWebhook"]);
  assert.deepEqual(workflow.connections, {
    "Receive Production Base Request": { main: [[{ node: code.name, type: "main", index: 0 }]] },
    [code.name]: { main: [[{ node: respond.name, type: "main", index: 0 }]] },
  });
  assert.equal(respond.parameters.responseBody, "={{ $json.response }}");
  assert.equal(respond.parameters.options.responseCode, "={{ $json.http_status }}");
  const serialized = JSON.stringify(workflow);
  assert.doesNotMatch(serialized, /credentials|postgres|sql|rpc_|trace|cost|gateway|recover|apiKey|authorization|password|token/i);
});

test("F0-06 executes the workflow Code node for accepted and redacted responses", async () => {
  assert.deepEqual(await executeWorkflowCode({ correlation_id: "run:001" }), {
    http_status: 200, response: { correlation_id: "run:001", result: { status: "accepted" } },
  });
  for (const request of [{ correlation_id: "bad value" }, {}, { correlation_id: 1 }, { correlation_id: "run:001", extra: true }]) {
    const response = await executeWorkflowCode(request);
    assert.equal(response.http_status, 400);
    assert.deepEqual(response.response, {
      correlation_id: "unavailable",
      redacted_error: { code: "INVALID_REQUEST", message: "The request could not be accepted." },
    });
    assert.doesNotMatch(JSON.stringify(response), /stack|sql|node|credential|token|bad value/i);
  }
});

test("F0-06 Draft 2020-12 contracts compile and close request and response shapes", async () => {
  const [request, success, error] = await Promise.all([
    readJson(path.join(CONTRACTS, "production-base-request.schema.json")),
    readJson(path.join(CONTRACTS, "production-base-success.schema.json")),
    readJson(path.join(CONTRACTS, "production-base-redacted-error.schema.json")),
  ]);
  const requestValidate = compile(request);
  const successValidate = compile(success);
  const errorValidate = compile(error);
  assert.equal(requestValidate({ correlation_id: "run:001" }), true);
  for (const value of [{ correlation_id: "run:001", extra: true }, {}, { correlation_id: 1 }]) assert.equal(requestValidate(value), false);
  assert.equal(successValidate({ correlation_id: "run:001", result: { status: "accepted" } }), true);
  for (const value of [{ correlation_id: "run:001", result: { status: "accepted" }, extra: true }, { correlation_id: "run:001" }, { correlation_id: "run:001", result: "accepted" }]) assert.equal(successValidate(value), false);
  const validError = { correlation_id: "unavailable", redacted_error: { code: "INVALID_REQUEST", message: "The request could not be accepted." } };
  assert.equal(errorValidate(validError), true);
  for (const value of [{ ...validError, extra: true }, { correlation_id: "unavailable" }, { correlation_id: "unavailable", redacted_error: "INVALID_REQUEST" }]) assert.equal(errorValidate(value), false);
});

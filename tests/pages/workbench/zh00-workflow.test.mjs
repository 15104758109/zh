import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const docsDirectory = path.join(root, "docs");
const n8nDirectory = readdirSync(docsDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(docsDirectory, entry.name, "n8n"))
  .find((candidate) => existsSync(candidate));
const workflowFile = readdirSync(n8nDirectory).find((name) => /^ZH00-.*\.json$/u.test(name));
const operator = "11111111-1111-1111-1111-111111111111";
const book = "22222222-2222-2222-2222-222222222222";
const evidence = "33333333-3333-3333-3333-333333333333";
const providerBaseUrl = "https://model.example/v1";
const modelName = "narrative-model";
const apiKeyRef = "n8n-credential:openai-account-v1";
const relayCoveApiKeyRef = "n8n-credential:relaycove-v1";

function workflow() {
  return JSON.parse(readFileSync(path.join(n8nDirectory, workflowFile), "utf8"));
}

function nodeById(value, id) {
  const node = value.nodes.find((item) => item.id === id);
  assert.ok(node, `missing node: ${id}`);
  return node;
}

function runNodeCode(node, input) {
  return new Function("$input", node.parameters.jsCode)({ item: { json: { body: input } } })[0].json;
}

function evaluateN8nExpression(expression, { statusCode, body }) {
  const source = expression.replace(/^={{\s*/, "").replace(/\s*}}$/, "");
  const upstream = {
    result: {
      route: "test",
      request: { local_operator_id: operator, provider_base_url: providerBaseUrl, model_name: modelName, api_key_ref: apiKeyRef },
    },
  };
  return new Function("$", "$json", `return (${source});`)(
    (name) => {
      assert.equal(name, "Workbench PostgreSQL RPC");
      return { item: { json: upstream } };
    },
    { statusCode, body },
  );
}

test("ZH00 routes each allowlisted credential through its configured test node", () => {
  const value = workflow();
  const expectedSources = [
    "Webhook: POST /workbench",
    "Validate workbench command",
    "Route workbench command",
    "Workbench PostgreSQL RPC",
    "Normalize PostgreSQL result",
    "Route approved model credential",
    "Test OpenAI credential",
    "Test RelayCove credential",
    "Redact and record credential test evidence",
  ];
  const expectedConnections = {
    "Webhook: POST /workbench": ["Validate workbench command"],
    "Validate workbench command": ["Route workbench command"],
    "Route workbench command": ["Workbench PostgreSQL RPC", "Respond"],
    "Workbench PostgreSQL RPC": ["Normalize PostgreSQL result"],
    "Normalize PostgreSQL result": ["Route approved model credential", "Respond"],
    "Route approved model credential": ["Test OpenAI credential", "Test RelayCove credential", "Respond"],
    "Test OpenAI credential": ["Redact and record credential test evidence"],
    "Test RelayCove credential": ["Redact and record credential test evidence"],
    "Redact and record credential test evidence": ["Respond"],
  };

  assert.equal(value.active, false);
  assert.equal(value.nodes.length, 10);
  assert.deepEqual(Object.keys(value.connections).sort(), expectedSources.sort());
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(value.connections).map(([source, connection]) => [source, connection.main.map((output) => output[0].node)]),
    ),
    expectedConnections,
  );
});

test("ZH00 maps operator bootstrap and the five stable rpc_workbench actions without legacy aggregate commands", () => {
  const value = workflow();
  const validate = nodeById(value, "zh00-validate");
  const postgres = nodeById(value, "zh00-postgres");
  const payloads = [
    { action: "operator" },
    { action: "operator", local_operator_id: operator },
    { action: "read", local_operator_id: operator, book_id: book, node_code: "FP014-02" },
    {
      action: "save_prompt_active",
      local_operator_id: operator,
      fp_target: "FP014-02",
      prompt_text: "Use evidence before drafting.",
      idempotency_key: "workbench-prompt-1",
    },
    {
      action: "save_model_template",
      local_operator_id: operator,
      template_type: "复杂任务",
      connection_test_evidence_id: evidence,
      routing_config_jsonb: { mode: "default" },
      parameters_jsonb: { temperature: 0.7 },
      idempotency_key: "workbench-model-1",
    },
    {
      action: "bind_node_template",
      local_operator_id: operator,
      node_code: "FP014-02",
      template_type: "复杂任务",
      temperature: 0.7,
      idempotency_key: "workbench-binding-1",
    },
    {
      action: "save_book_config",
      local_operator_id: operator,
      book_id: book,
      auto_production: false,
      auto_audit: false,
      auto_iteration: false,
      presentation_intensity: 0.65,
      idempotency_key: "workbench-book-1",
    },
  ];

  assert.match(postgres.parameters.query, /SELECT \$1::jsonb AS request/);
  assert.match(postgres.parameters.query, /rpc_get_local_operator\(request - 'action'\)/);
  assert.match(postgres.parameters.query, /rpc_workbench\(request\)/);
  for (const [code, literal] of [
    ["emotive_text", "U&'\\611F\\6027\\6587\\5B57'::text"],
    ["simple_logic", "U&'\\7B80\\5355\\903B\\8F91'::text"],
    ["repeated_instruction", "U&'\\91CD\\590D\\6307\\4EE4'::text"],
    ["complex_task", "U&'\\590D\\6742\\4EFB\\52A1'::text"],
    ["objective_fair", "U&'\\5BA2\\89C2\\516C\\6B63'::text"],
  ]) {
    assert.match(postgres.parameters.query, new RegExp(`WHEN '${code}' THEN jsonb_set`));
    assert.ok(postgres.parameters.query.includes(literal), literal);
  }
  assert.match(postgres.parameters.options.queryReplacement, /JSON\.stringify\(\$json\.request\)/);
  assert.doesNotMatch(validate.parameters.jsCode, /input\.action==='load'|input\.action==='save'/);

  for (const payload of payloads) {
    const result = runNodeCode(validate, payload);
    assert.equal(result.route, "db", payload.action);
    const expected = payload.action === "save_model_template"
      ? {
          ...payload,
          template_type: "complex_task",
        }
      : payload.action === "bind_node_template"
        ? { ...payload, template_type: "complex_task" }
        : payload;
    assert.deepEqual(result.request, expected, payload.action);
  }
});

test("ZH00 reads a scoped book banner without widening rpc_workbench's effective configuration contract", () => {
  const value = workflow();
  const validate = nodeById(value, "zh00-validate");
  const postgres = nodeById(value, "zh00-postgres");

  const result = runNodeCode(validate, {
    action: "book_banner",
    local_operator_id: operator,
    book_id: book,
  });

  assert.equal(result.route, "db");
  assert.deepEqual(result.request, {
    action: "book_banner",
    local_operator_id: operator,
    book_id: book,
  });
  assert.match(postgres.parameters.query, /request->>'action' = 'book_banner'/);
  assert.match(postgres.parameters.query, /JOIN public\.book_project AS bp/);
  assert.match(postgres.parameters.query, /bp\.local_operator_id = \(request->>'local_operator_id'\)::uuid/);
  assert.match(postgres.parameters.query, /public\.chapter_header AS ch/);
  assert.match(postgres.parameters.query, /cv\.version_state = 'formal'/);
  assert.match(postgres.parameters.query, /'book_banner'/);
  assert.doesNotMatch(postgres.parameters.query, /effective_config[^;]*book_banner/s);
});

test("ZH00 transports all five approved template labels through ASCII-safe codes", () => {
  const value = workflow();
  const validate = nodeById(value, "zh00-validate");
  const mappings = [
    ["感性文字", "emotive_text"],
    ["简单逻辑", "simple_logic"],
    ["重复指令", "repeated_instruction"],
    ["复杂任务", "complex_task"],
    ["客观公正", "objective_fair"],
  ];

  assert.match(validate.parameters.jsCode, /String\.fromCodePoint/);
  for (const [label] of mappings) assert.equal(validate.parameters.jsCode.includes(label), false, label);

  for (const [label, code] of mappings) {
    const save = runNodeCode(validate, {
      action: "save_model_template",
      local_operator_id: operator,
      template_type: label,
      connection_test_evidence_id: evidence,
      idempotency_key: `zh00-template-${code}`,
    });
    assert.equal(save.route, "db", label);
    assert.equal(save.request.template_type, code, label);

    const binding = runNodeCode(validate, {
      action: "bind_node_template",
      local_operator_id: operator,
      node_code: "FP014-02",
      template_type: label,
      idempotency_key: `zh00-binding-${code}`,
    });
    assert.equal(binding.route, "db", label);
    assert.equal(binding.request.template_type, code, label);
  }
});

test("ZH00 accepts the real page save payload and resolves its exact tested fields behind the webhook", () => {
  const value = workflow();
  const validate = nodeById(value, "zh00-validate");
  const postgres = nodeById(value, "zh00-postgres");
  const pagePayload = {
    action: "save_model_template",
    local_operator_id: operator,
    template_type: "复杂任务",
    connection_test_evidence_id: evidence,
    routing_config_jsonb: { mode: "default" },
    parameters_jsonb: { temperature: 0.7 },
    idempotency_key: "workbench-model-page-save-1",
  };

  const result = runNodeCode(validate, pagePayload);
  assert.equal(result.route, "db");
  assert.deepEqual(result.request, { ...pagePayload, template_type: "complex_task" });
  assert.match(postgres.parameters.query, /FROM public\.model_connection_test_evidence AS e/);
  assert.match(postgres.parameters.query, /e\.provider_base_url/);
  assert.match(postgres.parameters.query, /e\.model_name/);
  assert.match(postgres.parameters.query, /e\.api_key_ref_sha256/);
  assert.match(postgres.parameters.query, /CASE e\.api_key_ref_sha256/);
  assert.match(postgres.parameters.query, /n8n-credential:openai-account-v1/);
  assert.match(postgres.parameters.query, /n8n-credential:relaycove-v1/);
  assert.doesNotMatch(postgres.parameters.query, /JOIN public\.model_sync_config AS m/);
});

test("ZH00 preserves stable validation and lets the RPC return authoritative outcomes", () => {
  const value = workflow();
  const validate = nodeById(value, "zh00-validate");
  const normalizeDb = nodeById(value, "zh00-normalize-db");
  const response = nodeById(value, "zh00-respond");

  const malformed = runNodeCode(validate, { action: "read", local_operator_id: "not-a-uuid" });
  assert.equal(malformed.route, "respond");
  assert.equal(malformed.result.error.code, "INVALID_REQUEST");

  const malformedOperator = runNodeCode(validate, { action: "operator", local_operator_id: "not-a-uuid" });
  assert.equal(malformedOperator.route, "respond");
  assert.equal(malformedOperator.result.error.code, "INVALID_REQUEST");

  const oldAggregate = runNodeCode(validate, { action: "save", local_operator_id: operator, items: [] });
  assert.equal(oldAggregate.route, "respond");
  assert.equal(oldAggregate.result.error.code, "INVALID_REQUEST");

  const rawKey = runNodeCode(validate, {
    action: "save_model_template",
    local_operator_id: operator,
    template_type: "复杂任务",
    provider_base_url: "https://model.example/v1",
    model_name: "narrative-model",
    api_key_ref: "local-secure-ref:model-a",
    connection_test_evidence_id: evidence,
    idempotency_key: "workbench-model-raw-key",
    api_key: "plaintext-must-not-pass",
  });
  assert.equal(rawKey.route, "respond");
  assert.equal(rawKey.result.error.code, "INVALID_REQUEST");
  assert.equal(rawKey.request, undefined);

  const readonlyBudget = runNodeCode(validate, {
    action: "save_book_config",
    local_operator_id: operator,
    book_id: book,
    auto_production: false,
    auto_audit: false,
    auto_iteration: false,
    presentation_intensity: 0.65,
    token_budget: 900000,
    idempotency_key: "workbench-readonly-budget",
  });
  assert.equal(readonlyBudget.route, "db");
  assert.equal(readonlyBudget.request.token_budget, 900000);

  assert.equal(normalizeDb.type, "n8n-nodes-base.switch");
  assert.match(normalizeDb.parameters.rules.values[0].conditions.conditions[0].leftValue, /\$json\.result\.route/);
  assert.match(response.parameters.responseBody, /\$json\.result \? \$json\.result : \$json/);
  assert.deepEqual(response.parameters.options.responseHeaders.entries, [{ name: "cache-control", value: "no-store" }]);
});

test("ZH00 runs a controlled first model test and records redacted D-046 evidence", () => {
  const value = workflow();
  const validate = nodeById(value, "zh00-validate");
  const credentialRoute = nodeById(value, "zh00-route-credential");
  const credential = nodeById(value, "zh00-test-credential");
  const relayCoveCredential = nodeById(value, "zh00-test-relaycove");
  const evidenceRecorder = nodeById(value, "zh00-normalize-test");
  const result = runNodeCode(validate, {
    action: "test_connection",
    local_operator_id: operator,
    template_type: "复杂任务",
    provider_base_url: providerBaseUrl,
    model_name: modelName,
  });

  assert.equal(result.route, "db");
  assert.deepEqual(result.request, {
      action: "test_connection",
      local_operator_id: operator,
      template_type: "complex_task",
      provider_base_url: providerBaseUrl,
      model_name: modelName,
      api_key_ref: apiKeyRef,
    });

  const rawKey = runNodeCode(validate, {
    action: "test_connection",
    local_operator_id: operator,
    template_type: "复杂任务",
    provider_base_url: providerBaseUrl,
    model_name: modelName,
    api_key: "plaintext-must-not-pass",
  });
  assert.equal(rawKey.route, "respond");
  assert.equal(rawKey.result.error.code, "INVALID_REQUEST");

  const unsupportedCredential = runNodeCode(validate, {
    action: "save_model_template",
    local_operator_id: operator,
    template_type: "复杂任务",
    provider_base_url: providerBaseUrl,
    model_name: modelName,
    api_key_ref: "browser-supplied-ref",
    connection_test_evidence_id: evidence,
    idempotency_key: "workbench-model-browser-supplied",
  });
  assert.equal(unsupportedCredential.route, "respond");
  assert.equal(unsupportedCredential.result.error.code, "INVALID_REQUEST");

  const relayCoveTest = runNodeCode(validate, {
    action: "test_connection",
    local_operator_id: operator,
    template_type: "复杂任务",
    provider_base_url: "https://api.relaycove.com/v1",
    model_name: "gpt-5.6-terra",
    api_key_ref: relayCoveApiKeyRef,
  });
  assert.equal(relayCoveTest.route, "db");
  assert.equal(relayCoveTest.request.api_key_ref, relayCoveApiKeyRef);

  const unsupportedTestCredential = runNodeCode(validate, {
    action: "test_connection",
    local_operator_id: operator,
    template_type: "复杂任务",
    provider_base_url: "https://api.example/v1",
    model_name: "model-v1",
    api_key_ref: "n8n-credential:unregistered-v1",
  });
  assert.equal(unsupportedTestCredential.route, "respond");
  assert.equal(unsupportedTestCredential.result.error.code, "INVALID_REQUEST");

  assert.equal(credential.parameters.method, "POST");
  assert.match(credential.parameters.url, /chat\\\/completions/);
  assert.match(credential.parameters.url, /Workbench PostgreSQL RPC/);
  assert.match(credential.parameters.url, /result\.request\.provider_base_url/);
  assert.match(credential.parameters.jsonBody, /result\.request\.model_name/);
  assert.match(credential.parameters.jsonBody, /max_tokens: 1/);
  assert.equal(credential.parameters.authentication, "predefinedCredentialType");
  assert.equal(credential.parameters.nodeCredentialType, "openAiApi");
  assert.equal(credential.parameters.options.response.response.fullResponse, true);
  assert.equal(credential.parameters.options.response.response.neverError, true);
  assert.equal(credential.onError, "continueRegularOutput");
  assert.equal(credential.retryOnFail, true);
  assert.equal(credential.maxTries, 3);
  assert.equal(credential.waitBetweenTries, 3000);
  assert.equal(
    evaluateN8nExpression(credential.parameters.url, { statusCode: 0, body: null }),
    "https://model.example/v1/chat/completions",
  );
  assert.doesNotMatch(JSON.stringify(credential), /N8N_TEST_MODEL_API_KEY|Bearer\s/);
  assert.equal(credentialRoute.type, "n8n-nodes-base.switch");
  assert.match(JSON.stringify(credentialRoute.parameters), /openai-account-v1/);
  assert.match(JSON.stringify(credentialRoute.parameters), /relaycove-v1/);
  assert.equal(relayCoveCredential.parameters.nodeCredentialType, "openAiApi");
  assert.deepEqual(relayCoveCredential.credentials.openAiApi, {
    id: "ZpJ7ejgoXbQb5xUW",
    name: "RelayCove account",
  });
  assert.doesNotMatch(JSON.stringify(relayCoveCredential), /N8N_TEST_MODEL_API_KEY|Bearer\s/);
  const testConnectionValidation = validate.parameters.jsCode.match(/if \(input\.action === 'test_connection'\)[\s\S]*?(?=\nreturn fail)/)?.[0] ?? "";
  assert.match(testConnectionValidation, /provider_base_url/);
  assert.match(testConnectionValidation, /model_name/);
  assert.match(testConnectionValidation, /input\.api_key_ref/);
  assert.match(validate.parameters.jsCode, /relaycove-v1/);
  assert.doesNotMatch(validate.parameters.jsCode, /api\.tryallai\.net|gpt-5\.6-luna/);

  assert.equal(evidenceRecorder.type, "n8n-nodes-base.postgres");
  assert.match(evidenceRecorder.parameters.query, /v7_record_model_connection_test/);
  assert.match(evidenceRecorder.parameters.query, /connection_test_evidence_id/);
  assert.match(evidenceRecorder.parameters.query, /n8n-controlled-http-test/);
  assert.match(evidenceRecorder.parameters.options.queryReplacement, /body\?\.choices\?\.\[0\]\?\.message\?\.content/);
  assert.match(evidenceRecorder.parameters.options.queryReplacement, /body\?\.usage\?\.total_tokens/);
  assert.match(evidenceRecorder.parameters.options.queryReplacement, /result\.request\.api_key_ref/);
  assert.doesNotMatch(JSON.stringify(evidenceRecorder), /N8N_TEST_MODEL_API_KEY|Bearer\s/);
  assert.equal(evidenceRecorder.onError, "continueRegularOutput");

  const successfulEvidenceInput = JSON.parse(evaluateN8nExpression(
    evidenceRecorder.parameters.options.queryReplacement,
    { statusCode: 200, body: { choices: [{ message: { content: "pong" } }], usage: { total_tokens: 2 } } },
  )[0]);
  assert.deepEqual(successfulEvidenceInput, {
    local_operator_id: operator,
    provider_base_url: providerBaseUrl,
    model_name: modelName,
    api_key_ref: apiKeyRef,
    http_status: 200,
    test_succeeded: true,
  });

  const failedEvidenceInput = JSON.parse(evaluateN8nExpression(
    evidenceRecorder.parameters.options.queryReplacement,
    { statusCode: 401, body: { error: { code: "invalid_key" } } },
  )[0]);
  assert.equal(failedEvidenceInput.test_succeeded, false);
  assert.equal(failedEvidenceInput.http_status, 401);

  const emptyChoiceEvidenceInput = JSON.parse(evaluateN8nExpression(
    evidenceRecorder.parameters.options.queryReplacement,
    { statusCode: 200, body: { choices: [{ message: { content: null } }], usage: { total_tokens: 1 } } },
  )[0]);
  assert.equal(emptyChoiceEvidenceInput.test_succeeded, false);

  const missingUsageEvidenceInput = JSON.parse(evaluateN8nExpression(
    evidenceRecorder.parameters.options.queryReplacement,
    { statusCode: 200, body: { choices: [{ message: { content: "pong" } }] } },
  )[0]);
  assert.equal(missingUsageEvidenceInput.test_succeeded, false);
});

test("ZH00 tests the requested first template configuration without requiring an active model", () => {
  const value = workflow();
  const postgres = nodeById(value, "zh00-postgres");
  const route = nodeById(value, "zh00-route");
  const normalize = nodeById(value, "zh00-normalize-db");

  assert.match(postgres.parameters.query, /WHEN c\.request->>'action' = 'test_connection' THEN jsonb_build_object/);
  assert.match(postgres.parameters.query, /'provider_base_url', c\.request->>'provider_base_url'/);
  assert.match(postgres.parameters.query, /'model_name', c\.request->>'model_name'/);
  assert.match(postgres.parameters.query, /'api_key_ref', c\.request->>'api_key_ref'/);
  assert.match(postgres.parameters.query, /api_key_ref/);
  assert.doesNotMatch(postgres.parameters.query, /ACTIVE_CONFIG_UNAVAILABLE/);
  assert.equal(route.type, "n8n-nodes-base.switch");
  assert.equal(normalize.type, "n8n-nodes-base.switch");
  assert.match(normalize.parameters.rules.values[0].conditions.conditions[0].leftValue, /\$json\.result\.route/);
});

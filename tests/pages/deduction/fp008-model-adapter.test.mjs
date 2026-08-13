import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createOpenAiCompatibleModelInvoker,
  requestWithNodeHttps,
} from "../../../apps/api/src/features/fp008/fp008-02/openai-compatible-model.ts";
import { createFp008DiagnosticLogger } from "../../../apps/api/src/features/fp008/fp008-02/diagnostics.mjs";
import { resolveCredential } from "../../../apps/api/src/features/fp008/fp008-02/env-credential-resolver.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const alignedPrompts = readFileSync(path.join(root, "docs", "后端", "对齐版提示词.md"), "utf8");

function binding(promptText = "director prompt") {
  return {
    node_code: "NODE_06",
    prompt_text: promptText,
    model_name: "model-v1",
    provider_base_url: "https://provider.example/v1",
    api_key_ref: "local-secret-ref:model-v1",
    temperature: 0.3,
    parameters_jsonb: { max_tokens: 2048, timeout_ms: 5000 },
  };
}

function modelResponse(output, tokens = 11, usageFields = {}) {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(output) } }],
    usage: { total_tokens: tokens, ...usageFields },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function rawModelResponse(content, tokens = 11) {
  return new Response(JSON.stringify({
    choices: [{ message: { content } }],
    usage: { total_tokens: tokens },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

test("the FP008 F3/F4 prompt restricts candidate memory fields to canonical enums", () => {
  const sectionStart = alignedPrompts.indexOf("#### §F3/F4 · 导演真值选择与状态收束");
  const sectionEnd = alignedPrompts.indexOf("### FP008-03 · 推演放行闸门", sectionStart);
  const convergencePrompt = alignedPrompts.slice(sectionStart, sectionEnd);

  assert.match(convergencePrompt, /memory_type.*只能是.*event.*emotion.*knowledge.*relationship/su);
  assert.match(convergencePrompt, /truth_status.*只能是.*true.*misremembered.*false/su);
});

test("the FP008 F3/F4 system prompt requires an exact dual_spiral_verdict key", async () => {
  const requests = [];
  const invoke = createOpenAiCompatibleModelInvoker({
    resolveCredential: async () => "secret-value",
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return modelResponse({ accepted: true });
    },
  });

  await invoke({
    nodeCode: "NODE_06",
    mode: "director_converge",
    binding: binding(alignedPrompts),
    sessionKey: "director-exact-key-contract",
    continueSession: false,
    input: { particle_id: "p1" },
  });

  const systemPrompt = requests[0].messages[0].content;
  assert.match(systemPrompt, /"dual_spiral_verdict"\s*:/u);
  assert.match(systemPrompt, /顶层键名逐字符自检/u);
  assert.match(systemPrompt, /`dual_spiral_verdict`.*`dual_spiral_verrix`/su);
  assert.match(systemPrompt, /除上述字段外不得输出顶层字段/u);
  assert.match(systemPrompt, /events_in_round|state_diff|alt_paths/u);
});

test("the local resolver reads only the production injection for the approved credential reference", async () => {
  const previousProduction = process.env.FP008_CREDENTIAL_OPENAI_ACCOUNT_V1;
  const previousRelayCove = process.env.FP008_CREDENTIAL_RELAYCOVE_V1;
  const previousTest = process.env.N8N_TEST_MODEL_API_KEY;
  process.env.FP008_CREDENTIAL_OPENAI_ACCOUNT_V1 = "production-secret";
  process.env.FP008_CREDENTIAL_RELAYCOVE_V1 = "relaycove-secret";
  process.env.N8N_TEST_MODEL_API_KEY = "test-only-secret";
  try {
    assert.equal(await resolveCredential("n8n-credential:openai-account-v1"), "production-secret");
    assert.equal(await resolveCredential("n8n-credential:relaycove-v1"), "relaycove-secret");
    await assert.rejects(resolveCredential("n8n-credential:unknown"), /unavailable/i);
  } finally {
    if (previousProduction === undefined) delete process.env.FP008_CREDENTIAL_OPENAI_ACCOUNT_V1;
    else process.env.FP008_CREDENTIAL_OPENAI_ACCOUNT_V1 = previousProduction;
    if (previousRelayCove === undefined) delete process.env.FP008_CREDENTIAL_RELAYCOVE_V1;
    else process.env.FP008_CREDENTIAL_RELAYCOVE_V1 = previousRelayCove;
    if (previousTest === undefined) delete process.env.N8N_TEST_MODEL_API_KEY;
    else process.env.N8N_TEST_MODEL_API_KEY = previousTest;
  }
});

test("the local resolver fails closed when its production credential injection is absent", async () => {
  const previousProduction = process.env.FP008_CREDENTIAL_OPENAI_ACCOUNT_V1;
  const previousTest = process.env.N8N_TEST_MODEL_API_KEY;
  delete process.env.FP008_CREDENTIAL_OPENAI_ACCOUNT_V1;
  process.env.N8N_TEST_MODEL_API_KEY = "test-only-secret";
  try {
    await assert.rejects(resolveCredential("n8n-credential:openai-account-v1"), /unavailable/i);
  } finally {
    if (previousProduction === undefined) delete process.env.FP008_CREDENTIAL_OPENAI_ACCOUNT_V1;
    else process.env.FP008_CREDENTIAL_OPENAI_ACCOUNT_V1 = previousProduction;
    if (previousTest === undefined) delete process.env.N8N_TEST_MODEL_API_KEY;
    else process.env.N8N_TEST_MODEL_API_KEY = previousTest;
  }
});

test("the active RelayCove credential does not require an unused OpenAI deployment secret", async () => {
  const previousProduction = process.env.FP008_CREDENTIAL_OPENAI_ACCOUNT_V1;
  const previousRelayCove = process.env.FP008_CREDENTIAL_RELAYCOVE_V1;
  delete process.env.FP008_CREDENTIAL_OPENAI_ACCOUNT_V1;
  process.env.FP008_CREDENTIAL_RELAYCOVE_V1 = "relaycove-secret";
  try {
    assert.equal(await resolveCredential("n8n-credential:relaycove-v1"), "relaycove-secret");
    await assert.rejects(resolveCredential("n8n-credential:openai-account-v1"), /unavailable/i);
  } finally {
    if (previousProduction === undefined) delete process.env.FP008_CREDENTIAL_OPENAI_ACCOUNT_V1;
    else process.env.FP008_CREDENTIAL_OPENAI_ACCOUNT_V1 = previousProduction;
    if (previousRelayCove === undefined) delete process.env.FP008_CREDENTIAL_RELAYCOVE_V1;
    else process.env.FP008_CREDENTIAL_RELAYCOVE_V1 = previousRelayCove;
  }
});

test("the model adapter keeps only the same director's controlled history", async () => {
  const references = [];
  const requests = [];
  const invoke = createOpenAiCompatibleModelInvoker({
    resolveCredential: async (reference) => {
      references.push(reference);
      return "secret-value";
    },
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init, body: JSON.parse(init.body) });
      return modelResponse({ accepted: requests.length });
    },
  });
  const base = {
    nodeCode: "NODE_06",
    binding: binding(),
    sessionKey: "operator:book:l1a:chapter:version",
    input: { particle_id: "p1" },
  };
  const first = await invoke({ ...base, mode: "director_distribute", continueSession: false });
  const second = await invoke({ ...base, mode: "director_converge", continueSession: true });
  const character = await invoke({
    ...base,
    nodeCode: "NODE_05",
    mode: "character_respond",
    continueSession: false,
  });

  assert.deepEqual(first, { output: { accepted: 1 }, usage: { total_tokens: 11 } });
  assert.deepEqual(second, { output: { accepted: 2 }, usage: { total_tokens: 11 } });
  assert.deepEqual(character, { output: { accepted: 3 }, usage: { total_tokens: 11 } });
  assert.deepEqual(references, ["local-secret-ref:model-v1", "local-secret-ref:model-v1", "local-secret-ref:model-v1"]);
  assert.equal(requests[0].url, "https://provider.example/v1/chat/completions");
  assert.equal(requests[0].init.headers.authorization, "Bearer secret-value");
  assert.equal(requests[0].body.model, "model-v1");
  assert.equal(requests[0].body.temperature, 0.3);
  assert.equal(requests[0].body.max_tokens, 2048);
  assert.equal(requests[0].body.messages.length, 2);
  assert.equal(requests[1].body.messages.length, 4);
  assert.equal(requests[1].body.messages[1].role, "user");
  assert.equal(requests[1].body.messages[2].role, "assistant");
  assert.match(requests[1].body.messages[2].content, /accepted":1/u);
  assert.equal(requests[2].body.messages.length, 2);
  assert.match(requests[0].body.messages.at(-1).content, /char_tasks/u);
  assert.match(requests[0].body.messages.at(-1).content, /does not contain full role settings/u);
  assert.match(requests[0].body.messages.at(-1).content, /non-protagonist task must include staged_goal_injected/u);
  assert.match(requests[0].body.messages.at(-1).content, /protagonist task must not populate staged_goal_injected/u);
  assert.match(requests[1].body.messages.at(-1).content, /director convergence result/u);
  assert.match(requests[1].body.messages.at(-1).content, /selected event's participating characters/u);
  assert.match(requests[1].body.messages.at(-1).content, /selected events_in_round/u);
  assert.match(requests[1].body.messages.at(-1).content, /unselected candidate action/u);
  assert.match(requests[1].body.messages.at(-1).content, /all eight live-state keys/u);
  assert.match(requests[1].body.messages.at(-1).content, /trigger_state_json/u);
  assert.doesNotMatch(JSON.stringify(requests[2].body), /accepted":1/u);
  assert.doesNotMatch(JSON.stringify(requests[0].body), /secret-value|local-secret-ref/);
});

test("the model adapter emits one sanitized usage event for each successful provider call", async () => {
  const events = [];
  const requests = [];
  const invoke = createOpenAiCompatibleModelInvoker({
    resolveCredential: async () => "secret-value",
    onUsage: (event) => events.push(event),
    fetchImpl: async (_url, init) => {
      requests.push(init.body);
      return modelResponse(
        { result: "model-output-sentinel" },
        12,
        { prompt_tokens: 7, completion_tokens: 5 },
      );
    },
  });

  await invoke({
    nodeCode: "NODE_06",
    mode: "director_distribute",
    binding: binding("prompt-sentinel"),
    sessionKey: "usage-audit-session",
    continueSession: false,
    input: { business_input: "business-input-sentinel" },
  });

  assert.deepEqual(events, [{
    nodeCode: "NODE_06",
    mode: "director_distribute",
    prompt_tokens: 7,
    completion_tokens: 5,
    total_tokens: 12,
    request_body_bytes: new TextEncoder().encode(requests[0]).byteLength,
  }]);
  assert.doesNotMatch(JSON.stringify(events), /secret-value|local-secret-ref|provider\.example|model-v1|prompt-sentinel|business-input-sentinel|model-output-sentinel/u);
});

test("the adapter retries a reset connection within its bounded safe provider contract", async () => {
  const events = [];
  const delays = [];
  let calls = 0;
  const invoke = createOpenAiCompatibleModelInvoker({
    resolveCredential: async () => "secret-value",
    onAttempt: (event) => events.push(event),
    providerRetryDelayImpl: async (attempt, reason) => { delays.push({ attempt, reason }); },
    fetchImpl: async () => {
      calls += 1;
      const error = new Error("provider-message-sentinel");
      error.code = "ECONNRESET";
      throw error;
    },
  });

  await assert.rejects(
    invoke({
      nodeCode: "NODE_05",
      mode: "character_respond",
      binding: { ...binding("prompt-sentinel"), node_code: "NODE_05" },
      sessionKey: "transport-diagnostic",
      continueSession: false,
      input: { business_input: "business-input-sentinel" },
    }),
    (error) => {
      assert.equal(error?.code, "MODEL_PROVIDER_UNAVAILABLE");
      assert.equal(error?.statusCode, 503);
      assert.deepEqual(error?.diagnostics, {
        provider_status: null,
        model_node_code: "NODE_05",
        model_phase: "character_respond",
        transport_category: "connection_reset",
      });
      return true;
    },
  );

  assert.equal(calls, 3);
  assert.deepEqual(delays, [
    { attempt: 0, reason: "transport" },
    { attempt: 1, reason: "transport" },
  ]);
  assert.deepEqual(events.map((event) => ({
    source: event.source,
    call_id: event.call_id,
    nodeCode: event.nodeCode,
    mode: event.mode,
    provider_attempt: event.provider_attempt,
    outcome: event.outcome,
    http_status: event.http_status,
    transport_category: event.transport_category,
    retry_scheduled: event.retry_scheduled,
    total_tokens: event.total_tokens,
    timeout_ms: event.timeout_ms,
    elapsed_ms: event.elapsed_ms,
  })), [
    { source: "provider", call_id: 1, nodeCode: "NODE_05", mode: "character_respond", provider_attempt: 1, outcome: "transport_error", http_status: null, transport_category: "connection_reset", retry_scheduled: true, total_tokens: null, timeout_ms: 5000, elapsed_ms: events[0].elapsed_ms },
    { source: "provider", call_id: 1, nodeCode: "NODE_05", mode: "character_respond", provider_attempt: 2, outcome: "transport_error", http_status: null, transport_category: "connection_reset", retry_scheduled: true, total_tokens: null, timeout_ms: 5000, elapsed_ms: events[1].elapsed_ms },
    { source: "provider", call_id: 1, nodeCode: "NODE_05", mode: "character_respond", provider_attempt: 3, outcome: "transport_error", http_status: null, transport_category: "connection_reset", retry_scheduled: false, total_tokens: null, timeout_ms: 5000, elapsed_ms: events[2].elapsed_ms },
  ]);
  assert.ok(events.every((event) => Number.isSafeInteger(event.elapsed_ms) && event.elapsed_ms >= 0));
  assert.ok(events[0].request_body_bytes > 0);
  assert.doesNotMatch(JSON.stringify(events), /secret-value|provider-message-sentinel|prompt-sentinel|business-input-sentinel|provider\.example|model-v1/u);
});

test("the adapter emits bounded safe diagnostics for each transient HTTP retry", async () => {
  const events = [];
  let calls = 0;
  const invoke = createOpenAiCompatibleModelInvoker({
    resolveCredential: async () => "secret-value",
    onAttempt: (event) => events.push(event),
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { message: "provider-message-sentinel" } }), { status: 503 });
    },
  });

  await assert.rejects(
    invoke({
      nodeCode: "NODE_06",
      mode: "director_converge",
      binding: binding("prompt-sentinel"),
      sessionKey: "retry-diagnostic",
      continueSession: false,
      input: { business_input: "business-input-sentinel" },
    }),
    (error) => error?.code === "MODEL_PROVIDER_REJECTED",
  );

  assert.equal(calls, 3);
  assert.deepEqual(events.map((event) => ({
    source: event.source,
    nodeCode: event.nodeCode,
    mode: event.mode,
    provider_attempt: event.provider_attempt,
    outcome: event.outcome,
    http_status: event.http_status,
    transport_category: event.transport_category,
    retry_scheduled: event.retry_scheduled,
    total_tokens: event.total_tokens,
  })), [
    { source: "provider", nodeCode: "NODE_06", mode: "director_converge", provider_attempt: 1, outcome: "http_error", http_status: 503, transport_category: null, retry_scheduled: true, total_tokens: null },
    { source: "provider", nodeCode: "NODE_06", mode: "director_converge", provider_attempt: 2, outcome: "http_error", http_status: 503, transport_category: null, retry_scheduled: true, total_tokens: null },
    { source: "provider", nodeCode: "NODE_06", mode: "director_converge", provider_attempt: 3, outcome: "http_error", http_status: 503, transport_category: null, retry_scheduled: false, total_tokens: null },
  ]);
  assert.doesNotMatch(JSON.stringify(events), /secret-value|provider-message-sentinel|prompt-sentinel|business-input-sentinel|provider\.example|model-v1/u);
});

test("the diagnostic logger forwards only an explicit safe field whitelist", () => {
  const lines = [];
  const log = createFp008DiagnosticLogger({ enabled: true, write: (line) => lines.push(line) });
  log({
    source: "provider",
    nodeCode: "NODE_05",
    mode: "character_respond",
    provider_attempt: 2,
    outcome: "transport_error",
    http_status: null,
    transport_category: "connection_reset",
    retry_scheduled: true,
    request_body_bytes: 321,
    total_tokens: null,
    api_key_ref: "credential-sentinel",
    provider_base_url: "https://provider-sentinel.example",
    prompt_text: "prompt-sentinel",
    user_input: "business-input-sentinel",
    output: "model-output-sentinel",
  });

  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), {
    event: "fp008_model_diagnostic",
    source: "provider",
    call_id: null,
    nodeCode: "NODE_05",
    mode: "character_respond",
    provider_attempt: 2,
    outcome: "transport_error",
    http_status: null,
    transport_category: "connection_reset",
    retry_scheduled: true,
    request_body_bytes: 321,
    total_tokens: null,
    timeout_ms: null,
    elapsed_ms: null,
  });
  assert.doesNotMatch(lines[0], /credential-sentinel|provider-sentinel|prompt-sentinel|business-input-sentinel|model-output-sentinel/u);
});

test("the diagnostic request observer exposes one node prompt for isolated model tests", async () => {
  const requests = [];
  const invoke = createOpenAiCompatibleModelInvoker({
    resolveCredential: async () => "secret-value",
    onRequest: (event) => requests.push(event),
    fetchImpl: async () => modelResponse({ accepted: true }, 11),
  });

  await invoke({
    nodeCode: "NODE_05",
    mode: "character_respond",
    binding: { ...binding("prompt-sentinel"), node_code: "NODE_05" },
    sessionKey: "request-observer-session",
    continueSession: false,
    input: { particle_id: "p1", character: { char_code: "P001" } },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].nodeCode, "NODE_05");
  assert.equal(requests[0].call_id, 1);
  assert.equal(requests[0].mode, "character_respond");
  assert.equal(requests[0].system_prompt, "prompt-sentinel");
  assert.match(requests[0].user_input, /character_respond/u);
  assert.equal(requests[0].message_count, 2);
  assert.equal(requests[0].max_tokens, 2048);
  assert.equal(requests[0].timeout_ms, 5000);
  assert.equal(requests[0].elapsed_ms, 0);
  assert.ok(requests[0].request_body_bytes > 0);
});

test("usage audit treats missing details as null and cannot affect a model result", async () => {
  const events = [];
  const invoke = createOpenAiCompatibleModelInvoker({
    resolveCredential: async () => "secret-value",
    onUsage: (event) => {
      events.push(event);
      throw new Error("observer unavailable");
    },
    fetchImpl: async () => modelResponse({ accepted: true }, 11),
  });

  const reply = await invoke({
    nodeCode: "NODE_05",
    mode: "character_respond",
    binding: { ...binding(), node_code: "NODE_05" },
    sessionKey: "usage-audit-observer-error",
    continueSession: false,
    input: { particle_id: "p1" },
  });

  assert.deepEqual(reply, { output: { accepted: true }, usage: { total_tokens: 11 } });
  assert.deepEqual(events, [{
    nodeCode: "NODE_05",
    mode: "character_respond",
    prompt_tokens: null,
    completion_tokens: null,
    total_tokens: 11,
    request_body_bytes: events[0].request_body_bytes,
  }]);
  assert.ok(events[0].request_body_bytes > 0);
});

test("the model adapter estimates its full next request and bounds an unconfigured completion", async () => {
  const requests = [];
  const invoke = createOpenAiCompatibleModelInvoker({
    resolveCredential: async () => "secret-value",
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return modelResponse({ accepted: requests.length });
    },
  });
  const base = {
    nodeCode: "NODE_06",
    mode: "director_distribute",
    binding: { ...binding(), parameters_jsonb: { timeout_ms: 5000 } },
    sessionKey: "budgeted-director-session",
    continueSession: false,
    input: { particle_id: "p1" },
  };

  const firstEstimate = invoke.estimateTokenUsage(base);
  await invoke(base);
  const firstBodyBytes = new TextEncoder().encode(JSON.stringify(requests[0])).byteLength;
  assert.equal(
    firstEstimate,
    Math.ceil(firstBodyBytes / 4) + requests[0].max_tokens,
    "budget estimates must conservatively convert UTF-8 bytes to tokens",
  );
  const secondEstimate = invoke.estimateTokenUsage({
    ...base,
    mode: "director_converge",
    continueSession: true,
  });

  assert.equal(requests[0].max_tokens, 32000);
  assert.ok(firstEstimate > 32000);
  assert.ok(secondEstimate > firstEstimate, "the reserve must include the retained director history");
});

test("the default runtime adapter uses a bounded Node HTTPS transport", async () => {
  const requests = [];
  const invoke = createOpenAiCompatibleModelInvoker({
    resolveCredential: async () => "secret-value",
    httpsRequestImpl: async (url, init, timeoutMs) => {
      requests.push({ url: String(url), init, timeoutMs, body: JSON.parse(init.body) });
      return modelResponse({ accepted: true });
    },
  });

  const reply = await invoke({
    nodeCode: "NODE_06",
    mode: "director_distribute",
    binding: binding(),
    sessionKey: "native-transport-session",
    continueSession: false,
    input: { particle_id: "p1" },
  });

  assert.deepEqual(reply, { output: { accepted: true }, usage: { total_tokens: 11 } });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://provider.example/v1/chat/completions");
  assert.equal(requests[0].timeoutMs, 5000);
  assert.equal(requests[0].init.headers.authorization, "Bearer secret-value");
  assert.equal(requests[0].body.response_format, undefined);
});

test("a provider response that keeps streaming past timeout_ms fails on the wall clock", async () => {
  let interval;
  const invoke = createOpenAiCompatibleModelInvoker({
    resolveCredential: async () => "secret-value",
    fetchImpl: async () => new Response(new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode("{"));
        interval = setInterval(() => controller.enqueue(encoder.encode(" ")), 5);
      },
    }), { status: 200 }),
  });
  const startedAt = Date.now();

  await assert.rejects(
    invoke({
      nodeCode: "NODE_06",
      mode: "director_converge",
      binding: { ...binding(), parameters_jsonb: { timeout_ms: 1000 } },
      sessionKey: "streaming-timeout",
      continueSession: false,
      input: {},
    }),
    (error) => error?.message === "MODEL_REQUEST_TIMEOUT",
  );
  clearInterval(interval);
  assert.ok(Date.now() - startedAt < 2000, "the adapter must enforce an absolute response deadline");
});

test("the Node HTTPS transport destroys a response stream that exceeds its deadline", async () => {
  let interval;
  let requestDestroyed = false;
  let responseDestroyed = false;
  const response = {
    statusCode: 200,
    setEncoding() {},
    on(event, listener) {
      if (event === "data") interval = setInterval(() => listener(" "), 5);
      if (event === "error") this.errorListener = listener;
      if (event === "end") this.endListener = listener;
      return this;
    },
    once(event, listener) {
      return this.on(event, listener);
    },
    destroy(error) {
      responseDestroyed = true;
      clearInterval(interval);
      this.errorListener?.(error);
    },
  };
  const request = {
    once() { return this; },
    setTimeout() { return this; },
    end() {},
    destroy() { requestDestroyed = true; },
  };
  const startedAt = Date.now();
  await assert.rejects(
    requestWithNodeHttps(
      new URL("https://provider.example/v1/chat/completions"),
      { method: "POST", headers: {}, body: "{}" },
      40,
      ((_url, _options, callback) => {
        queueMicrotask(() => callback(response));
        return request;
      }),
    ),
    (error) => error?.message === "MODEL_REQUEST_TIMEOUT",
  );
  assert.equal(requestDestroyed, true);
  assert.equal(responseDestroyed, true);
  assert.ok(Date.now() - startedAt < 500);
});

test("a director convergence request leaves JSON parsing to the local adapter", async () => {
  const requests = [];
  const invoke = createOpenAiCompatibleModelInvoker({
    resolveCredential: async () => "secret-value",
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return modelResponse({ accepted: true });
    },
  });

  await invoke({
    nodeCode: "NODE_06",
    mode: "director_converge",
    binding: binding(),
    sessionKey: "director-convergence-schema",
    continueSession: false,
    input: { particle_id: "p1" },
  });

  assert.equal(requests[0].response_format, undefined);
});

test("a character F2 request leaves JSON parsing to the local adapter", async () => {
  const requests = [];
  const invoke = createOpenAiCompatibleModelInvoker({
    resolveCredential: async () => "secret-value",
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return modelResponse({ accepted: true });
    },
  });

  await invoke({
    nodeCode: "NODE_05",
    mode: "character_respond",
    binding: { ...binding(), node_code: "NODE_05" },
    sessionKey: "character-result-schema",
    continueSession: false,
    input: { particle_id: "p1" },
  });

  assert.equal(requests[0].response_format, undefined);
});

test("a new director attempt clears the same session key", async () => {
  const requests = [];
  const invoke = createOpenAiCompatibleModelInvoker({
    resolveCredential: async () => "secret-value",
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return modelResponse({ accepted: requests.length });
    },
  });
  const base = {
    nodeCode: "NODE_06",
    mode: "director_distribute",
    binding: binding(),
    input: { particle_id: "p1" },
  };

  const sessionKey = "operator:book:l1a:chapter:version";
  await invoke({ ...base, sessionKey, continueSession: false });
  await invoke({ ...base, sessionKey, continueSession: true });
  await invoke({ ...base, sessionKey, continueSession: false });

  assert.equal(requests[0].messages.length, 2);
  assert.equal(requests[1].messages.length, 4);
  assert.equal(requests[2].messages.length, 2);
  assert.doesNotMatch(JSON.stringify(requests[2].messages), /accepted":1|accepted":2/u);
});

test("the FP008 adapter scopes marked prompt material to the invoking role", async () => {
  const requests = [];
  const invoke = createOpenAiCompatibleModelInvoker({
    resolveCredential: async () => "secret-value",
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return modelResponse({ accepted: requests.length });
    },
  });
  const markedPrompt = [
    "**运行时模式分发**：MODE_DISPATCH",
    "**what**：ignored runtime overview",
    "#### §F1 · 导演信息发放",
    "F1_ONLY",
    "#### §F2 · 角色推演",
    "F2_ONLY",
    "#### §F3/F4 · 导演收束",
    "F3_ONLY",
    "#### §F5 · 后端组装",
    "F5_ONLY",
  ].join("\n");

  await invoke({
    nodeCode: "NODE_06",
    mode: "director_distribute",
    binding: binding(markedPrompt),
    sessionKey: "director-session",
    continueSession: false,
    input: {},
  });
  await invoke({
    nodeCode: "NODE_05",
    mode: "character_respond",
    binding: { ...binding(markedPrompt), node_code: "NODE_05" },
    sessionKey: "character-session",
    continueSession: false,
    input: {},
  });

  const directorPrompt = requests[0].messages[0].content;
  const characterPrompt = requests[1].messages[0].content;
  assert.match(directorPrompt, /MODE_DISPATCH|F1_ONLY|F3_ONLY/u);
  assert.doesNotMatch(directorPrompt, /F2_ONLY|F5_ONLY/u);
  assert.match(characterPrompt, /MODE_DISPATCH|F2_ONLY/u);
  assert.doesNotMatch(characterPrompt, /F1_ONLY|F3_ONLY|F5_ONLY/u);
});

test("JSON repair accepts BOM, fenced JSON, and one object surrounded by prose", async () => {
  for (const content of [
    "\uFEFF{\"accepted\":true}",
    "```json\n{\"accepted\":true}\n```",
    "Here is the result: {\"accepted\":true} -- end.",
  ]) {
    const invoke = createOpenAiCompatibleModelInvoker({
      resolveCredential: async () => "secret-value",
      fetchImpl: async () => rawModelResponse(content),
    });
    const reply = await invoke({
      nodeCode: "NODE_06",
      mode: "director_distribute",
      binding: binding(),
      sessionKey: `repair-${content.slice(0, 4)}`,
      continueSession: false,
      input: {},
    });
    assert.deepEqual(reply.output, { accepted: true });
  }
});

test("JSON repair accepts one complete root with a repairable syntax error", async () => {
  for (const [index, content] of [
    'Result: {"accepted":true,}',
    "Result: {'accepted':true,}",
    "Result: {accepted:true,}",
  ].entries()) {
    const invoke = createOpenAiCompatibleModelInvoker({
      resolveCredential: async () => "secret-value",
      fetchImpl: async () => rawModelResponse(content),
    });

    const reply = await invoke({
      nodeCode: "NODE_06",
      mode: "director_distribute",
      binding: binding(),
      sessionKey: `repairable-complete-root-${index}`,
      continueSession: false,
      input: {},
    });

    assert.deepEqual(reply.output, { accepted: true });
  }
});

test("JSON repair rejects truncated and multiple top-level values without merging them", async () => {
  for (const content of [
    "Here is the result: {\"accepted\":true",
    "{\"accepted\":true,\"nested\":{\"ok\":true}",
    "{\"accepted\":true}\n{\"other\":false}",
  ]) {
    const invoke = createOpenAiCompatibleModelInvoker({
      resolveCredential: async () => "secret-value",
      fetchImpl: async () => rawModelResponse(content),
    });
    await assert.rejects(
      invoke({
        nodeCode: "NODE_06",
        mode: "director_distribute",
        binding: binding(),
        sessionKey: `invalid-${content.slice(0, 4)}`,
        continueSession: false,
        input: {},
      }),
      (error) => error.code === "MODEL_OUTPUT_INVALID",
    );
  }
});

test("truncated model JSON preserves only sanitized provider diagnostics", async () => {
  let requestBody;
  const responseContent = '{"accepted":true,"nested":{"ok":true}';
  const invoke = createOpenAiCompatibleModelInvoker({
    resolveCredential: async () => "secret-value",
    fetchImpl: async (_url, init) => {
      requestBody = init.body;
      return new Response(JSON.stringify({
        choices: [{
          finish_reason: "length",
          message: { content: responseContent },
        }],
        usage: { prompt_tokens: 101, completion_tokens: 202, total_tokens: 303 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  await assert.rejects(
    invoke({
      nodeCode: "NODE_05",
      mode: "character_respond",
      binding: { ...binding(), node_code: "NODE_05", prompt_text: "prompt-sentinel" },
      sessionKey: "truncated-diagnostics",
      continueSession: false,
      input: { business_input: "business-input-sentinel" },
    }),
      (error) => {
        assert.equal(error.code, "MODEL_OUTPUT_INVALID");
        assert.equal(error.statusCode, 502);
        assert.equal(error.retryable, true);
        assert.deepEqual(error.diagnostics, {
        provider_status: 200,
        provider_error_code: null,
        provider_error_type: null,
        model_node_code: "NODE_05",
        model_phase: "character_respond",
        has_choices: true,
        has_usage: true,
        usage_keys: ["completion_tokens", "prompt_tokens", "total_tokens"],
        provider_finish_reason: "length",
        provider_prompt_tokens: 101,
        provider_completion_tokens: 202,
        provider_total_tokens: 303,
        response_content_bytes: new TextEncoder().encode(responseContent).byteLength,
        request_body_bytes: new TextEncoder().encode(requestBody).byteLength,
      });
      assert.doesNotMatch(JSON.stringify(error), /secret-value|provider\.example|model-v1|prompt-sentinel|business-input-sentinel|accepted|nested/u);
      return true;
    },
  );
});

test("non-JSON content and unresolved credential references fail without leaking secrets", async () => {
  const delays = [];
  const invalidJson = createOpenAiCompatibleModelInvoker({
    resolveCredential: async () => "secret-value",
    providerRetryDelayImpl: async (attempt, reason) => { delays.push({ attempt, reason }); },
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{ message: { content: "not JSON at all" } }],
      usage: { total_tokens: 5 },
    }), { status: 200 }),
  });
  await assert.rejects(
    invalidJson({
      nodeCode: "NODE_05",
      mode: "character_respond",
      binding: { ...binding(), node_code: "NODE_05" },
      sessionKey: "isolated-character",
      continueSession: false,
      input: {},
    }),
    (error) => error.code === "MODEL_OUTPUT_INVALID" && !error.message.includes("secret-value"),
  );
  assert.deepEqual(delays, [], "invalid model JSON must not use transport backoff");

  const missingCredential = createOpenAiCompatibleModelInvoker({
    resolveCredential: async () => { throw new Error("secret backend detail"); },
    fetchImpl: async () => { throw new Error("must not call provider"); },
  });
  await assert.rejects(
    missingCredential({
      nodeCode: "NODE_05",
      mode: "character_respond",
      binding: { ...binding(), node_code: "NODE_05" },
      sessionKey: "isolated-character",
      continueSession: false,
      input: {},
    }),
    (error) => error.code === "MODEL_CREDENTIAL_UNAVAILABLE" && !error.message.includes("backend detail"),
  );
});

test("a rejected provider response exposes only safe protocol diagnostics", async () => {
  let calls = 0;
  let requestBody;
  const invoke = createOpenAiCompatibleModelInvoker({
    resolveCredential: async () => "secret-value",
    fetchImpl: async (_url, init) => {
      calls += 1;
      requestBody = JSON.parse(init.body);
      return new Response(JSON.stringify({
        error: {
          code: "unsupported_response_format",
          type: "invalid_request_error",
          message: "The request included a private diagnostic that must not leave the adapter.",
        },
        choices: [],
        usage: { total_tokens: 0 },
      }), { status: 400 });
    },
  });

  await assert.rejects(
    invoke({
      nodeCode: "NODE_05",
      mode: "character_respond",
      binding: { ...binding(), node_code: "NODE_05" },
      sessionKey: "provider-rejection",
      continueSession: false,
      input: {},
    }),
    (error) => {
      assert.equal(error.code, "MODEL_PROVIDER_REJECTED");
      assert.equal(error.statusCode, 502);
      assert.deepEqual(error.diagnostics, {
        provider_status: 400,
        provider_error_code: "unsupported_response_format",
        provider_error_type: "invalid_request_error",
        model_node_code: "NODE_05",
        model_phase: "character_respond",
        has_choices: true,
        has_usage: true,
        usage_keys: ["total_tokens"],
      });
      assert.doesNotMatch(JSON.stringify(error), /secret-value|private diagnostic/u);
      return true;
    },
  );
  assert.equal(calls, 1, "request and credential failures must not retry");
  assert.equal(requestBody.response_format, undefined, "unsupported provider response_format must not be sent");
});

test("transient provider responses retry within one FP008 model invocation", async () => {
  for (const status of [429, 502, 503, 504]) {
    let calls = 0;
    const invoke = createOpenAiCompatibleModelInvoker({
      resolveCredential: async () => "secret-value",
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          return new Response(JSON.stringify({ error: { type: "upstream_error" } }), { status });
        }
        return modelResponse({ recovered_from: status });
      },
    });

    const result = await invoke({
      nodeCode: "NODE_06",
      mode: "director_distribute",
      binding: binding(),
      sessionKey: `transient-${status}`,
      continueSession: false,
      input: {},
    });

    assert.deepEqual(result, { output: { recovered_from: status }, usage: { total_tokens: 11 } });
    assert.equal(calls, 2, `HTTP ${status} must receive one bounded retry`);
  }
});

test("a transient transport error retries once with an injected provider delay", async () => {
  const attempts = [];
  const delays = [];
  let calls = 0;
  const invoke = createOpenAiCompatibleModelInvoker({
    resolveCredential: async () => "secret-value",
    onAttempt: (event) => attempts.push(event),
    providerRetryDelayImpl: async (attempt, reason) => { delays.push({ attempt, reason }); },
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        const error = new Error("private upstream timeout");
        error.code = "ETIMEDOUT";
        throw error;
      }
      return modelResponse({ recovered: true });
    },
  });

  const result = await invoke({
    nodeCode: "NODE_06",
    mode: "director_distribute",
    binding: binding(),
    sessionKey: "transient-transport",
    continueSession: false,
    input: {},
  });

  assert.deepEqual(result, { output: { recovered: true }, usage: { total_tokens: 11 } });
  assert.equal(calls, 2);
  assert.deepEqual(delays, [{ attempt: 0, reason: "transport" }]);
  assert.deepEqual(attempts.map((attempt) => ({
    provider_attempt: attempt.provider_attempt,
    outcome: attempt.outcome,
    http_status: attempt.http_status,
    transport_category: attempt.transport_category,
    retry_scheduled: attempt.retry_scheduled,
  })), [
    { provider_attempt: 1, outcome: "transport_error", http_status: null, transport_category: "timeout", retry_scheduled: true },
    { provider_attempt: 2, outcome: "success", http_status: 200, transport_category: null, retry_scheduled: false },
  ]);
  assert.doesNotMatch(JSON.stringify(attempts), /private upstream timeout|secret-value/u);
});

test("persistent transport failures stop at the provider retry bound with a safe code", async () => {
  const delays = [];
  let calls = 0;
  const invoke = createOpenAiCompatibleModelInvoker({
    resolveCredential: async () => "secret-value",
    providerRetryDelayImpl: async (attempt, reason) => { delays.push({ attempt, reason }); },
    fetchImpl: async () => {
      calls += 1;
      const error = new Error("private timeout detail");
      error.code = "ETIMEDOUT";
      throw error;
    },
  });

  await assert.rejects(
    invoke({
      nodeCode: "NODE_05",
      mode: "character_respond",
      binding: { ...binding(), node_code: "NODE_05" },
      sessionKey: "persistent-transport",
      continueSession: false,
      input: {},
    }),
    (error) => {
      assert.equal(error.code, "MODEL_PROVIDER_TIMEOUT");
      assert.equal(error.statusCode, 503);
      assert.deepEqual(error.diagnostics, {
        provider_status: null,
        model_node_code: "NODE_05",
        model_phase: "character_respond",
        transport_category: "timeout",
      });
      assert.doesNotMatch(JSON.stringify(error), /private timeout detail|secret-value/u);
      return true;
    },
  );
  assert.equal(calls, 3);
  assert.deepEqual(delays, [
    { attempt: 0, reason: "transport" },
    { attempt: 1, reason: "transport" },
  ]);
});

test("a persistent transient provider response stops after the configured retry bound", async () => {
  let calls = 0;
  const invoke = createOpenAiCompatibleModelInvoker({
    resolveCredential: async () => "secret-value",
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { type: "upstream_error" } }), { status: 503 });
    },
  });

  await assert.rejects(
    invoke({
      nodeCode: "NODE_06",
      mode: "director_distribute",
      binding: binding(),
      sessionKey: "persistent-transient-provider",
      continueSession: false,
      input: {},
    }),
    (error) => error.code === "MODEL_PROVIDER_REJECTED" && error.diagnostics?.provider_status === 503,
  );
  assert.equal(calls, 3, "the adapter must stop after three provider attempts");
});

test("a successful-status response without usage retries in the provider contract then fails closed", async () => {
  const attempts = [];
  const delays = [];
  let calls = 0;
  const invoke = createOpenAiCompatibleModelInvoker({
    resolveCredential: async () => "secret-value",
    onAttempt: (event) => attempts.push(event),
    providerRetryDelayImpl: async (attempt, reason) => { delays.push({ attempt, reason }); },
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({
        choices: [{ message: { content: "{}" } }],
        usage: { prompt_tokens: 12, hidden_provider_note: "must not be exposed" },
      }), { status: 200 });
    },
  });

  await assert.rejects(
    invoke({
      nodeCode: "NODE_06",
      mode: "director_converge",
      binding: binding(),
      sessionKey: "missing-usage",
      continueSession: false,
      input: {},
    }),
    (error) => {
      assert.equal(error.code, "MODEL_USAGE_MISSING");
      assert.equal(error.statusCode, 502);
      assert.equal(error.retryable, false);
      assert.deepEqual(error.diagnostics, {
        provider_status: 200,
        provider_error_code: null,
        provider_error_type: null,
        model_node_code: "NODE_06",
        model_phase: "director_converge",
        has_choices: true,
        has_usage: true,
        usage_keys: ["hidden_provider_note", "prompt_tokens"],
      });
      assert.doesNotMatch(JSON.stringify(error), /secret-value|must not be exposed/u);
      return true;
    },
  );
  assert.equal(calls, 3, "missing usage must retry inside one provider request contract");
  assert.deepEqual(attempts.map((attempt) => ({
    provider_attempt: attempt.provider_attempt,
    outcome: attempt.outcome,
    http_status: attempt.http_status,
    retry_scheduled: attempt.retry_scheduled,
    total_tokens: attempt.total_tokens,
  })), [
    { provider_attempt: 1, outcome: "usage_missing", http_status: 200, retry_scheduled: true, total_tokens: null },
    { provider_attempt: 2, outcome: "usage_missing", http_status: 200, retry_scheduled: true, total_tokens: null },
    { provider_attempt: 3, outcome: "usage_missing", http_status: 200, retry_scheduled: false, total_tokens: null },
  ]);
  assert.deepEqual(delays, [
    { attempt: 0, reason: "usage_missing" },
    { attempt: 1, reason: "usage_missing" },
  ]);
  assert.doesNotMatch(JSON.stringify(attempts), /secret-value|must not be exposed/u);
});

test("a provider retry after missing usage charges only the later returned usage", async () => {
  const usageEvents = [];
  const delays = [];
  let calls = 0;
  const invoke = createOpenAiCompatibleModelInvoker({
    resolveCredential: async () => "secret-value",
    onUsage: (event) => usageEvents.push(event),
    providerRetryDelayImpl: async (attempt, reason) => { delays.push({ attempt, reason }); },
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: "{}" } }],
          usage: { prompt_tokens: 12 },
        }), { status: 200 });
      }
      return modelResponse({ recovered: true }, 17, { prompt_tokens: 12, completion_tokens: 5 });
    },
  });

  const result = await invoke({
    nodeCode: "NODE_06",
    mode: "director_converge",
    binding: binding(),
    sessionKey: "missing-usage-recovered",
    continueSession: false,
    input: {},
  });

  assert.equal(calls, 2);
  assert.deepEqual(result, { output: { recovered: true }, usage: { total_tokens: 17 } });
  assert.equal(usageEvents.length, 1);
  assert.equal(usageEvents[0].total_tokens, 17);
  assert.deepEqual(delays, [{ attempt: 0, reason: "usage_missing" }]);
});

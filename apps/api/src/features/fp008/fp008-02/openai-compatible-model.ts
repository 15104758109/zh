import { request as httpsRequest } from "node:https";
import { jsonrepair } from "jsonrepair";

import {
  DeductionServiceError,
  FP008_DEFAULT_MODEL_MAX_TOKENS,
  type ModelInvocation,
  type ModelInvoker,
  type ModelReply,
} from "./engine.ts";

type JsonObject = Record<string, unknown>;
type CredentialResolver = (apiKeyRef: string) => Promise<string>;
type DirectorMessage = Readonly<{ role: "user" | "assistant"; content: string }>;
type UsageObserver = (event: Readonly<{
  nodeCode: ModelInvocation["nodeCode"];
  mode: ModelInvocation["mode"];
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  request_body_bytes: number;
}>) => void;
type RequestObserver = (event: Readonly<{
  call_id: number;
  nodeCode: ModelInvocation["nodeCode"];
  mode: ModelInvocation["mode"];
  system_prompt: string;
  user_input: string;
  message_count: number;
  max_tokens: number;
  request_body_bytes: number;
  timeout_ms: number;
  elapsed_ms: number;
}>) => void;
export type ProviderAttemptObserver = (event: Readonly<{
  source: "provider";
  call_id: number;
  nodeCode: ModelInvocation["nodeCode"];
  mode: ModelInvocation["mode"];
  provider_attempt: number;
  outcome: "http_error" | "transport_error" | "usage_missing" | "output_invalid" | "success";
  http_status: number | null;
  transport_category: "timeout" | "connection_reset" | "connection_refused" | "dns" | "network" | "other" | null;
  retry_scheduled: boolean;
  request_body_bytes: number;
  total_tokens: number | null;
  timeout_ms: number;
  elapsed_ms: number;
}>) => void;
type NodeHttpsRequestInit = Readonly<{
  method: "POST";
  headers: Record<string, string>;
  body: string;
}>;
type NodeHttpsRequestImpl = (url: URL, init: NodeHttpsRequestInit, timeoutMs: number) => Promise<Response>;
const TRANSIENT_PROVIDER_STATUSES = new Set([429, 502, 503, 504]);
const MAX_PROVIDER_ATTEMPTS = 3;
const LIVE_STATE_KEYS = [
  "philosophy_live_json", "emotion_state_json", "drive_live_json", "trigger_state_json",
  "goal_state_json", "pressure_level", "current_goal_txt", "current_emo_tag",
] as const;
const RELATION_SNAPSHOT_KEYS = [
  "trust", "intimacy", "power_balance", "dependence", "hostility", "common_goal",
  "secret_known", "emotional_bond", "relation_type", "relation_hierarchy", "relation_origin",
  "relation_overview", "change_event_json",
] as const;

function transportCategory(error: unknown): "timeout" | "connection_reset" | "connection_refused" | "dns" | "network" | "other" {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : "";
  if (code === "ECONNRESET") return "connection_reset";
  if (code === "ECONNREFUSED") return "connection_refused";
  if (["ENOTFOUND", "EAI_AGAIN"].includes(code)) return "dns";
  if (["ETIMEDOUT", "ECONNABORTED"].includes(code) || message === "MODEL_REQUEST_TIMEOUT") return "timeout";
  if (["ENETUNREACH", "EHOSTUNREACH", "EPIPE"].includes(code)) return "network";
  return "other";
}

function observeAttempt(observer: ProviderAttemptObserver | undefined, event: Parameters<ProviderAttemptObserver>[0]): void {
  try {
    observer?.(event);
  } catch {
    // Diagnostics must never affect a provider call.
  }
}

function safeUsageToken(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function object(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function completionsUrl(baseValue: unknown): URL {
  const base = new URL(String(baseValue));
  const path = base.pathname.replace(/\/+$/, "");
  base.pathname = path.endsWith("/chat/completions") ? path : `${path}/chat/completions`;
  base.search = "";
  base.hash = "";
  return base;
}

function optionalNumber(value: unknown, minimum: number, maximum: number): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : undefined;
}

function safeProviderToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return /^[A-Za-z0-9_.:-]{1,100}$/.test(normalized) ? normalized : null;
}

function safeProviderKeys(value: unknown): string[] {
  const source = object(value);
  return Object.keys(source ?? {})
    .filter((key) => safeProviderToken(key) !== null)
    .sort()
    .slice(0, 20);
}

function providerDiagnostics(status: number, payload: JsonObject | null, invocation: ModelInvocation) {
  const providerError = object(payload?.error);
  return {
    provider_status: status,
    provider_error_code: safeProviderToken(providerError?.code),
    provider_error_type: safeProviderToken(providerError?.type),
    model_node_code: invocation.nodeCode,
    model_phase: invocation.mode,
    has_choices: Array.isArray(payload?.choices),
    has_usage: object(payload?.usage) !== null,
    usage_keys: safeProviderKeys(payload?.usage),
  };
}

function modelOutputDiagnostics(
  status: number,
  payload: JsonObject | null,
  invocation: ModelInvocation,
  responseContent: string | null,
  requestBodyBytes: number,
) {
  const choice = object(Array.isArray(payload?.choices) ? payload.choices[0] : null);
  const usage = object(payload?.usage);
  return {
    ...providerDiagnostics(status, payload, invocation),
    provider_finish_reason: safeProviderToken(choice?.finish_reason),
    provider_prompt_tokens: safeUsageToken(usage?.prompt_tokens),
    provider_completion_tokens: safeUsageToken(usage?.completion_tokens),
    provider_total_tokens: safeUsageToken(usage?.total_tokens),
    response_content_bytes: typeof responseContent === "string"
      ? new TextEncoder().encode(responseContent).byteLength
      : 0,
    request_body_bytes: requestBodyBytes,
  };
}

type ProviderRetryReason = "transient_http" | "usage_missing" | "transport";
type ProviderRetryDelay = (attempt: number, reason: ProviderRetryReason) => Promise<void>;

function providerRetryDelay(attempt: number, reason: ProviderRetryReason): Promise<void> {
  // OpenRouter free routes can return a 2xx envelope without usage while the
  // selected upstream recovers. A short immediate replay reproduces that gap.
  const delayMs = reason === "usage_missing" ? 55_000 : 250 * (2 ** attempt);
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function transportFailure(error: unknown, invocation: ModelInvocation): DeductionServiceError {
  const category = transportCategory(error);
  return new DeductionServiceError(
    category === "timeout" ? "MODEL_PROVIDER_TIMEOUT" : "MODEL_PROVIDER_UNAVAILABLE",
    category === "timeout" ? "The model provider timed out." : "The model provider is unavailable.",
    503,
    {
      provider_status: null,
      model_node_code: invocation.nodeCode,
      model_phase: invocation.mode,
      transport_category: category,
    },
  );
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("MODEL_REQUEST_TIMEOUT")), timeoutMs);
  });
  return Promise.race([operation, deadline]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

export function requestWithNodeHttps(
  url: URL,
  init: NodeHttpsRequestInit,
  timeoutMs: number,
  requestFactory: typeof httpsRequest = httpsRequest,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    let request: ReturnType<typeof httpsRequest> | undefined;
    let responseStream: { destroy(error?: Error): unknown } | undefined;
    let settled = false;
    let wallTimer: ReturnType<typeof setTimeout>;
    const cleanup = () => clearTimeout(wallTimer);
    const settleError = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    wallTimer = setTimeout(() => {
      const error = new Error("MODEL_REQUEST_TIMEOUT");
      request?.destroy(error);
      responseStream?.destroy(error);
      settleError(error);
    }, timeoutMs);
    request = requestFactory(url, {
      method: init.method,
      headers: init.headers,
    }, (response) => {
      responseStream = response;
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { body += chunk; });
      response.once("error", settleError);
      response.once("end", () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(new Response(body, { status: response.statusCode ?? 502 }));
      });
    });
    request.once("error", settleError);
    request.setTimeout(timeoutMs, () => request.destroy(new Error("MODEL_REQUEST_TIMEOUT")));
    request.end(init.body);
  });
}

function balancedJsonSpans(source: string): Array<{ raw: string; end: number }> {
  const spans: Array<{ raw: string; end: number }> = [];
  const stack: string[] = [];
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (stack.length === 0 && (character === "{" || character === "[")) {
      start = index;
      stack.push(character === "{" ? "}" : "]");
    } else if (character === "}" || character === "]") {
      if (stack.length === 0 || stack.at(-1) !== character) {
        stack.length = 0;
        start = -1;
        continue;
      }
      stack.pop();
      if (stack.length === 0 && start >= 0) {
        spans.push({ raw: source.slice(start, index + 1), end: index + 1 });
        start = -1;
      }
    } else if (stack.length > 0 && (character === "{" || character === "[")) {
      stack.push(character === "{" ? "}" : "]");
    }
  }
  return spans;
}

function parseModelOutput(content: unknown): unknown {
  if (typeof content !== "string" || !content.trim()) {
    throw new DeductionServiceError("MODEL_OUTPUT_INVALID", "The model returned no JSON content.", 502);
  }
  let raw = content.replace(/^\uFEFF/, "").trim();
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  if (fenced?.[1] !== undefined) raw = fenced[1].trim();

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // A provider may wrap one JSON value in short explanatory text. Continue
    // with balanced extraction, but never merge or repair multiple values.
  }

  // First identify complete, non-overlapping roots. A complete root may still
  // contain repairable JSON syntax errors; an unclosed root is never repaired.
  const candidates: Array<{ raw: string; value: unknown | null }> = [];
  for (const span of balancedJsonSpans(raw)) {
    if (!span) continue;
    let value: unknown | null = null;
    let parsed = false;
    try {
      value = JSON.parse(span.raw);
      parsed = true;
    } catch {
      // The single complete root is eligible for conservative syntax repair.
    }
    if (parsed && (!value || typeof value !== "object")) continue;
    candidates.push({ raw: span.raw, value });
  }
  if (candidates.length === 1) {
    const [candidate] = candidates;
    if (candidate) {
      if (candidate.value !== null) return candidate.value;
      try {
        const repaired = jsonrepair(candidate.raw);
        const parsed = JSON.parse(repaired);
        if (parsed && typeof parsed === "object") return parsed;
      } catch {
        // Preserve the existing fail-closed error below.
      }
    }
  }
  if ((raw.startsWith("{") || raw.startsWith("[")) && candidates.length === 0) {
    throw new DeductionServiceError("MODEL_OUTPUT_INVALID", "The model response was truncated JSON.", 502);
  }
  throw new DeductionServiceError(
    "MODEL_OUTPUT_INVALID",
    candidates.length > 1 ? "The model response contained multiple JSON values." : "The model response was not valid JSON.",
    502,
  );
}

function repairConvergenceStateSnapshots(outputValue: unknown, inputValue: unknown): unknown {
  const output = object(outputValue);
  const input = object(inputValue);
  const candidateState = object(input?.candidate_state_context);
  if (!output || !candidateState) {
    return outputValue;
  }

  const baselineByCharacterId = new Map<string, JsonObject>();
  if (Array.isArray(candidateState.characters)) {
    for (const candidate of candidateState.characters) {
      const character = object(candidate);
      const characterId = typeof character?.character_id === "string" ? character.character_id : null;
      const liveState = object(character?.live_state_json);
      if (characterId && liveState) baselineByCharacterId.set(characterId, liveState);
    }
  }
  const baselineByRelationId = new Map<string, JsonObject>();
  if (Array.isArray(candidateState.relations)) {
    for (const candidate of candidateState.relations) {
      const relation = object(candidate);
      const relationId = typeof relation?.relation_state_id === "string" ? relation.relation_state_id : null;
      const currentState = object(relation?.current_state);
      if (relationId && currentState) baselineByRelationId.set(relationId, currentState);
    }
  }

  let repaired = false;
  const stateDiff = Array.isArray(output.state_diff) ? output.state_diff.map((entry) => {
    const diff = object(entry);
    if (diff?.entity_type !== "character_live_state" || typeof diff.entity_id !== "string") return entry;
    const after = object(diff.after);
    const baseline = baselineByCharacterId.get(diff.entity_id);
    if (!after || !baseline) return entry;

    const completedAfter = { ...after };
    let completed = false;
    for (const key of LIVE_STATE_KEYS) {
      if (!Object.hasOwn(completedAfter, key) && Object.hasOwn(baseline, key)) {
        completedAfter[key] = structuredClone(baseline[key]);
        completed = true;
      }
    }
    if (!completed) return entry;
    repaired = true;
    return { ...diff, after: completedAfter };
  }) : output.state_diff;
  const relationDiff = Array.isArray(output.relation_diff) ? output.relation_diff.map((entry) => {
    const diff = object(entry);
    if (typeof diff?.relation_state_id !== "string") return entry;
    const after = object(diff.after);
    const baseline = baselineByRelationId.get(diff.relation_state_id);
    if (!after || !baseline) return entry;

    const completedAfter = { ...after };
    let completed = false;
    for (const key of RELATION_SNAPSHOT_KEYS) {
      if (!Object.hasOwn(completedAfter, key) && Object.hasOwn(baseline, key)) {
        completedAfter[key] = structuredClone(baseline[key]);
        completed = true;
      }
    }
    if (!completed) return entry;
    repaired = true;
    return { ...diff, after: completedAfter };
  }) : output.relation_diff;

  return repaired ? { ...output, state_diff: stateDiff, relation_diff: relationDiff } : outputValue;
}

function modeContract(mode: ModelInvocation["mode"]): string {
  if (mode === "director_distribute") {
    return "Run only FP008-02 F1. The input does not contain full role settings; do not request, infer, or fabricate them. Return one JSON object with exactly one top-level field: char_tasks (an array containing exactly one isolated task for each participating character). Every non-protagonist task must include staged_goal_injected; a protagonist task must not populate staged_goal_injected. Do not return convergence fields.";
  }
  if (mode === "director_converge") {
    return "Run only FP008-02 F3/F4. Return one director convergence result object. Each candidate_state_context.relations entry identifies char_a_id, char_b_id, char_a_code, and char_b_code. A relation_diff entry may be output only when every referenced event_ids event has both char_a_code and char_b_code in its participating_chars; otherwise leave that relation unchanged and omit it. Every relation_diff.after must include the complete relation snapshot (trust, intimacy, power_balance, dependence, hostility, common_goal, secret_known, emotional_bond, relation_type, relation_hierarchy, relation_origin, relation_overview, change_event_json); copy an unchanged value from candidate_state_context.relations[].current_state rather than omitting it. Every memory_changes entry must include all seven required keys: character_id, memory_type, memory_content, truth_status, importance, decay_rate, event_ids. truth_status must be exactly true, misremembered, or false. No partial memory entry is allowed; an empty memory_changes array is valid. Every state_diff.event_ids value must name only event_id values from this response's selected events_in_round, never an unselected candidate action, alternate path, or prior-particle event; use an empty state_diff when no selected event supports a state change. Do not return char_tasks. Copy particle sequence counters from the input unchanged. Every character_live_state state_diff.after must include all eight live-state keys (philosophy_live_json, emotion_state_json, drive_live_json, trigger_state_json, goal_state_json, pressure_level, current_goal_txt, current_emo_tag); copy an unchanged value from candidate_state_context rather than omitting the key.";
  }
  return "Run only FP008-02 F2 for the supplied character. Return one compact character deduction result object, not char_tasks or a director convergence result. Do not output reasoning, a task restatement, Chinese-key examples, Markdown, or any prose outside the exact English-key JSON contract. Use concise factual values while retaining every required field and the documented 2-3 candidate actions.";
}

function section(prompt: string, start: string, end: string): string | null {
  const startIndex = prompt.indexOf(start);
  const endIndex = prompt.indexOf(end, startIndex + start.length);
  if (startIndex === -1 || endIndex === -1) return null;
  return prompt.slice(startIndex, endIndex).trim();
}

function scopedFp008Prompt(prompt: string, nodeCode: ModelInvocation["nodeCode"]): string {
  const dispatch = section(prompt, "**运行时模式分发**", "**what**");
  const f1 = section(prompt, "#### §F1", "#### §F2");
  const f2 = section(prompt, "#### §F2", "#### §F3/F4");
  const f3 = section(prompt, "#### §F3/F4", "#### §F5");
  if (!f1 || !f2 || !f3) return prompt;

  const selected = nodeCode === "NODE_05" ? [f2] : [f1, f3];
  return [dispatch, ...selected].filter(Boolean).join("\n\n");
}

type PreparedRequest = Readonly<{
  body: JsonObject;
  currentInput: string;
  priorDirectorMessages: DirectorMessage[];
}>;

function prepareRequest(
  invocation: ModelInvocation,
  directorSessions: Map<string, DirectorMessage[]>,
): PreparedRequest {
  const binding = invocation.binding;
  const prompt = text(binding.prompt_text);
  const model = text(binding.model_name);
  if (!prompt || !model) {
    throw new DeductionServiceError("MODEL_BINDING_UNAVAILABLE", "The frozen model binding is incomplete.", 503);
  }

  const parameters = object(binding.parameters_jsonb) ?? {};
  const directorInvocation = invocation.nodeCode === "NODE_06";
  const priorDirectorMessages = directorInvocation && invocation.continueSession
    ? directorSessions.get(invocation.sessionKey) ?? []
    : [];
  const outputContract = modeContract(invocation.mode);
  const currentInput = JSON.stringify({
    mode: invocation.mode,
    output_contract: outputContract,
    input: invocation.input,
  });
  const messages: JsonObject[] = [{
    role: "system",
    content: `${scopedFp008Prompt(prompt, invocation.nodeCode)}\n\nRuntime output contract:\n${outputContract}`,
  }, ...priorDirectorMessages, {
    role: "user",
    content: currentInput,
  }];
  const body: JsonObject = {
    model,
    messages,
    stream: false,
  };
  const temperature = optionalNumber(binding.temperature ?? parameters.temperature, 0, 2);
  const configuredMaxTokens = optionalNumber(parameters.max_tokens, 1, Number.MAX_SAFE_INTEGER);
  const maxTokens = Math.floor(configuredMaxTokens ?? FP008_DEFAULT_MODEL_MAX_TOKENS);
  if (temperature !== undefined) body.temperature = temperature;
  body.max_tokens = maxTokens;
  return { body, currentInput, priorDirectorMessages };
}

export function createOpenAiCompatibleModelInvoker({
  resolveCredential,
  fetchImpl,
  httpsRequestImpl = requestWithNodeHttps,
  onUsage,
  onRequest,
  onAttempt,
  providerRetryDelayImpl,
}: {
  resolveCredential: CredentialResolver;
  fetchImpl?: typeof fetch;
  httpsRequestImpl?: NodeHttpsRequestImpl;
  onUsage?: UsageObserver;
  onRequest?: RequestObserver;
  onAttempt?: ProviderAttemptObserver;
  providerRetryDelayImpl?: ProviderRetryDelay;
}): ModelInvoker {
  if (typeof resolveCredential !== "function") throw new TypeError("resolveCredential is required");
  if (fetchImpl !== undefined && typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
  if (typeof httpsRequestImpl !== "function") throw new TypeError("httpsRequestImpl must be a function");
  if (onUsage !== undefined && typeof onUsage !== "function") throw new TypeError("onUsage must be a function");
  if (onRequest !== undefined && typeof onRequest !== "function") throw new TypeError("onRequest must be a function");
  if (onAttempt !== undefined && typeof onAttempt !== "function") throw new TypeError("onAttempt must be a function");
  if (providerRetryDelayImpl !== undefined && typeof providerRetryDelayImpl !== "function") {
    throw new TypeError("providerRetryDelayImpl must be a function");
  }
  // Only directors retain their controlled context across particles. Character
  // calls are always fresh so role-private context cannot cross the boundary.
  const directorSessions = new Map<string, DirectorMessage[]>();
  let nextCallId = 0;
  const invoke: ModelInvoker = async (invocation: ModelInvocation): Promise<ModelReply> => {
    const callId = ++nextCallId;
    const binding = invocation.binding;
    const apiKeyRef = text(binding.api_key_ref);
    if (!apiKeyRef) {
      throw new DeductionServiceError("MODEL_BINDING_UNAVAILABLE", "The frozen model binding is incomplete.", 503);
    }

    let apiKey: string;
    try {
      apiKey = await resolveCredential(apiKeyRef);
    } catch {
      throw new DeductionServiceError("MODEL_CREDENTIAL_UNAVAILABLE", "The local credential reference could not be resolved.", 503);
    }
    if (!text(apiKey)) {
      throw new DeductionServiceError("MODEL_CREDENTIAL_UNAVAILABLE", "The local credential reference could not be resolved.", 503);
    }

    const directorInvocation = invocation.nodeCode === "NODE_06";
    if (directorInvocation && !invocation.continueSession) {
      directorSessions.delete(invocation.sessionKey);
    }
    const prepared = prepareRequest(invocation, directorSessions);

    const parameters = object(binding.parameters_jsonb) ?? {};
    const timeoutMs = optionalNumber(parameters.timeout_ms, 1_000, 900_000) ?? 180_000;
    const url = completionsUrl(binding.provider_base_url);
    const headers = {
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    };
    const body = JSON.stringify(prepared.body);
    const requestBodyBytes = new TextEncoder().encode(body).byteLength;
    try {
      const requestMessages = Array.isArray(prepared.body.messages) ? prepared.body.messages : [];
      const systemMessage = object(requestMessages[0]);
      onRequest?.({
        call_id: callId,
        nodeCode: invocation.nodeCode,
        mode: invocation.mode,
        system_prompt: String(systemMessage?.content ?? ""),
        user_input: prepared.currentInput,
        message_count: requestMessages.length,
        max_tokens: Number(prepared.body.max_tokens),
        request_body_bytes: requestBodyBytes,
        timeout_ms: timeoutMs,
        elapsed_ms: 0,
      });
    } catch {
      // Prompt inspection is diagnostic-only and must never change execution.
    }
    let attemptStartedAt = performance.now();
    const emitAttempt = (event: Omit<Parameters<ProviderAttemptObserver>[0], "call_id" | "timeout_ms" | "elapsed_ms">) => {
      observeAttempt(onAttempt, {
        ...event,
        call_id: callId,
        timeout_ms: timeoutMs,
        elapsed_ms: Math.max(0, Math.round(performance.now() - attemptStartedAt)),
      });
    };
    const retryTransport = async (error: unknown, attempt: number): Promise<void> => {
      const retryScheduled = attempt < MAX_PROVIDER_ATTEMPTS - 1;
      emitAttempt({
        source: "provider",
        nodeCode: invocation.nodeCode,
        mode: invocation.mode,
        provider_attempt: attempt + 1,
        outcome: "transport_error",
        http_status: null,
        transport_category: transportCategory(error),
        retry_scheduled: retryScheduled,
        request_body_bytes: requestBodyBytes,
        total_tokens: null,
      });
      if (!retryScheduled) throw transportFailure(error, invocation);
      await (providerRetryDelayImpl ?? providerRetryDelay)(attempt, "transport");
    };
    let response: Response | null = null;
    let payload: JsonObject | null = null;
    let providerAttempt = 0;
    for (let attempt = 0; attempt < MAX_PROVIDER_ATTEMPTS; attempt += 1) {
      providerAttempt = attempt + 1;
      attemptStartedAt = performance.now();
      try {
        response = fetchImpl
          ? await withTimeout(fetchImpl(url, { method: "POST", headers, body, signal: AbortSignal.timeout(timeoutMs) }), timeoutMs)
          : await httpsRequestImpl(url, { method: "POST", headers, body }, timeoutMs);
      } catch (error) {
        await retryTransport(error, attempt);
        continue;
      }
      if (!response.ok) {
        const retryScheduled = TRANSIENT_PROVIDER_STATUSES.has(response.status)
          && attempt < MAX_PROVIDER_ATTEMPTS - 1;
        emitAttempt({
          source: "provider",
          nodeCode: invocation.nodeCode,
          mode: invocation.mode,
          provider_attempt: providerAttempt,
          outcome: "http_error",
          http_status: response.status,
          transport_category: null,
          retry_scheduled: retryScheduled,
          request_body_bytes: requestBodyBytes,
          total_tokens: null,
        });
        if (!retryScheduled) break;
        await response.body?.cancel().catch(() => undefined);
        await (providerRetryDelayImpl ?? providerRetryDelay)(attempt, "transient_http");
        continue;
      }

      try {
        payload = object(await withTimeout(response.json(), timeoutMs));
      } catch (error) {
        if (error instanceof Error && error.message === "MODEL_REQUEST_TIMEOUT") {
          void response.body?.cancel().catch(() => undefined);
          throw error;
        }
        payload = null;
      }
      const usage = object(payload?.usage);
      const totalTokens = safeUsageToken(usage?.total_tokens);
      if (totalTokens !== null) break;

      const retryScheduled = attempt < MAX_PROVIDER_ATTEMPTS - 1;
      emitAttempt({
        source: "provider",
        nodeCode: invocation.nodeCode,
        mode: invocation.mode,
        provider_attempt: providerAttempt,
        outcome: "usage_missing",
        http_status: response.status,
        transport_category: null,
        retry_scheduled: retryScheduled,
        request_body_bytes: requestBodyBytes,
        total_tokens: null,
      });
      if (!retryScheduled) {
        throw new DeductionServiceError(
          "MODEL_USAGE_MISSING",
          "The model response omitted token usage.",
          502,
          providerDiagnostics(response.status, payload, invocation),
        );
      }
      await (providerRetryDelayImpl ?? providerRetryDelay)(attempt, "usage_missing");
    }
    if (!response) throw new Error("MODEL_PROVIDER_UNAVAILABLE");
    if (!response.ok) {
      try {
        payload = object(await withTimeout(response.json(), timeoutMs));
      } catch (error) {
        if (error instanceof Error && error.message === "MODEL_REQUEST_TIMEOUT") {
          void response.body?.cancel().catch(() => undefined);
          throw error;
        }
        payload = null;
      }
      throw new DeductionServiceError(
        "MODEL_PROVIDER_REJECTED",
        "The model provider rejected the request.",
        502,
        providerDiagnostics(response.status, payload, invocation),
      );
    }
    const choice = object(Array.isArray(payload?.choices) ? payload.choices[0] : null);
    const message = object(choice?.message);
    const usage = object(payload?.usage);
    const totalTokens = safeUsageToken(usage?.total_tokens);
    if (totalTokens === null) {
      // The provider loop has already retried this response contract; never
      // let the engine immediately replay an exhausted missing-usage reply.
      throw new DeductionServiceError(
        "MODEL_USAGE_MISSING",
        "The model response omitted token usage.",
        502,
        providerDiagnostics(response.status, payload, invocation),
      );
    }
    try {
      onUsage?.({
        nodeCode: invocation.nodeCode,
        mode: invocation.mode,
        prompt_tokens: safeUsageToken(usage?.prompt_tokens),
        completion_tokens: safeUsageToken(usage?.completion_tokens),
        total_tokens: totalTokens,
        request_body_bytes: requestBodyBytes,
      });
    } catch {
      // Usage auditing must never change a provider call's business result.
    }
    const responseContent = text(message?.content);
    let output: unknown;
    try {
      output = parseModelOutput(responseContent);
      if (invocation.mode === "director_converge") {
        output = repairConvergenceStateSnapshots(output, invocation.input);
      }
    } catch (error) {
      if (error instanceof DeductionServiceError && error.code === "MODEL_OUTPUT_INVALID") {
        emitAttempt({
          source: "provider",
          nodeCode: invocation.nodeCode,
          mode: invocation.mode,
          provider_attempt: providerAttempt,
          outcome: "output_invalid",
          http_status: response.status,
          transport_category: null,
          retry_scheduled: false,
          request_body_bytes: requestBodyBytes,
          total_tokens: totalTokens,
        });
        throw new DeductionServiceError(
          error.code,
          error.message,
          error.statusCode,
          modelOutputDiagnostics(response.status, payload, invocation, responseContent, requestBodyBytes),
          true,
        );
      }
      throw error;
    }
    emitAttempt({
      source: "provider",
      nodeCode: invocation.nodeCode,
      mode: invocation.mode,
      provider_attempt: providerAttempt,
      outcome: "success",
      http_status: response.status,
      transport_category: null,
      retry_scheduled: false,
      request_body_bytes: requestBodyBytes,
      total_tokens: totalTokens,
    });
    if (directorInvocation && responseContent) {
      directorSessions.set(invocation.sessionKey, [
        ...prepared.priorDirectorMessages,
        { role: "user", content: prepared.currentInput },
        { role: "assistant", content: responseContent },
      ]);
    }

    return { output, usage: { total_tokens: totalTokens } };
  };
  invoke.clearSession = (sessionKey) => {
    directorSessions.delete(sessionKey);
  };
  invoke.estimateTokenUsage = (invocation) => {
    const prepared = prepareRequest(invocation, directorSessions);
    const requestBytes = new TextEncoder().encode(JSON.stringify(prepared.body)).byteLength;
    return requestBytes + Number(prepared.body.max_tokens);
  };
  return invoke;
}

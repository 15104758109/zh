import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { DeductionServiceError } from "./engine.ts";
import { createFp008DiagnosticLogger } from "./diagnostics.mjs";
import { createOpenAiCompatibleModelInvoker } from "./openai-compatible-model.ts";
import { buildFp008Service } from "./service.ts";

async function loadCredentialResolver() {
  if (process.env.FP008_CONNECTIVITY_ONLY === "true") {
    return async () => {
      throw new DeductionServiceError(
        "MODEL_CREDENTIAL_UNAVAILABLE",
        "The credential resolver is unavailable in connectivity-only mode.",
        503,
      );
    };
  }
  const modulePath = process.env.ZHREPLAN_CREDENTIAL_RESOLVER_MODULE;
  if (!modulePath) throw new Error("ZHREPLAN_CREDENTIAL_RESOLVER_MODULE is required.");
  const loaded = await import(pathToFileURL(resolve(modulePath)).href);
  if (typeof loaded.resolveCredential !== "function") {
    throw new Error("The credential resolver module must export resolveCredential.");
  }
  return loaded.resolveCredential;
}

const resolveCredential = await loadCredentialResolver();
const debugRequests = process.env.FP008_DEBUG_REQUESTS === "true";
const diagnosticLog = createFp008DiagnosticLogger({ enabled: process.env.FP008_DIAGNOSTICS === "true" });
const app = buildFp008Service({
  invokeModel: createOpenAiCompatibleModelInvoker({
    resolveCredential,
    onUsage: (event) => console.info(JSON.stringify({ event: "fp008_model_usage", ...event })),
    ...(debugRequests ? {
      onRequest: (event) => console.info(JSON.stringify({
        event: "fp008_model_request",
        nodeCode: event.nodeCode,
        mode: event.mode,
        system_prompt_chars: event.system_prompt.length,
        user_input_chars: event.user_input.length,
        message_count: event.message_count,
        max_tokens: event.max_tokens,
        request_body_bytes: event.request_body_bytes,
      })),
    } : {}),
    onAttempt: diagnosticLog,
  }),
  onEngineAttempt: diagnosticLog,
});
const host = process.env.FP008_HOST || "0.0.0.0";
const port = Number(process.env.FP008_PORT || 4182);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("FP008_PORT is invalid.");

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`FP008-02 service received ${signal}; closing the listener.`);
  try {
    await app.close();
  } catch (error) {
    process.exitCode = 1;
    console.error("FP008-02 service failed to close cleanly.", error);
  }
}

process.once("SIGINT", () => { void shutdown("SIGINT"); });
process.once("SIGTERM", () => { void shutdown("SIGTERM"); });

try {
  await app.listen({ host, port });
} catch (error) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "UNKNOWN";
  const detail = code === "EADDRINUSE"
    ? `FP008-02 cannot listen on ${host}:${port}: the address is already in use.`
    : `FP008-02 cannot listen on ${host}:${port} (${code}).`;
  console.error(detail);
  throw new Error(detail, { cause: error });
}

console.log(`FP008-02 service listening on http://${host}:${port}/fp008-02`);

const PROVIDER_FIELDS = [
  "source",
  "call_id",
  "nodeCode",
  "mode",
  "provider_attempt",
  "outcome",
  "http_status",
  "transport_category",
  "retry_scheduled",
  "request_body_bytes",
  "total_tokens",
  "timeout_ms",
  "elapsed_ms",
];

const ENGINE_FIELDS = [
  "source",
  "nodeCode",
  "mode",
  "engine_attempt",
  "outcome",
  "error_category",
  "error_code",
  "provider_status",
  "retry_scheduled",
];

function project(source, fields) {
  const result = { event: "fp008_model_diagnostic" };
  for (const field of fields) result[field] = source[field] ?? null;
  return result;
}

export function createFp008DiagnosticLogger({ enabled = false, write = console.info } = {}) {
  if (!enabled) return () => undefined;
  if (typeof write !== "function") throw new TypeError("write must be a function");
  return (event) => {
    const fields = event?.source === "provider" ? PROVIDER_FIELDS
      : event?.source === "engine" ? ENGINE_FIELDS
        : null;
    if (!fields) return;
    try {
      write(JSON.stringify(project(event, fields)));
    } catch {
      // Diagnostics must never affect FP008 execution.
    }
  };
}

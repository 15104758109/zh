import Fastify from "fastify";

import {
  DeductionServiceError,
  createDeductionEngine,
  type DiagnosticValue,
  type EngineAttemptObserver,
  type ModelInvoker,
} from "./engine.ts";

type Engine = ReturnType<typeof createDeductionEngine>;

function errorPayload(
  code: string,
  message: string,
  diagnostics?: Readonly<Record<string, DiagnosticValue>>,
) {
  return {
    ok: false,
    redacted_error: {
      code,
      message,
      ...(diagnostics ? { provider_diagnostics: diagnostics } : {}),
    },
  };
}

function localBrowserOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const origin = new URL(value);
    if (origin.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(origin.hostname)) return null;
    return origin.origin;
  } catch {
    return null;
  }
}

export function buildFp008Service({
  engine,
  invokeModel,
  onEngineAttempt,
  logger = false,
}: {
  engine?: Engine;
  invokeModel?: ModelInvoker;
  onEngineAttempt?: EngineAttemptObserver;
  logger?: boolean;
}) {
  const deduction = engine ?? (invokeModel ? createDeductionEngine({
    invokeModel,
    ...(onEngineAttempt ? { onAttempt: onEngineAttempt } : {}),
  }) : null);
  if (!deduction) throw new TypeError("engine or invokeModel is required");
  const app = Fastify({ logger, bodyLimit: 20 * 1024 * 1024 });

  app.addHook("onRequest", async (request, reply) => {
    const origin = localBrowserOrigin(request.headers.origin);
    if (origin) {
      reply.header("access-control-allow-origin", origin);
      reply.header("access-control-allow-methods", "GET, POST, OPTIONS");
      reply.header("access-control-allow-headers", "accept, content-type");
      reply.header("vary", "Origin");
    }
    if (request.method === "OPTIONS") return reply.code(204).send();
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DeductionServiceError) {
      return reply.code(error.statusCode).send(errorPayload(error.code, error.message, error.diagnostics));
    }
    const fastifyCode = typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "";
    if (fastifyCode === "FST_ERR_CTP_INVALID_JSON_BODY" || fastifyCode === "FST_ERR_CTP_EMPTY_JSON_BODY") {
      return reply.code(400).send(errorPayload("INVALID_REQUEST", "Request body must be valid JSON."));
    }
    return reply.code(500).send(errorPayload("INTERNAL_ERROR", "The deduction service failed."));
  });

  app.get("/healthz", async () => ({ ok: true }));

  app.get("/fp008-02", async (request, reply) => {
    try {
      const query = request.query as Record<string, unknown>;
      const unexpected = Object.keys(query).find((key) => ![
        "local_operator_id", "book_id", "l1a_unit_id",
      ].includes(key));
      if (unexpected) {
        throw new DeductionServiceError("INVALID_REQUEST", `${unexpected} is not supported.`);
      }
      const result = deduction.getProjection({
        local_operator_id: query.local_operator_id,
        book_id: query.book_id,
        l1a_unit_id: query.l1a_unit_id,
      });
      if (!result) return reply.code(404).send(errorPayload("DEDUCTION_NOT_FOUND", "No in-memory L1A deduction was found."));
      return { ok: true, result };
    } catch (error) {
      if (error instanceof DeductionServiceError) {
        return reply.code(error.statusCode).send(errorPayload(error.code, error.message, error.diagnostics));
      }
      return reply.code(500).send(errorPayload("INTERNAL_ERROR", "The deduction service failed."));
    }
  });

  app.post("/fp008-02", async (request, reply) => {
    try {
      const body = request.body;
      if (body && typeof body === "object" && !Array.isArray(body)
        && (body as Record<string, unknown>).action === "pause") {
        const result = deduction.requestPause((body as Record<string, unknown>).scope);
        return { ok: true, result };
      }
      const result = await deduction.execute(request.body);
      return { ok: true, result };
    } catch (error) {
      if (error instanceof DeductionServiceError) {
        return reply.code(error.statusCode).send(errorPayload(error.code, error.message, error.diagnostics));
      }
      return reply.code(500).send(errorPayload("INTERNAL_ERROR", "The deduction service failed."));
    }
  });

  return app;
}

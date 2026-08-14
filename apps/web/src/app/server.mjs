import { createServer } from "node:http";
import { execFile, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePageRoute } from "./routes.mjs";
import { mergeDeductionRuntime } from "./deduction-runtime-projection.mjs";

const host = "127.0.0.1";
const port = Number(process.env.PORT || 4176);
const fp008ServiceEndpoint = process.env.FP008_SERVICE_URL || "http://127.0.0.1:4182/fp008-02";
const workbenchWebhookEndpoint = process.env.WORKBENCH_WEBHOOK_URL || "http://127.0.0.1:5678/webhook/workbench";
const POSTGRES_COMMAND_TIMEOUT_MS = 10_000;
const WORKFLOW_REQUEST_TIMEOUT_MS = 15_000;
const root = fileURLToPath(new URL("..", import.meta.url));
const types = { ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".mjs": "application/javascript; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

// Route-owned pages stay unchanged; their pinned static dependencies are rewritten at delivery.
const staticAssetReplacements = new Map([
  ["https://cdn.jsdelivr.net/npm/daisyui@4.12.10/dist/full.css", "/vendor/daisyui-4.12.10-full.css"],
  ["https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4", "/vendor/tailwindcss-browser-4.js"],
  ["https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap", "/vendor/font-fallback.css"],
  ["https://lh3.googleusercontent.com/aida-public/AB6AXuDWN1f5QywV4T1kvEuDMePpnX_XfzMmFd0EQUlM7ovGycO-dQ8gQqJ3M3Do31VaSDWXbJmsVmivXjBKjEoIZWXblfn_Mbj1AJyAmQtzs_MdaJz9pUav0DWCBHber1wGyKQG-ltRTEv0CwgdhQEGMGyeRFlVa7EuNLFQoBqKV0SDeWQ9e40ZhwsjDci2psAE6rcekQy4K2a9vNEOiv-sd46KaeCUzp-G24Z1EnZDP2A6OIABFGtH-qlLbXcRtMO8S6w6ldI_2N1mupI", "/vendor/avatar-leader.svg"],
  ["https://lh3.googleusercontent.com/aida-public/AB6AXuAKk0brn9lQ2LSa7jRTLKr9uVpbq6KBianajU38JQW16x4jIblDZndSX0tMVEFMahbl81Xk2kznwdajKM5_0uXPB0UJ4Ghqu4nmlFHUtbRkdhvo3nzN9A_8C8a3BLIhVR_6Q6iwcWNxysZgTva_22qyzdRquPh0rjuCsmaeLRV89TX__qOqyez-y3ZbeUrdnXmkAJdBKnw4jbIDa8g3-CBdyohHSD7fmxIoYvxkqCv-KscwZkPV8ww2H9sSPAdAd67imYf0vM6Hjmc", "/vendor/avatar-traitor.svg"],
  ["https://lh3.googleusercontent.com/aida-public/AB6AXuAbvzFRzr2Cu0SYr1RVvbJz7C9Fnwep8zj2FrE7UCH1I-qQiS0Le8qo1gC2fj6QCLP4xAmMY1ritr1YBlZV3EtGx3_QGyDrtS1ygiy1_DODmFFqfUrdASeI5ONMuiVJyVlyTTd5vQK5_S9awVnFIokxtIa-29xvXrq2k24P8WuUwJnS2RZJ1Nb1ghJSjPyRrIQCEp-TC3tzSebFCZbSxz2JQtJ0X5FuUSXpLHzUylHrubuEOAzd4OVdgbinjRoXK2sK1MEG7VzpJKI", "/vendor/avatar-reporter.svg"],
]);

function localizeStaticAssets(document) {
  for (const [remote, local] of staticAssetReplacements) {
    document = document.replaceAll(remote, local).replaceAll(remote.replaceAll("&", "&amp;"), local);
  }
  return document;
}

function send(response, status, body, type = "application/json; charset=utf-8") {
  response.writeHead(status, { "cache-control": "no-store", "content-type": type });
  response.end(body);
}

function normalizeRpcEnvelope(result) {
  return result?.ok === false && result.error && !result.redacted_error
    ? { ...result, redacted_error: result.error }
    : result;
}

function sqlLiteral(value) {
  return `'${JSON.stringify(value).replaceAll("'", "''")}'`;
}

function terminateChildTree(child) {
  if (!child || child.killed) return;
  if (process.platform === "win32" && child.pid) {
    execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {
      if (!child.killed) child.kill();
    });
    return;
  }
  child.kill();
}

async function executePostgresJson(sql, operation = "PostgreSQL request") {
  const stdout = await new Promise((resolve, reject) => {
    const child = spawn("docker", [
      "exec", "-i", process.env.ZHREPLAN_POSTGRES_CONTAINER || "n8n-pgvector", "sh", "-lc",
      'exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "zh_narrative" -At -f -',
    ], { windowsHide: true });
    let output = "";
    let error = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      terminateChildTree(child);
      reject(new Error(`${operation} timed out`));
    }, POSTGRES_COMMAND_TIMEOUT_MS);
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { error += chunk; });
    child.on("error", (spawnError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(spawnError);
    });
    child.on("close", code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error(error.trim() || `${operation} failed`));
    });
    child.stdin.end(sql);
  });
  const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop();
  if (!line) throw new Error(`${operation} returned no response`);
  return JSON.parse(line);
}

async function callSkillRpc(functionName, request) {
  return executePostgresJson(
    `SELECT public.${functionName}(${sqlLiteral(request)}::jsonb);`,
    "Skill RPC",
  );
}

async function callWorkbenchWorkflow(request) {
  const response = await fetch(workbenchWebhookEndpoint, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(WORKFLOW_REQUEST_TIMEOUT_MS),
  });
  const payload = await response.json();
  const result = payload?.result && typeof payload.result === "object" && "ok" in payload.result
    ? payload.result
    : payload;
  if (!response.ok && result?.ok !== false) throw new Error("WORKFLOW_UNAVAILABLE");
  return result;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuidLiteral(value) {
  if (!UUID_PATTERN.test(String(value || ""))) throw new Error("INVALID_UUID");
  return `'${value}'::uuid`;
}

async function readDeductionWorkspace(bookId, localOperatorId) {
  const book = uuidLiteral(bookId);
  const operator = uuidLiteral(localOperatorId);
  const sql = `
WITH scoped_book AS (
  SELECT id, title, stage_code, run_status, auto_production, auto_audit,
         auto_iteration, token_budget,
         token_budget_version, active_chapter_json, current_l1a_id
  FROM public.book_project
  WHERE id = ${book} AND local_operator_id = ${operator}
), current_l1a AS (
  SELECT l.id, l.l1a_index, l.l1a_name
  FROM public.l1a_unit AS l
  JOIN scoped_book AS b
    ON b.current_l1a_id = l.id
   AND b.id = l.book_id
  WHERE l.is_valid
    AND NOT l.is_shadow
), chapter_rows AS (
  SELECT p.chapter_index,
         jsonb_build_object(
           'chapter_id', p.chapter_id,
           'l1a_unit_id', p.l1a_unit_id,
           'chapter_index', p.chapter_index,
           'title', h.title,
           'status', p.status,
           'run_status', p.run_status,
           'candidate_version_id', p.candidate_version_id,
           'deduction_progress_json', p.deduction_progress_json,
           'deduction_locked', p.deduction_locked,
           'target_snapshot_json', cv.target_snapshot_json,
           'candidate_plot_sim_json', cv.candidate_plot_sim_json,
           'has_candidate_text', NULLIF(btrim(cv.prose_text), '') IS NOT NULL,
           'objective_audit_completed', EXISTS (
             SELECT 1
             FROM public.audit_attempt_log AS a
             WHERE a.book_id = p.book_id
               AND a.chapter_id = p.chapter_id
               AND a.chapter_version_id = cv.id
               AND a.audit_type = 'objective'
               AND a.audit_status = 'completed'
               AND a.candidate_text_snapshot IS NOT DISTINCT FROM cv.prose_text
               AND a.is_valid
               AND NOT a.is_shadow
           ),
           'review_decision', cv.review_decision,
           'review_comment', cv.review_comment,
           'updated_at', p.updated_at,
           'is_next_presentation', COALESCE(p.deduction_locked, false)
             AND NOT EXISTS (
               SELECT 1
               FROM public.chapter_header AS previous
               WHERE previous.book_id = p.book_id
                 AND previous.l1a_unit_id = p.l1a_unit_id
                 AND previous.chapter_index < p.chapter_index
                 AND previous.confirmation_status IS DISTINCT FROM 'creator_confirmed'
             )
         ) AS row_json
  FROM public.v_chapter_progress AS p
  JOIN scoped_book AS b ON b.id = p.book_id
  JOIN public.chapter_header AS h ON h.id = p.chapter_id
  JOIN public.chapter_version AS cv ON cv.id = p.candidate_version_id
  WHERE p.local_operator_id = ${operator}
    AND b.current_l1a_id IS NOT NULL
    AND p.l1a_unit_id = b.current_l1a_id
), next_presentation AS (
  SELECT row_json
  FROM chapter_rows
  WHERE COALESCE((row_json->>'is_next_presentation')::boolean, false)
  ORDER BY chapter_index
  LIMIT 1
), character_rows AS (
  SELECT COALESCE(c.char_code, c.id::text) AS sort_key,
         jsonb_build_object(
           'character_id', c.id,
           'char_name', c.char_name,
           'char_type', c.char_type,
           'char_code', c.char_code,
           'current_goal_txt', c.current_goal_txt,
           'current_emo_tag', c.current_emo_tag,
           'pressure_level', c.pressure_level,
           'emotion_state_json', c.emotion_state_json,
           'drive_live_json', c.drive_live_json,
           'trigger_state_json', c.trigger_state_json
         ) AS row_json
  FROM public.v_character_active AS c
  JOIN scoped_book AS b ON b.id = c.book_id
  WHERE c.local_operator_id = ${operator}
)
SELECT COALESCE(
  (
    SELECT jsonb_build_object(
      'ok', true,
      'result', jsonb_build_object(
        'book', to_jsonb(b) || jsonb_build_object(
          'current_l1a', (
            SELECT jsonb_build_object(
              'id', l.id,
              'l1a_index', l.l1a_index,
              'l1a_name', l.l1a_name
            )
            FROM current_l1a AS l
          )
        ),
        'chapters', COALESCE((SELECT jsonb_agg(row_json ORDER BY chapter_index) FROM chapter_rows), '[]'::jsonb),
        'next_presentation', (SELECT row_json FROM next_presentation),
        'characters', COALESCE((SELECT jsonb_agg(row_json ORDER BY sort_key) FROM character_rows), '[]'::jsonb)
      )
    )
    FROM scoped_book AS b
  ),
  public.v7_error('SCOPE_REJECTED', 'The selected book is unavailable.')
);`;
  return executePostgresJson(sql, "Deduction workspace read");
}

async function readAuditProjection(bookId, localOperatorId, chapterId, chapterVersionId) {
  const book = uuidLiteral(bookId);
  const operator = uuidLiteral(localOperatorId);
  const chapter = uuidLiteral(chapterId);
  const version = uuidLiteral(chapterVersionId);
  const sql = `
WITH scoped_book AS (
  SELECT id, title, local_operator_id, current_l1a_id
  FROM public.book_project
  WHERE id = ${book} AND local_operator_id = ${operator}
), scoped_candidate AS (
  SELECT cv.id
  FROM public.chapter_version AS cv
  JOIN public.chapter_header AS h ON h.id = cv.chapter_id
  JOIN scoped_book AS b ON b.id = cv.book_id
  WHERE cv.id = ${version}
    AND cv.chapter_id = ${chapter}
    AND cv.version_state = 'candidate'
    AND cv.is_valid
    AND NOT cv.is_shadow
    AND NOT h.is_finalized
    AND h.l1a_unit_id = b.current_l1a_id
), scoped_formal AS (
  SELECT cv.id, cv.book_id, cv.chapter_id, cv.prose_text,
         cv.deduction_progress_json, h.chapter_index, h.title,
         h.confirmation_status,
         (
           h.confirmation_status = 'unconfirmed'
           AND NOT EXISTS (
             SELECT 1
             FROM public.chapter_header AS later
             JOIN public.chapter_version AS later_version
               ON later_version.chapter_id = later.id
              AND later_version.book_id = later.book_id
              AND later_version.version_state = 'formal'
              AND later_version.is_formal
              AND later_version.is_valid
              AND NOT later_version.is_shadow
             WHERE later.book_id = h.book_id
               AND later.l1a_unit_id = h.l1a_unit_id
               AND later.chapter_index > h.chapter_index
           )
         ) AS continuation_available
  FROM public.chapter_version AS cv
  JOIN public.chapter_header AS h ON h.id = cv.chapter_id
  JOIN scoped_book AS b ON b.id = cv.book_id
  WHERE cv.id = ${version}
    AND cv.chapter_id = ${chapter}
    AND cv.version_state = 'formal'
    AND cv.is_formal
    AND cv.is_valid
    AND NOT cv.is_shadow
    AND NULLIF(btrim(cv.prose_text), '') IS NOT NULL
    AND h.is_finalized
    AND h.l1a_unit_id = b.current_l1a_id
), complete_projection AS (
  SELECT
    b.id AS book_id,
    b.title AS book_title,
    c.chapter_id,
    c.id AS chapter_version_id,
    c.chapter_index,
    c.title AS chapter_title,
    c.prose_text,
    c.deduction_progress_json,
    c.confirmation_status,
    c.continuation_available,
    objective.has_p0_blocker,
    objective.audit_findings_jsonb,
    objective.p0_items_json,
    objective.return_route_suggestion_jsonb,
    reader.score_json AS reader_score_json,
    commercial.score_json AS commercial_score_json,
    editorial.decision_json,
    editorial.fix_instruction_json
  FROM scoped_formal AS c
  JOIN scoped_book AS b ON b.id = c.book_id
  CROSS JOIN LATERAL (
    SELECT a.has_p0_blocker, a.audit_findings_jsonb, a.p0_items_json,
           a.return_route_suggestion_jsonb
    FROM public.audit_attempt_log AS a
    WHERE a.book_id = c.book_id
      AND a.chapter_id = c.chapter_id
      AND a.chapter_version_id = c.id
      AND a.audit_type = 'objective'
      AND a.audit_status = 'completed'
      AND a.candidate_text_snapshot IS NOT DISTINCT FROM c.prose_text
      AND NOT a.has_p0_blocker
      AND (jsonb_typeof(a.return_route_suggestion_jsonb) IS DISTINCT FROM 'object'
           OR a.return_route_suggestion_jsonb = '{}'::jsonb)
      AND a.is_valid
      AND NOT a.is_shadow
    ORDER BY a.created_at DESC
    LIMIT 1
  ) AS objective
  CROSS JOIN LATERAL (
    SELECT e.score_json
    FROM public.editor_log AS e
    WHERE e.book_id = c.book_id
      AND e.chapter_id = c.chapter_id
      AND e.chapter_version_id = c.id
      AND e.phase = 'reader'
      AND jsonb_typeof(e.score_json) = 'object'
      AND e.score_json <> '{}'::jsonb
      AND e.is_valid
      AND NOT e.is_shadow
    ORDER BY e.created_at DESC
    LIMIT 1
  ) AS reader
  CROSS JOIN LATERAL (
    SELECT e.score_json
    FROM public.editor_log AS e
    WHERE e.book_id = c.book_id
      AND e.chapter_id = c.chapter_id
      AND e.chapter_version_id = c.id
      AND e.phase = 'commercial'
      AND jsonb_typeof(e.score_json) = 'object'
      AND e.score_json <> '{}'::jsonb
      AND e.is_valid
      AND NOT e.is_shadow
    ORDER BY e.created_at DESC
    LIMIT 1
  ) AS commercial
  CROSS JOIN LATERAL (
    SELECT e.decision_json, e.fix_instruction_json
    FROM public.editor_log AS e
    WHERE e.book_id = c.book_id
      AND e.chapter_id = c.chapter_id
      AND e.chapter_version_id = c.id
      AND e.phase = 'editorial'
      AND e.decision_json->>'verdict' = 'Y'
      AND COALESCE((e.decision_json->>'force_manual')::boolean, true) IS FALSE
      AND e.is_valid
      AND NOT e.is_shadow
      AND jsonb_typeof(e.decision_json) = 'object'
    ORDER BY e.created_at DESC
    LIMIT 1
  ) AS editorial
), audit_queue AS (
  SELECT
    b.id AS book_id,
    jsonb_agg(
      jsonb_build_object(
        'chapter_id', cv.chapter_id,
        'chapter_version_id', cv.id,
        'chapter_index', h.chapter_index,
        'title', h.title
      )
      ORDER BY h.chapter_index, cv.version_no, cv.id
    ) AS chapter_queue
  FROM scoped_book AS b
  JOIN public.chapter_header AS h
    ON h.book_id = b.id
   AND h.l1a_unit_id = b.current_l1a_id
   AND h.is_finalized
  JOIN public.chapter_version AS cv
    ON cv.book_id = b.id
   AND cv.chapter_id = h.id
   AND cv.version_state = 'formal'
   AND cv.is_formal
   AND cv.is_valid
   AND NOT cv.is_shadow
   AND NULLIF(btrim(cv.prose_text), '') IS NOT NULL
  CROSS JOIN LATERAL (
    SELECT a.has_p0_blocker
    FROM public.audit_attempt_log AS a
    WHERE a.book_id = b.id
      AND a.chapter_id = h.id
      AND a.chapter_version_id = cv.id
      AND a.audit_type = 'objective'
      AND a.audit_status = 'completed'
      AND a.candidate_text_snapshot IS NOT DISTINCT FROM cv.prose_text
      AND NOT a.has_p0_blocker
      AND (jsonb_typeof(a.return_route_suggestion_jsonb) IS DISTINCT FROM 'object'
           OR a.return_route_suggestion_jsonb = '{}'::jsonb)
      AND a.is_valid
      AND NOT a.is_shadow
    ORDER BY a.created_at DESC
    LIMIT 1
  ) AS objective
  CROSS JOIN LATERAL (
    SELECT e.id
    FROM public.editor_log AS e
    WHERE e.book_id = b.id
      AND e.chapter_id = h.id
      AND e.chapter_version_id = cv.id
      AND e.phase = 'editorial'
      AND e.decision_json->>'verdict' = 'Y'
      AND COALESCE((e.decision_json->>'force_manual')::boolean, true) IS FALSE
      AND e.is_valid
      AND NOT e.is_shadow
      AND jsonb_typeof(e.decision_json) = 'object'
    ORDER BY e.created_at DESC
    LIMIT 1
  ) AS editorial
  WHERE objective.has_p0_blocker IS FALSE
  GROUP BY b.id
)
SELECT COALESCE(
  (
    SELECT jsonb_build_object(
      'ok', true,
      'result', jsonb_build_object(
        'book', jsonb_build_object('id', book_id, 'title', book_title),
        'chapter', jsonb_build_object(
          'chapter_id', chapter_id,
          'chapter_version_id', chapter_version_id,
          'chapter_index', chapter_index,
          'title', chapter_title,
          'version_state', 'formal',
          'confirmation_status', confirmation_status,
          'continuation_available', continuation_available,
          'reject_count', COALESCE(deduction_progress_json->>'reject_count', '0'),
          'prose_text', prose_text
        ),
        'objective', jsonb_build_object(
          'has_p0_blocker', has_p0_blocker,
          'audit_findings_jsonb', audit_findings_jsonb,
          'p0_items_json', p0_items_json,
          'return_route_suggestion_jsonb', return_route_suggestion_jsonb
        ),
        'reader', jsonb_build_object('score_json', reader_score_json),
        'commercial', jsonb_build_object('score_json', commercial_score_json),
        'editorial', jsonb_build_object(
          'decision_json', decision_json,
          'fix_instruction_json', fix_instruction_json
        ),
        'chapter_queue', COALESCE((SELECT chapter_queue FROM audit_queue WHERE book_id = complete_projection.book_id), '[]'::jsonb)
      )
    )
    FROM complete_projection
  ),
  (
    SELECT public.v7_error(
      'FORMAL_CHAPTER_REQUIRED',
      '当前章节尚未正式写入，页面不会展示候选正文。'
    )
    FROM scoped_candidate
  ),
  public.v7_error('AUDIT_PROJECTION_UNAVAILABLE', 'No complete current-version editorial projection is available.')
);`;
  return executePostgresJson(sql, "Audit projection read");
}

async function readDeductionRuntime(databaseResult, localOperatorId) {
  const book = databaseResult?.result?.book;
  if (!book?.current_l1a_id) return null;
  const url = new URL(fp008ServiceEndpoint);
  url.searchParams.set("local_operator_id", localOperatorId);
  url.searchParams.set("book_id", book.id);
  url.searchParams.set("l1a_unit_id", book.current_l1a_id);
  let response;
  try {
    response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(1200) });
  } catch {
    return null;
  }
  if (response.status === 404) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok !== true || !payload.result) throw new Error("FP008_RUNTIME_UNAVAILABLE");
  return payload.result;
}

async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 2 * 1024 * 1024) throw new Error("REQUEST_TOO_LARGE");
  }
  if (!body.trim()) return {};
  return JSON.parse(body);
}

async function serveSkillApi(request, response) {
  try {
    const payload = await readJsonBody(request);
    const action = payload?.action || "list";
    if (!["operator", "list", "create_version", "set_preference", "delete", "import_overwrite"].includes(action)) {
      return send(response, 400, JSON.stringify({ ok: false, redacted_error: { code: "INVALID_REQUEST", message: "技能操作不受支持。" } }));
    }
    const result = action === "operator"
      ? await callWorkbenchWorkflow(payload)
      : action === "list"
        ? await callSkillRpc("rpc_get_effective_skills", payload)
        : await callSkillRpc("rpc_manage_skill", payload);
    const normalized = normalizeRpcEnvelope(result);
    const status = normalized?.ok === true ? 200 : 400;
    return send(response, status, JSON.stringify(normalized));
  } catch (error) {
    const code = error?.message === "REQUEST_TOO_LARGE" ? "REQUEST_TOO_LARGE" : "RPC_UNAVAILABLE";
    const status = code === "REQUEST_TOO_LARGE" ? 413 : 503;
    return send(response, status, JSON.stringify({ ok: false, redacted_error: { code, message: code === "REQUEST_TOO_LARGE" ? "请求内容过大。" : "技能数据服务暂不可用。" } }));
  }
}

async function serveDeductionApi(response, bookId, localOperatorId) {
  try {
    let result = await readDeductionWorkspace(bookId, localOperatorId);
    if (result?.ok === true) {
      const runtime = await readDeductionRuntime(result, localOperatorId);
      if (runtime) result = mergeDeductionRuntime(result, runtime);
    }
    const normalized = normalizeRpcEnvelope(result);
    const status = normalized?.ok === true ? 200 : 404;
    return send(response, status, JSON.stringify(normalized));
  } catch (error) {
    const invalid = error?.message === "INVALID_UUID";
    return send(response, invalid ? 400 : 503, JSON.stringify({
      ok: false,
      redacted_error: {
        code: invalid ? "INVALID_BOOK_CONTEXT" : "RPC_UNAVAILABLE",
        message: invalid ? "当前作品上下文无效。" : "推演数据服务暂不可用。",
      },
    }));
  }
}

async function serveAuditApi(response, bookId, localOperatorId, chapterId, chapterVersionId) {
  try {
    const result = normalizeRpcEnvelope(await readAuditProjection(bookId, localOperatorId, chapterId, chapterVersionId));
    const code = result?.redacted_error?.code;
    const status = result?.ok === true ? 200 : code === "SCOPE_REJECTED" ? 404 : 409;
    return send(response, status, JSON.stringify(result));
  } catch (error) {
    const invalid = error?.message === "INVALID_UUID";
    return send(response, invalid ? 400 : 503, JSON.stringify({
      ok: false,
      redacted_error: {
        code: invalid ? "INVALID_AUDIT_CONTEXT" : "RPC_UNAVAILABLE",
        message: invalid ? "当前审计范围无效。" : "审计结果服务暂时不可用。",
      },
    }));
  }
}

async function serveFile(response, relative) {
  const file = join(root, relative);
  try {
    send(response, 200, await readFile(file), types[extname(file)] || "application/octet-stream");
  } catch {
    send(response, 404, JSON.stringify({ error: "NOT_FOUND" }));
  }
}

async function serveRoute(response, page) {
  try {
    const document = await readFile(join(root, page), "utf8");
    const base = `/${dirname(page).replace(/\\/g, "/")}/`;
    const localized = localizeStaticAssets(document);
    send(response, 200, localized.replace(/<head(\s[^>]*)?>/i, (head) => `${head}<base href="${base}">`), types[".html"]);
  } catch {
    send(response, 404, JSON.stringify({ error: "NOT_FOUND" }));
  }
}

createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || host}`);
  const pathname = url.pathname;
  const deductionApi = pathname.match(/^\/api\/books\/([^/]+)\/deduction\/?$/);
  if (deductionApi) {
    if (request.method !== "GET") return send(response, 405, JSON.stringify({ error: "METHOD_NOT_ALLOWED" }));
    let bookId = "";
    try {
      bookId = decodeURIComponent(deductionApi[1]);
    } catch {
      // The API returns the same scoped validation error for malformed path encoding.
    }
    return serveDeductionApi(response, bookId, url.searchParams.get("local_operator_id"));
  }
  const auditApi = pathname.match(/^\/api\/books\/([^/]+)\/audit\/?$/);
  if (auditApi) {
    if (request.method !== "GET") return send(response, 405, JSON.stringify({ error: "METHOD_NOT_ALLOWED" }));
    let bookId = "";
    try {
      bookId = decodeURIComponent(auditApi[1]);
    } catch {
      // The API returns the same scoped validation error for malformed path encoding.
    }
    return serveAuditApi(
      response,
      bookId,
      url.searchParams.get("local_operator_id"),
      url.searchParams.get("chapter_id"),
      url.searchParams.get("chapter_version_id"),
    );
  }
  if (pathname === "/api/skill-library") {
    if (!["GET", "POST"].includes(request.method || "")) return send(response, 405, JSON.stringify({ error: "METHOD_NOT_ALLOWED" }));
    if (request.method === "GET") {
      const params = Object.fromEntries(url.searchParams.entries());
      return serveSkillApi({ async *[Symbol.asyncIterator]() { yield JSON.stringify({ action: "list", ...params }); } }, response);
    }
    return serveSkillApi(request, response);
  }
  if (request.method !== "GET") return send(response, 405, JSON.stringify({ error: "METHOD_NOT_ALLOWED" }));
  if (pathname.startsWith("/assets/") || pathname.startsWith("/app/") || pathname.startsWith("/components/") || pathname.startsWith("/pages/") || pathname.startsWith("/vendor/")) {
    const relative = normalize(`.${pathname}`).replace(/^\.?[\\/]+/, "");
    if (relative.includes("..")) return send(response, 400, JSON.stringify({ error: "BAD_PATH" }));
    return serveFile(response, relative);
  }
  const route = resolvePageRoute(pathname);
  if (route) return serveRoute(response, route.page);
  return send(response, 404, JSON.stringify({ error: "NOT_FOUND" }));
}).listen(port, host, () => process.stdout.write(`web server listening on http://${host}:${port}/workbench\n`));

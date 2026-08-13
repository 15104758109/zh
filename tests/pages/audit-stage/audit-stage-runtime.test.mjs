import assert from "node:assert/strict";
import test from "node:test";

import {
  AuditStageError,
  auditNextAction,
  buildAuditConfirmationIntent,
  buildAuditReturnIntent,
  buildAuditStageChapterUrl,
  fetchAuditProjection,
  sendAuditConfirmationIntent,
  sendAuditReturnIntent,
} from "../../../apps/web/src/pages/audit-stage/index.mjs";
import {
  auditWaitRouteStorageKey,
  readAuditWaitRoute,
  storeAuditWaitRoute,
} from "../../../apps/web/src/pages/audit-stage/wait-route.mjs";

const OPERATOR = "3d5a33f3-4ae0-4a5f-bd7e-9a04b84ac111";
const BOOK = "cd726e72-bf3f-4d21-a90c-70cd7dd38f30";
const CHAPTER = "815fe390-94e1-4a51-947b-6db2412b5a11";
const VERSION = "987409eb-05b4-43d8-b557-60d782ca8387";
const EDITORIAL = "50f7330f-8aaf-489f-81dd-b1c44d69f8de";

function projection(overrides = {}) {
  return {
    chapter: {
      chapter_id: CHAPTER,
      chapter_version_id: VERSION,
      version_state: "formal",
      continuation_available: true,
      prose_text: "仅用于证明页面读取正式正文，不能随继续请求写回。",
    },
    objective: {
      has_p0_blocker: false,
      audit_findings_jsonb: { objective_only: true },
    },
    editorial: {
      decision_json: { verdict: "Y", reject_count_observed: 0, force_manual: false },
      ...overrides.editorial,
    },
    ...overrides,
  };
}

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
  };
}

test("FP012-02 page submits only the continue intent to the issued ZH06 wait route", () => {
  const payload = buildAuditConfirmationIntent(
    { localOperatorId: OPERATOR, bookId: BOOK },
    projection(),
    "http://127.0.0.1:5678/webhook-waiting/1495?signature=test-signature",
  );

  assert.deepEqual(payload, { action: "continue_next_chapter" });
  assert.doesNotMatch(JSON.stringify(payload), /prose_text|has_p0_blocker|audit_findings_jsonb|verdict|creator_confirmed/u);
});

test("FP012-02 approval only continues the next chapter after the current chapter is formal", () => {
  const payload = buildAuditConfirmationIntent(
    { localOperatorId: OPERATOR, bookId: BOOK },
    projection({
      chapter: {
        chapter_id: CHAPTER,
        chapter_version_id: VERSION,
        version_state: "formal",
        continuation_available: true,
        prose_text: "已正式写入的正文。",
      },
    }),
    "http://127.0.0.1:5678/webhook-waiting/1495?signature=test-signature",
  );

  assert.deepEqual(payload, { action: "continue_next_chapter" });
  assert.doesNotMatch(JSON.stringify(payload), /prose_text|has_p0_blocker|verdict|editor_log_id|creator_confirmed/u);
});

test("FP012-02 returns only the scoped current formal chapter with the author's reason", () => {
  const payload = buildAuditReturnIntent(
    { localOperatorId: OPERATOR, bookId: BOOK },
    projection(),
    "http://127.0.0.1:5678/webhook-waiting/1495?signature=test-signature",
    "当前章的呈现需要重新处理。",
  );

  assert.deepEqual(payload, {
    action: "return_current_chapter",
    return_reason: "当前章的呈现需要重新处理。",
  });
  assert.doesNotMatch(JSON.stringify(payload), /prose_text|has_p0_blocker|audit_findings_jsonb|verdict|creator_confirmed/u);
});

test("FP012-02 refuses a return with no reason before sending the signed wait callback", () => {
  assert.throws(
    () => buildAuditReturnIntent(
      { localOperatorId: OPERATOR, bookId: BOOK },
      projection(),
      "http://127.0.0.1:5678/webhook-waiting/1495?signature=test-signature",
      "  ",
    ),
    (error) => error instanceof AuditStageError && error.code === "RETURN_REASON_REQUIRED",
  );
});

test("FP012-02 page refuses an unscoped, candidate, or non-wait confirmation route", () => {
  assert.throws(
    () => buildAuditConfirmationIntent(
      { localOperatorId: OPERATOR, bookId: BOOK },
      projection({ chapter: { chapter_id: CHAPTER } }),
      "http://127.0.0.1:5678/webhook-waiting/1495?signature=test-signature",
    ),
    (error) => error instanceof AuditStageError && error.code === "INCOMPLETE_CHAPTER_CONTEXT",
  );

  assert.throws(
    () => buildAuditConfirmationIntent(
      { localOperatorId: OPERATOR, bookId: BOOK },
      projection({ chapter: { chapter_id: CHAPTER, chapter_version_id: VERSION, version_state: "candidate" } }),
      "http://127.0.0.1:5678/webhook-waiting/1495?signature=test-signature",
    ),
    (error) => error instanceof AuditStageError && error.code === "FORMAL_CHAPTER_REQUIRED",
  );

  assert.throws(
    () => buildAuditConfirmationIntent(
      { localOperatorId: OPERATOR, bookId: BOOK },
      projection(),
      "http://127.0.0.1:5678/webhook/audit_stage",
    ),
    (error) => error instanceof AuditStageError && error.code === "AUDIT_WAIT_ROUTE_REQUIRED",
  );
});

test("FP012-02 keeps the issued wait route only in the matching browser session scope", () => {
  const entries = new Map();
  const sessionStorage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  };
  const scope = { bookId: BOOK, chapterId: CHAPTER, chapterVersionId: VERSION };
  const waitRoute = "http://127.0.0.1:5678/webhook-waiting/1495?signature=test-signature";

  assert.equal(
    auditWaitRouteStorageKey(scope),
    `zh.audit.wait-route:${BOOK}:${CHAPTER}:${VERSION}`,
  );
  assert.equal(storeAuditWaitRoute(sessionStorage, scope, waitRoute), waitRoute);
  assert.equal(readAuditWaitRoute(sessionStorage, scope), waitRoute);
  assert.equal(readAuditWaitRoute(sessionStorage, { ...scope, chapterVersionId: EDITORIAL }), null);
});

test("FP012-02 posts only the continue intent to the stored wait route", async () => {
  const calls = [];
  const payload = await sendAuditConfirmationIntent(
    { localOperatorId: OPERATOR, bookId: BOOK },
    projection(),
    "http://127.0.0.1:5678/webhook-waiting/1495?signature=test-signature",
    {
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return response(200, { received: true });
      },
    },
  );

  assert.deepEqual(payload, { received: true });
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].url, "http://127.0.0.1:5678/webhook-waiting/1495?signature=test-signature");
  assert.doesNotMatch(calls[0].init.body, /prose_text|has_p0_blocker|audit_findings_jsonb|verdict/u);
});

test("FP012-02 posts only the return intent and reason to the stored wait route", async () => {
  const calls = [];
  const payload = await sendAuditReturnIntent(
    { localOperatorId: OPERATOR, bookId: BOOK },
    projection(),
    "http://127.0.0.1:5678/webhook-waiting/1495?signature=test-signature",
    "本章需要重新呈现。",
    {
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return response(200, { received: true });
      },
    },
  );

  assert.deepEqual(payload, { received: true });
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].url, "http://127.0.0.1:5678/webhook-waiting/1495?signature=test-signature");
  assert.equal(
    calls[0].init.body,
    JSON.stringify({ action: "return_current_chapter", return_reason: "本章需要重新呈现。" }),
  );
});

test("audit page exposes only continuation for the current formal chapter", () => {
  assert.equal(auditNextAction(projection()).kind, "continue");
  assert.equal(auditNextAction(projection({ chapter: { chapter_id: CHAPTER, chapter_version_id: VERSION, version_state: "formal", continuation_available: false } })).kind, "view");
  assert.equal(auditNextAction(projection({ objective: { has_p0_blocker: true } })).kind, "manual");
});

test("audit page reads only the scoped formal projection", async () => {
  const calls = [];
  const result = await fetchAuditProjection(
    {
      localOperatorId: OPERATOR,
      bookId: BOOK,
      chapterId: CHAPTER,
      chapterVersionId: VERSION,
    },
    {
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return response(200, { ok: true, result: { book: { id: BOOK.toUpperCase() }, ...projection() } });
      },
    },
  );

  assert.equal(calls[0].init.method, "GET");
  assert.equal(
    calls[0].url,
    `/api/books/${BOOK}/audit?local_operator_id=${OPERATOR}&chapter_id=${CHAPTER}&chapter_version_id=${VERSION}`,
  );
  assert.equal(result.chapter.prose_text, "仅用于证明页面读取正式正文，不能随继续请求写回。");
});

test("audit page keeps the current L1A's other formal chapters selectable", async () => {
  const otherChapter = "c32a3582-40d7-4f10-8ee7-a0c5164b5a50";
  const otherVersion = "1ab8d5e0-e0f4-44a5-b03a-780dfcb16924";
  const result = await fetchAuditProjection(
    {
      localOperatorId: OPERATOR,
      bookId: BOOK,
      chapterId: CHAPTER,
      chapterVersionId: VERSION,
    },
    {
      fetchImpl: async () => response(200, {
        ok: true,
        result: {
          book: { id: BOOK },
          ...projection(),
          chapter_queue: [
            { chapter_id: CHAPTER, chapter_version_id: VERSION, chapter_index: 1, title: "第一章" },
            { chapter_id: otherChapter, chapter_version_id: otherVersion, chapter_index: 2, title: "第二章" },
          ],
        },
      }),
    },
  );

  assert.deepEqual(result.chapter_queue, [
    { chapter_id: CHAPTER, chapter_version_id: VERSION, chapter_index: 1, title: "第一章" },
    { chapter_id: otherChapter, chapter_version_id: otherVersion, chapter_index: 2, title: "第二章" },
  ]);
  assert.equal(
    buildAuditStageChapterUrl({ bookId: BOOK }, result.chapter_queue[1]),
    `/books/${BOOK}/audit?chapter_id=${otherChapter}&chapter_version_id=${otherVersion}`,
  );
});

test("audit page refuses a formal prose response without a chief-editor conclusion", async () => {
  await assert.rejects(
    fetchAuditProjection(
      {
        localOperatorId: OPERATOR,
        bookId: BOOK,
        chapterId: CHAPTER,
        chapterVersionId: VERSION,
      },
      {
        fetchImpl: async () => response(200, {
          ok: true,
          result: {
            book: { id: BOOK },
            chapter: { chapter_id: CHAPTER, chapter_version_id: VERSION, version_state: "formal", prose_text: "不应提前显示" },
            objective: { has_p0_blocker: false },
          },
        }),
      },
    ),
    (error) => error instanceof AuditStageError && error.code === "EDITORIAL_DECISION_REQUIRED",
  );
});

test("audit page refuses a candidate response even when it contains prose", async () => {
  await assert.rejects(
    fetchAuditProjection(
      {
        localOperatorId: OPERATOR,
        bookId: BOOK,
        chapterId: CHAPTER,
        chapterVersionId: VERSION,
      },
      {
        fetchImpl: async () => response(200, {
          ok: true,
          result: {
            book: { id: BOOK },
            chapter: {
              chapter_id: CHAPTER,
              chapter_version_id: VERSION,
              version_state: "candidate",
              prose_text: "candidate prose must remain unavailable",
            },
            objective: { has_p0_blocker: false },
            editorial: {
              decision_json: { verdict: "N", reject_count_observed: 0, force_manual: false },
            },
          },
        }),
      },
    ),
    (error) => error instanceof AuditStageError && error.code === "FORMAL_CHAPTER_REQUIRED",
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  buildAuditStageUrl,
  buildAuditPresentationIntent,
  currentL1aLabel,
  DeductionDataError,
  hasPlot,
  isPresentationCandidate,
  presentationReleaseState,
  presentationSelection,
  resolveAuditReviewContext,
  sendAuditPresentationIntent,
  storeIssuedAuditWaitRoute,
} from "../../../apps/web/src/pages/audit-review/index.mjs";
import { legacyRouteNames } from "../../../apps/web/src/pages/prototype/common/legacy-route-names.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const sourcePath = `${root}docs/前端原型_v2/pages/audit_review.html`;
const pagePath = `${root}apps/web/src/pages/audit-review/index.html`;
const modulePath = `${root}apps/web/src/pages/audit-review/index.mjs`;
const sharedSidebarPath = `${root}apps/web/src/pages/prototype/common/sidebar.js`;
const serverPath = `${root}apps/web/src/app/server.mjs`;
const L1A = "ba5a33f3-4ae0-4a5f-bd7e-9a04b84ac111";

function ids(html) {
  return [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
}

test("AUDIT_REVIEW preserves prototype anchors and binds the L1A presentation entry", async () => {
  const [source, html, module, sharedSidebar, server] = await Promise.all([
    readFile(sourcePath, "utf8"),
    readFile(pagePath, "utf8"),
    readFile(modulePath, "utf8"),
    readFile(sharedSidebarPath, "utf8"),
    readFile(serverPath, "utf8"),
  ]);

  assert.deepEqual(new Set(ids(`${html}\n${sharedSidebar}`)), new Set(ids(source)), "target plus shared shell must retain the prototype id set");
  for (const region of ["sidebar", "topbar", "deduction_summary", "p0_review", "decision_actions"]) {
    assert.match(html, new RegExp(`data-region=["']${region}["']`));
  }
  assert.match(html, /href="\/pages\/prototype\/common\/theme\.css"/);
  assert.match(html, /href="\/pages\/prototype\/common\/sidebar\.css"/);
  assert.match(html, /src="\/pages\/prototype\/common\/sidebar\.js"/);
  assert.match(html, /href="\/pages\/audit-review\/page\.css"/);
  assert.match(html, /data-shared-sidebar[^>]+data-sidebar-active="production"/);
  assert.doesNotMatch(html, /data-sidebar-brand-icon=/);
  assert.match(sharedSidebar, /item\.id === active \? "active"/);
  assert.match(sharedSidebar, /item\.id === active \? ` aria-current="page"`/);
  assert.doesNotMatch(sharedSidebar, /href:\s*"[^"]+\.html"/);
  assert.match(html, /data-book-segment="deduction-review"[^>]*class="header-tab active"[^>]*aria-current="page"/);
  assert.match(html, /data-action="approve-preview"[^>]*disabled/);
  assert.match(html, /data-action="return-preview"[^>]*disabled/);
  assert.match(html, /id="confirm-replan-btn"[^>]*disabled/);
  assert.match(html, /data-audit-review-root[^>]*hidden inert aria-hidden="true"/);
  assert.match(html, /type="application\/x-source-prototype" data-prototype-business-data/);
  assert.doesNotMatch(html, /静态原型预览|退回成功！已发送/);
  assert.doesNotMatch(html, /text-\[(?:7|8|9|9\.5)px\]|\bcyber-|bg-gradient-|tracking-(?:wide|wider|widest)/);
  assert.doesNotMatch(module, /text-\[(?:7|8|9|9\.5)px\]|\bcyber-|bg-gradient-|tracking-(?:wide|wider|widest)/);
  assert.match(html, /\[data-audit-review-state-overlay\][\s\S]*background:\s*var\(--color-base-200\)/);
  assert.doesNotMatch(html, /background:\s*rgba\(244, 243, 242, 0\.94\)/);

  assert.match(module, /fetchDeductionProjection/);
  assert.match(module, /has_candidate_text === false/);
  assert.match(module, /currentL1aLabel/);
  assert.match(module, /当前 L1A/);
  assert.match(module, /presentationSelection/);
  assert.match(module, /后端已解析下一章/);
  assert.match(module, /const presentationLabel = "待正文呈现"/);
  assert.match(module, /isPresentationCandidate/);
  assert.doesNotMatch(module, /label: "部分检查点"|label: "全部候选"/);
  assert.match(module, /scrubPrototypeBusinessData/);
  assert.match(module, /function setReviewContentVisible/);
  assert.match(module, /setReviewContentVisible\(root, false\)/);
  assert.match(module, /setReviewContentVisible\(root, true\)/);
  assert.match(module, /schedulePolling/);
  assert.match(module, /visibilitychange/);
  assert.match(module, /5000/);
  assert.match(module, /disabled = true/);
  assert.match(module, /buildAuditPresentationIntent/);
  assert.match(module, /sendAuditPresentationIntent/);
  assert.match(module, /AUDIT_WEBHOOK_URL/);
  assert.match(module, /webhook\/audit_stage/);
  assert.match(module, /主编裁决前不展示候选正文/);
  assert.match(module, /主编放行并完成正式写入后，审计页面才会显示正文/);
  assert.doesNotMatch(module, /请等待主编裁决后再进入审计页面查看和确认/);
  assert.doesNotMatch(module, /FP009-01 写接口尚未形成稳定合同/);
  assert.doesNotMatch(module, /放行整段结果|带方向退回整段|稳定整段 RPC/);
  assert.equal(legacyRouteNames["audit_review.html"], "deduction-review");
  assert.equal(legacyRouteNames["audit_stage.html"], "audit");
  assert.match(html, /整个 L1A 重推方向与建议/);
  assert.match(server, /next_presentation/);
  assert.match(server, /confirmation_status IS DISTINCT FROM 'creator_confirmed'/);
  assert.doesNotMatch(module, /static_mock|静态批准预览|退回成功/);
});

test("empty particle arrays are not treated as deduction results", () => {
  assert.equal(hasPlot({ candidate_plot_sim_json: { particles_records: [] } }), false);
  assert.equal(hasPlot({ candidate_plot_sim_json: { particles_records: [], chapter_summary: {} } }), false);
  assert.equal(hasPlot({ candidate_plot_sim_json: { particles_records: [{ particle_id: "p-1" }] } }), true);
  assert.equal(hasPlot({ candidate_plot_sim_json: { chapter_summary: "整段结果" } }), true);
});

test("FP009 only offers the backend-resolved next candidate with no candidate prose", () => {
  assert.equal(isPresentationCandidate({ deduction_locked: true, has_candidate_text: false, is_next_presentation: true }), true);
  assert.equal(isPresentationCandidate({ deduction_locked: true, has_candidate_text: false, is_next_presentation: false }), false);
  assert.equal(isPresentationCandidate({ deduction_locked: false, has_candidate_text: false, is_next_presentation: true }), false);
  assert.equal(isPresentationCandidate({ deduction_locked: true, has_candidate_text: true, is_next_presentation: true }), false);
});

test("FP009 keeps V7's formal-write blocker visible after candidate prose exists", () => {
  const chapter = {
    deduction_locked: true,
    has_candidate_text: true,
    is_next_presentation: true,
  };

  assert.equal(presentationReleaseState(chapter), "awaiting_editorial");
  assert.equal(
    presentationReleaseState(chapter, {
      presentationError: new DeductionDataError(
        "WORD_COUNT_CONTRACT_UNRESOLVED",
        "无法确定正式章节字数和进度，当前章节不能进入作者确认。",
      ),
    }),
    "blocked",
  );
});

test("FP009 uses the backend's L1A scope and unique next chapter instead of a chapter picker", () => {
  const l1aId = "ba5a33f3-4ae0-4a5f-bd7e-9a04b84ac111";
  const nextChapter = {
    l1a_unit_id: l1aId,
    chapter_id: "815fe390-94e1-4a51-947b-6db2412b5a11",
    candidate_version_id: "987409eb-05b4-43d8-b557-60d782ca8387",
    chapter_index: 2,
    is_next_presentation: true,
  };
  const selection = presentationSelection({
    book: { current_l1a: { id: l1aId, l1a_index: 1, l1a_name: "暗潮" } },
    chapters: [{ ...nextChapter, chapter_index: 7 }, nextChapter],
    next_presentation: nextChapter,
  });

  assert.equal(selection.l1a.id, l1aId);
  assert.equal(selection.chapter.chapter_id, nextChapter.chapter_id);
  assert.equal(presentationSelection({ book: { current_l1a: { id: l1aId } }, chapters: [nextChapter] }).chapter, null);
});

test("FP009 keeps the authoritative current L1A visible while a chapter is selected", () => {
  assert.equal(
    currentL1aLabel({
      current_l1a: { l1a_index: 7, l1a_name: "反向渗透" },
    }),
    "L1A-07 反向渗透",
  );
  assert.equal(currentL1aLabel({ current_l1a_id: "not-a-label" }), null);
});

test("FP009 presentation intent keeps only the selected L1A and book scope", () => {
  const payload = buildAuditPresentationIntent(
    {
      localOperatorId: "3d5a33f3-4ae0-4a5f-bd7e-9a04b84ac111",
      bookId: "cd726e72-bf3f-4d21-a90c-70cd7dd38f30",
    },
    { id: L1A },
    "audit-presentation-7f34ad20",
  );

  assert.deepEqual(payload, {
    local_operator_id: "3d5a33f3-4ae0-4a5f-bd7e-9a04b84ac111",
    book_id: "cd726e72-bf3f-4d21-a90c-70cd7dd38f30",
    l1a_unit_id: L1A,
    idempotency_key: "audit-presentation-7f34ad20",
  });
  assert.doesNotMatch(JSON.stringify(payload), /chapter_id|chapter_version_id/u);
});

test("FP009 stores only the issued wait route and opens the same candidate's audit page", () => {
  const entries = new Map();
  const sessionStorage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  };
  const context = {
    localOperatorId: "3d5a33f3-4ae0-4a5f-bd7e-9a04b84ac111",
    bookId: "cd726e72-bf3f-4d21-a90c-70cd7dd38f30",
  };
  const chapter = {
    chapter_id: "815fe390-94e1-4a51-947b-6db2412b5a11",
    candidate_version_id: "987409eb-05b4-43d8-b557-60d782ca8387",
  };
  const waitRoute = "http://127.0.0.1:5678/webhook-waiting/1495?signature=test-signature";

  assert.equal(
    buildAuditStageUrl(context, chapter),
    "/books/cd726e72-bf3f-4d21-a90c-70cd7dd38f30/audit?chapter_id=815fe390-94e1-4a51-947b-6db2412b5a11&chapter_version_id=987409eb-05b4-43d8-b557-60d782ca8387",
  );
  assert.equal(storeIssuedAuditWaitRoute(sessionStorage, context, chapter, { wait_route: waitRoute }), waitRoute);
  assert.deepEqual([...entries.values()], [waitRoute]);
});

test("FP009 presentation intent rejects an incomplete L1A scope", () => {
  assert.throws(
    () => buildAuditPresentationIntent(
      { localOperatorId: "3d5a33f3-4ae0-4a5f-bd7e-9a04b84ac111", bookId: "cd726e72-bf3f-4d21-a90c-70cd7dd38f30" },
      {},
      "audit-presentation-7f34ad20",
    ),
    (error) => error instanceof DeductionDataError && error.code === "INVALID_DEDUCTION_CONTEXT",
  );
});

test("FP009 presentation surfaces the workflow's preflight blocker without treating it as prose", async () => {
  const calls = [];
  await assert.rejects(
    () => sendAuditPresentationIntent(
      {
        localOperatorId: "3d5a33f3-4ae0-4a5f-bd7e-9a04b84ac111",
        bookId: "cd726e72-bf3f-4d21-a90c-70cd7dd38f30",
      },
      { id: L1A },
      "audit-presentation-7f34ad20",
      {
        endpoint: "http://127.0.0.1:5678/webhook/audit_stage",
        fetchImpl: async (url, options) => {
          calls.push({ url, options });
          return {
            ok: true,
            status: 200,
            json: async () => ({
              ok: false,
              redacted_error: { code: "DEDUCTION_NOT_LOCKED", message: "candidate is not locked" },
            }),
          };
        },
      },
    ),
    (error) => error instanceof DeductionDataError && error.code === "DEDUCTION_NOT_LOCKED",
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:5678/webhook/audit_stage");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    local_operator_id: "3d5a33f3-4ae0-4a5f-bd7e-9a04b84ac111",
    book_id: "cd726e72-bf3f-4d21-a90c-70cd7dd38f30",
    l1a_unit_id: L1A,
    idempotency_key: "audit-presentation-7f34ad20",
  });
});

test("FP009 rejects an HTTP 200 workflow response without an explicit success envelope", async () => {
  await assert.rejects(
    () => sendAuditPresentationIntent(
      {
        localOperatorId: "3d5a33f3-4ae0-4a5f-bd7e-9a04b84ac111",
        bookId: "cd726e72-bf3f-4d21-a90c-70cd7dd38f30",
      },
      { id: L1A },
      "audit-presentation-7f34ad20",
      {
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => ({ error: "workflow stopped before a controlled response" }),
        }),
      },
    ),
    (error) => error instanceof DeductionDataError && error.code === "HTTP_200",
  );
});

test("FP009 presents V7's formal word-count blocker without opening creator confirmation", async () => {
  await assert.rejects(
    () => sendAuditPresentationIntent(
      {
        localOperatorId: "3d5a33f3-4ae0-4a5f-bd7e-9a04b84ac111",
        bookId: "cd726e72-bf3f-4d21-a90c-70cd7dd38f30",
      },
      { id: L1A },
      "audit-presentation-7f34ad20",
      {
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            ok: false,
            redacted_error: {
              code: "WORD_COUNT_CONTRACT_UNRESOLVED",
              message: "raw workflow text must not replace the V7 page explanation",
            },
          }),
        }),
      },
    ),
    (error) => error instanceof DeductionDataError
      && error.code === "WORD_COUNT_CONTRACT_UNRESOLVED"
      && error.message === "无法确定正式章节字数和进度，当前章节不能进入作者确认。",
  );
});

test("FP009 does not open the audit page for a主编 N response", async () => {
  await assert.rejects(
    () => sendAuditPresentationIntent(
      {
        localOperatorId: "3d5a33f3-4ae0-4a5f-bd7e-9a04b84ac111",
        bookId: "cd726e72-bf3f-4d21-a90c-70cd7dd38f30",
      },
      { id: L1A },
      "audit-presentation-7f34ad20",
      {
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            wait_route: "http://127.0.0.1:5678/webhook-waiting/2207?signature=same-run",
            decision: { verdict: "N", force_manual: false },
          }),
        }),
      },
    ),
    (error) => error instanceof DeductionDataError && error.code === "EDITORIAL_REWRITING",
  );
});

test("FP009 treats the existing n8n error-output context as a controlled blocker", async () => {
  await assert.rejects(
    () => sendAuditPresentationIntent(
      {
        localOperatorId: "3d5a33f3-4ae0-4a5f-bd7e-9a04b84ac111",
        bookId: "cd726e72-bf3f-4d21-a90c-70cd7dd38f30",
      },
      { id: L1A },
      "audit-presentation-7f34ad20",
      {
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            context: {
              redacted_error: { code: "SCOPE_REJECTED", message: "The selected book is unavailable." },
            },
            error: "A non-empty prompt is required.",
          }),
        }),
      },
    ),
    (error) => error instanceof DeductionDataError && error.code === "SCOPE_REJECTED",
  );
});

test("missing review context uses the existing controlled state instead of exposing prototype review data", async () => {
  const module = await readFile(modulePath, "utf8");

  assert.match(module, /function isReviewContextError\(error\)/);
  assert.match(module, /\["BOOK_CONTEXT_REQUIRED", "LOCAL_OPERATOR_REQUIRED"\]\.includes\(error\.code\)/);
  assert.match(module, /const contextError = isReviewContextError\(error\);/);
  assert.match(module, /setState\(root, contextError \? "context" : "error"/);
});

test("a valid review route without matching B1 context does not claim its URL is invalid", () => {
  assert.throws(
    () => resolveAuditReviewContext({
      locationLike: { pathname: `/books/${L1A}/deduction-review`, search: "" },
      storage: { getItem: () => null },
    }),
    (error) => error instanceof DeductionDataError
      && error.code === "BOOK_CONTEXT_REQUIRED"
      && error.message === "当前路由的作品上下文不可用，请从作品工作流重新进入。",
  );
});

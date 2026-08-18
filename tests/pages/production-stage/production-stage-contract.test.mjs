import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { canSwitchProductionL1a, hasChapterDivision, normalizeProductionProjection, productionCandidateDisplay, productionRequest, productionStartHint, resolveProductionContext } from "../../../apps/web/src/pages/production-stage/index.mjs";

const pagePath = new URL("../../../apps/web/src/pages/production-stage/index.html", import.meta.url);
const modulePath = new URL("../../../apps/web/src/pages/production-stage/index.mjs", import.meta.url);
const cssPath = new URL("../../../apps/web/src/pages/production-stage/page.css", import.meta.url);
const sharedSidebarPath = new URL("../../../apps/web/src/pages/prototype/common/sidebar.js", import.meta.url);
const bookId = "11111111-1111-4111-8111-111111111111";
const operatorId = "22222222-2222-4222-8222-222222222222";

test("production context only reads a matching saved B1 scope", () => {
  const context = resolveProductionContext({
    locationLike: { pathname: `/books/${bookId}/production/`, search: "" },
    storage: { getItem: () => JSON.stringify({ current_book_id: bookId, local_operator_id: operatorId }) },
  });
  assert.deepEqual(context, { bookId, localOperatorId: operatorId });
  assert.throws(() => resolveProductionContext({ locationLike: { pathname: "/production/", search: "" }, storage: { getItem: () => null } }));
  assert.throws(() => resolveProductionContext({ locationLike: { pathname: `/books/${bookId}/production/`, search: "" }, storage: { getItem: () => null } }));
});

test("production projection selects a documented locked L1A without persisting in the browser", () => {
  const firstL1a = "33333333-3333-4333-8333-333333333333";
  const secondL1a = "44444444-4444-4444-8444-444444444444";
  const base = {
    book: { book_id: bookId, title: "Test book", current_l1a_id: null },
    l1as: [
      { l1a_id: firstL1a, l1a_index: 1, l1a_name: "First", status: "finalized", is_formal: true, is_locked: true },
      { l1a_id: secondL1a, l1a_index: 2, l1a_name: "Second", status: "finalized", is_formal: true, is_locked: true },
    ],
  };
  assert.equal(normalizeProductionProjection(base).selectedL1aId, firstL1a);
  assert.equal(normalizeProductionProjection({ ...base, book: { ...base.book, current_l1a_id: secondL1a } }).selectedL1aId, secondL1a);
  assert.equal(productionRequest({ bookId, localOperatorId: operatorId }, "generate", { l1a_id: firstL1a }).l1a_id, firstL1a);
});

test("production start hint distinguishes missing scope from an in-progress L1A", () => {
  assert.equal(productionStartHint(null, null), "缺少作品或操作者范围");
  assert.equal(productionStartHint({ bookId, localOperatorId: operatorId }, null), "请先选择正式锁定的 L1A");
  assert.equal(productionStartHint({ bookId, localOperatorId: operatorId }, { status: "locked_for_deduction" }), "当前 L1A 已进入推演，暂不能重新生成方案");
});

test("production keeps L1A selection open until candidate chapters are established", () => {
  assert.equal(canSwitchProductionL1a(null), true);
  assert.equal(canSwitchProductionL1a({ status: "finalized" }), true);
  assert.equal(canSwitchProductionL1a({ status: "completed" }), true);
  assert.equal(canSwitchProductionL1a({ status: "locked_for_deduction" }), false);
});

test("production page does not make an empty chapter division approvable", () => {
  assert.equal(hasChapterDivision({ chapter_division: [] }), false);
  assert.equal(hasChapterDivision({ chapter_division: [{ chapter_seq: 1 }] }), true);
});

test("production candidate display binds V7 runtime objects without treating L1A intent as a chapter boundary", () => {
  const display = productionCandidateDisplay({
    context: { characters: [{ character_id: "33333333-3333-4333-8333-333333333333", char_name: "江枫" }] },
    l1a_presentation_plan: {
      plot_retained: [{ content: "资源盘点暴露方舟建设缺口" }],
      small_arc_sequence: [{ arc_node: "发现资源缺口" }],
      hook_positions: [{ content: "西侧入口的灯光突然熄灭" }],
      revelation_plan: { has_truth_particle: true, technical: "熔炼能力受输入材料限制", institutional: "配给必须记录", philosophical: "" },
      chapter_division: [{ chapter_seq: 1 }],
    },
    scene_condition_package: {
      scene_location: "方舟预定建设地",
      participant_chars: ["33333333-3333-4333-8333-333333333333"],
      available_resource_codes: ["维修间", "配电间"],
      scene_constraints: ["资源必须经盘点与运输取得"],
      forbid_lines_active: ["本 L1A 的宏观意图，不是章节硬约束"],
    },
  });

  assert.equal(display.phase, "发现资源缺口");
  assert.equal(display.events, "资源盘点暴露方舟建设缺口");
  assert.equal(display.hooks, "西侧入口的灯光突然熄灭");
  assert.equal(display.boundary, "资源必须经盘点与运输取得");
  assert.equal(display.scene, "方舟预定建设地；可支配资源：维修间；配电间");
  assert.deepEqual(display.participants, ["江枫"]);
  assert.doesNotMatch(display.events, /\[object Object\]/);
  assert.doesNotMatch(display.boundary, /宏观意图/);
});

test("production page preserves prototype anchors and exposes only the approved generate approve return flow", async () => {
  const [html, module, css] = await Promise.all([readFile(pagePath, "utf8"), readFile(modulePath, "utf8"), readFile(cssPath, "utf8")]);
  for (const anchor of ["main-content", "l1a-dropdown-container", "l1a-current-label", "emotion-chart-area", "plan-generation-btn", "chapter-detail-grid", "production-state-overlay", "submit-replan-btn"]) {
    assert.match(html, new RegExp(`id=["']${anchor}["']`));
  }
  assert.match(module, /content_production/);
  assert.match(module, /singleFlight/);
  assert.match(module, /l1a_presentation_plan/);
  assert.match(module, /scene_condition_package: candidate\.scene_condition_package/);
  assert.match(module, /idempotency_key/);
  assert.match(module, /action, extras/);
  assert.match(module, /productionRequest\(runtime\.context, "read"\)/);
  assert.match(module, /selectedL1aId/);
  assert.doesNotMatch(module, /localStorage\.setItem|static_mock|setTimeout|\/api\/books/);
  assert.match(css, /#production-state-overlay/);
  assert.match(css, /\.production-l1a-option/);
  assert.match(css, /#regenerate-modal > div\s*\{[\s\S]*?width:\s*min\(460px, calc\(100vw - 32px\)\)[\s\S]*?overscroll-behavior:\s*contain;/);
  assert.match(module, /root\.setAttribute\("inert", ""\);/);
  assert.match(module, /root\.removeAttribute\("inert"\);/);
  assert.match(module, /const focusable = \[\.\.\.modal\.querySelectorAll\(/);
});

test("production delegates sidebar toggling to the shared sidebar owner", async () => {
  const [module, sharedSidebar] = await Promise.all([
    readFile(modulePath, "utf8"),
    readFile(sharedSidebarPath, "utf8"),
  ]);

  assert.match(sharedSidebar, /window\.toggleSidebar/);
  assert.doesNotMatch(module, /function bindSidebar\(/);
  assert.doesNotMatch(module, /bindSidebar\(root\)/);
});

test("production page keeps unsupported participant additions visibly disabled", async () => {
  const [html, css] = await Promise.all([readFile(pagePath, "utf8"), readFile(cssPath, "utf8")]);
  assert.match(html, /id="production-add-character-btn"[^>]*disabled[^>]*aria-disabled="true"/u);
  assert.match(html, /id="production-add-character-btn"[^>]*title="生产阶段暂无角色增补合同。"/u);
  assert.match(html, /class="production-action-button[^"]*whitespace-nowrap/u);
  assert.match(css, /\.production-action-button\s*\{[\s\S]*flex:\s*1 1 144px[\s\S]*min-width:\s*144px/u);
  assert.match(css, /\.production-approval-actions\s*\{[\s\S]*flex-wrap:\s*wrap/u);
});

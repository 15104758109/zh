import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const sourcePath = `${root}docs/前端原型_v2/pages/audit_stage.html`;
const pagePath = `${root}apps/web/src/pages/audit-stage/index.html`;
const modulePath = `${root}apps/web/src/pages/audit-stage/index.mjs`;
const stylesheetPath = `${root}apps/web/src/pages/audit-stage/page.css`;
const sharedSidebarPath = `${root}apps/web/src/pages/prototype/common/sidebar.js`;

function ids(html) {
  return [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
}

test("AUDIT_STAGE keeps prototype anchors and binds the scoped audit projection in place", async () => {
  const [source, html, module, stylesheet, sharedSidebar] = await Promise.all([
    readFile(sourcePath, "utf8"),
    readFile(pagePath, "utf8"),
    readFile(modulePath, "utf8"),
    readFile(stylesheetPath, "utf8"),
    readFile(sharedSidebarPath, "utf8"),
  ]);

  const targetIds = new Set(ids(`${html}\n${sharedSidebar}`));
  assert.deepEqual(ids(source).filter((id) => !targetIds.has(id)), []);
  for (const region of ["sidebar", "topbar", "prose_view", "objective_audit", "editor_decision", "enhancement", "release_actions"]) {
    assert.match(html, new RegExp(`data-region=["']${region}["']`));
  }
  assert.match(html, /data-shared-sidebar[^>]+data-sidebar-active="audit"/);
  assert.match(sharedSidebar, /item\.id === active \? "active"/);
  assert.match(sharedSidebar, /item\.id === active \? ` aria-current="page"`/);
  assert.doesNotMatch(sharedSidebar, /href:\s*"[^"]+\.html"/);
  const topbar = html.match(/<header[^>]*data-region="topbar"[^>]*>([\s\S]*?)<\/header>/)?.[1] || "";
  assert.match(topbar, /id="view-audit-btn"[^>]*aria-pressed="true">审计<\/button>/);
  assert.match(topbar, /id="view-assets-btn"[^>]*aria-pressed="false">资产<\/button>/);
  assert.equal((html.match(/data-interaction="switch_audit_panel"/g) || []).length, 1);
  assert.doesNotMatch(topbar, /href="audit_review\.html"/);
  assert.match(html, /data-interaction="show_returned_state"/);
  assert.match(html, /id="replan-chapter-btn" onclick="openReplanModal\(\)" data-interaction="open_returned_state"/);
  assert.match(html, /id="confirm-replan-btn" onclick="showReturnedState\(\)" data-interaction="show_returned_state"/);
  assert.match(html, /data-interaction="show_released_state"/);
  assert.equal((html.match(/data-mvp-deferred="FP011"/g) || []).length, 2);
  assert.match(html, /id="start-presentation-btn"[^>]+disabled[^>]+data-contract-unavailable="true"/);
  assert.match(html, /id="tab-audit-objective"[^>]+disabled[^>]+data-contract-unavailable="true"/);
  assert.match(html, /id="approve-chapter-btn"[^>]+disabled[^>]+data-contract-unavailable="true"/);
  assert.match(html, /id="replan-chapter-btn"[^>]+disabled[^>]+data-contract-unavailable="true"/);
  assert.match(html, /id="confirm-replan-btn"[^>]+disabled[^>]+data-contract-unavailable="true"/);
  assert.match(html, /id="tab-audit-commercial"[^>]+disabled[^>]+aria-disabled="true"/);
  assert.match(html, /id="tab-audit-reader"[^>]+disabled[^>]+aria-disabled="true"/);
  assert.match(html, /data-audit-stage-state-overlay data-state="blocked"/);
  assert.match(html, /data-mode="contract_unavailable"/);
  assert.match(html, /data-audit-stage-mock-content hidden inert aria-hidden="true"/);
  assert.match(html, /function updateUnavailableViewNotice\(mode\)/);
  assert.match(html, /updateUnavailableViewNotice\('assets'\)/);
  assert.match(html, /updateUnavailableViewNotice\('audit'\)/);
  assert.match(html, /资产数据尚未接入/);
  assert.doesNotMatch(html, /static_mock/);
  assert.doesNotMatch(html, /正文呈现渲染完毕|已完成第 0.*正文放行回写|修正意见已提交/);
  for (const asset of [
    "/vendor/font-fallback.css",
    "/vendor/daisyui-4.12.10-full.css",
    "/pages/prototype/common/theme.css",
    "/pages/prototype/common/sidebar.css",
    "/pages/prototype/common/theme.js",
    "/pages/prototype/common/sidebar.js",
    "/vendor/tailwindcss-browser-4.js",
  ]) {
    assert.match(html, new RegExp(asset.replaceAll("/", "\\/")));
  }
  assert.doesNotMatch(html, /(?:src|href)=["'](?:\.\.\/common\/|\.\/new_book_wizard_data\.js|https?:\/\/)/);
  for (const id of ["sw-auto-production", "sw-auto-audit", "sw-auto-iteration"]) {
    assert.match(html, new RegExp(`id=["']${id}["'][^>]+data-contract-unavailable=["']true["'][^>]+aria-disabled=["']true["']`));
  }
  assert.match(html, /<script type="module" src="\/pages\/audit-stage\/index\.mjs"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="\/pages\/audit-stage\/page\.css">/);
  assert.doesNotMatch(html, /docs[\\/]前端原型|<(?:i?frame)\b/i);

  assert.match(stylesheet, /\[data-audit-stage-state-overlay\][\s\S]*position:\s*fixed\s*!important/);
  assert.match(stylesheet, /inset:\s*64px\s+0\s+0\s+var\(--sidebar-w\)\s*!important/);

  assert.doesNotMatch(module, /\bcontent\s*\.\s*(?:innerHTML|outerHTML|textContent)\s*=/);
  assert.doesNotMatch(module, /\bcontent\s*\.\s*(?:replaceChildren|append|appendChild|prepend|insertAdjacentHTML|insertAdjacentElement)\s*\(/);
  assert.doesNotMatch(module, /\.innerHTML\s*=/);
  assert.doesNotMatch(module, /<(?:section|div|main)\b/);
  assert.match(module, /function setState/);
  assert.match(module, /function showReadyState/);
  assert.match(module, /function setAuditContentVisible/);
  assert.match(module, /function renderProse/);
  assert.match(module, /function renderAuditTabs/);
  assert.match(module, /function renderAuditDetails/);
  assert.match(module, /function renderActions/);
  assert.match(module, /当前页面只允许对服务端已返回的正式章节提交继续或退回/);
  assert.match(module, /当前审计读取合同未返回叙事资产/);
  assert.match(module, /function bindViewControls/);
  assert.match(module, /fetchAuditProjection/);
  assert.match(module, /sendAuditConfirmationIntent/);
  assert.match(module, /auditNextAction/);
  assert.match(module, /readAuditWaitRoute/);
  assert.match(module, /readReusableAuditWaitRoute/);
  assert.match(module, /button\.removeAttribute\("onclick"\)/);
  assert.match(module, /context: \["无法确认当前作品"/);
  assert.match(module, /import "\.\.\/prototype\/common\/book-context\.js"/);
  assert.match(module, /readMatchingBookContext/);
  assert.match(module, /requireRoute: true/);
  assert.doesNotMatch(module, /bookIdFromLocation/);
  assert.doesNotMatch(module, /book-ashfall/);
  assert.match(module, /root\.ownerDocument\.querySelectorAll\("a\[href\]"\)/);
  assert.match(module, /name === "iteration\.html"/);
  assert.match(module, /blocked: \["当前候选需要人工处理"/);
  assert.match(module, /loading: \["正在读取审计结果"/);
  assert.match(module, /return Object\.hasOwn\(stateCopy, value\) \? value : "error"/);
  assert.match(module, /overlay\.hidden = false/);
  assert.match(module, /overlay\.dataset\.state = active/);
  assert.match(module, /container\.hidden = !visible/);
  assert.match(module, /container\.inert = !visible/);
  assert.match(module, /container\.setAttribute\("aria-hidden", "true"\)/);
  assert.match(module, /setAuditContentVisible\(root, true\)/);
  assert.match(module, /chapter_version_id/);
  assert.match(module, /当前正式正文不可用/);
  assert.match(module, /createNode\(doc, "p", "leading-relaxed text-base-content", paragraph\)/);
  assert.doesNotMatch(module, /createNode\(doc, "p", "text-lg leading-relaxed text-base-content", paragraph\)/);
  assert.match(html, /本次推演章节 \(当前 L1A 正式章节\)/);
  assert.match(html, /class="space-y-8 leading-relaxed text-lg max-w-4xl mx-auto"/);
  assert.match(module, /主编已放行/);
  assert.match(module, /继续或退回所需的受控确认地址尚未返回/);
  assert.match(module, /continue_next_chapter/);
  assert.match(module, /退回当前章/);
  assert.doesNotMatch(module, /主编退回/);
  assert.doesNotMatch(module, /static_mock/);
  assert.doesNotMatch(module, /showReleasedState\(\).*released/s);
  assert.match(module, /routeFor\(bookId, "audit"\)/);
  assert.doesNotMatch(module, /routeFor\(bookId, "deduction-review"\)/);
});

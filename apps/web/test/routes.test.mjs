import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pageDirectories = ["workbench", "skill-library", "new-book", "world", "characters", "l1a", "production-stage", "multi-agent-deduction", "audit-review", "audit-stage", "iteration"];

test("router registers all eleven static restore routes", async () => {
  const source = await readFile(new URL("../src/app/routes.mjs", import.meta.url), "utf8");
  assert.equal((source.match(/page: "pages\//g) || []).length, 11);
});

test("shared sidebar emits only canonical application routes", async () => {
  const [sidebar, theme] = await Promise.all([
    readFile(new URL("../src/pages/prototype/common/sidebar.js", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/prototype/common/theme.js", import.meta.url), "utf8"),
  ]);
  assert.match(sidebar, /path: "\/workbench"/);
  for (const segment of ["world", "production", "audit", "iteration"]) assert.match(sidebar, new RegExp(`segment: "${segment}"`));
  assert.match(sidebar, /`\/books\/\$\{encodeURIComponent\(bookId\)\}\/\$\{item\.segment\}`/);
  assert.match(sidebar, /window\.location\.pathname\.match\(\/\^\\\/books\\\/\(\[\^\/\]\+\)\\\//);
  assert.match(sidebar, /decodeURIComponent\(routeMatch\[1\]\)/);
  assert.match(sidebar, /aria-disabled="true"/);
  assert.doesNotMatch(sidebar, /href:\s*"[^"]+\.html"/);
  assert.match(theme, /localStorage\.setItem\("sidebar-state", state\)/);
  assert.match(theme, /syncSidebarToggleState\(\)/);
  assert.match(theme, /setAttribute\("aria-expanded", String\(!collapsed\)\)/);
});

test("shared sidebar carries a verified book id when returning to workbench", async () => {
  const sidebar = await readFile(new URL("../src/pages/prototype/common/sidebar.js", import.meta.url), "utf8");
  assert.match(sidebar, /item\.id === "workbench" && bookId/);
  assert.match(sidebar, /`\/workbench\?book_id=\$\{encodeURIComponent\(bookId\)\}`/);
});

test("workbench shows no invented L1A target before a V7 projection exists", async () => {
  const [page, runtime] = await Promise.all([
    readFile(new URL("../src/pages/workbench/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/workbench/workbench-runtime.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(page, /id="currentBookL1aTarget"[^>]*>待有效投影</);
  assert.doesNotMatch(page, /currentBookL1a[^<]*<\/span><span[^>]*>\/ 100/);
  assert.match(runtime, /\? "目标未定义"/);
});

test("new book keeps the shared prototype sidebar geometry", async () => {
  const [newBook, sharedSidebar] = await Promise.all([
    readFile(new URL("../src/pages/new-book/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/prototype/common/sidebar.css", import.meta.url), "utf8"),
  ]);
  const sharedWidths = [...sharedSidebar.matchAll(/--sidebar-w:\s*(\d+px)/g)].map((match) => match[1]);
  assert.deepEqual(sharedWidths.slice(0, 2), ["200px", "64px"]);
  assert.match(newBook, /href="\/pages\/prototype\/common\/sidebar\.css"/);
  assert.doesNotMatch(newBook, /--sidebar-w:\s*\d+px/);
});

test("shared page content keeps the available desktop width when runtime data is empty", async () => {
  const sharedSidebar = await readFile(new URL("../src/pages/prototype/common/sidebar.css", import.meta.url), "utf8");
  assert.match(sharedSidebar, /\.main-content\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-width:\s*0;/s);
});

test("shared header leaves FP016 configuration to the workbench runtime", async () => {
  const header = await readFile(new URL("../src/pages/prototype/common/header.js", import.meta.url), "utf8");
  assert.doesNotMatch(header, /NEW_BOOK_WIZARD_DATA/);
  assert.doesNotMatch(header, /book\[key\]\s*=/);
  assert.match(header, /window\.toggleAutoSwitch = function \(\) \{\s*return false;/);
  assert.match(header, /window\.location\.pathname === '\/workbench'/);
  assert.match(header, /setAttribute\('aria-disabled', 'true'\)/);
  assert.match(header, /el\.inert = true;/);
  assert.match(header, /pointerEvents = 'none';/);
  assert.match(header, /请在工作台统一配置/);
});

test("audit quick settings exposes one in-popover apply command", async () => {
  const audit = await readFile(new URL("../src/pages/audit-stage/index.html", import.meta.url), "utf8");
  assert.equal((audit.match(/应用当前配置/g) || []).length, 1);
  const popover = audit.slice(audit.indexOf('id="quick-settings-popover"'), audit.indexOf('<div class="h-8 w-[1px]'));
  assert.match(popover, /应用当前配置/);
});

test("audit route explains that a scoped candidate is not yet a formal chapter", async () => {
  const [server, adapter] = await Promise.all([
    readFile(new URL("../src/app/server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/audit-stage/index.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(server, /scoped_candidate AS/u);
  assert.match(server, /FORMAL_CHAPTER_REQUIRED/u);
  assert.match(server, /当前章节尚未正式写入/u);
  assert.match(adapter, /当前章节尚不能进入作者确认/u);
  assert.match(adapter, /FORMAL_CHAPTER_REQUIRED[\s\S]*\? "empty"/u);
});

test("normal routes load only canonical application-owned page DOM", async () => {
  const [server, routes, newBook, auditStage, world] = await Promise.all([
    readFile(new URL("../src/app/server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/app/routes.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/new-book/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/audit-stage/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/world/index.html", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(server, /prototypeRoot|4179|docs[\\/]\S*prototype/i);
  assert.doesNotMatch(routes, /<(?:i?frame)\b|document\.write|fetch\(|prototype\.html/i);
  assert.match(server, /resolvePageRoute\(pathname\)/);
  assert.match(server, /route\.page/);
  assert.match(server, /<base href=/);
  assert.match(newBook, /\u65b0\u4e66\u521b\u4e16/);
  assert.doesNotMatch(newBook, /fonts\.googleapis\.com/i);
  assert.match(auditStage, /auditBtn\?\.addEventListener/);
  assert.match(world, /\u62d6\u62fd|\u7ed1\u5b9a/);
  for (const directory of pageDirectories) {
    await readFile(new URL(`../src/pages/${directory}/index.html`, import.meta.url), "utf8");
  }
});

test("route entry delegates book context and states to each preserved page adapter", async () => {
  const [routes, auditStage, auditReview] = await Promise.all([
    readFile(new URL("../src/app/routes.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/audit-stage/index.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/audit-review/index.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(routes, /audit-stage\/index\.html/);
  assert.match(auditStage, /readMatchingBookContext/);
  assert.match(auditStage, /requireRoute: true/);
  assert.doesNotMatch(auditStage, /bookIdFromLocation/);
  assert.match(auditStage, /new URLSearchParams\(locationLike\?\.search \|\| ""\)\.get\("state"\)/);
  assert.match(auditReview, /resolveAuditReviewContext/);
  assert.match(auditReview, /fetchDeductionProjection/);
  assert.match(auditReview, /new URLSearchParams\(window\.location\.search\)\.get\("state"\)/);
});

test("static delivery pins remote UI dependencies to application-owned vendor assets", async () => {
  const [server, manifest, daisy, tailwind, fontFallback, materialIcons] = await Promise.all([
    readFile(new URL("../src/app/server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/vendor/SOURCES.json", import.meta.url), "utf8"),
    readFile(new URL("../src/vendor/daisyui-4.12.10-full.css", import.meta.url), "utf8"),
    readFile(new URL("../src/vendor/tailwindcss-browser-4.js", import.meta.url), "utf8"),
    readFile(new URL("../src/vendor/font-fallback.css", import.meta.url), "utf8"),
    readFile(new URL("../src/vendor/material-icons-outlined.woff2", import.meta.url)),
  ]);
  assert.match(server, /pathname\.startsWith\("\/vendor\/"\)/);
  assert.match(server, /localizeStaticAssets/);
  assert.match(server, /\/vendor\/daisyui-4\.12\.10-full\.css/);
  assert.match(server, /\/vendor\/tailwindcss-browser-4\.js/);
  assert.match(server, /\/vendor\/font-fallback\.css/);
  assert.match(manifest, /"version": "4\.3\.2"/);
  assert.match(daisy, /\.btn\b/);
  assert.match(tailwind, /tailwindcss/i);
  assert.match(fontFallback, /network-free fallback/);
  assert.match(fontFallback, /material-icons-outlined\.woff2/);
  assert.ok(materialIcons.byteLength > 100_000);
});

test("source page entries do not retain fixed Google or jsDelivr UI dependencies", async () => {
  for (const directory of pageDirectories) {
    const page = await readFile(new URL(`../src/pages/${directory}/index.html`, import.meta.url), "utf8");
    assert.doesNotMatch(page, /https:\/\/fonts\.googleapis\.com\//, directory);
    assert.doesNotMatch(page, /https:\/\/cdn\.jsdelivr\.net\/npm\/(?:daisyui|@tailwindcss)\//, directory);
  }
});

test("page webhook defaults use the IPv4 loopback without removing environment overrides", async () => {
  const sources = await Promise.all([
    readFile(new URL("../src/pages/new-book/new-book-bridge.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/world/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/characters/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/production-stage/index.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/multi-agent-deduction/index.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/multi-agent-deduction/deduction-data-client.mjs", import.meta.url), "utf8"),
  ]);
  for (const source of sources) {
    assert.doesNotMatch(source, /http:\/\/localhost:5678\/webhook/);
    assert.match(source, /http:\/\/127\.0\.0\.1:5678\/webhook/);
  }
  assert.match(sources[0], /window\.NEW_BOOK_WEBHOOK_URL/);
  assert.match(sources[1], /window\.WORLD_WEBHOOK_URL/);
  assert.match(sources[2], /window\.CHARACTER_SETTINGS_WEBHOOK_URL/);
  assert.match(sources[3], /PRODUCTION_WEBHOOK_URL/);
  assert.match(sources[4], /DEDUCTION_WEBHOOK_URL/);
});

test("L1A runtime avatars do not depend on remote image sources", async () => {
  const [l1a, l1aModule] = await Promise.all([
    readFile(new URL("../src/pages/l1a/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/l1a/index.mjs", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(l1a, /https:\/\/lh3\.googleusercontent\.com\//);
  assert.match(l1aModule, /avatar\.textContent = asText\(character\.char_name, "\?"\)\.slice\(0, 1\)/);
  assert.match(l1aModule, /avatar\.className = .*bg-neutral.*grid place-items-center/);
});

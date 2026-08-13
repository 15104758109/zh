import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sharedPages = new Map([
  ["workbench", "workbench"],
  ["skill-library", "workbench"],
  ["world", "design"],
  ["characters", "design"],
  ["l1a", "design"],
  ["production-stage", "production"],
  ["multi-agent-deduction", "production"],
  ["audit-review", "production"],
  ["audit-stage", "audit"],
  ["new-book", "design"],
]);

const readPage = (directory) => readFile(new URL(`../src/pages/${directory}/index.html`, import.meta.url), "utf8");

test("prototype pages mount one shared sidebar and do not own collapse state", async () => {
  for (const [directory, active] of sharedPages) {
    const html = await readPage(directory);
    assert.equal((html.match(/\bdata-shared-sidebar\b/g) || []).length, 1, `${directory} shared sidebar mount`);
    assert.match(html, new RegExp(`data-sidebar-active=["']${active}["']`), `${directory} active stage`);
    assert.match(html, /prototype\/common\/theme\.css/, `${directory} shared theme`);
    assert.equal((html.match(/prototype\/common\/sidebar\.js/g) || []).length, 1, `${directory} sidebar runtime`);
    assert.doesNotMatch(html, /<ul[^>]+(?:sidebar-menu|id=["']sidebarMenu)/, `${directory} duplicates menu markup`);
    assert.doesNotMatch(html, /<button[^>]+sidebar-toggle/, `${directory} duplicates toggle markup`);
    assert.doesNotMatch(html, /(?:window\.)?toggleSidebar\s*=\s*function|function\s+toggleSidebar\s*\(/, `${directory} overrides shared collapse state`);
  }
});

test("new-book keeps its pre-book design route while delegating the shell to shared navigation", async () => {
  const html = await readPage("new-book");
  assert.match(html, /data-sidebar-design-href=["']\/books\/new["']/);
  assert.doesNotMatch(html, /function\s+renderSidebar\s*\(/);
  assert.doesNotMatch(html, /document\.documentElement\.classList\.toggle\("sidebar-collapsed"\)/);
  assert.doesNotMatch(html, /\.sidebar-glass\s*\{/);
});

test("shared theme restores the persisted collapse state only after the body exists", async () => {
  const [theme, sidebar] = await Promise.all([
    readFile(new URL("../src/pages/prototype/common/theme.js", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/prototype/common/sidebar.js", import.meta.url), "utf8"),
  ]);
  assert.match(theme, /function restoreSidebarState\(\)/);
  assert.match(theme, /addEventListener\("DOMContentLoaded", restoreSidebarState, \{ once: true \}\)/);
  assert.match(theme, /classList\.toggle\("sidebar-collapsed", state === "collapsed"\)/);
  assert.match(theme, /localStorage\.setItem\("sidebar-state", state\)/);
  assert.match(theme, /setAttribute\("aria-expanded", String\(!collapsed\)\)/);
  assert.doesNotMatch(sidebar, /classList\.toggle\("sidebar-collapsed"\)|sidebar-state|setAttribute\("aria-expanded"/);
  assert.match(sidebar, /window\.syncSidebarToggleState\(\)/);
});

test("quick-settings events have one shared owner", async () => {
  const [theme, header] = await Promise.all([
    readFile(new URL("../src/pages/prototype/common/theme.js", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/prototype/common/header.js", import.meta.url), "utf8"),
  ]);
  assert.equal((`${theme}\n${header}`.match(/window\.toggleQuickSettings\s*=\s*function/g) || []).length, 1);
  assert.match(theme, /quick-settings-popover/);
  assert.doesNotMatch(header, /document\.getElementById\('quick-settings-popover'\)/);
});

test("shared header accepts only an existing matching book context", async () => {
  const header = await readFile(new URL("../src/pages/prototype/common/header.js", import.meta.url), "utf8");
  assert.match(header, /function syncRouteBookContext\(\)/);
  assert.match(header, /zhreplan\.local_operator_id\.v1/);
  assert.match(header, /current\?\.current_book_id\?\.toLowerCase\(\) !== bookId\) return null/);
  assert.doesNotMatch(header, /localStorage\.setItem\("current_book_context"/);
  assert.match(header, /if \(!UUID_PATTERN\.test\(operatorId\)\) return null/);
  assert.match(header, /作品 \$\{routeBook\.slice\(0, 8\)\}/);
  assert.match(header, /window\.syncRouteBookContext = syncRouteBookContext/);
  assert.match(header, /addEventListener\('load', initReadOnlyHeader, \{ once: true \}\)/);
});

test("shared sidebar does not promote a bare route UUID into a usable book context", async () => {
  const sidebar = await readFile(new URL("../src/pages/prototype/common/sidebar.js", import.meta.url), "utf8");
  assert.match(sidebar, /const context = JSON\.parse\(localStorage\.getItem\("current_book_context"/);
  assert.match(sidebar, /routeBookId\.toLowerCase\(\) !== contextBookId/);
  assert.match(sidebar, /return null;/);
});

test("shared shell keeps the prototype default brand icon when no page override is required", async () => {
  const [deduction, review] = await Promise.all([
    readPage("multi-agent-deduction"),
    readPage("audit-review"),
  ]);
  assert.doesNotMatch(deduction, /data-sidebar-brand-icon=/);
  assert.doesNotMatch(review, /data-sidebar-brand-icon=/);
});

test("the active shared navigation item exposes page semantics", async () => {
  const sidebar = await readFile(new URL("../src/pages/prototype/common/sidebar.js", import.meta.url), "utf8");
  assert.match(sidebar, /item\.id === active \? ` aria-current="page"`/);
  assert.match(sidebar, /sidebar\.dataset\.sidebarDesignHref/);
});

test("character design tabs keep the current book id and never use prototype html routes", async () => {
  const [characters, sidebar] = await Promise.all([
    readPage("characters"),
    readFile(new URL("../src/pages/prototype/common/sidebar.js", import.meta.url), "utf8"),
  ]);
  for (const segment of ["world", "characters", "l1a"]) {
    assert.match(characters, new RegExp(`data-book-segment=["']${segment}["']`));
  }
  assert.doesNotMatch(characters, /href=["'][^"']+\.html["']/);
  assert.match(sidebar, /querySelectorAll\("\[data-book-segment\]"\)/);
  assert.match(sidebar, /`\/books\/\$\{encodeURIComponent\(bookId\)\}\/\$\{segment\}`/);
  assert.match(sidebar, /removeAttribute\("href"\)/);
  assert.match(sidebar, /setAttribute\("aria-disabled", "true"\)/);
});

test("formal page tabs use canonical routes instead of prototype html files", async () => {
  const bookPages = new Map([
    ["world", ["world", "characters", "l1a"]],
    ["l1a", ["world", "characters", "l1a"]],
    ["production-stage", ["production", "deduction", "deduction-review"]],
    ["multi-agent-deduction", ["production", "deduction", "deduction-review"]],
    ["audit-review", ["production", "deduction", "deduction-review"]],
  ]);
  for (const [directory, segments] of bookPages) {
    const html = await readPage(directory);
    assert.doesNotMatch(html, /href=["'][^"']+\.html["']/u, `${directory} prototype href`);
    for (const segment of segments) {
      assert.match(html, new RegExp(`data-book-segment=["']${segment}["']`), `${directory} ${segment} tab`);
    }
  }

  const [workbench, skills] = await Promise.all([readPage("workbench"), readPage("skill-library")]);
  for (const html of [workbench, skills]) {
    assert.doesNotMatch(html, /href=["'](?:workbench|skill_library)\.html["']/u);
    assert.match(html, /href=["']\/workbench["']/u);
    assert.match(html, /href=["']\/skill_library\.html["']/u);
  }
});

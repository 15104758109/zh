import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const page = readFileSync(path.join(root, "apps/web/src/pages/new-book/index.html"), "utf8");
const data = readFileSync(path.join(root, "apps/web/src/pages/new-book/new_book_wizard_data.js"), "utf8");
const bridge = readFileSync(path.join(root, "apps/web/src/pages/new-book/new-book-bridge.mjs"), "utf8");

test("new book starts without a fabricated transcript", () => {
  assert.match(data, /chat:\s*\[\s*\]/);
  assert.match(page, /尚无对话记录/);
});

test("correctable character and world validation returns the draft to editing", () => {
  assert.match(bridge, /if \(missingCharacterData\) return \{ state: "returned"/);
  assert.match(bridge, /world_assets\.some[\s\S]*?return \{ state: "returned"/);
});

test("sidebar has one page-bound click path and a root width transition", () => {
  assert.match(page, /:root\.sidebar-collapsed \{ --sidebar-w: 62px; \}/);
  assert.match(page, /new-book-bridge\.mjs\?v=sidebar-truthful-1/);
  assert.doesNotMatch(page, /window\.toggleSidebar\s*=/);
  assert.match(page, /function bindSidebarToggle\(\)/);
  assert.match(page, /z-index: 45/);
  assert.match(page, /document\.documentElement\.classList\.toggle\("sidebar-collapsed"\)/);
  assert.match(page, /toggle\.addEventListener\("click", update\)/);
  assert.match(page, /toggle\.dataset\.newBookSidebarBound = "true"/);
  assert.doesNotMatch(bridge, /bindSidebarToggle/);
  assert.match(page, /const localIconMap/);
  assert.match(page, /new MutationObserver\(\(\) => localizeMaterialIcons\(\)\)/);
  assert.match(page, /icon\.setAttribute\("aria-hidden", "true"\)/);
  assert.doesNotMatch(page, /https?:\/\/[^\s"']+(?:fonts|material)/i);
});

test("final review does not present prototype risks as AI output", () => {
  assert.match(page, /尚未执行 AI 综合分析，暂无分析结果。/);
  assert.match(page, /AI综合分析/);
  assert.doesNotMatch(page, /AI分析结果/);
  assert.doesNotMatch(page, /item\.risks/);
  assert.match(data, /prototypeRisks:/);
});

test("dynamic icon writes are remapped without token or question-mark fallbacks", () => {
  for (const icon of ["public", "group", "gavel", "chevron_right"]) assert.match(page, new RegExp(`${icon}: \\["[^?]`));
  assert.match(page, /const token = icon\.textContent\.trim\(\);/);
  assert.match(page, /icon\.dataset\.localIcon === "true" && !localIconMap\[token\]/);
  assert.match(page, /workIcon\.textContent = item\.icon \|\| "fact_check"[\s\S]*?localizeMaterialIcons\(document\)/);
  assert.equal((page.match(/minimizeIcon\.textContent = "chevron_right"/g) || []).length, 2);
  assert.doesNotMatch(page, /\["\?", "操作"\]/);
});

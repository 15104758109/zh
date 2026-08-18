import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pagePath = new URL("../../../apps/web/src/pages/skill-library/index.html", import.meta.url);

test("skill library keeps closed overlays out of the keyboard path and constrains narrow layouts", async () => {
  const page = await readFile(pagePath, "utf8");

  assert.match(page, /id="detailDrawer"[^>]*aria-hidden="true" inert/);
  assert.match(page, /id="skillFormModal"[^>]*aria-hidden="true" inert/);
  assert.match(page, /drawer\.removeAttribute\('inert'\);/);
  assert.match(page, /drawer\.setAttribute\('inert', ''\);/);
  assert.match(page, /modal\.removeAttribute\('inert'\);/);
  assert.match(page, /modal\.setAttribute\('inert', ''\);/);
  assert.match(page, /w-\[min\(440px,calc\(100vw-16px\)\)\]/);
  assert.match(page, /w-\[min\(500px,calc\(100vw-32px\)\)\][^\"]*max-h-\[calc\(100dvh-32px\)\][^\"]*overflow-y-auto overscroll-contain/);
  assert.match(page, /#modalBox\.skill-modal-expanded \{ width: min\(860px, calc\(100vw - 32px\)\); \}/);
  assert.doesNotMatch(page, /classList\.add\('w-\[860px\]'\)/);
});

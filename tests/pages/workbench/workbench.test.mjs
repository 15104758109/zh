import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const pageDir = path.join(root, "apps", "web", "src", "pages", "workbench");
const page = readFileSync(path.join(pageDir, "index.html"), "utf8");
const runtime = readFileSync(path.join(pageDir, "workbench-runtime.mjs"), "utf8");

test("workbench uses only the mounted runtime and no legacy fallback", () => {
  assert.doesNotMatch(page, /src="\/pages\/workbench\/workbench\.mjs"/);
  assert.doesNotMatch(page, /href="\/pages\/workbench\/workbench\.css"/);
  assert.match(page, /src="\/pages\/workbench\/workbench-runtime\.mjs"/);
  assert.doesNotMatch(page, /node_prompt_/);
  assert.doesNotMatch(page, /loadNodePrompt/);
});

test("workbench has no static fake book options while the stable book-list contract is absent", () => {
  assert.match(page, /当前接口尚未提供作品列表。请从作品页面选择作品后回到这里。/);
  assert.doesNotMatch(page, /data-title="Aetheric Chronicles"/);
  assert.doesNotMatch(page, /data-title="剑域神座"/);
  assert.doesNotMatch(page, /data-title="深渊降临"/);
  assert.match(page, /id="bookDropdown"[^>]*hidden/);
});

test("workbench hands off its new-book modal data through the active new-book draft contract", () => {
  const handoff = runtime.match(/function installNewBookHandoff\(\) \{([\s\S]*?)\n\}\n\nfunction installModalInteractions/);

  assert.ok(handoff, "the new-book handoff must remain a scoped runtime adapter");
  assert.match(page, /onclick="openNewBookModal\(\)"/);
  assert.match(runtime, /window\.openNewBookModal\s*=/);
  assert.match(runtime, /origin:\s*\{[\s\S]*title,[\s\S]*genre:\s*selectedMainGenre,[\s\S]*targetWords:\s*String\(Number\(targetWords\)\s*\*\s*10000\)/);
  assert.match(runtime, /chapterWords:\s*"2000"/);
  assert.match(runtime, /localStorage\.setItem\(newBookDraftKey, JSON\.stringify\(newBookDraft\)\)/);
  assert.match(runtime, /window\.location\.assign\("\/books\/new"\)/);
  // The transplanted prototype retains its inert source script for DOM fidelity;
  // the mounted runtime is the executable handoff authority.
  assert.doesNotMatch(runtime, /new_book\.html/);
  assert.doesNotMatch(handoff[1], /callWorkbench\(/);
  assert.doesNotMatch(handoff[1], /contextKey/);
});

test("workbench new-book handoff exposes only the six V7 primary genres", () => {
  const expectedGenres = ["科幻", "玄幻", "言情", "武侠", "恐怖", "同人"];
  const genreTags = runtime.match(/const newBookGenreTags = Object\.freeze\((\{[\s\S]*?\})\);/);
  const affinityTags = runtime.match(/const affinityTags = (\{[\s\S]*?\n  \});/);

  assert.ok(genreTags, "the handoff must keep its primary genre map");
  assert.ok(affinityTags, "the handoff must keep its affinity map");
  assert.deepEqual(Object.keys(Function(`return (${genreTags[1]});`)()), expectedGenres);
  const affinity = Function(`return (${affinityTags[1]});`)();
  assert.deepEqual(Object.keys(affinity.S), expectedGenres);
  assert.deepEqual(Object.keys(affinity.A), expectedGenres);
});

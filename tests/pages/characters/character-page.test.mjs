import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../../..");
const page = () => readFile(resolve(root, "apps/web/src/pages/characters/index.html"), "utf8");

test("character target retains the indexed prototype structural anchors", async () => {
  const source = await page();
  for (const anchor of ["character-card-list", "drawer-l0", "drawer-l1", "drawer-l2", "drawer-l3", "relation-radar", "rel-char-selector"]) {
    assert.match(source, new RegExp(`id=["']${anchor}["']`));
  }
});

test("page binds FP003 transient, candidate, snapshot, and confirmation actions to the existing webhook", async () => {
  const source = await page();

  assert.match(source, /window\.characterSettings = \[\];/);
  assert.match(source, /action: "generate_candidate"/);
  assert.match(source, /body\.result\.candidate/);
  assert.match(source, /candidate\?\.characters/);
  assert.match(source, /CHARACTER_SETTINGS_WEBHOOK_URL/);
  assert.doesNotMatch(source, /creator_input/);
  assert.match(source, /action: "save_candidate"/);
  assert.match(source, /action: "read_versions"/);
  assert.match(source, /action: "confirm"/);
  assert.match(source, /buildInitialMemoryConfirmation/);
  assert.match(source, /memory_type/);
  assert.match(source, /truth_status/);
  assert.match(source, /normalizeCharacterSnapshot/);
  assert.doesNotMatch(source, /character-runtime-overlay/);
});

test("existing controls carry the documented FP003 state transitions without adding page regions", async () => {
  const source = await page();

  assert.match(source, /id="character-snapshot-current"/);
  assert.match(source, /id="character-snapshot-future"/);
  assert.match(source, /id="character-confirm-candidate"/);
  assert.match(source, /id="character-behavior-input"[^>]*disabled/);
  assert.match(source, /id="character-behavior-start"[^>]*disabled/);
  assert.match(source, /character-snapshot-current"\)\?\.addEventListener\("click", \(\) => readSnapshot\("formal"\)\)/);
  assert.match(source, /character-snapshot-future"\)\?\.addEventListener\("click", \(\) => readSnapshot\("candidate"\)\)/);
  assert.match(source, /保存候选/);
  assert.match(source, /restoreSavedCandidateFromSnapshot/);
  assert.match(source, /初始记忆仅保留在本次页面会话/);
  assert.doesNotMatch(source, /initial_memory_ids/);
});

test("a candidate snapshot is restored into the page before its confirmation state is evaluated", async () => {
  const source = await page();
  const readSnapshot = source.match(/async function readSnapshot\(kind\) \{[\s\S]*?\r?\n    \}\r?\n\r?\n    async function confirmCandidate/)?.[0] || "";

  assert.match(readSnapshot, /savedCandidate = restoreSavedCandidateFromSnapshot\(snapshot\)/);
  assert.doesNotMatch(readSnapshot, /候选快照不含可恢复的初始记忆，不能直接确认/);
});

test("character snapshots expose the documented role-arc direction in the existing target field", async () => {
  const source = await page();

  assert.match(source, /function arcDirectionText\(arc\)/);
  assert.match(source, /setText\("char-target-val", arcDirectionText\(candidate\.arc\)\)/);
  assert.doesNotMatch(source, /setText\("char-target-val", ""\)/);
});

test("formal V7 layer values render through the existing drawers without treating scalars or arrays as absent", async () => {
  const source = await page();

  assert.match(source, /displayCharacterValue/);
  assert.match(source, /data\.value \?\? data\.val \?\? raw/);
  assert.match(source, /function renderCandidateL1\(candidate\)/);
  assert.match(source, /function renderCandidateL2\(candidate\)/);
  assert.match(source, /function renderCandidateL3\(candidate\)/);
  assert.match(source, /setText\("cs-belief", candidate\.l0\?\.\["底层信念"\]\)/);
  assert.match(source, /L2 · 世界作用位/);
  assert.match(source, /L3 · 关系作用位/);
});

test("async formal snapshot values resize the default-open drawer after rendering", async () => {
  const source = await page();

  assert.match(source, /function resizeOpenCharacterDrawer\(\) \{[\s\S]*?data-drawer-toggle[\s\S]*?openDrawer\.style\.maxHeight = String\(openDrawer\.scrollHeight\) \+ "px";/);
  assert.match(source, /renderCandidateRelations\(candidate\);\s*\/\/ The default-open L0 drawer[\s\S]*?resizeOpenCharacterDrawer\(\);/);
  assert.match(source, /materializeSnapshot\(snapshot\);\s*resizeOpenCharacterDrawer\(\);/);
  assert.match(source, /el\.style\.maxHeight = el\.scrollHeight > 0 \? el\.scrollHeight \+ 'px' : 'none';/);
  assert.match(source, /await readSnapshot\("formal"\);\s*\/\/ Let the load-time prototype initializer[\s\S]*?window\.setTimeout\(resizeOpenCharacterDrawer, 0\);/);
});

test("direct book routes load the formal character snapshot without an empty first interaction", async () => {
  const source = await page();

  assert.match(source, /async function bootstrapCharacterPage\(\)/);
  assert.match(source, /if \(!hasCharacterContext\(\)\)/);
  assert.match(source, /await readSnapshot\("formal"\)/);
  assert.match(source, /addEventListener\("load", bootstrapCharacterPage, \{ once: true \}\)/);
  assert.match(source, /headerBookName\.textContent = `作品 \$\{scopedBookId\.slice\(0, 8\)\}`/u);
  assert.match(source, /headerBookName\.title = `当前作品标识：\$\{scopedBookId\}`/u);
  assert.doesNotMatch(source, /headerBookName\.textContent = "当前作品"/u);
});

test("missing or invalid book context clears prototype candidates and keeps character actions unavailable", async () => {
  const source = await page();

  assert.match(source, /function hasCharacterContext\(\)/);
  assert.match(source, /return Boolean\(bookContext\(\)\);/);
  assert.match(source, /const contextAvailable = hasCharacterContext\(\);/);
  assert.match(source, /setButtonEnabled\(document\.getElementById\("character-snapshot-current"\), contextAvailable && !busy/);
  assert.match(source, /setButtonEnabled\(document\.getElementById\("character-snapshot-future"\), contextAvailable && !busy/);
  assert.match(source, /if \(!hasCharacterContext\(\)\) \{[\s\S]*?clearPrototypeValues\(\);[\s\S]*?updateActionControls\(\);/);
  assert.match(source, /else setButtonEnabled\(confirm, false, "确认候选"/);
});

test("busy transitions restore the existing generator card after snapshot reads", async () => {
  const source = await page();
  const updateControls = source.match(/function updateActionControls\(\) \{[\s\S]*?\r?\n    \}\r?\n\r?\n    function decorateGeneratorCard/)?.[0] || "";

  assert.match(updateControls, /decorateGeneratorCard\(\);/);
});

test("the existing generator control is announced as unavailable while its request is pending", async () => {
  const source = await page();
  const decorateGenerator = source.match(/function decorateGeneratorCard\(\) \{[\s\S]*?\r?\n    \}\r?\n\r?\n    async function generateCandidate/)?.[0] || "";

  assert.match(decorateGenerator, /card\.setAttribute\("aria-disabled", String\(busy \|\| frozen\)\);/);
  assert.match(decorateGenerator, /card\.setAttribute\("aria-busy", String\(busy\)\);/);
});

test("FP004 design lock disables character candidate writes while preserving snapshot reads", async () => {
  const source = await page();

  assert.match(source, /let frozen = false;/);
  assert.match(source, /frozen = body\?\.result\?\.frozen === true;/);
  assert.match(source, /if \(frozen\) setStatus\("设计已锁定，角色设定仅可查看。"\)/);
  assert.match(source, /card\.setAttribute\("aria-disabled", String\(busy \|\| frozen\)\);/);
  assert.match(source, /if \(busy \|\| frozen\) return;/);
});

test("a failed candidate generation keeps the currently read formal snapshot visible", async () => {
  const source = await page();
  const generation = source.match(/async function generateCandidate\(\) \{[\s\S]*?\r?\n    \}\r?\n\r?\n    async function requestCharacterService/)?.[0] || "";

  assert.match(generation, /catch \(error\) \{\s*setStatus\(error\.message/);
  assert.doesNotMatch(generation, /catch \(error\) \{[\s\S]*?clearPrototypeValues\(\)/);
});

test("repeated V7 detail rendering restores prototype drawers before the legacy refresh", async () => {
  const source = await page();
  const refreshBridge = source.match(/window\.refreshCharDetail = function \(\) \{[\s\S]*?\r?\n    \};/)?.[0] || "";

  assert.match(refreshBridge, /resetCandidateDetails\(\);\s*originalRefreshCharDetail\(\);/);
});

test("an empty snapshot is not presented as a successful formal-character read", async () => {
  const source = await page();

  assert.match(source, /if \(!snapshot \|\| !Array\.isArray\(snapshot\.characters\) \|\| !snapshot\.characters\.length\) \{[\s\S]*?clearPrototypeValues\(\);[\s\S]*?throw new Error\("角色快照未返回可展示的数据。"\);[\s\S]*?\}/);
  assert.match(source, /throw new Error\("角色快照未返回可展示的数据。"\)/);
  assert.match(source, /setStatus\(error\.message \|\| "角色快照读取失败。"\)/);
});

test("character page identifies the current Chinese product instead of the prototype brand", async () => {
  const source = await page();

  assert.match(source, /<title>角色设定 - 纵横叙事引擎<\/title>/);
  assert.doesNotMatch(source, /Cyber-Tech Narrative Engine/);
});

test("character page labels arc direction and unavailable live fields without implying data loss", async () => {
  const source = await page();

  assert.match(source, /<span class="text-base-content opacity-60 text-xs">发展方向<\/span>/);
  assert.match(source, /正式角色快照未提供角色简介/);
  assert.match(source, /活态压力未返回/);
  assert.match(source, /char\.snapshotState === "formal" \? 'L0-L3 已锁定' : '候选快照'/);
});

test("character page removes duplicate stitch-only cursor and scroll overrides", async () => {
  const source = await page();

  assert.doesNotMatch(source, /data-stitch-cursor/);
  assert.doesNotMatch(source, /data-stitch-scroll-lock/);
  assert.doesNotMatch(source, /\*\{cursor:crosshair!important\}/);
});

test("immediate confirmation carries complete in-session memories while allowing an empty memory list", async () => {
  const source = await page();
  const saveCandidate = source.match(/async function saveCandidate\(\) \{[\s\S]*?\r?\n    \}\r?\n\r?\n    function restoreSavedCandidateFromSnapshot/)?.[0] || "";
  const restore = source.match(/function restoreSavedCandidateFromSnapshot\(snapshot\) \{[\s\S]*?\r?\n    \}\r?\n\r?\n    async function readSnapshot/)?.[0] || "";
  const confirmCandidate = source.match(/async function confirmCandidate\(\) \{[\s\S]*?\r?\n    \}\r?\n\r?\n    function reportUnavailable/)?.[0] || "";

  assert.match(saveCandidate, /initialMemories: memories/);
  assert.match(saveCandidate, /confirmable: memoriesComplete/);
  assert.doesNotMatch(saveCandidate, /memories\.length > 0/);
  assert.doesNotMatch(saveCandidate, /initialMemories: \[\]/);
  assert.match(restore, /confirmable: false/);
  assert.match(confirmCandidate, /initial_memories: savedCandidate\.initialMemories/);
});

test("saving a transient candidate marks the existing cards as saved before confirmation", async () => {
  const source = await page();
  const saveCandidate = source.match(/async function saveCandidate\(\) \{[\s\S]*?\r?\n    \}\r?\n\r?\n    function restoreSavedCandidateFromSnapshot/)?.[0] || "";
  const markStart = source.indexOf("function markCandidateSaved()");
  const markEnd = source.indexOf("\n\n    async function saveCandidate", markStart);
  const markSaved = markStart >= 0 && markEnd > markStart ? source.slice(markStart, markEnd) : "";

  assert.match(saveCandidate, /markCandidateSaved\(\);/);
  assert.match(markSaved, /character\.status = "候选（已保存）"/);
  assert.match(markSaved, /character\.isTransientCandidate = false/);
  assert.match(markSaved, /character\.snapshotState = "candidate"/);

  const calls = [];
  const pageWindow = {
    characterSettings: [{ status: "候选（未保存）", isTransientCandidate: true, snapshotState: "transient" }],
    renderCharacterCards: () => calls.push("cards"),
    refreshCharDetail: () => calls.push("detail"),
  };
  const markCandidateSaved = new Function("window", `${markSaved}\nreturn markCandidateSaved;`)(pageWindow);
  markCandidateSaved();

  assert.deepEqual(pageWindow.characterSettings[0], {
    status: "候选（已保存）", isTransientCandidate: false, snapshotState: "candidate",
  });
  assert.deepEqual(calls, ["cards", "detail"]);
});

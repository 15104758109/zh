import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const page = readFileSync(path.join(root, "apps/web/src/pages/world/index.html"), "utf8");
const worldData = readFileSync(path.join(root, "apps/web/src/pages/world/assets/world-data.js"), "utf8");

test("WORLD target provides a runtime adapter using the approved action contract", () => {
  assert.match(page, /WORLD_WEBHOOK_URL/);
  for (const action of ["read_versions", "generate_candidate", "save_candidate", "confirm"]) assert.ok(page.includes(`request('${action}'`));
  assert.match(page, /local_operator_id/);
  assert.match(page, /book_id/);
  assert.match(page, /world_candidate_ids/);
  assert.match(page, /binding_candidate_ids/);
  assert.match(page, /delete_world_ids/);
  assert.match(page, /delete_world_binding_ids/);
  assert.match(page, /atoms: payload\.atoms, bindings: payload\.bindings/);
});

test("WORLD never persists a placeholder as a conflict affordance", () => {
  assert.doesNotMatch(page, /affordance_dims:\s*item\.ai\?\.suggestion\s*\?\s*\[item\.ai\.suggestion\]\s*:\s*\['待定义'\]/);
  assert.match(page, /function resolvedAffordanceDims\(item\)/);
  assert.match(page, /function incompleteAffordanceItems\(sourceItems\)/);
  assert.match(page, /缺少冲突作用维度，不能保存或确认/);
  assert.match(page, /affordance_dims: resolvedAffordanceDims\(item\)/);
});

test("WORLD candidate response remains transient until the existing prototype save action", () => {
  assert.match(page, /const candidates = result\?\.candidates/);
  assert.match(page, /validation_conflicts/);
  assert.match(page, /renderDiffProposals\(\);/);
  assert.match(page, /openDiffModal\(\);/);
  assert.match(page, /window\.saveDrawerItem = async function \(\)/);
});

test("WORLD detail drawer provides the editable prototype field helpers", () => {
  for (const helper of ["renderFields", "collectFields", "openDrawer", "closeDrawer"]) {
    assert.match(page, new RegExp(`function ${helper}\\(`));
  }
  assert.match(page, /const fields = BOARD_FIELDS\[board\] \|\| \[\];/);
  assert.match(page, /fields\.map\(field =>/);
  assert.match(page, /id="fld-\$\{field\.key\}"/);
  assert.match(page, /field\.type === 'textarea'/);
  assert.match(page, /field\.type === 'select'/);
  assert.match(page, /document\.getElementById\('detailDrawer'\)\?\.classList\.add\('open'\)/);
  assert.match(page, /document\.getElementById\('drawerBackdrop'\)\?\.classList\.remove\('open'\)/);
});

test("WORLD maps binding atom keys onto the rendered world-item ids", () => {
  assert.match(page, /const atomIdByLayerKey = new Map\(\);/);
  assert.match(page, /const atomIdByKey = new Map\(\);/);
  assert.match(page, /atomIdByLayerKey\.set\(`\$\{settingLayer\}:\$\{item\.atom_key\}`, id\);/);
  assert.match(page, /const fromRef = binding\.from_ref_id \|\| binding\.from_ref;/);
  assert.match(page, /from: atomIdByLayerKey\.get\(`\$\{settingLayer\}:\$\{fromRef\}`\) \|\| atomIdByKey\.get\(fromRef\) \|\| fromRef/);
  assert.match(page, /to: atomIdByLayerKey\.get\(`\$\{settingLayer\}:\$\{toRef\}`\) \|\| atomIdByKey\.get\(toRef\) \|\| toRef/);
});

test("WORLD edits one complete candidate snapshot and formally confirms the exact candidate set", () => {
  assert.match(page, /const candidateWriteAvailable = true/);
  assert.match(page, /const canConfirm = \(\) => .*state === 'candidate'/);
  assert.match(page, /returnedVersions\.filter\(version => \['formal', 'candidate', 'history'\]\.includes\(version\?\.state\)\)/);
  assert.match(page, /worldCandidateIds: bridge\.selected\.world_candidate_ids/);
  assert.match(page, /bindingCandidateIds: bridge\.selected\.binding_candidate_ids/);
  assert.match(page, /世界设定已确认生效/);
  assert.match(page, /async function saveCandidate\(draftItems = items, draftBindings = bindings\)/);
  assert.match(page, /const draftItems = structuredClone\(items\);/);
  assert.match(page, /if \(await saveCandidate\(draftItems, bindings\)\) closeDrawer\(\);/);
  assert.doesNotMatch(page, /originalSaveDrawerItem\(\)/);
});

test("WORLD displays V7 history read-only and maps explicit deletion intent to RPC-002 v3", () => {
  assert.match(page, /window\.deleteCurrentItem = async function/);
  assert.match(page, /window\.removeBinding = async function/);
  assert.match(page, /deleteWorldIds: bridge\.selected\.delete_world_ids/);
  assert.match(page, /deleteWorldBindingIds: bridge\.selected\.delete_world_binding_ids/);
  assert.match(page, /const draftItems = items\.filter\(item => item\.id !== currentItemId\);/);
  assert.match(page, /const draftBindings = bindings\.filter\(binding => binding\.id !== bindingId\);/);
  assert.doesNotMatch(page, /正式删除合同尚未接入/);
  assert.match(page, /bridge\.selected\?\.state === 'history'/);
  assert.match(page, /history: '历史快照，只读'/);
  assert.match(page, /history: '历史'/);
});

test("WORLD preserves the prototype tree and adds only in-place binding anchors", () => {
  for (const id of ["main-content", "world-context-bar", "projection-bar", "world-skeleton-list", "map-canvas", "map-pins-container", "bindingModal", "diffModal"]) assert.match(page, new RegExp(`id="${id}"`));
  for (const id of ["world-adapter-status", "world-version-snapshot", "world-confirm-candidate"]) assert.match(page, new RegExp(`\.id = '${id}'`));
});

test("WORLD state overlays hide prototype mock content when data cannot load", () => {
  for (const state of ["empty", "loading", "error"]) assert.match(page, new RegExp(`${state}:`));
  assert.match(page, /world-page-state-overlay/);
  assert.match(page, /stateCopy = \{ empty:/);
  assert.match(page, /function showPageState\(state, detailOverride\)/);
  assert.match(page, /overlay\.className = 'ui-state-overlay z-\[55\]'/);
  assert.match(page, /card\.className = 'ui-state-panel'/);
  assert.doesNotMatch(page, /bg-base-100\/95 p-6/);
  assert.match(page, /main\.append\(overlay\)/);
  assert.match(page, /recovery\.addEventListener\('click'/);
  assert.match(page, /url\.searchParams\.delete\('state'\)/);
  assert.match(page, /showPageState\('empty', '请从作品工作流进入本页以恢复当前作品上下文。'\)/);
  assert.doesNotMatch(page, /document\.open\(|document\.write\(|\.innerHTML\s*=\s*`<main/);
});

test("WORLD unavailable states hide and disable the underlying prototype controls", () => {
  assert.match(page, /main\.dataset\.worldState = state/);
  assert.match(page, /#main-content\[data-world-state="loading"\]/);
  assert.match(page, /#main-content\[data-world-state="empty"\]/);
  assert.match(page, /#main-content\[data-world-state="error"\]/);
  assert.match(page, /pointer-events:\s*none\s*!important/);
  assert.match(page, /visibility:\s*hidden\s*!important/);
  assert.match(page, /:not\(#world-page-state-overlay\)/);
  assert.match(page, /#main-content\[data-world-state="empty"\]\s*~\s*#conflict-seed-chat/);
});

test("WORLD keeps its prototype header visible when scoped data is unavailable", () => {
  assert.match(page, /> :not\(header\):not\(#world-page-state-overlay\)/);
});

test("WORLD hides prototype business data until the runtime has a real context", () => {
  assert.match(page, /data-world-runtime-ready="false"/);
  assert.match(page, /body:not\(\[data-world-runtime-ready="true"\]\)/);
  assert.match(page, /function revealWorldRuntimeState\(\)/);
  assert.match(page, /async function readVersions\(preferredVersionId\) \{\s*revealWorldRuntimeState\(\);/);
});

test("WORLD starts without prototype business records before the scoped version read", () => {
  assert.match(page, /let items = \[\];/);
  assert.match(page, /let bindings = \[\];/);
  assert.doesNotMatch(page, /id:'r1', board:'rules'/);
  assert.doesNotMatch(page, /id:'b1', from:'r1'/);
});

test("WORLD bounds a hung version read and keeps the existing error recovery path", () => {
  assert.match(page, /const WORLD_READ_TIMEOUT_MS = 12_000/);
  assert.match(page, /const WORLD_READ_TIMEOUT_MESSAGE = '读取世界设定超时，请检查服务后重试。'/);
  assert.match(page, /readVersions: \(context, requestOptions = \{\}\) => request\('read_versions'/);
  assert.match(page, /signal: requestOptions\.signal/);
  assert.match(page, /async function readVersionsWithTimeout\(\)/);
  assert.match(page, /controller\.abort\(\)/);
  assert.match(page, /Promise\.race\(\[adapter\.readVersions\(context, \{ signal: controller\.signal \}\), timeout\]\)/);
  assert.match(page, /showPageState\('error', message\)/);
});

test("WORLD preserves real empty and frozen states instead of exposing mock mutations", () => {
  assert.match(page, /else showPageState\('empty', '当前作品尚没有可显示的世界设定版本。'\)/);
  assert.match(page, /if \(!bridge\.versions\.length\) \{\s*bridge\.selected = null;\s*confirmButton\.disabled = true;/);
  assert.match(page, /if \(bridge\.frozen\) \{\s*const message = '设计已锁定，世界设定仅可查看。'/);
  assert.match(page, /const message = bridge\.frozen \? '设计已锁定，世界设定仅可查看。' : '当前候选合同无法保存完整世界设定快照，操作不会保存。'/);
  assert.match(page, /window\.batchAction = async function \(action\) \{/);
  assert.match(page, /if \(action === 'delete'\) \{/);
  assert.match(page, /return originalBatchAction\?\.apply\(this, arguments\);/);
});

test("WORLD makes the existing mutation controls visibly read-only after FP004 locks the design", () => {
  assert.match(page, /function applyFrozenControls\(\)/);
  assert.match(page, /const frozenMessage = '设计已锁定，世界设定仅可查看。'/);
  assert.match(page, /control\.disabled = bridge\.frozen/);
  assert.match(page, /card\.draggable = !bridge\.frozen/);
  assert.match(page, /applyFrozenControls\(\);/);
});

test("WORLD fails closed for prototype-only quick creation and chat parsing", () => {
  const quickCreateSource = page.match(/window\.quickCreateTarget = function \(\) \{([\s\S]*?)\n  \};/s)?.[0] || "";
  const chatSource = page.match(/function sendChatIdea\(\) \{([\s\S]*?)\n\}/s)?.[0] || "";

  assert.match(quickCreateSource, /未创建或保存数据/);
  assert.doesNotMatch(quickCreateSource, /originalQuickCreateTarget/);
  assert.match(chatSource, /尚未接入 V7 世界设定生成流程/);
  assert.doesNotMatch(chatSource, /setTimeout\(/);
  assert.doesNotMatch(chatSource, /activeProposals\s*=/);
});

test("WORLD renders initial and future settings as separate real projections", () => {
  assert.match(page, /function activeSettingLayer\(\)/);
  assert.match(page, /function renderSnapshotLayer\(\)/);
  assert.match(page, /items = sourceItems\.filter\(item => item\.settingLayer === layer\)/);
  assert.match(page, /bindings = sourceBindings\.filter\(binding => binding\.settingLayer === layer/);
  assert.match(page, /bridge\.worldProgressions = Array\.isArray\(result\?\.world_progressions\)/);
  assert.match(page, /当前显示未来走向。关联 L1A：/);
  assert.match(page, /document\.getElementById\('v7-setting-layer-tabs'\)\?\.addEventListener\('click'/);
});

test("WORLD uses shared canonical navigation for the current book route", () => {
  assert.match(page, /data-book-segment="world"[^>]*class="header-tab active"/);
  assert.match(page, /data-book-segment="characters"[^>]*class="header-tab"/);
  assert.match(page, /data-book-segment="l1a"[^>]*class="header-tab"/);
  assert.doesNotMatch(page, /href="[^"]+\.html"/);
  assert.doesNotMatch(page, /world_creator\.html/);
});

test("WORLD reuses the canonical shared shell assets on the nested book route", () => {
  for (const asset of ["theme.css", "sidebar.css", "theme.js", "header.js"]) {
    assert.match(page, new RegExp(`/pages/prototype/common/${asset.replace(".", "\\.")}`));
    assert.doesNotMatch(page, new RegExp(`/pages/world/assets/${asset.replace(".", "\\.")}`));
  }
  assert.match(page, /\/pages\/world\/assets\/world-data\.js/);
  assert.doesNotMatch(page, /src="\.\/assets\/world-data\.js"/);
  assert.doesNotMatch(page, /\.\.\/common\//);
});

test("WORLD nested route keeps its data bootstrap and V7 setting-layer mount", () => {
  assert.match(worldData, /WIZARD_DATA/);
  assert.match(page, /v7-setting-layer-tabs/);
  assert.match(page, /WORLD_ADAPTER_BRIDGE/);
});

test("WORLD keeps visible labels readable and uses the shared solid component semantics", () => {
  assert.doesNotMatch(page, /font-size:\s*9px|text-\[9px\]/);
  assert.doesNotMatch(page, /(?:repeating-)?(?:linear|radial|conic)-gradient|bg-gradient-/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const sourcePath = new URL("docs/%E5%89%8D%E7%AB%AF%E5%8E%9F%E5%9E%8B_v2/pages/l1a_settings.html", `file:///${root.replace(/\\/g, "/")}/`);
const targetPath = new URL("apps/web/src/pages/l1a/index.html", `file:///${root.replace(/\\/g, "/")}/`);
const runtimePath = new URL("apps/web/src/pages/l1a/index.mjs", `file:///${root.replace(/\\/g, "/")}/`);
const sharedSidebarPath = new URL("apps/web/src/pages/prototype/common/sidebar.js", `file:///${root.replace(/\\/g, "/")}/`);

function ids(html) {
  return [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
}

test("L1A retains prototype anchors while adding only runtime state anchors", async () => {
  const [source, target, runtime, sharedSidebar] = await Promise.all([readFile(sourcePath, "utf8"), readFile(targetPath, "utf8"), readFile(runtimePath, "utf8"), readFile(sharedSidebarPath, "utf8")]);
  const targetIds = new Set(ids(`${target}\n${sharedSidebar}`));
  const dynamicPrototypeIds = new Set(["edit-commit-icon", "edit-commit-text"]);
  const missing = ids(source).filter((id) => !targetIds.has(id) && !dynamicPrototypeIds.has(id));
  assert.deepEqual(missing, []);
  assert.match(runtime, /id = "edit-commit-icon"/);
  assert.match(runtime, /id = "edit-commit-text"/);
  for (const anchor of [
    "sidebarMenu", "main-content", "l1a-card-list", "l1a-detail-section", "l1a-side-panels",
    "triple-line-sort-btn", "tab-plot", "tab-emotion", "tab-character", "toast-container",
    "l1a-runtime-state", "l1a-runtime-state-retry", "l1a-chapters-list",
  ]) {
    assert.ok(targetIds.has(anchor), `missing ${anchor}`);
  }
  assert.match(target, /<script type="module" src="\.\/index\.mjs"><\/script>/);
  assert.match(target, /data-shared-sidebar[^>]+data-sidebar-active="design"/);
});

test("L1A runtime reads the scoped n8n projection and never accesses PostgreSQL from the page", async () => {
  const runtime = await readFile(runtimePath, "utf8");
  assert.match(runtime, /import "\.\.\/prototype\/common\/book-context\.js"/);
  assert.match(runtime, /function currentBookContext\(\)/);
  assert.doesNotMatch(runtime, /localStorage\.getItem\(operatorStorageKey\)/);
  assert.match(runtime, /readMatchingBookContext/);
  assert.match(runtime, /requireRoute: true/);
  assert.match(runtime, /action: "read"/);
  assert.match(runtime, /action: "generate"/);
  assert.match(runtime, /action: "sort"/);
  assert.match(runtime, /action: "finalize"/);
  assert.match(runtime, /local_operator_id: operatorId/);
  assert.match(runtime, /book_id: bookId/);
  assert.match(runtime, /http:\/\/127\.0\.0\.1:5678\/webhook\/generate_l1a/);
  assert.doesNotMatch(runtime, /postgres|psql|rpc_generate_l1a_conflicts\s*\(/i);
  assert.doesNotMatch(runtime, /world_version_id|character_version_id|creator_input|generated_candidates|trigger:/);
  assert.match(runtime, /candidate_revisions/);
  assert.match(runtime, /candidate_fingerprint/);
  assert.match(runtime, /result\.sort_draft/);
  assert.match(runtime, /acceptedSortDraft/);
  assert.match(runtime, /mutationKey\("generate"/);
  assert.match(runtime, /mutationKey\("sort"/);
  assert.match(runtime, /mutationKey\("finalize"/);
  assert.match(runtime, /async function runSort\(\) \{\s*if \(runtime\.sortBusy\) return;/);
  assert.match(runtime, /async function runFinalize\(\) \{\s*if \(runtime\.sortBusy\) return;/);
  assert.match(runtime, /function runSortOrFinalize\(\) \{\s*if \(runtime\.sortBusy\) return;/);
  assert.match(runtime, /post\(generateEndpoint,[\s\S]*?timeoutMs: 0/);
  assert.match(runtime, /post\(finalizeEndpoint,[\s\S]*?timeoutMs: 0/);
  assert.doesNotMatch(runtime, /setTimeout\(\(\) => controller\.abort\(\), 12000\)/);
});

test("L1A removes prototype business fixtures and disables controls without stable contracts", async () => {
  const [target, runtime] = await Promise.all([readFile(targetPath, "utf8"), readFile(runtimePath, "utf8")]);
  assert.doesNotMatch(target, /定义 5 条原始 L1A 数据数组|function generateCandidateL1A|function triggerTripleLineSort/);
  assert.doesNotMatch(target, /L1A-002|第4章：真相的边缘|第12章：最终对决前夕|已推演/);
  assert.doesNotMatch(target, /onclick="[^"\n]*(deleteCurrentL1A|generateCandidateL1A|triggerTripleLineSort|addCharacterToCurrentL1A|switchDetailTab)/);
  assert.match(runtime, /window\.l1aSettings = \[\]/);
  assert.match(runtime, /function bindCardListDrag/);
  assert.match(runtime, /const hasBookContext = Boolean\(currentBookContext\(\)\);/);
  assert.match(runtime, /traversal\.disabled = !hasBookContext;/);
  assert.match(runtime, /delete-current-l1a-btn/);
  assert.match(runtime, /generate-variant-btn/);
  assert.match(runtime, /add-character-to-l1a-btn/);
  assert.match(runtime, /http:\/\/127\.0\.0\.1:5678\/webhook\/finalize_l1a/);
  assert.match(runtime, /ordered_l1a_ids/);
  assert.match(runtime, /design_fingerprint/);
  assert.match(runtime, /l1a-sort-review/);
  assert.match(runtime, /不能伪造删除成功/);
  assert.match(runtime, /不能伪造候选/);
  assert.doesNotMatch(runtime, /三线排序尚无已接入的稳定工作流合同/);
  assert.match(runtime, /GENERATE_RESPONSE_INCOMPLETE/);
  assert.doesNotMatch(runtime, /静态候选|静态排序|静态锁定/);
});

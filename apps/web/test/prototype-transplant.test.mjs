import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const sharedSidebarPath = join(root, "apps/web/src/pages/prototype/common/sidebar.js");
const pages = [
  ["WORKBENCH", "docs/前端原型_v2/pages/workbench.html", "apps/web/src/pages/workbench/index.html"],
  ["NEW_BOOK", "docs/前端原型_v2/pages/new_book.html", "apps/web/src/pages/new-book/index.html"],
  ["WORLD", "docs/前端原型_v2/pages/world-settings-drag-binding.html", "apps/web/src/pages/world/index.html"],
  ["CHARACTERS", "docs/前端原型_v2/pages/character_settings.html", "apps/web/src/pages/characters/index.html"],
  ["L1A", "docs/前端原型_v2/pages/l1a_settings.html", "apps/web/src/pages/l1a/index.html"],
  ["PRODUCTION", "docs/前端原型_v2/pages/production_stage.html", "apps/web/src/pages/production-stage/index.html"],
  ["DEDUCTION", "docs/前端原型_v2/pages/multi_agent_deduction.html", "apps/web/src/pages/multi-agent-deduction/index.html"],
  ["AUDIT_REVIEW", "docs/前端原型_v2/pages/audit_review.html", "apps/web/src/pages/audit-review/index.html"],
  ["AUDIT_STAGE", "docs/前端原型_v2/pages/audit_stage.html", "apps/web/src/pages/audit-stage/index.html"],
  ["SKILL_LIBRARY", "docs/前端原型_v2/pages/skill_library.html", "apps/web/src/pages/skill-library/index.html"],
].map(([page_id, source_prototype, target_implementation]) => ({ page_id, source_prototype, target_implementation }));

function structuralIds(html) {
  const patterns = [
    /\bid=["']([^"']+)["']/g,
    /\.id\s*=\s*["']([^"']+)["']/g,
    /\.setAttribute\(\s*["']id["']\s*,\s*["']([^"']+)["']/g,
  ];
  return patterns.flatMap((pattern) => [...html.matchAll(pattern)].map((match) => match[1]));
}

async function optionalRead(path) {
  try {
    await access(path);
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

for (const page of pages) {
  test(`${page.page_id} retains its prototype structure and has no root renderer`, async () => {
    const sourcePath = join(root, page.source_prototype);
    const targetPath = join(root, page.target_implementation);
    const [source, target] = await Promise.all([
      readFile(sourcePath, "utf8"),
      readFile(targetPath, "utf8"),
    ]);

    // Prototype anchors may be authored by the page's own runtime module. The
    // transplant surface is the preserved HTML plus that colocated module,
    // not the HTML file in isolation.
    const pageModule = await optionalRead(join(dirname(targetPath), "index.mjs"));
    const sharedSidebar = target.includes("data-shared-sidebar") ? await readFile(sharedSidebarPath, "utf8") : "";
    const targetSurface = `${target}\n${pageModule || ""}\n${sharedSidebar}`;
    const targetIds = new Set(structuralIds(targetSurface));
    const missingIds = structuralIds(source).filter((id) => !targetIds.has(id));
    assert.deepEqual(missingIds, [], `${page.page_id} removed prototype structural ids: ${missingIds.join(", ")}`);

    if (pageModule === null) return;

    const forbiddenRootWrites = [
      /\bcontent\s*\.\s*(?:innerHTML|outerHTML|textContent)\s*=/g,
      /\bcontent\s*\.\s*(?:replaceChildren|append|appendChild|prepend|insertAdjacentHTML|insertAdjacentElement)\s*\(/g,
    ];
    const matches = forbiddenRootWrites.flatMap((pattern) => [...pageModule.matchAll(pattern)].map((match) => match[0]));
    assert.deepEqual(
      matches,
      [],
      `${page.page_id} replaces the transplanted prototype root: ${matches.join(", ")}`,
    );
  });
}

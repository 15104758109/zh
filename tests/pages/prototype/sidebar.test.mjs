import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourcePath = new URL("../../../apps/web/src/pages/prototype/common/sidebar.js", import.meta.url);

test("shared audit navigation enters the scoped review route", async () => {
  const source = await readFile(sourcePath, "utf8");
  assert.match(source, /id: "audit", segment: "audit", entrySegment: "deduction-review"/u);
  assert.match(source, /data-book-segment="\$\{item\.entrySegment \|\| item\.segment\}"/u);
});

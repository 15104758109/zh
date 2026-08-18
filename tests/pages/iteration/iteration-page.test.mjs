import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeIterationProjection, iterationState, selectIterationSample } from "../../../apps/web/src/pages/iteration/index.mjs";

const bookId = "00000000-0000-4000-8000-000000000001";
const sampleId = "00000000-0000-4000-8000-000000000002";

test("iteration page keeps the screenshot shell and real controls", async () => {
  const [html, css] = await Promise.all([
    readFile(new URL("../../../apps/web/src/pages/iteration/index.html", import.meta.url), "utf8"),
    readFile(new URL("../../../apps/web/src/pages/iteration/page.css", import.meta.url), "utf8"),
  ]);
  for (const id of ["sidebarMenu", "header-book-name", "quick-settings-btn", "quick-settings-popover", "main-content", "step-text-1", "step-text-2", "step-text-3", "step-text-4", "select-sample-col", "sample-list", "sample-detail", "experiment-btn", "discard-btn", "adopt-btn"]) {
    if (id === "sidebarMenu") continue;
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.match(html, /data-shared-sidebar/);
  assert.doesNotMatch(html, /onclick\s*=/i);
  assert.doesNotMatch(html, /\b(?:alert|confirm)\s*\(/i);
  assert.match(css, /--color-neutral/);
  assert.match(css, /--color-primary/);
  assert.match(css, /focus-visible/);
  const module = await readFile(new URL("../../../apps/web/src/pages/iteration/index.mjs", import.meta.url), "utf8");
  for (const id of ["old-input-col", "new-prompt-col", "new-output-col", "old-input-content", "new-prompt-content", "new-output-content"]) assert.match(module, new RegExp(id));
});

test("iteration projection is book-scoped and rejects mismatched sample scope", () => {
  const payload = {
    ok: true,
    result: {
      book: { id: bookId, title: "熔炼末世", auto_iteration: false },
      automatic_pooling: false,
      pooling_contract: { code: "ITERATION_RETRY_CONTRACT_UNRESOLVED", message: "需要第三次失败证据。" },
      samples: [
        { id: sampleId, book_id: bookId, source_fp: "FP014-01", iter_type: "prompt", review_status: "pool", exec_result: "failed" },
        { id: "00000000-0000-4000-8000-000000000003", book_id: "00000000-0000-4000-8000-000000000099", source_fp: "wrong", review_status: "pool" },
      ],
    },
  };
  const projection = normalizeIterationProjection(payload, bookId);
  assert.equal(projection.book.title, "熔炼末世");
  assert.equal(projection.samples.length, 1);
  assert.equal(projection.samples[0].id, sampleId);
  assert.equal(iterationState(projection), "ready");
  assert.equal(selectIterationSample(projection, sampleId).source_fp, "FP014-01");
  assert.equal(normalizeIterationProjection(payload, "00000000-0000-4000-8000-000000000099"), null);
});

test("empty iteration pool is an honest blocked state", () => {
  const projection = normalizeIterationProjection({
    ok: true,
    result: { book: { id: bookId, title: "熔炼末世" }, samples: [], automatic_pooling: false },
  }, bookId);
  assert.equal(iterationState(projection), "blocked");
  assert.equal(projection.samples.length, 0);
});

test("iteration rendering updates local regions instead of replacing the page root", async () => {
  const source = await readFile(new URL("../../../apps/web/src/pages/iteration/index.mjs", import.meta.url), "utf8");
  assert.match(source, /list\.replaceChildren\(\)/);
  assert.doesNotMatch(source, /document\.body\.innerHTML/);
  assert.doesNotMatch(source, /main-content[\s\S]*innerHTML\s*=/);
});

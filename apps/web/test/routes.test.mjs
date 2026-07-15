import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pageDirectories = ["workbench", "new-book", "world", "characters", "l1a", "production-stage", "multi-agent-deduction", "audit-review", "audit-stage"];

test("router registers all nine static restore routes", async () => {
  const source = await readFile(new URL("../src/app/main.mjs", import.meta.url), "utf8");
  assert.equal((source.match(/module: "\/pages\//g) || []).length, 9);
});

test("normal routes load only canonical application-owned page DOM", async () => {
  const [entry, server, newBook, auditStage, world] = await Promise.all([
    readFile(new URL("../src/app/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/app/server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/new-book/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/audit-stage/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/world/index.html", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(entry, /<(?:i?frame)\b|127\.0\.0\.1:4179|pages\/prototype\/pages|prototype\.html/i);
  assert.doesNotMatch(server, /prototypeRoot|4179|docs[\\/]\S*prototype/i);
  assert.match(newBook, /\u65b0\u4e66\u521b\u4e16/);
  assert.doesNotMatch(newBook, /fonts\.googleapis\.com/i);
  assert.match(auditStage, /auditBtn\?\.addEventListener/);
  assert.match(world, /\u62d6\u62fd|\u7ed1\u5b9a/);
  assert.match(entry, /'world_creator\.html':'\/books\//);
  assert.match(entry, /'audit_stage\.html':'\/books\//);
  for (const directory of pageDirectories) {
    await readFile(new URL(`../src/pages/${directory}/index.html`, import.meta.url), "utf8");
  }
});

test("route bridge preserves the active book and exposes distinct contained states", async () => {
  const entry = await readFile(new URL("../src/app/index.html", import.meta.url), "utf8");
  assert.match(entry, /location\.pathname\.match/);
  assert.match(entry, /decodeURIComponent\(match\?\.\[1\]/);
  assert.match(entry, /empty: \["\\u6682\\u65e0\\u5185\\u5bb9"/);
  assert.match(entry, /loading: \["\\u6b63\\u5728\\u52a0\\u8f7d"/);
  assert.match(entry, /error: \["\\u9875\\u9762\\u52a0\\u8f7d\\u5931\\u8d25"/);
  assert.match(entry, /host\.append\(panel\)/);
});

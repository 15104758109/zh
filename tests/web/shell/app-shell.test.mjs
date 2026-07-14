import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createMockProjection, createProjection, createProjectionStore, PROJECTION_STATES } from "../../../apps/web/src/app/projection-store.mjs";
import { STATE_COPY, stateModel } from "../../../apps/web/src/components/system-state/system-state.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const contextA = { local_operator_id: "operator:a", book_id: "book:a" };
const contextB = { local_operator_id: "operator:a", book_id: "book:b" };
const contextC = { local_operator_id: "operator:b", book_id: "book:a" };

test("six closed projection states have neutral display semantics", () => {
  assert.deepEqual(PROJECTION_STATES, ["loading", "empty", "failure", "paused", "readonly", "complete"]);
  for (const state of PROJECTION_STATES) {
    const model = stateModel(createProjection({ state }));
    assert.equal(model.state, state);
    assert.equal(model.label, STATE_COPY[state].label);
    assert.equal(typeof model.description, "string");
  }
  assert.match(stateModel(createProjection({ state: "complete" })).description, /不代表业务验收/);
});

test("unknown states and non-closed inputs are rejected", () => {
  assert.throws(() => createProjection({ state: "running" }), /invalid projection input/);
  assert.throws(() => createProjection({ state: "empty", extra: true }), /invalid projection input/);
  assert.throws(() => createProjection({ state: "empty", config: [{ label: "x" }] }), /invalid configuration projection/);
  assert.throws(() => stateModel({ state: "running" }), /unknown projection state/);
});

test("operator and book scopes isolate memory projections", () => {
  const store = createProjectionStore();
  store.write(contextA, { state: "paused" });
  store.write(contextB, { state: "failure" });
  store.write(contextC, { state: "readonly" });
  assert.equal(store.read(contextA).state, "paused");
  assert.equal(store.read(contextB).state, "failure");
  assert.equal(store.read(contextC).state, "readonly");
  assert.equal(store.size(), 3);
});

test("context switching retains only its own cached projection", () => {
  const store = createProjectionStore();
  store.write(contextA, { state: "loading" });
  store.write(contextB, { state: "complete" });
  assert.equal(store.read(contextB).state, "complete");
  assert.equal(store.read(contextA).state, "loading");
  store.clear(contextB);
  assert.equal(store.read(contextB), undefined);
  assert.equal(store.read(contextA).state, "loading");
});

test("mock configuration is conspicuously marked and does not create a backend claim", () => {
  const projection = createMockProjection("empty");
  assert.equal(projection.config.length, 5);
  assert.ok(projection.config.every((entry) => entry.source === "mock" && entry.value === "测试/Mock"));
  assert.match(projection.summary, /测试\/Mock/);
});

test("HTML entry point and its local resources exist", () => {
  const html = readFileSync(path.join(root, "apps/web/src/app/index.html"), "utf8");
  assert.match(html, /app-shell\.mjs/);
  assert.match(html, /shell\.css/);
  for (const file of ["app-shell.mjs", "shell.css", "projection-store.mjs"]) {
    assert.ok(readFileSync(path.join(root, "apps/web/src/app", file), "utf8").length > 0);
  }
});

test("shell has no login, RBAC, score, or static business outcome language", () => {
  const source = ["app-shell.mjs", "projection-store.mjs", "index.html"].map((file) => readFileSync(path.join(root, "apps/web/src/app", file), "utf8")).join("\n");
  assert.doesNotMatch(source, /登录|账号|RBAC|评分|假成本|业务成功/);
  assert.match(source, /后端投影/);
});

test("shell styling is stable and avoids gradient or oversized marketing treatment", () => {
  const css = readFileSync(path.join(root, "apps/web/src/app/shell.css"), "utf8");
  assert.match(css, /min-height: 150px/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.doesNotMatch(css, /gradient|border-radius: (?:9|[1-9]\d)px/);
});

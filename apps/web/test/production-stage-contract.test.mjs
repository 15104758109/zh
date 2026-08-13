import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const pagePath = new URL("../src/pages/production-stage/index.html", import.meta.url);
const modulePath = new URL("../src/pages/production-stage/index.mjs", import.meta.url);

test("production stage uses the approved two-request contract without persisted browser state", async () => {
  const [html, module] = await Promise.all([
    readFile(pagePath, "utf8"),
    readFile(modulePath, "utf8"),
  ]);

  assert.match(html, /id=["']production-state-overlay["']/);
  assert.match(html, /href=["']\/vendor\/font-fallback\.css["']/,
    "production must load the local Material Symbols font before shared navigation mounts");
  assert.match(html, /id=["']plan-generation-btn["']/);
  assert.match(html, /id=["']submit-replan-btn["']/);
  assert.match(module, /content_production/);
  assert.match(module, /["']generate["']/);
  assert.match(module, /["']approve["']/);
  assert.match(module, /["']return["']/);
  assert.match(module, /l1a_presentation_plan/);
  assert.match(module, /idempotency_key/);
  assert.match(module, /singleFlight/);
  assert.match(module, /if \(runtime\.busy \|\| !runtime\.context\) return/);
  assert.match(module, /runtime\.busy = true/);
  assert.match(module, /finally \{ runtime\.busy = false/);
  assert.match(module, /runtime\.candidate = \{ \.\.\.candidate, approvalKey:/);
  assert.match(module, /l1a_presentation_plan: candidate\.l1a_presentation_plan/);
  assert.match(module, /ProductionContextError/);
  assert.doesNotMatch(html, /static_mock|L1A-[0-9]|Kaelen|Elyse|Thorne|9\.2|8\.5|9\.0|8\.8/);
  assert.doesNotMatch(module, /\/api\/books|\/api\/skill-library|localStorage\.setItem|static_mock|setTimeout/);
});

test("production stage always releases its busy button state after backend completion or failure", async () => {
  const module = await readFile(modulePath, "utf8");
  const source = module.match(/async function singleFlight\(root, operation\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(source, "singleFlight must remain an executable page boundary");
  const runtime = { context: {}, busy: false };
  let renders = 0;
  const singleFlight = runInNewContext(`(${source})`, {
    runtime,
    renderControls: () => { renders += 1; },
  });
  const attributes = new Set();
  const root = {
    setAttribute: (name) => attributes.add(name),
    removeAttribute: (name) => attributes.delete(name),
  };

  await assert.rejects(singleFlight(root, async () => { throw new Error("backend failed"); }), /backend failed/);
  assert.equal(runtime.busy, false);
  assert.equal(attributes.has("aria-busy"), false);
  assert.equal(renders, 2);

  await singleFlight(root, async () => {});
  assert.equal(runtime.busy, false);
  assert.equal(attributes.has("aria-busy"), false);
  assert.equal(renders, 4);
});

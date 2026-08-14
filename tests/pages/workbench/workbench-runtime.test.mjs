import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const runtime = readFileSync(path.join(root, "apps", "web", "src", "pages", "workbench", "workbench-runtime.mjs"), "utf8");
const page = readFileSync(path.join(root, "apps", "web", "src", "pages", "workbench", "index.html"), "utf8");
const sharedTheme = readFileSync(path.join(root, "apps", "web", "src", "pages", "prototype", "common", "theme.js"), "utf8");

test("workbench accepts a validated routed book scope without trusting it as an operator scope", () => {
  assert.match(runtime, /const operatorKey = "zhreplan\.local_operator_id\.v1"/);
  assert.match(runtime, /function validBookIdFromQuery\(\)/);
  assert.match(runtime, /new URLSearchParams\(window\.location\.search\)/);
  assert.match(runtime, /params\.get\("book_id"\)/);
  assert.match(runtime, /if \(requestedBookId\) return \{ local_operator_id: operatorId, current_book_id: requestedBookId, source: "route" \};/);
  assert.match(runtime, /if \(existing\?\.local_operator_id === operatorId\) return \{ \.\.\.existing, source: "storage" \};/);
  assert.match(runtime, /bookContextSource: null/);
  assert.match(runtime, /state\.bookContextSource = context\?\.source \|\| null;/);
  assert.match(runtime, /state\.bookContextSource === "storage"/);
  assert.doesNotMatch(runtime, /localStorage\.setItem\(contextKey, .*requestedBookId/);
  assert.match(runtime, /function persistVerifiedBookContext\(\)[\s\S]*?state\.bookBanner\.book_id[\s\S]*?state\.operatorId[\s\S]*?localStorage\.setItem\(contextKey,/);
  assert.match(runtime, /await loadBookBanner\(\);\s*persistVerifiedBookContext\(\);/);
  assert.match(runtime, /if \(bookId\) \{\s*link\.href = `\/books\/\$\{encodeURIComponent\(bookId\)\}\/\$\{segment\}`;/);
  assert.match(runtime, /link\.removeAttribute\("href"\);\s*link\.setAttribute\("aria-disabled", "true"\);/);
  assert.match(runtime, /error\?\.code === "SCOPE_REJECTED" \|\| error\?\.code === "BOOK_BANNER_UNAVAILABLE"/);
  assert.match(runtime, /const body = \{ action: "operator" \}/);
  assert.match(runtime, /await callWorkbench\(body\)/);
  assert.match(runtime, /action: "operator"/);
  assert.doesNotMatch(runtime, /function stableOperator\(/);
});

test("workbench reads the stable effective projection and uses only approved configuration commands", () => {
  assert.match(runtime, /const endpoint = window\.WORKBENCH_WEBHOOK_URL \|\| "http:\/\/127\.0\.0\.1:5678\/webhook\/workbench"/);
  assert.match(runtime, /action: "read"/);
  for (const action of ["save_prompt_active", "bind_node_template"]) {
    assert.match(runtime, new RegExp(`action: "${action}"`));
  }
  assert.match(runtime, /idempotency_key: idempotencyKey\(/);
  assert.doesNotMatch(runtime, /action:\s*["']load["']/);
  assert.doesNotMatch(runtime, /action:\s*["']save["']/);
  assert.match(runtime, /effective_config/);
  assert.match(runtime, /prompts: \[\], model_templates: \[\], node_bindings: \[\], book: null, budget: null/);
});

test("workbench renders the selected book from a scoped banner projection rather than configuration data", () => {
  assert.match(runtime, /bookBanner: null/);
  assert.match(runtime, /action: "book_banner"/);
  assert.match(runtime, /book_banner/);
  assert.match(runtime, /state\.bookBanner\.book_id\.toLowerCase\(\) === state\.bookId/);
  for (const field of ["title", "genre_main", "stage_code", "progress_percent", "latest_chapter", "formal_word_count"]) {
    assert.match(runtime, new RegExp(`banner(?:\\?\\.|\\.)${field}`), field);
  }
  assert.doesNotMatch(runtime, /effective_config\.book\?\.effective_value\?\.(?:title|genre_main|stage_code|progress_percent)/);
});

test("workbench keeps fixed L1A budget read-only and saves the user's complete automation snapshot without auto-enable", () => {
  assert.match(runtime, /固定 L1A 推演预算/);
  assert.match(runtime, /该预算只读/);
  assert.doesNotMatch(runtime, /token_budget:\s*(?:Number|parse|\d)/);
  assert.match(runtime, /const hasSelectedBook = Boolean\(state\.bookId\)/);
  assert.match(runtime, /const hasCompleteSnapshot = Boolean\(/);
  assert.match(runtime, /setDisabled\(control, !hasSelectedBook, title\)/);
  assert.match(runtime, /action: "save_book_config"/);
  assert.match(runtime, /const current = \{\s*auto_production: config\?\.auto_production,\s*auto_audit: config\?\.auto_audit,\s*auto_iteration: config\?\.auto_iteration,\s*presentation_intensity: numberOrNull\(config\?\.presentation_intensity\),\s*\}/);
  assert.match(runtime, /Object\.values\(current\)\.slice\(0, 3\)\.every\(\(value\) => typeof value === "boolean"\)/);
  assert.match(runtime, /const next = \{ \.\.\.current, \[key\]: !current\[key\] \}/);
  assert.match(runtime, /book_id: state\.bookId,\s*\.\.\.next,/);
  assert.match(runtime, /何时实际触发仍由后端流程决定/);
  assert.match(runtime, /不会补默认值或自动启用任何流程/);
  assert.doesNotMatch(runtime, /setDisabled\(control, !hasCompleteConfig, title\)/);
  assert.doesNotMatch(runtime, /auto_production:\s*true/);
  assert.match(runtime, /action: "test_connection"/);
  assert.match(runtime, /密钥由本地受控凭据保管，页面不显示或提交；连接测试和模板保存由受控后端执行/);
  assert.doesNotMatch(runtime, /connection_tested\s*:\s*true/);
  assert.doesNotMatch(runtime, /test_succeeded\s*:\s*true/);
});

test("workbench keeps global model setup usable without a book while book controls stay scoped", () => {
  assert.doesNotMatch(runtime, /未选择作品时不能读取或修改 Prompt、模型绑定/);
  assert.doesNotMatch(runtime, /const contextRestriction = !state\.bookId/);
  assert.match(runtime, /setDisabled\(valueFromId\("fetchModelsBtn"\), true, "当前没有受控模型目录合同/);
  assert.match(runtime, /setDisabled\(valueFromId\("testConnectionBtn"\), false\);/);
  assert.match(runtime, /setDisabled\(valueFromId\("saveModelConfigurationBtn"\), false\);/);
  assert.match(runtime, /setDisabled\(control, !hasSelectedBook, title\)/);
  assert.match(page, /id="testConnectionBtn"/);
  assert.match(page, /id="saveModelConfigurationBtn"/);
});

test("workbench preserves the five approved templates and blocks unbound canvas writes", () => {
  assert.match(runtime, /const templateTypes = Object\.freeze\(\["感性文字", "简单逻辑", "重复指令", "复杂任务", "客观公正"\]\)/);
  assert.match(runtime, /node\?\.dataset\.nodeCode \|\| ""/);
  assert.match(runtime, /notifyUnmappedNode/);
  assert.match(runtime, /统一配置只允许五个已批准模板/);
  assert.doesNotMatch(runtime, /localStorage\.setItem\("templatesData"/);
  assert.doesNotMatch(runtime, /localStorage\.setItem\("node_prompt_/);
});

test("workbench uses the local Material Symbols fallback and retains its configuration DOM", () => {
  assert.match(page, /href="\/vendor\/font-fallback\.css"/);
  assert.doesNotMatch(page, /fonts\.googleapis\.com/);
  for (const asset of [
    "/pages/prototype/common/theme.css",
    "/pages/prototype/common/sidebar.css",
    "/pages/prototype/common/theme.js",
    "/pages/prototype/common/header.js",
    "/pages/new-book/new_book_wizard_data.js",
  ]) assert.ok(page.includes(asset), asset);
  for (const id of ["canvasViewport", "canvasContent", "promptEditor", "workbenchTemplateSelect", "modelSettingsModal", "quick-settings-popover"]) {
    assert.match(page, new RegExp(`id=["']${id}["']`), id);
  }
  assert.match(page, /href="\/skill_library\.html"/);
  assert.doesNotMatch(runtime, /header-tab:not\(\.active\)|skill\.href = "\/workbench"/);
});

test("workbench connectors and the primary book action use native visual semantics", () => {
  assert.match(page, /\.node-path\s*\{[^}]*fill:\s*none;[^}]*stroke:\s*color-mix\([^}]*vector-effect:\s*non-scaling-stroke;/s);
  assert.match(page, /\.node-path\.active\s*\{[^}]*stroke:\s*var\(--color-primary\)/s);
  assert.doesNotMatch(page, /btn-rainbow-glow/);
  assert.match(page, /onclick="openNewBookModal\(\)" class="[^"]*\bbtn\s+btn-neutral\b[^"]*"/);
});

test("workbench maps all 22 V7 LLM cards once and keeps runtime-pending cards bindable", () => {
  const expectedNodeCodes = [
    "FP001-03", "FP001-05", "FP002-04", "FP003-04", "FP004-01", "FP004-02", "FP004-05",
    "FP005-01", "FP006-01", "FP007-01", "FP008-01", "FP008-02", "FP008-03", "FP009-01", "FP010-01", "FP011-01",
    "FP011-02", "FP012-01", "FP012-03", "FP013-01", "FP014-01", "FP014-02",
  ];
  assert.equal(expectedNodeCodes.length, 22);
  for (const nodeCode of expectedNodeCodes) {
    assert.equal((page.match(new RegExp(`data-node-code="${nodeCode}"`, "g")) || []).length, 1, nodeCode);
  }
  for (const [nodeId, nodeCode] of [["node-fp004-02", "FP004-02"], ["node-fp005-01", "FP005-01"], ["node-fp008-01", "FP008-01"]]) {
    assert.match(page, new RegExp(`id="${nodeId}"[^>]+data-node-code="${nodeCode}"[^>]+data-runtime-state="pending"`));
    assert.doesNotMatch(page, new RegExp(`id="${nodeId}"[^>]+data-contract-state="pending"`));
  }
  assert.equal((page.match(/可绑定 \/ 运行合同待接入/g) || []).length, 3);
  assert.match(page, /id="node-fp008-checkpoint"[^>]+data-node-code="FP008-03"/);
  assert.doesNotMatch(page, /id="node-fp008-checkpoint"[^>]+data-contract-state="relation"/);
  for (const nodeId of ["node-ind-rating", "node-fp004-lock", "node-fp006-confirm", "node-fp008-store", "node-fp012-reject", "node-fp012-archive", "node-fp013-store", "node-fp014-pool"]) {
    assert.match(page, new RegExp(`id="${nodeId}"[^>]+(?:data-reference-only="true"|data-contract-state="relation")`));
  }
  assert.match(runtime, /node\.dataset\.contractState === "relation"/);
  assert.match(page, /data-source="node-fp006-01" data-target="node-fp006-confirm"/);
  assert.match(page, /data-source="node-fp008-01" data-target="node-simulate"/);
  assert.match(page, /data-source="node-fp014-01" data-target="node-ind-prompt"/);
});

test("workbench saves a controlled model template only after D-046 evidence", () => {
  const testConnectionSource = runtime.match(/async function testConnection\(event\) \{([\s\S]*?)\n\}/)?.[0] || "";
  const saveModelSource = runtime.match(/async function saveModelConfiguration\(\) \{([\s\S]*?)\n\}/)?.[0] || "";
  assert.match(runtime, /modelTestEvidenceId: ""/);
  assert.match(testConnectionSource, /const evidenceId = result\?\.connection_test\?\.connection_test_evidence_id/);
  assert.match(testConnectionSource, /state\.modelTestEvidenceId = evidenceId/);
  assert.match(testConnectionSource, /\.\.\.modelConnectionInput\(\)/);
  assert.doesNotMatch(testConnectionSource, /modalApiKeyInput|api_key:\s/);
  assert.match(saveModelSource, /action: "save_model_template"/);
  assert.match(saveModelSource, /connection_test_evidence_id: evidenceId/);
  assert.match(runtime, /function objectOrEmpty\(value\) \{\s*return value !== null && typeof value === "object" && !Array\.isArray\(value\) \? value : \{\};/);
  assert.match(saveModelSource, /const activeTemplate = findModel\(state\.modalTemplate\)\?\.effective_value/);
  assert.match(saveModelSource, /const routingConfig = objectOrEmpty\(activeTemplate\?\.routing_config_jsonb\)/);
  assert.match(saveModelSource, /const temperature = numberOrNull\(valueFromId\("modalTempRange"\)\?\.value\)/);
  assert.match(saveModelSource, /const modelInput = modelConnectionInput\(\);/);
  assert.match(saveModelSource, /if \(!state\.operatorId \|\| !isUuid\(state\.operatorId\)\) \{/);
  assert.match(saveModelSource, /const modelParameters = \{ \.\.\.objectOrEmpty\(activeTemplate\?\.parameters_jsonb\), temperature \}/);
  assert.match(saveModelSource, /routing_config_jsonb: routingConfig/);
  assert.match(saveModelSource, /parameters_jsonb: modelParameters/);
  const templateSaveRequest = saveModelSource.match(/action: "save_model_template",[\s\S]*?idempotency_key: idempotencyKey\("workbench-model"\),/);
  assert.ok(templateSaveRequest, "the model-template save request should be present");
  assert.match(templateSaveRequest[0], /\.\.\.modelInput/);
  assert.doesNotMatch(templateSaveRequest[0], /modalApiKeyInput|api_key:\s/);
  assert.match(runtime, /地址变更后必须重新完成受控连接测试/);
  assert.match(runtime, /function modelConnectionInput\(\)/);
  assert.match(runtime, /function controlledCredentialReferenceForProvider\(providerBaseUrl\)/);
  assert.match(runtime, /https:\/\/openrouter\.ai\/api\/v1/);
  assert.match(runtime, /https:\/\/api\.relaycove\.com\/v1/);
  assert.match(runtime, /n8n-credential:openai-account-v1/);
  assert.match(runtime, /n8n-credential:relaycove-v1/);
  assert.match(page, /id="modalModelSelect" list="modalModelChoices"/);
});

test("workbench preserves an existing numeric binding temperature without inventing one", () => {
  const bindSource = runtime.match(/async function bindNodeTemplate\(templateType\) \{([\s\S]*?)\n\}/)?.[0] || "";
  assert.match(bindSource, /const existingTemperature = findBinding\(nodeCode\)\?\.effective_value\?\.temperature/);
  assert.match(bindSource, /if \(typeof existingTemperature === "number" && Number\.isFinite\(existingTemperature\)\) \{\s*request\.temperature = existingTemperature;/);
  assert.doesNotMatch(bindSource, /temperature:\s*(?:0\.7|0|Number|parse)/);
});

test("workbench applies a temperature-only change to the selected node binding", () => {
  const saveModelSource = runtime.match(/async function saveModelConfiguration\(\) \{([\s\S]*?)\n\}/)?.[0] || "";
  const unchangedBranch = saveModelSource.match(/if \(unchangedModel\) \{([\s\S]*?)\n  \}\n\n  const evidenceId/);
  assert.match(saveModelSource, /const nodeCode = activeNodeCode\(\);/);
  assert.match(saveModelSource, /const unchangedModel =/);
  assert.match(saveModelSource, /if \(unchangedModel\)/);
  assert.ok(unchangedBranch, "the unchanged-model branch should be explicit");
  assert.match(saveModelSource, /action: "bind_node_template"/);
  assert.match(saveModelSource, /node_code: nodeCode/);
  assert.match(saveModelSource, /template_type: state\.modalTemplate/);
  assert.match(saveModelSource, /temperature,/);
  assert.doesNotMatch(unchangedBranch[1], /action: "save_model_template"/);
});

test("workbench keeps V7 temperature bounds and does not assert a zero-write outcome when transport is uncertain", () => {
  assert.match(page, /id="modalTempRange" type="range" min="0" max="2" step="0\.1" value="0\.7"/);
  assert.match(page, /<span>0 \(严格\)<\/span>[\s\S]*?<span>2 \(发散\)<\/span>/);

  const callSource = runtime.match(/async function callWorkbench\(payload\) \{([\s\S]*?)\n\}/)?.[0] || "";
  assert.match(callSource, /结果未知/);
  assert.doesNotMatch(callSource, /未修改任何配置/);
});

test("workbench reports a refresh failure after prompt or binding persistence instead of claiming a confirmed save", () => {
  const promptSource = runtime.match(/async function finishPromptEdit\([\s\S]*?(?=\nasync function bindNodeTemplate)/)?.[0] || "";
  const bindSource = runtime.match(/async function bindNodeTemplate\([\s\S]*?(?=\nasync function testConnection)/)?.[0] || "";

  for (const source of [promptSource, bindSource]) {
    assert.match(source, /const refreshed = await loadProjection\(\);/);
    assert.match(source, /if \(!refreshed\) \{[\s\S]*?setStatus\("failure",/);
    assert.doesNotMatch(source, /await loadProjection\(\);\s*setStatus\("ready"/);
  }
});

test("workbench preserves paragraph boundaries when saving an edited prompt", () => {
  assert.match(runtime, /function promptEditorText\(editor\) \{\s*return editor\.innerText\.replace\(\/\\r\\n\/g, "\\n"\)\.replace\(\/\\n\{3,\}\/g, "\\n\\n"\)\.trim\(\);/);
  assert.doesNotMatch(runtime, /const promptText = editor\.textContent\.trim\(\);/);
});

test("workbench keeps prompt completion bound to the current editor after a projection refresh", () => {
  assert.match(runtime, /document\.addEventListener\("focusout", \(event\) => \{[\s\S]*?const prompt = valueFromId\("promptEditor"\);[\s\S]*?event\.target !== prompt[\s\S]*?finishPromptEdit\(\)/);
  assert.doesNotMatch(runtime, /prompt\.addEventListener\("blur"/);
});

test("workbench Ctrl+Enter completes the existing prompt edit without relying on browser blur", () => {
  const shortcut = runtime.match(/else if \(\(event\.ctrlKey \|\| event\.metaKey\) && event\.key === "Enter"\) \{([\s\S]*?)\n    \}/)?.[1] || "";

  assert.match(shortcut, /finishPromptEdit\(\)/);
  assert.doesNotMatch(shortcut, /prompt\.blur\(\)/);
});

test("the prototype mock fallback is inert while the runtime owns canvas and modal behavior", () => {
  assert.equal((page.match(/<script type="text\/plain" data-prototype-mock="disabled">/g) || []).length, 2);
  const activeInlineScripts = [...page.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*\btype="text\/plain")[^>]*>([\s\S]*?)<\/script>/g)];
  assert.equal(activeInlineScripts.length, 0, "the shared sidebar owner is external to the page");
  assert.match(sharedTheme, /window\.toggleSidebar = function\(\)/);
  assert.doesNotMatch(sharedTheme, /defaultNodeTemplateMap|defaultTemplatesData|defaultNodePrompts|nodeTemplateMap|templatesData|loadNodePrompt|saveModalConfiguration|toggleAutoSwitch/);
  assert.doesNotMatch(page, /src="\/pages\/workbench\/workbench\.mjs"/);
  assert.match(runtime, /function openModelSettings\(\)/);
  assert.match(runtime, /function installCanvasNavigation\(\)/);
  assert.match(runtime, /function syncNodeHighlight\(\)/);
  assert.match(runtime, /运营商名称由当前模型模板的连接地址派生/);
});

test("an unconfigured node shows no prototype default prompt", () => {
  assert.match(runtime, /if \(!prompt\?\.effective_value\?\.prompt_text\) \{\s*editor\.dataset\.empty = "true";\s*editor\.textContent = "尚无 active Prompt；双击填写后可保存为新的 active 版本。"/);
  assert.doesNotMatch(runtime, /defaultNodePrompts/);
  assert.doesNotMatch(runtime, /node_prompt_/);
});

test("the workbench main area consumes the full desktop width beside the shared sidebar", () => {
  assert.match(page, /\.main-content \{ flex: 1 1 auto; min-width: 0; \}/);
});

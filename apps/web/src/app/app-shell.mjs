import { createMockProjection, createProjectionStore, PROJECTION_STATES } from "./projection-store.mjs";
import { renderSystemState } from "../components/system-state/system-state.mjs";

const contexts = Object.freeze([
  { local_operator_id: "operator:local", book_id: "book:ashfall", label: "余烬航线" },
  { local_operator_id: "operator:local", book_id: "book:river", label: "河岸档案" },
]);

function scopeOf(context) {
  return { local_operator_id: context.local_operator_id, book_id: context.book_id };
}

function configTable(document, projection) {
  const section = document.createElement("section");
  section.className = "config-summary";
  section.setAttribute("aria-labelledby", "config-heading");
  const heading = document.createElement("h2");
  heading.id = "config-heading";
  heading.textContent = "统一配置摘要";
  const note = document.createElement("p");
  note.className = "section-note";
  note.textContent = projection.config.some((item) => item.source === "mock")
    ? "当前为测试/Mock 数据，不会覆盖后端投影。"
    : "只读显示后端当前生效投影。";
  const table = document.createElement("table");
  table.innerHTML = "<thead><tr><th>项目</th><th>当前生效值</th><th>范围</th><th>版本</th><th>来源</th></tr></thead>";
  const body = document.createElement("tbody");
  for (const item of projection.config) {
    const row = document.createElement("tr");
    for (const value of [item.label, item.value, item.scope, item.version, item.source === "mock" ? "测试/Mock" : "后端"]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    body.append(row);
  }
  table.append(body);
  section.append(heading, note, table);
  return section;
}

export function mountAppShell(document) {
  const store = createProjectionStore();
  let active = contexts[0];
  for (const context of contexts) store.write(scopeOf(context), createMockProjection());
  const root = document.querySelector("#app");
  if (!root) throw new Error("missing app root");

  function render() {
    const projection = store.read(scopeOf(active));
    root.replaceChildren();
    const shell = document.createElement("main");
    shell.className = "app-shell";
    shell.innerHTML = "<header class=\"app-header\"><div><p class=\"eyebrow\">作品工作台</p><h1>投影概览</h1></div><div class=\"context-readout\"><span>本地操作者</span><strong></strong></div></header>";
    shell.querySelector("strong").textContent = active.local_operator_id;
    const controls = document.createElement("section");
    controls.className = "shell-controls";
    controls.setAttribute("aria-label", "测试投影控制");
    const bookLabel = document.createElement("label");
    bookLabel.textContent = "作品上下文";
    const bookSelect = document.createElement("select");
    bookSelect.dataset.testid = "book-context";
    contexts.forEach((context, index) => {
      const option = new Option(context.label, String(index), false, context.book_id === active.book_id);
      bookSelect.add(option);
    });
    bookSelect.addEventListener("change", () => { active = contexts[Number(bookSelect.value)]; render(); });
    bookLabel.append(bookSelect);
    const stateLabel = document.createElement("label");
    stateLabel.textContent = "状态预览（测试输入）";
    const stateSelect = document.createElement("select");
    stateSelect.dataset.testid = "projection-state";
    PROJECTION_STATES.forEach((state) => stateSelect.add(new Option(state, state, false, state === projection.state)));
    stateSelect.addEventListener("change", () => { store.write(scopeOf(active), createMockProjection(stateSelect.value)); render(); });
    stateLabel.append(stateSelect);
    controls.append(bookLabel, stateLabel);
    shell.append(controls, renderSystemState(document, projection), configTable(document, projection));
    root.append(shell);
  }
  render();
  return Object.freeze({ store, contexts, active: () => active, render });
}

if (typeof document !== "undefined") mountAppShell(document);

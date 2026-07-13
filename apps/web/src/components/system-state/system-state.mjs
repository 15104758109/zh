export const STATE_COPY = Object.freeze({
  loading: { label: "读取中", description: "正在等待后端投影。", tone: "neutral" },
  empty: { label: "暂无投影", description: "当前作品没有可展示的后端投影。", tone: "neutral" },
  failure: { label: "投影不可用", description: "后端投影未能提供；请根据服务端信息处理。", tone: "danger" },
  paused: { label: "已暂停", description: "后端投影报告当前流程处于暂停状态。", tone: "warning" },
  readonly: { label: "只读", description: "当前投影可查看，但此应用壳不提供写入。", tone: "neutral" },
  complete: { label: "已完成", description: "后端投影明确报告完成；此状态不代表业务验收。", tone: "positive" },
});

export function stateModel(projection) {
  const detail = STATE_COPY[projection?.state];
  if (!detail) throw new TypeError("unknown projection state");
  return Object.freeze({ state: projection.state, ...detail, summary: projection.summary ?? detail.description });
}

export function renderSystemState(document, projection) {
  const model = stateModel(projection);
  const section = document.createElement("section");
  section.className = `system-state system-state--${model.tone}`;
  section.dataset.state = model.state;
  section.setAttribute("aria-labelledby", "state-heading");
  const heading = document.createElement("h2");
  heading.id = "state-heading";
  heading.textContent = model.label;
  const description = document.createElement("p");
  description.textContent = model.description;
  const summary = document.createElement("p");
  summary.className = "system-state__summary";
  summary.textContent = model.summary;
  section.append(heading, description, summary);
  return section;
}

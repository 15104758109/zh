export const PROJECTION_STATES = Object.freeze([
  "loading",
  "empty",
  "failure",
  "paused",
  "readonly",
  "complete",
]);

const STATE_SET = new Set(PROJECTION_STATES);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function closedObject(value, keys) {
  return isPlainObject(value) && Object.keys(value).every((key) => keys.includes(key));
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function assertProjectionContext(context) {
  if (!closedObject(context, ["local_operator_id", "book_id"])
    || !nonEmptyString(context.local_operator_id)
    || !nonEmptyString(context.book_id)) {
    throw new TypeError("invalid projection context");
  }
  return Object.freeze({
    local_operator_id: context.local_operator_id,
    book_id: context.book_id,
  });
}

export function createProjection(input) {
  if (!closedObject(input, ["state", "summary", "config"])
    || !STATE_SET.has(input.state)
    || ("summary" in input && !nonEmptyString(input.summary))
    || ("config" in input && !Array.isArray(input.config))) {
    throw new TypeError("invalid projection input");
  }
  const config = (input.config ?? []).map((entry) => {
    if (!closedObject(entry, ["label", "value", "scope", "version", "source"])
      || !nonEmptyString(entry.label)
      || !nonEmptyString(entry.value)
      || !nonEmptyString(entry.scope)
      || !nonEmptyString(entry.version)
      || !["backend", "mock"].includes(entry.source)) {
      throw new TypeError("invalid configuration projection");
    }
    return Object.freeze({ ...entry });
  });
  return Object.freeze({ state: input.state, ...(input.summary ? { summary: input.summary } : {}), config: Object.freeze(config) });
}

export function projectionKey(context) {
  const safeContext = assertProjectionContext(context);
  return `${safeContext.local_operator_id}\u0000${safeContext.book_id}`;
}

export function createProjectionStore() {
  const cache = new Map();
  return Object.freeze({
    read(context) {
      return cache.get(projectionKey(context));
    },
    write(context, input) {
      const projection = createProjection(input);
      cache.set(projectionKey(context), projection);
      return projection;
    },
    clear(context) {
      cache.delete(projectionKey(context));
    },
    size() {
      return cache.size;
    },
  });
}

export function createMockProjection(state = "empty") {
  if (!STATE_SET.has(state)) throw new TypeError("invalid projection state");
  return createProjection({
    state,
    summary: "当前显示测试/Mock 投影；它不会覆盖后端投影。",
    config: [
      { label: "Prompt", value: "测试/Mock", scope: "作品", version: "Mock", source: "mock" },
      { label: "模型", value: "测试/Mock", scope: "作品", version: "Mock", source: "mock" },
      { label: "预算", value: "测试/Mock", scope: "本地操作者", version: "Mock", source: "mock" },
      { label: "自动化", value: "测试/Mock", scope: "作品", version: "Mock", source: "mock" },
      { label: "表现参数", value: "测试/Mock", scope: "作品", version: "Mock", source: "mock" },
    ],
  });
}

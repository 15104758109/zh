export const ACTIVE_FP_IDS = [
  "FP001-01", "FP001-02", "FP001-03", "FP001-05", "FP001-06", "FP001-07",
  "FP002-01", "FP002-02", "FP002-03", "FP002-04", "FP003-01", "FP003-02",
  "FP003-03", "FP003-04", "FP004-00", "FP004-01", "FP004-02", "FP004-04",
  "FP004-05", "FP005-00", "FP005-01", "FP006-01", "FP006-02", "FP007-01",
  "FP008-01", "FP008-02", "FP008-03", "FP008-04", "FP009-00", "FP009-01",
  "FP010-01", "FP010-02", "FP011-01", "FP011-02", "FP012-01", "FP012-02",
  "FP012-03", "FP012-04", "FP013-01", "FP013-02", "FP014-00", "FP014-01",
  "FP014-02", "FP014-03", "FP014-04", "FP015-01", "FP015-02", "FP016-01",
  "FP017-00", "FP017-01",
] as const;

export type LintIssue = { code: string; file: string; path: string; message: string };
export type InteractionContract = Record<string, unknown>;
export type CoverageModel = { active?: readonly { id: string; owner?: string }[] };

const REQUIRED_ACTION_FIELDS = ["prerequisites", "backend_command", "failure", "recovery", "projection"];

function scalar(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "{}") return trimmed === "{}" ? {} : "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed;
}

// The contract format intentionally accepts only mappings and list items. It avoids a YAML dependency
// while keeping authored contracts readable and prevents YAML tags/anchors from becoming executable input.
export function parseInteractionYaml(source: string): InteractionContract {
  const text = source.trim();
  if (text.startsWith("{")) return JSON.parse(text) as InteractionContract;
  const root: Record<string, unknown> = {};
  const stack: { indent: number; value: Record<string, unknown> | unknown[] }[] = [{ indent: -1, value: root }];
  const lines = source.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const raw = lines[lineIndex] ?? "";
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();
    while (stack.length > 1 && indent <= stack.at(-1)!.indent) stack.pop();
    const parent = stack.at(-1)!.value;
    if (line.startsWith("- ")) {
      if (!Array.isArray(parent)) throw new Error(`List item has no list parent: ${line}`);
      const body = line.slice(2);
      const match = /^([^:]+):(?:\s*(.*))?$/.exec(body);
      if (!match) { parent.push(scalar(body)); continue; }
      const item: Record<string, unknown> = {};
      parent.push(item);
      stack.push({ indent, value: item });
      const value = match[2] ?? "";
      const itemKey = match[1] ?? "";
      if (value) item[itemKey.trim()] = scalar(value);
      else {
        const next = lines.slice(lineIndex + 1).find((candidate) => candidate.trim() && !candidate.trimStart().startsWith("#"));
        const child: Record<string, unknown> | unknown[] = next?.trim().startsWith("- ") ? [] : {};
        item[itemKey.trim()] = child;
        stack.push({ indent: indent + 1, value: child });
      }
      continue;
    }
    const match = /^([^:]+):(?:\s*(.*))?$/.exec(line);
    if (!match || Array.isArray(parent)) throw new Error(`Invalid mapping line: ${line}`);
    const key = (match[1] ?? "").trim();
    const value = match[2] ?? "";
    if (value) { parent[key] = scalar(value); continue; }
    const next = lines.slice(lineIndex + 1).find((candidate) => candidate.trim() && !candidate.trimStart().startsWith("#"));
    const child: Record<string, unknown> | unknown[] = next?.trim().startsWith("- ") ? [] : {};
    parent[key] = child;
    stack.push({ indent, value: child });
  }
  return root;
}

function issue(issues: LintIssue[], code: string, file: string, path: string, message: string) {
  issues.push({ code, file, path, message });
}

export function lintContract(contract: InteractionContract, file = "<memory>", expectedOwner?: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const required = ["version", "contract_id", "owner", "object_scope", "actions"];
  for (const field of required) if (!(field in contract)) issue(issues, "REQUIRED_FIELD", file, field, `Missing ${field}.`);
  if (contract.version !== 1) issue(issues, "VERSION", file, "version", "version must be 1.");
  if (typeof contract.contract_id !== "string" || !/^(FP\d{3}-\d{2}|cap-[a-z0-9-]+)$/.test(contract.contract_id)) issue(issues, "CONTRACT_ID", file, "contract_id", "contract_id must identify an FP or capability.");
  if (typeof contract.owner !== "string" || !/^(F0|S[1-7]|W0)-[A-Z0-9-]+$/.test(contract.owner)) issue(issues, "OWNER", file, "owner", "owner must be a Task ID.");
  if (expectedOwner && contract.owner !== expectedOwner) issue(issues, "OWNER_MISMATCH", file, "owner", `Expected owner ${expectedOwner}.`);
  const scope = contract.object_scope as Record<string, unknown> | undefined;
  if (!scope || typeof scope !== "object" || Array.isArray(scope) || Object.keys(scope).length === 0) issue(issues, "OBJECT_SCOPE", file, "object_scope", "object_scope must declare at least one controlled object boundary.");
  const actions = contract.actions;
  if (!Array.isArray(actions) || actions.length === 0) { issue(issues, "ACTIONS", file, "actions", "At least one action is required."); return issues; }
  actions.forEach((action, index) => {
    const base = `actions[${index}]`;
    if (!action || typeof action !== "object" || Array.isArray(action)) { issue(issues, "ACTION", file, base, "Action must be a mapping."); return; }
    const entry = action as Record<string, unknown>;
    if (typeof entry.id !== "string" || entry.id.length === 0) issue(issues, "ACTION_ID", file, `${base}.id`, "Action needs an id.");
    for (const field of REQUIRED_ACTION_FIELDS) if (!(field in entry)) issue(issues, "ACTION_FIELD", file, `${base}.${field}`, `Missing ${field}.`);
    if (!Array.isArray(entry.prerequisites) || entry.prerequisites.length === 0) issue(issues, "PREREQUISITES", file, `${base}.prerequisites`, "Action needs explicit prerequisites.");
    if (typeof entry.backend_command !== "string" || !/^(rpc_|command_)[a-z0-9_]+$/.test(entry.backend_command)) issue(issues, "BACKEND_COMMAND", file, `${base}.backend_command`, "Action must use a controlled backend command.");
    if (!entry.failure || typeof entry.failure !== "object" || Array.isArray(entry.failure)) issue(issues, "FAILURE", file, `${base}.failure`, "Action needs a failure contract.");
    if (!entry.recovery || typeof entry.recovery !== "object" || Array.isArray(entry.recovery)) issue(issues, "RECOVERY", file, `${base}.recovery`, "Action needs a recovery contract.");
    const projection = entry.projection as Record<string, unknown> | undefined;
    if (!projection || projection.mode !== "readonly") issue(issues, "READONLY_PROJECTION", file, `${base}.projection`, "Projection must be explicitly readonly; a display is not a state transition.");
  });
  return issues;
}

export function coverageReport(contracts: readonly InteractionContract[], model: CoverageModel = {}): Record<string, unknown> {
  const active = model.active ?? ACTIVE_FP_IDS.map((id) => ({ id }));
  const present = new Set(contracts.map((contract) => contract.contract_id).filter((id): id is string => typeof id === "string"));
  const missing = active.filter((item) => !present.has(item.id)).map((item) => item.id);
  return {
    active_fp_count: active.length,
    covered_active_fp_count: active.length - missing.length,
    missing_active_fp: missing,
    merged_responsibilities: [{ id: "FP007-02", owner: "S3-FP007-01", status: "merged", independent_contract_required: false }],
  };
}

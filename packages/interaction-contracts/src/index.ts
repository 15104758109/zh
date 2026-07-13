const ACTIVE_FP_OWNER_PAIRS: readonly (readonly [string, string])[] = [
    ["FP001-01", "S1-FP001-01"], ["FP001-02", "S1-FP001-02"], ["FP001-03", "S1-FP001-03"], ["FP001-05", "S1-FP001-05"], ["FP001-06", "S1-FP001-06"], ["FP001-07", "S1-FP001-07"],
    ["FP002-01", "S2-FP002-01"], ["FP002-02", "S2-FP002-02"], ["FP002-03", "S2-FP002-03"], ["FP002-04", "S2-FP002-04"], ["FP003-01", "S2-FP003-01"], ["FP003-02", "S2-FP003-02"],
    ["FP003-03", "S2-FP003-03"], ["FP003-04", "S2-FP003-04"], ["FP004-00", "S2-FP004-00"], ["FP004-01", "S2-FP004-01"], ["FP004-02", "S2-FP004-02"], ["FP004-04", "S2-FP004-04"], ["FP004-05", "S2-FP004-05"],
    ["FP005-00", "S3-FP005-00"], ["FP005-01", "S3-FP005-01"], ["FP006-01", "S3-FP006-01"], ["FP006-02", "S3-FP006-02"], ["FP007-01", "S3-FP007-01"],
    ["FP008-01", "S4-FP008-01"], ["FP008-02", "S4-FP008-02"], ["FP008-03", "S4-FP008-03"], ["FP008-04", "S4-FP008-04"], ["FP009-00", "S5-FP009-00"], ["FP009-01", "S5-FP009-01"],
    ["FP010-01", "S5-FP010-01"], ["FP010-02", "S5-FP010-02"], ["FP011-01", "S5-FP011-01"], ["FP011-02", "S5-FP011-02"], ["FP012-01", "S5-FP012-01"], ["FP012-02", "S5-FP012-02"],
    ["FP012-03", "S5-FP012-03"], ["FP012-04", "S5-FP012-04"], ["FP013-01", "S5-FP013-01"], ["FP013-02", "S5-FP013-02"], ["FP014-00", "S7-FP014-00"], ["FP014-01", "S7-FP014-01"],
    ["FP014-02", "S7-FP014-02"], ["FP014-03", "S7-FP014-03"], ["FP014-04", "S7-FP014-04"], ["FP015-01", "S3-FP015-01"], ["FP015-02", "S7-FP015-02"], ["FP016-01", "S1-FP016-01"],
    ["FP017-00", "F0-04-LOCAL-OPERATOR"], ["FP017-01", "S7-FP017-01"],
];

export const DEFAULT_COVERAGE_MODEL = {
  active: ACTIVE_FP_OWNER_PAIRS.map(([id, owner]) => ({ id, owner })),
} as const;

export type LintIssue = { code: string; file: string; path: string; message: string };
export type InteractionContract = Record<string, unknown>;
export type CoverageModel = { active?: readonly { id: string; owner?: string }[] };
export type InteractionSchema = { $id?: string; $schema?: string };

const CONTROLLED_RPC_IDS = new Set(Array.from({ length: 16 }, (_, index) => `RPC-${String(index + 1).padStart(3, "0")}`));
const TOP_FIELDS = new Set(["version", "contract_id", "owner", "object_scope", "actions"]);
const ACTION_FIELDS = new Set(["id", "prerequisites", "backend_command", "success", "failure", "recovery", "permission", "projection"]);

function scalar(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed;
}

function setField(parent: Record<string, unknown>, key: string, value: unknown) {
  if (Object.hasOwn(parent, key)) throw new Error(`Duplicate YAML key: ${key}`);
  parent[key] = value;
}

// This deliberately restricted YAML reader rejects aliases, tags, flow collections, and duplicate keys.
export function parseInteractionYaml(source: string): InteractionContract {
  if (source.trimStart().startsWith("{")) throw new Error("JSON input is not accepted; author an interaction YAML contract.");
  const root: Record<string, unknown> = {};
  const stack: { indent: number; value: Record<string, unknown> | unknown[] }[] = [{ indent: -1, value: root }];
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    if (/[*&!{}\[\]]/.test(raw)) throw new Error(`Unsupported YAML construct: ${raw.trim()}`);
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();
    while (stack.length > 1 && indent <= stack.at(-1)!.indent) stack.pop();
    const parent = stack.at(-1)!.value;
    const next = lines.slice(index + 1).find((candidate) => candidate.trim() && !candidate.trimStart().startsWith("#"));
    if (line.startsWith("- ")) {
      if (!Array.isArray(parent)) throw new Error(`List item has no list parent: ${line}`);
      const match = /^([^:]+):(?:\s*(.*))?$/.exec(line.slice(2));
      if (!match) { parent.push(scalar(line.slice(2))); continue; }
      const item: Record<string, unknown> = {};
      parent.push(item);
      stack.push({ indent, value: item });
      const key = (match[1] ?? "").trim();
      const value = match[2] ?? "";
      if (value) setField(item, key, scalar(value));
      else {
        const child: Record<string, unknown> | unknown[] = next?.trim().startsWith("- ") ? [] : {};
        setField(item, key, child);
        stack.push({ indent: indent + 1, value: child });
      }
      continue;
    }
    const match = /^([^:]+):(?:\s*(.*))?$/.exec(line);
    if (!match || Array.isArray(parent)) throw new Error(`Invalid mapping line: ${line}`);
    const key = (match[1] ?? "").trim();
    const value = match[2] ?? "";
    if (value) { setField(parent, key, scalar(value)); continue; }
    const child: Record<string, unknown> | unknown[] = next?.trim().startsWith("- ") ? [] : {};
    setField(parent, key, child);
    stack.push({ indent, value: child });
  }
  return root;
}

function issue(issues: LintIssue[], code: string, file: string, path: string, message: string) { issues.push({ code, file, path, message }); }
function closedObject(value: unknown, fields: readonly string[], issues: LintIssue[], file: string, path: string): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) { issue(issues, "TYPE", file, path, "Expected an object."); return false; }
  for (const key of Object.keys(value)) if (!fields.includes(key)) issue(issues, "UNKNOWN_FIELD", file, `${path}.${key}`, "Unknown field.");
  return true;
}
function requiredString(value: unknown, issues: LintIssue[], file: string, path: string) { if (typeof value !== "string" || value.length === 0) issue(issues, "TYPE", file, path, "Expected a nonempty string."); }

export function validateInteractionContract(contract: InteractionContract, schema: InteractionSchema | undefined, file = "<memory>"): LintIssue[] {
  const issues: LintIssue[] = [];
  if (!schema || schema.$id !== "urn:zhreplan:interaction-contract:1") { issue(issues, "SCHEMA", file, "", "Interaction contract schema is unavailable or invalid."); return issues; }
  for (const key of Object.keys(contract)) if (!TOP_FIELDS.has(key)) issue(issues, "UNKNOWN_FIELD", file, key, "Unknown field.");
  for (const field of TOP_FIELDS) if (!(field in contract)) issue(issues, "REQUIRED_FIELD", file, field, `Missing ${field}.`);
  if (contract.version !== 1) issue(issues, "VERSION", file, "version", "version must be 1.");
  if (typeof contract.contract_id !== "string" || !/^(FP\d{3}-\d{2}|cap-[a-z0-9-]+)$/.test(contract.contract_id)) issue(issues, "CONTRACT_ID", file, "contract_id", "contract_id must identify an FP or capability.");
  requiredString(contract.owner, issues, file, "owner");
  const scope = contract.object_scope;
  if (closedObject(scope, ["local_operator_id", "book_id", "chapter_id", "run_id"], issues, file, "object_scope")) {
    if (!Object.hasOwn(scope, "local_operator_id")) issue(issues, "REQUIRED_FIELD", file, "object_scope.local_operator_id", "Missing local_operator_id boundary.");
    for (const [key, value] of Object.entries(scope)) if (typeof value !== "string" || !["required", "optional", "not_applicable"].includes(value)) issue(issues, "OBJECT_SCOPE", file, `object_scope.${key}`, "Scope values must be required, optional, or not_applicable.");
  }
  if (!Array.isArray(contract.actions) || contract.actions.length === 0) { issue(issues, "ACTIONS", file, "actions", "At least one action is required."); return issues; }
  contract.actions.forEach((action, index) => {
    const path = `actions[${index}]`;
    if (!closedObject(action, [...ACTION_FIELDS], issues, file, path)) return;
    for (const field of ACTION_FIELDS) if (!Object.hasOwn(action, field)) issue(issues, "REQUIRED_FIELD", file, `${path}.${field}`, `Missing ${field}.`);
    requiredString(action.id, issues, file, `${path}.id`);
    if (!Array.isArray(action.prerequisites) || action.prerequisites.length === 0 || action.prerequisites.some((item) => typeof item !== "string" || item.length === 0)) issue(issues, "PREREQUISITES", file, `${path}.prerequisites`, "Prerequisites must be a nonempty string list.");
    const command = action.backend_command;
    if (closedObject(command, ["registry_id", "command_id"], issues, file, `${path}.backend_command`)) {
      requiredString(command.registry_id, issues, file, `${path}.backend_command.registry_id`);
      requiredString(command.command_id, issues, file, `${path}.backend_command.command_id`);
      if (typeof command.registry_id === "string" && !CONTROLLED_RPC_IDS.has(command.registry_id)) issue(issues, "BACKEND_COMMAND", file, `${path}.backend_command.registry_id`, "Command must cite a registered controlled RPC.");
    }
    for (const [field, keys] of [["success", ["result", "state_change"]], ["failure", ["code", "message"]], ["recovery", ["strategy"]], ["permission", ["source", "enforcement"]], ["projection", ["mode", "fields"]]] as const) {
      const value = action[field];
      if (!closedObject(value, keys, issues, file, `${path}.${field}`)) continue;
      for (const key of keys) if (!Object.hasOwn(value, key)) issue(issues, "REQUIRED_FIELD", file, `${path}.${field}.${key}`, `Missing ${key}.`);
      for (const key of keys.filter((key) => key !== "state_change" && key !== "fields")) requiredString(value[key], issues, file, `${path}.${field}.${key}`);
      if (field === "success" && typeof value.state_change !== "boolean") issue(issues, "SUCCESS", file, `${path}.success.state_change`, "Success must explicitly declare state_change.");
      if (field === "permission" && (value.source !== "object_scope" || value.enforcement !== "backend")) issue(issues, "PERMISSION", file, `${path}.permission`, "Permission must be enforced by the declared object scope at the backend.");
      if (field === "projection" && (value.mode !== "readonly" || !Array.isArray(value.fields) || value.fields.length === 0 || value.fields.some((item) => typeof item !== "string" || item.length === 0))) issue(issues, "READONLY_PROJECTION", file, `${path}.projection`, "Projection must be readonly with nonempty fields.");
    }
  });
  return issues;
}

export function lintContract(contract: InteractionContract, schema: InteractionSchema, file = "<memory>", model: CoverageModel = DEFAULT_COVERAGE_MODEL): LintIssue[] {
  const issues = validateInteractionContract(contract, schema, file);
  const expectedOwner = model.active?.find((item) => item.id === contract.contract_id)?.owner;
  if (expectedOwner && contract.owner !== expectedOwner) issue(issues, "OWNER_MISMATCH", file, "owner", `Expected owner ${expectedOwner}.`);
  return issues;
}

export function coverageReport(contracts: readonly InteractionContract[], model: CoverageModel = DEFAULT_COVERAGE_MODEL): Record<string, unknown> {
  const active = model.active ?? [];
  const present = new Set(contracts.map((contract) => contract.contract_id).filter((id): id is string => typeof id === "string"));
  const missing = active.filter((item) => !present.has(item.id)).map((item) => item.id);
  return { active_fp_count: active.length, covered_active_fp_count: active.length - missing.length, missing_active_fp: missing, merged_responsibilities: [{ id: "FP007-02", owner: "S3-FP007-01", status: "merged", independent_contract_required: false }] };
}

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

import { ContractValidator } from "@zh/contracts";

export type LintIssue = { code: string; file: string; path: string; message: string };
export type InteractionContract = Record<string, unknown>;
export type CoverageModel = { active?: readonly { id: string; owner?: string }[] };
export type InteractionSchema = { $id?: string; $schema?: string };

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
    if (/^ *\t/.test(raw)) throw new Error("Tab indentation is not permitted in YAML contracts.");
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

export function lintContract(contract: InteractionContract, schema: InteractionSchema, file = "<memory>", model: CoverageModel = DEFAULT_COVERAGE_MODEL): LintIssue[] {
  const issues: LintIssue[] = [];
  const validator = ContractValidator.create([schema]);
  if (!validator.ok || typeof schema.$id !== "string") {
    issues.push({ code: "SCHEMA", file, path: "", message: "Interaction contract schema could not be compiled." });
    return issues;
  }
  const validation = validator.value.validateRaw(schema.$id, "interaction-contract", 1, contract);
  if (!validation.ok) for (const error of validation.errors) issues.push({ code: error.code, file, path: error.path, message: error.message });
  const expectedOwner = model.active?.find((item) => item.id === contract.contract_id)?.owner;
  if (expectedOwner && contract.owner !== expectedOwner) issues.push({ code: "OWNER_MISMATCH", file, path: "owner", message: `Expected owner ${expectedOwner}.` });
  return issues;
}

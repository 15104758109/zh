#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, "..");

const CONTROL_PATH = "docs/IMPLEMENTATION_CONTROL.md";
const V7_PATH = "docs/v7设计文档_20260709_终版.md";
const PROMPT_PATH = "docs/后端/对齐版提示词.md";
const PROTOTYPE_ROOT = "docs/前端原型_v2";
const N8N_ROOT = "docs/后端/n8n";

const ROLES = new Map([
  ["coordinator", "VIEW::COORDINATOR"],
  ["gap_auditor", "VIEW::GAP_AUDITOR"],
  ["coder", "VIEW::CODER"],
  ["prompt_editor", "VIEW::PROMPT_EDITOR"],
  ["auditor", "VIEW::AUDITOR"],
  ["reviewer", "VIEW::REVIEWER"],
  ["architect", "VIEW::ARCHITECT"],
]);

const CROSS_FP_REVIEW_ROLES = new Set(["coordinator", "reviewer", "architect"]);
const CONFLICT_LEVELS = new Set(["BLOCKING", "EXPECTED_GREENFIELD", "WARNING"]);
const DECISION_LEVELS = new Set([
  "CREATOR_REQUIRED",
  "TASK_AUTONOMOUS",
  "ARCHITECT_AUTONOMOUS",
  "P2_TECH_DEBT",
  "BLOCKED_TECHNICAL",
  "ENVIRONMENT_APPROVAL_REQUIRED",
]);

const EXCLUDED_SEGMENTS = new Set([
  ".git",
  ".tmp",
  "tmp",
  "temp",
  "archive",
  "archives",
  "archived",
  "backup",
  "backups",
  "legacy",
  "归档",
  "历史版本",
  "旧版",
]);

const TASK_ID_RE = /^(?:F0|W0|S[1-7])-[A-Z0-9-]+$/;
const FP_ID_RE = /^FP\d{3}(?:-\d{2})?$/;

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function conflict(level, kind, reason, details = {}) {
  if (!CONFLICT_LEVELS.has(level)) throw new Error(`unknown conflict level: ${level}`);
  return { level, kind, reason, ...details };
}

function gitBlobOid(buffer) {
  const header = Buffer.from(`blob ${buffer.length}\0`, "utf8");
  return crypto.createHash("sha1").update(header).update(buffer).digest("hex");
}

function stripMd(value) {
  const trimmed = String(value ?? "").trim();
  const singleCodeSpan = /^`([^`]*)`$/.exec(trimmed);
  if (singleCodeSpan) return singleCodeSpan[1].trim();
  return trimmed;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseMarkdownRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;

  const cells = [];
  let current = "";
  let escaped = false;
  for (let index = 1; index < trimmed.length - 1; index += 1) {
    const char = trimmed[index];
    if (escaped) {
      current += char;
      escaped = false;
    } else if (char === "\\") {
      current += char;
      escaped = true;
    } else if (char === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function isSeparatorRow(cells) {
  return Boolean(cells?.length) && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function readTextFile(root, relativePath) {
  const normalized = normalizePath(relativePath);
  const absolutePath = path.join(root, ...normalized.split("/"));
  const buffer = fs.readFileSync(absolutePath);
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "").replaceAll("\r\n", "\n");
  return {
    relativePath: normalized,
    absolutePath,
    buffer,
    text,
    lines: text.split("\n"),
    sha256: sha256(buffer),
    gitBlobOid: gitBlobOid(buffer),
  };
}

function lineRangeHash(info, startLine, endLine) {
  return sha256(info.lines.slice(startLine - 1, endLine).join("\n"));
}

function makeRef(info, startLine, endLine, anchor, kind = "line_range") {
  return {
    path: info.relativePath,
    anchor,
    kind,
    start_line: startLine,
    end_line: endLine,
    section_sha256: lineRangeHash(info, startLine, endLine),
  };
}

function headingSections(info) {
  const headings = [];
  for (let index = 0; index < info.lines.length; index += 1) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(info.lines[index]);
    if (!match) continue;
    headings.push({ line: index + 1, level: match[1].length, title: match[2] });
  }
  return headings.map((heading, index) => {
    let endLine = info.lines.length;
    for (let cursor = index + 1; cursor < headings.length; cursor += 1) {
      if (headings[cursor].level <= heading.level) {
        endLine = headings[cursor].line - 1;
        break;
      }
    }
    return { ...heading, endLine };
  });
}

function findHeadingSection(info, titlePredicate, anchor) {
  const section = headingSections(info).find((candidate) => titlePredicate(candidate.title, candidate));
  return section ? makeRef(info, section.line, section.endLine, anchor, "heading_section") : null;
}

function findStableHeading(info, stableId, sourcePrefix) {
  const escaped = escapeRegExp(stableId);
  const exactId = new RegExp(`(^|[^A-Z0-9-])${escaped}([^A-Z0-9-]|$)`);
  const sections = headingSections(info);
  const candidates = sections.filter((candidate) => exactId.test(candidate.title));
  if (!candidates.length) return null;
  const exactStart = candidates.find((candidate) => candidate.title.startsWith(stableId));
  const selected = exactStart ?? candidates[0];
  const targetGroup = fpGroup(stableId);
  const targetIsNode = stableId.includes("-");
  let endLine = info.lines.length;
  for (const candidate of sections) {
    if (candidate.line <= selected.line) continue;
    const leadingFp = /^(FP\d{3})(?:-(\d{2}))?\b/.exec(candidate.title);
    if (!leadingFp) continue;
    const candidateGroup = leadingFp[1];
    const candidateNode = leadingFp[2] ? `${candidateGroup}-${leadingFp[2]}` : null;
    const beginsNextStableObject = targetIsNode
      ? candidateGroup !== targetGroup || Boolean(candidateNode && candidateNode !== stableId)
      : candidateGroup !== targetGroup;
    if (beginsNextStableObject) {
      endLine = candidate.line - 1;
      break;
    }
  }
  return makeRef(
    info,
    selected.line,
    endLine,
    `${sourcePrefix}::${stableId}`,
    "stable_heading_section",
  );
}

function parseTables(info) {
  const tables = [];
  for (let index = 0; index < info.lines.length - 1; index += 1) {
    const header = parseMarkdownRow(info.lines[index]);
    const separator = parseMarkdownRow(info.lines[index + 1]);
    if (!header || !isSeparatorRow(separator) || header.length !== separator.length) continue;

    const rows = [];
    let cursor = index + 2;
    while (cursor < info.lines.length) {
      const cells = parseMarkdownRow(info.lines[cursor]);
      if (!cells || cells.length !== header.length || isSeparatorRow(cells)) break;
      const values = Object.fromEntries(header.map((name, cellIndex) => [stripMd(name), cells[cellIndex]]));
      rows.push({ line: cursor + 1, cells, values, raw: info.lines[cursor] });
      cursor += 1;
    }
    tables.push({ header: header.map(stripMd), headerLine: index + 1, rows });
    index = Math.max(index, cursor - 1);
  }
  return tables;
}

function cleanObjectValues(values) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, stripMd(value)]));
}

function rowRef(info, row, anchor, kind = "table_row") {
  return makeRef(info, row.line, row.line, anchor, kind);
}

function isExcludedPath(relativePath) {
  const segments = normalizePath(relativePath).toLowerCase().split("/");
  return segments.some((segment) => EXCLUDED_SEGMENTS.has(segment));
}

function listFiles(root, relativeRoot = "") {
  const start = path.join(root, ...normalizePath(relativeRoot).split("/").filter(Boolean));
  if (!fs.existsSync(start)) return [];
  const output = [];

  function visit(absoluteDirectory, relativeDirectory) {
    const entries = fs.readdirSync(absoluteDirectory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const relativePath = normalizePath(path.posix.join(relativeDirectory, entry.name));
      if (isExcludedPath(relativePath)) continue;
      const absolutePath = path.join(absoluteDirectory, entry.name);
      if (entry.isDirectory()) visit(absolutePath, relativePath);
      else if (entry.isFile()) output.push(relativePath);
    }
  }

  visit(start, normalizePath(relativeRoot));
  return output;
}

function globToRegExp(glob) {
  const normalized = normalizePath(glob);
  let pattern = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === "*") {
      if (normalized[index + 1] === "*") {
        pattern += ".*";
        index += 1;
      } else {
        pattern += "[^/]*";
      }
    } else if (char === "?") {
      pattern += "[^/]";
    } else {
      pattern += escapeRegExp(char);
    }
  }
  return new RegExp(`${pattern}$`);
}

function extractBacktickTokens(text) {
  return [...String(text).matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

function parseDependsOn(text) {
  if (stripMd(text) === "—") return [];
  return [...String(text).matchAll(/(?:F0|W0|S[1-7])-[A-Z0-9-]+/g)]
    .map((match) => match[0])
    .filter((value, index, values) => values.indexOf(value) === index);
}

function fpGroup(fpId) {
  const match = /^(FP\d{3})/.exec(fpId);
  return match?.[1] ?? null;
}

function expressionContainsFp(expression, fpId) {
  const group = Number(fpGroup(fpId)?.slice(2));
  if (!Number.isInteger(group)) return false;
  const exact = new RegExp(`(^|[^A-Z0-9-])${escapeRegExp(fpId)}([^A-Z0-9-]|$)`);
  if (exact.test(expression)) return true;
  const groupId = fpGroup(fpId);
  if (new RegExp(`(^|[^A-Z0-9-])${groupId}([^A-Z0-9-]|$)`).test(expression)) return true;
  for (const match of expression.matchAll(/FP(\d{3})\s*-\s*FP(\d{3})/g)) {
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (group >= Math.min(start, end) && group <= Math.max(start, end)) return true;
  }
  return false;
}

function expandCompositeToken(token) {
  const match = /^(.*?)(\d+)((?:[\/~]\d+)*)$/.exec(token);
  if (!match || !match[3]) return [token];
  const prefix = match[1];
  const width = match[2].length;
  const output = [`${prefix}${match[2]}`];
  let current = Number(match[2]);
  const parts = [...match[3].matchAll(/([\/~])(\d+)/g)];
  for (const [, operator, digits] of parts) {
    const next = Number(digits);
    if (operator === "~") {
      const step = next >= current ? 1 : -1;
      for (let value = current + step; value !== next + step; value += step) {
        output.push(`${prefix}${String(value).padStart(width, "0")}`);
      }
    } else {
      output.push(`${prefix}${String(next).padStart(width, "0")}`);
    }
    current = next;
  }
  return [...new Set(output)];
}

function extractStableTokens(text) {
  const patterns = [
    /(?:V7|PROMPT)::FP\d{3}-\d{2}(?:[\/~]\d{2})*/g,
    /(?:ALIGN|G03[A-D])::[A-Z0-9_-]+/g,
    /(?:BIZDEP|DATADEP|RUNDEP|VIEWDEP|SPLIT|MERGE)::[A-Z0-9_-]+(?:[\/~]\d{3})*/g,
    /G03[A-D]-(?:BD|TC|BA)-\d{2}(?:[\/~]\d{2})*/g,
    /(?:TERM|GD|RPC|ALIGN-DEBT)-\d{3}(?:[\/~]\d{3})*/g,
    /G04::[A-Z0-9_-]+/g,
    /IMPLEMENTATION_CONTROL::[^`、，；|]+/g,
  ];
  const values = [];
  for (const pattern of patterns) {
    for (const match of String(text).matchAll(pattern)) {
      values.push(...expandCompositeToken(match[0].trim()));
    }
  }
  return [...new Set(values)];
}

function lineNumbersContaining(info, needle) {
  const output = [];
  for (let index = 0; index < info.lines.length; index += 1) {
    if (info.lines[index].includes(needle)) output.push(index + 1);
  }
  return output;
}

function jsonPointerEscape(value) {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}

function findJsonPointers(value, stableId, pointer = "", output = []) {
  if (typeof value === "string") {
    if (value.includes(stableId)) output.push(pointer || "/");
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => findJsonPointers(item, stableId, `${pointer}/${index}`, output));
    return output;
  }
  if (!value || typeof value !== "object") return output;
  for (const [key, child] of Object.entries(value)) {
    const childPointer = `${pointer}/${jsonPointerEscape(key)}`;
    if (key.includes(stableId)) output.push(childPointer);
    findJsonPointers(child, stableId, childPointer, output);
  }
  return output;
}

function runGit(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : null;
}

function gitState(root) {
  const head = runGit(root, ["rev-parse", "HEAD"]);
  const statusOutput = runGit(root, ["-c", "core.quotepath=false", "status", "--porcelain=v1", "--untracked-files=all"]);
  const statuses = new Map();
  if (statusOutput) {
    for (const line of statusOutput.split(/\r?\n/)) {
      if (line.length < 4) continue;
      const code = line.slice(0, 2);
      let filePath = normalizePath(line.slice(3));
      if (filePath.includes(" -> ")) filePath = filePath.split(" -> ").at(-1);
      statuses.set(filePath, code);
    }
  }
  return { head, statuses };
}

class ProjectContextRouter {
  constructor(root) {
    this.root = path.resolve(root);
    this.control = readTextFile(this.root, CONTROL_PATH);
    this.v7 = null;
    this.prompt = null;
    this.tables = parseTables(this.control);
    this.git = gitState(this.root);
    this.allProjectFiles = null;
    this.versionCache = new Map();
    this.tasks = this.parseTasks();
    this.taskById = new Map(this.tasks.map((task) => [task.id, task]));
    this.dependencyRows = this.parseDependencyRows();
    this.sliceRows = this.parseSliceRows();
    this.scopeDefinitions = this.parseScopeDefinitions();
    this.rpcRows = this.parseRpcRows();
    this.alignmentRows = this.parseAlignmentRows();
    this.gates = this.parseGateValues();
  }

  v7Source() {
    if (!this.v7) this.v7 = readTextFile(this.root, V7_PATH);
    return this.v7;
  }

  promptSource() {
    if (!this.prompt) this.prompt = readTextFile(this.root, PROMPT_PATH);
    return this.prompt;
  }

  parseTasks() {
    const tasks = [];
    for (const table of this.tables.filter((candidate) => candidate.header[0] === "Task ID")) {
      for (const row of table.rows) {
        const values = cleanObjectValues(row.values);
        const id = values["Task ID"];
        if (!TASK_ID_RE.test(id)) continue;
        tasks.push({ id, values, line: row.line, sourceRef: rowRef(this.control, row, id) });
      }
    }
    return tasks;
  }

  parseDependencyRows() {
    const rows = [];
    for (const table of this.tables) {
      for (const row of table.rows) {
        const values = cleanObjectValues(row.values);
        const key = values["依赖键"];
        if (!/^(?:BIZDEP|DATADEP|RUNDEP)::\d{3}$/.test(key ?? "")) continue;
        const upstream = values["上游"] ?? values["生产者"] ?? "";
        const downstream = values["下游"] ?? values["消费者"] ?? "";
        rows.push({
          key,
          type: key.split("::")[0],
          upstream,
          downstream,
          status: values["状态"] ?? "",
          sourceRef: rowRef(this.control, row, key),
        });
      }
    }
    return rows;
  }

  parseSliceRows() {
    const table = this.tables.find((candidate) => candidate.header[0] === "切片" && candidate.header.includes("入口条件"));
    if (!table) return [];
    return table.rows
      .map((row) => ({ values: cleanObjectValues(row.values), line: row.line, sourceRef: rowRef(this.control, row, `G04::SLICES::${stripMd(row.cells[0])}`) }))
      .filter((row) => /^(?:F0|W0|S[1-7])$/.test(row.values["切片"]));
  }

  parseScopeDefinitions() {
    const table = this.tables.find((candidate) => candidate.header[0] === "注册项" && candidate.header[1] === "定义");
    const definitions = new Map();
    for (const row of table?.rows ?? []) {
      const key = stripMd(row.cells[0]);
      if (key.startsWith("SCOPE::")) definitions.set(key, stripMd(row.cells[1]));
    }
    return definitions;
  }

  parseRpcRows() {
    const table = this.tables.find((candidate) => candidate.header[0] === "ID" && candidate.header.includes("正式 RPC 名"));
    return (table?.rows ?? [])
      .map((row) => ({ values: cleanObjectValues(row.values), line: row.line, sourceRef: rowRef(this.control, row, stripMd(row.cells[0])) }))
      .filter((row) => /^RPC-(?:\d{3}|X\d{2})$/.test(row.values.ID));
  }

  parseAlignmentRows() {
    const table = this.tables.find((candidate) => candidate.header[0] === "对齐键" && candidate.header.includes("V7 业务意图"));
    if (!table) return new Map();
    return new Map(table.rows.map((row) => {
      const values = cleanObjectValues(row.values);
      return [values["对齐键"], { values, line: row.line, sourceRef: rowRef(this.control, row, values["对齐键"]) }];
    }));
  }

  parseGateValues() {
    const gates = {};
    for (const line of this.control.lines.slice(0, 80)) {
      const match = /^([A-Z0-9_-]+)=(.+)$/.exec(line.trim());
      if (match) gates[match[1]] = match[2];
    }
    return gates;
  }

  deriveTaskFpIds(task) {
    const coverage = task.values["FP覆盖（主/横切）"] ?? task.values["覆盖 FP（主/横切）"] ?? "";
    const primary = [...coverage.matchAll(/FP::(FP\d{3}-\d{2})/g)].map((match) => match[1]);
    const exact = [...coverage.matchAll(/\b(FP\d{3}-\d{2})\b/g)].map((match) => match[1]);
    return [...new Set([...primary, ...exact])]
      .filter((fpId) => Boolean(this.detailedFpRow(fpId)));
  }

  versionFor(relativePath, registeredSha256 = null) {
    const normalized = normalizePath(relativePath);
    const cacheKey = `${normalized}|${registeredSha256 ?? ""}`;
    if (this.versionCache.has(cacheKey)) return this.versionCache.get(cacheKey);
    const info = readTextFile(this.root, normalized);
    const version = {
      path: normalized,
      bytes: info.buffer.length,
      sha256: info.sha256,
      git_blob_oid: info.gitBlobOid,
      git_head: this.git.head,
      worktree_status: this.git.statuses.get(normalized) ?? "CLEAN",
      registered_sha256: registeredSha256,
      matches_registered_sha256: registeredSha256 ? info.sha256 === registeredSha256.toLowerCase() : null,
    };
    this.versionCache.set(cacheKey, version);
    return version;
  }

  registeredProtectedHashes() {
    const output = new Map();
    for (const table of this.tables) {
      for (const row of table.rows) {
        const key = stripMd(row.cells[0]);
        if (key === "SCOPE::HASH::V7") output.set(V7_PATH, stripMd(row.cells[1]).toLowerCase());
        if (key === "SCOPE::HASH::PROMPT") output.set(PROMPT_PATH, stripMd(row.cells[1]).toLowerCase());
      }
    }
    return output;
  }

  controlTokenRef(token) {
    if (token.startsWith("IMPLEMENTATION_CONTROL::")) {
      const title = token.split("::").slice(1).join("::").trim();
      return findHeadingSection(this.control, (candidate) => candidate.includes(title), token);
    }
    const preferredPatterns = [
      new RegExp(`^\\|\\s*\`?${escapeRegExp(token)}\`?\\s*\\|`),
      new RegExp(`稳定锚点：\`${escapeRegExp(token)}\``),
    ];
    for (const pattern of preferredPatterns) {
      const index = this.control.lines.findIndex((line) => pattern.test(line));
      if (index >= 0) return makeRef(this.control, index + 1, index + 1, token);
    }
    const index = this.control.lines.findIndex((line) => line.includes(`\`${token}\``));
    return index >= 0 ? makeRef(this.control, index + 1, index + 1, token) : null;
  }

  roleViewRef(viewId) {
    for (const table of this.tables.filter((candidate) => candidate.header[0] === "视图 ID")) {
      const row = table.rows.find((candidate) => stripMd(candidate.cells[0]) === viewId);
      if (row) return { ...cleanObjectValues(row.values), source_ref: rowRef(this.control, row, viewId) };
    }
    return null;
  }

  detailedFpRow(fpId) {
    for (const table of this.tables) {
      if (!table.header.some((header) => header.includes("业务")) || table.header[0] === "Task ID") continue;
      const row = table.rows.find((candidate) => stripMd(candidate.cells[0]) === fpId);
      if (row) return { values: cleanObjectValues(row.values), sourceRef: rowRef(this.control, row, `FP::${fpId}`) };
    }
    return null;
  }

  allFiles() {
    if (!this.allProjectFiles) this.allProjectFiles = listFiles(this.root);
    return this.allProjectFiles;
  }

  expandWriteScope(task) {
    const declared = task.values.write_scope;
    const patterns = [];
    const vertical = /SCOPE::VERTICAL\((FP\d{3}-\d{2})\)/.exec(declared);
    const capability = /SCOPE::CAP\(([a-z0-9-]+)\)/.exec(declared);

    if (vertical) {
      const definition = this.scopeDefinitions.get("SCOPE::VERTICAL(FPddd-dd)") ?? "";
      const lower = vertical[1].toLowerCase();
      const group = lower.slice(0, 5);
      const underscored = lower.replace("-", "_");
      for (let token of extractBacktickTokens(definition)) {
        token = token.replaceAll("fpddd-dd", lower).replaceAll("fpddd_dd", underscored).replaceAll("fpddd", group);
        patterns.push(normalizePath(token));
      }
    } else if (capability) {
      const definition = this.scopeDefinitions.get("SCOPE::CAP(name)") ?? "";
      const name = capability[1];
      for (let token of extractBacktickTokens(definition)) {
        token = token.replaceAll("cap-name", `cap-${name}`).replaceAll("cap_name", `cap_${name.replaceAll("-", "_")}`).replaceAll("name", name);
        patterns.push(normalizePath(token));
      }
    } else {
      patterns.push(...extractBacktickTokens(declared).filter((token) => !token.startsWith("SCOPE::")).map(normalizePath));
    }
    return [...new Set(patterns)];
  }

  matchedScopeFiles(patterns) {
    const files = this.allFiles();
    return patterns.map((pattern) => {
      const regex = globToRegExp(pattern);
      return { pattern, matches: files.filter((file) => regex.test(file)) };
    });
  }

  taskGraph(task) {
    const upstreamIds = parseDependsOn(task.values.depends_on);
    const upstream = upstreamIds.map((id) => {
      const dependency = this.taskById.get(id);
      return dependency ? { task_id: id, status: dependency.values["状态"], source_ref: dependency.sourceRef } : { task_id: id, status: "MISSING", source_ref: null };
    });
    const downstream = this.tasks
      .filter((candidate) => parseDependsOn(candidate.values.depends_on).includes(task.id))
      .map((candidate) => ({ task_id: candidate.id, status: candidate.values["状态"], source_ref: candidate.sourceRef }));
    return { upstream, downstream };
  }

  fpDependencyEdges(fpIds) {
    const output = [];
    for (const row of this.dependencyRows) {
      for (const fpId of fpIds) {
        const from = expressionContainsFp(row.upstream, fpId);
        const to = expressionContainsFp(row.downstream, fpId);
        if (!from && !to) continue;
        output.push({
          fp_id: fpId,
          relation: from && to ? "BIDIRECTIONAL_OR_LOOP" : from ? "DIRECT_DOWNSTREAM_EDGE" : "DIRECT_UPSTREAM_EDGE",
          dependency_key: row.key,
          upstream: row.upstream,
          downstream: row.downstream,
          status: row.status,
          source_ref: row.sourceRef,
        });
      }
    }
    return output;
  }

  sourceAnchors(fpIds, source, sourcePrefix) {
    const anchors = [];
    const missing = [];
    for (const fpId of fpIds) {
      const ref = findStableHeading(source, fpId, sourcePrefix);
      if (ref) anchors.push({ fp_id: fpId, source_ref: ref });
      else missing.push({ kind: sourcePrefix.toLowerCase(), fp_id: fpId, reason: `No exact heading for ${sourcePrefix}::${fpId}` });
    }
    return { anchors, missing };
  }

  prototypeAnchors(fpIds) {
    const prototypeFiles = listFiles(this.root, PROTOTYPE_ROOT)
      .filter((file) => /\.(?:html|js|css)$/i.test(file));
    const output = [];
    const missing = [];

    for (const fpId of fpIds) {
      const group = fpGroup(fpId);
      const alignment = this.alignmentRows.get(`ALIGN::${group}`);
      const detail = this.detailedFpRow(fpId);
      const routingText = [
        ...Object.values(alignment?.values ?? {}),
        ...Object.values(detail?.values ?? {}),
      ].join(" ");
      const explicitNames = new Set([...routingText.matchAll(/[\p{L}\p{N}_-]+\.(?:html|js|css)/gu)].map((match) => match[0]));

      const exactContentMatches = [];
      for (const file of prototypeFiles) {
        const info = readTextFile(this.root, file);
        const lines = lineNumbersContaining(info, fpId);
        if (lines.length) exactContentMatches.push({ file, info, lines });
      }

      const routedFiles = new Set(exactContentMatches.map((match) => match.file));
      for (const file of prototypeFiles) {
        const base = path.posix.basename(file);
        const stem = base.slice(0, -path.posix.extname(base).length);
        if (explicitNames.has(base)) routedFiles.add(file);
        else if (stem.length >= 8 && new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(stem)}([^A-Za-z0-9_]|$)`).test(routingText)) routedFiles.add(file);
      }

      for (const file of [...routedFiles].sort()) {
        const info = readTextFile(this.root, file);
        const exact = exactContentMatches.find((candidate) => candidate.file === file);
        output.push({
          fp_id: fpId,
          path: file,
          anchor_kind: exact ? "exact_fp_line_matches" : "file_routed_by_control",
          line_matches: exact?.lines ?? [],
          routing_evidence: alignment?.sourceRef ?? detail?.sourceRef ?? null,
          file_sha256: info.sha256,
        });
      }
      if (!routedFiles.size) {
        missing.push({
          kind: "prototype",
          fp_id: fpId,
          reason: "Prototype assets contain no stable FP ID and the control row names no resolvable asset; fuzzy routing is forbidden",
          routing_evidence: alignment?.sourceRef ?? detail?.sourceRef ?? null,
        });
      }
    }
    return { anchors: output, missing };
  }

  n8nAnchors(fpIds) {
    const files = listFiles(this.root, N8N_ROOT).filter((file) => file.endsWith(".json"));
    const output = [];
    const missing = [];
    for (const fpId of fpIds) {
      let found = false;
      for (const file of files) {
        const info = readTextFile(this.root, file);
        let parsed;
        try {
          parsed = JSON.parse(info.text);
        } catch (error) {
          missing.push({ kind: "n8n", fp_id: fpId, path: file, reason: `Invalid JSON: ${error.message}` });
          continue;
        }
        const pointers = [...new Set(findJsonPointers(parsed, fpId))].sort();
        if (!pointers.length) continue;
        found = true;
        output.push({
          fp_id: fpId,
          path: file,
          json_pointers: pointers,
          line_matches: lineNumbersContaining(info, fpId),
          file_sha256: info.sha256,
          maturity: "REFERENCE_ONLY",
        });
      }
      if (!found) missing.push({ kind: "n8n", fp_id: fpId, reason: "No exact FP ID in canonical n8n JSON" });
    }
    return { anchors: output, missing };
  }

  rpcAnchors(task, fpIds) {
    const explicitIds = new Set(extractStableTokens(`${task.values["精确读取锚点"]} ${task.values["业务结果"]}`).filter((token) => /^RPC-\d{3}$/.test(token)));
    const relevant = this.rpcRows.filter((row) => explicitIds.has(row.values.ID) || fpIds.includes(row.values["所属 FP"]));
    return relevant.map((row) => ({
      rpc_id: row.values.ID,
      rpc_name: row.values["正式 RPC 名"],
      owner: row.values["所属 FP"],
      status: row.values["状态"],
      source_ref: row.sourceRef,
    }));
  }

  exactControlAnchors(task) {
    const tokens = extractStableTokens(task.values["精确读取锚点"]);
    const anchors = [];
    const missing = [];
    for (const token of tokens) {
      if (token.startsWith("V7::") || token.startsWith("PROMPT::")) continue;
      const ref = this.controlTokenRef(token);
      if (ref) anchors.push(ref);
      else missing.push({ kind: "control_anchor", anchor: token, reason: "Stable reference not found in active control source" });
    }
    return { anchors, missing };
  }

  globalInvariantRefs(task, roleView) {
    const refs = [];
    const gateRef = findHeadingSection(this.control, (title) => title === "Gate Register", "IMPLEMENTATION_CONTROL::Gate Register");
    const invariantRef = findHeadingSection(this.control, (title) => title.includes("全项目业务不变量"), "IMPLEMENTATION_CONTROL::全项目业务不变量");
    const decisionsRef = findHeadingSection(this.control, (title) => title === "全局决策注册表", "IMPLEMENTATION_CONTROL::全局决策注册表");
    if (gateRef) refs.push(gateRef);
    if (invariantRef) refs.push(invariantRef);
    if (decisionsRef) refs.push(decisionsRef);
    if (roleView?.source_ref) refs.push(roleView.source_ref);
    for (const token of extractStableTokens(`${task.values["精确读取锚点"]} ${task.values["禁止项"]}`)) {
      if (!/^GD-\d{3}$/.test(token)) continue;
      const ref = this.controlTokenRef(token);
      if (ref) refs.push(ref);
    }
    return [...new Map(refs.map((ref) => [`${ref.path}:${ref.start_line}:${ref.anchor}`, ref])).values()];
  }

  gateSnapshot() {
    const gateTable = this.tables.find((candidate) => candidate.header[0] === "Gate");
    const g05Row = gateTable?.rows.find((row) => stripMd(row.cells[0]) === "G05");
    const g06Row = gateTable?.rows.find((row) => stripMd(row.cells[0]) === "G06");
    const counts = this.tasks.reduce((summary, task) => {
      const status = task.values["状态"];
      summary[status] = (summary[status] ?? 0) + 1;
      return summary;
    }, {});
    const approvalEvidence = this.gates.G05_APPROVAL_EVIDENCE ?? "";
    const g06ApprovalEvidence = this.gates.G06_APPROVAL_EVIDENCE ?? "";
    const g06ArtifactPath = normalizePath(this.gates.G06_ARTIFACT_PATH ?? "");
    const g06ArtifactExists = Boolean(g06ArtifactPath) && fs.existsSync(path.join(this.root, ...g06ArtifactPath.split("/")));
    const g06ArtifactHash = g06ArtifactExists ? this.versionFor(g06ArtifactPath).sha256 : null;
    const registeredAssertionCount = Number(this.gates.G06_TEST_ASSERTIONS);
    return {
      values: this.gates,
      active_execution_gate_valid: this.gates.G04_GATE === "APPROVED" && this.gates.G04_REVISION === "2",
      g05: {
        valid: this.gates.G05_GATE === "APPROVED"
          && Boolean(this.gates.G05_APPROVED_AT)
          && approvalEvidence.startsWith("CREATOR_EXPLICIT_")
          && stripMd(g05Row?.cells[1] ?? "") === "APPROVED",
        source_ref: g05Row ? rowRef(this.control, g05Row, "G05") : null,
      },
      g06: {
        registered: Object.hasOwn(this.gates, "G06_GATE"),
        valid: this.gates.G06_GATE === "APPROVED"
           && Boolean(this.gates.G06_APPROVED_AT)
           && g06ApprovalEvidence.startsWith("CREATOR_EXPLICIT_")
           && stripMd(g06Row?.cells[1] ?? "") === "APPROVED"
          && Number.isInteger(registeredAssertionCount)
          && registeredAssertionCount >= 58
          && g06ArtifactHash === String(this.gates.G06_ARTIFACT_SHA256 ?? "").toLowerCase(),
        artifact_path: g06ArtifactPath || null,
        artifact_sha256: g06ArtifactHash,
        registered_assertions: Number.isInteger(registeredAssertionCount) ? registeredAssertionCount : null,
        source_ref: g06Row ? rowRef(this.control, g06Row, "G06") : null,
      },
      g07: {
        gate: this.gates.G07_GATE ?? "UNREGISTERED",
        a_status: this.gates.G07_A_STATUS ?? "UNREGISTERED",
        b_status: this.gates.G07_B_STATUS ?? "UNREGISTERED",
        creator_approved: this.gates.G07_GATE === "APPROVED"
          && String(this.gates.G07_APPROVAL_EVIDENCE ?? "").startsWith("CREATOR_EXPLICIT_"),
      },
      task_status_counts: counts,
      task_count: this.tasks.length,
    };
  }

  worktreeDiffPaths() {
    return [...this.git.statuses.entries()].map(([file, status]) => ({ path: file, status })).sort((a, b) => a.path.localeCompare(b.path));
  }

  route({ role, taskId, fpIds, crossFpReview = false, baseCommit = null, taskCommit = null }) {
    if (!ROLES.has(role)) throw new Error(`role must be one of: ${[...ROLES.keys()].join(", ")}`);
    if (!TASK_ID_RE.test(taskId)) throw new Error(`invalid task_id: ${taskId}`);
    const task = this.taskById.get(taskId);
    if (!task) throw new Error(`task_id not found in active Task Index: ${taskId}`);

    const taskFpIds = this.deriveTaskFpIds(task);
    const fpIdsWereExplicit = Array.isArray(fpIds) && fpIds.length > 0;
    const normalizedFpIds = [...new Set((fpIdsWereExplicit ? fpIds : taskFpIds).map((value) => value.toUpperCase()))];
    if (normalizedFpIds.some((value) => !FP_ID_RE.test(value))) {
      throw new Error("fp_ids must contain only FPddd or FPddd-dd identifiers");
    }
    const outOfScopeFpIds = normalizedFpIds.filter((fpId) => !taskFpIds.includes(fpId));
    const crossFpReviewAllowed = outOfScopeFpIds.length > 0
      && crossFpReview
      && CROSS_FP_REVIEW_ROLES.has(role);
    const forcedReadOnly = Boolean(crossFpReview) || crossFpReviewAllowed;

    const viewId = ROLES.get(role);
    const roleView = this.roleViewRef(viewId);
    const taskGraph = this.taskGraph(task);
    const fpEdges = this.fpDependencyEdges(normalizedFpIds);
    const control = this.exactControlAnchors(task);
    const v7Source = normalizedFpIds.length ? this.v7Source() : null;
    const promptSource = normalizedFpIds.length ? this.promptSource() : null;
    const v7 = v7Source ? this.sourceAnchors(normalizedFpIds, v7Source, "V7") : { anchors: [], missing: [] };
    const prompt = promptSource ? this.sourceAnchors(normalizedFpIds, promptSource, "PROMPT") : { anchors: [], missing: [] };
    const prototype = normalizedFpIds.length ? this.prototypeAnchors(normalizedFpIds) : { anchors: [], missing: [] };
    const n8n = normalizedFpIds.length ? this.n8nAnchors(normalizedFpIds) : { anchors: [], missing: [] };
    const rpcs = this.rpcAnchors(task, normalizedFpIds);
    const scopePatterns = this.expandWriteScope(task);
    const scopeMatches = this.matchedScopeFiles(scopePatterns);
    const matchedFiles = [...new Set(scopeMatches.flatMap((entry) => entry.matches))];
    const machineContractFiles = matchedFiles.filter((file) => /^(?:db\/|contracts\/|packages\/contracts\/)/.test(file));
    const runtimeEvidenceFiles = matchedFiles.filter((file) => /^(?:tests\/|evidence\/|logs\/|screenshots\/)/.test(file));
    const codeFiles = matchedFiles.filter((file) => !machineContractFiles.includes(file) && !runtimeEvidenceFiles.includes(file));
    const missingScopePatterns = scopeMatches.filter((entry) => !entry.matches.length).map((entry) => entry.pattern);
    const detailedRows = normalizedFpIds.map((fpId) => ({ fp_id: fpId, row: this.detailedFpRow(fpId) })).filter((entry) => entry.row);
    const alignments = [...new Set(normalizedFpIds.map(fpGroup))]
      .map((group) => this.alignmentRows.get(`ALIGN::${group}`))
      .filter(Boolean);
    const gate = this.gateSnapshot();
    const taskRoleMatches = task.values["角色"] === viewId;
    const dependenciesVerified = taskGraph.upstream.every((dependency) => dependency.status === "VERIFIED");
    const promptTokens = new Set(extractStableTokens(task.values["精确读取锚点"]).filter((token) => token.startsWith("PROMPT::")));

    const conflicts = [];
    conflicts.push(...control.missing.map((item) => conflict("BLOCKING", item.kind, item.reason, item)));
    conflicts.push(...v7.missing.map((item) => conflict("BLOCKING", item.kind, item.reason, item)));
    conflicts.push(...prompt.missing.map((item) => conflict(
      promptTokens.has(`PROMPT::${item.fp_id}`) ? "BLOCKING" : "WARNING",
      item.kind,
      item.reason,
      item,
    )));
    conflicts.push(...prototype.missing.map((item) => conflict("WARNING", item.kind, item.reason, item)));
    conflicts.push(...n8n.missing.map((item) => conflict("WARNING", item.kind, item.reason, item)));

    if (outOfScopeFpIds.length) {
      const level = crossFpReviewAllowed ? "WARNING" : "BLOCKING";
      conflicts.push(conflict(level, "task_fp_scope", crossFpReviewAllowed
        ? "Requested FP is outside the Task coverage and was admitted only for explicit read-only cross-FP review"
        : "Requested FP is outside the Task coverage; this role/mode cannot load it", {
        requested_fp_ids: outOfScopeFpIds,
        task_fp_ids: taskFpIds,
        cross_fp_review: Boolean(crossFpReview),
      }));
    }
    if (crossFpReview && !CROSS_FP_REVIEW_ROLES.has(role)) {
      conflicts.push(conflict("BLOCKING", "cross_fp_review_role", `${role} cannot enable cross-FP review mode`));
    }
    for (const rpc of rpcs.filter((rpc) => rpc.status !== "REGISTERED_DESIGN")) {
      conflicts.push(conflict("BLOCKING", "rpc_status", `RPC status is ${rpc.status}; it is not an active implementation channel`, { rpc_id: rpc.rpc_id }));
    }
    const staleAcceptanceLine = this.control.lines.findIndex((line) => line.includes("G04-BA-07") && line.includes("当前全部 PLANNED"));
    if ((gate.task_status_counts.READY ?? 0) > 0 && staleAcceptanceLine >= 0) {
      conflicts.push(conflict("BLOCKING", "control_status_narrative_drift", "G04-BA-07 conflicts with active Task Index status counts", {
        source_ref: makeRef(this.control, staleAcceptanceLine + 1, staleAcceptanceLine + 1, "G04-BA-07"),
      }));
    }
    if (!machineContractFiles.length) {
      conflicts.push(conflict("EXPECTED_GREENFIELD", "schema_or_machine_contract", `No machine Schema/contract file exists yet in the expanded Task scope: ${scopePatterns.join(", ")}`));
    }
    if (!codeFiles.length) {
      conflicts.push(conflict("EXPECTED_GREENFIELD", "code_anchor", `No implementation code file exists yet in the expanded Task scope for ${task.id}`));
    }
    if (missingScopePatterns.length) {
      conflicts.push(conflict("EXPECTED_GREENFIELD", "unmaterialized_write_scope", `No current files match: ${missingScopePatterns.join(", ")}`));
    }

    const registeredHashes = this.registeredProtectedHashes();
    const versionPaths = new Set([
      CONTROL_PATH,
      ...(normalizedFpIds.length ? [V7_PATH, PROMPT_PATH] : []),
      ...prototype.anchors.map((anchor) => anchor.path),
      ...n8n.anchors.map((anchor) => anchor.path),
      ...matchedFiles,
    ]);
    const fileVersions = [...versionPaths].sort().map((file) => this.versionFor(file, registeredHashes.get(file) ?? null));
    for (const version of fileVersions.filter((item) => item.matches_registered_sha256 === false)) {
      conflicts.push(conflict("BLOCKING", "protected_hash_drift", `Protected source hash drifted for ${version.path}`, {
        path: version.path,
        expected_sha256: version.registered_sha256,
        actual_sha256: version.sha256,
      }));
    }
    if (!gate.active_execution_gate_valid) conflicts.push(conflict("BLOCKING", "active_gate", "G04_GATE or G04_REVISION is not the approved execution value"));
    if (!gate.g05.valid) conflicts.push(conflict("BLOCKING", "g05_registration", "G05 approval registration is incomplete or inconsistent"));
    if (!gate.g06.valid) conflicts.push(conflict("BLOCKING", "g06_artifact", "G06 registration, assertion count, or artifact hash does not match the current router"));
    if (task.values["状态"] !== "READY") conflicts.push(conflict("BLOCKING", "task_status", `Task status is ${task.values["状态"]}, not READY`));
    if (!dependenciesVerified) conflicts.push(conflict("BLOCKING", "task_dependencies", "One or more direct Task dependencies are not VERIFIED"));
    if (role === "prompt_editor" && !task.id.includes("PROMPT-REVISION")) {
      conflicts.push(conflict("BLOCKING", "prompt_revision_not_instantiated", "Prompt editor requires an instantiated TASKCLASS::PROMPT_REVISION Task"));
    }

    const blockingConflicts = conflicts.filter((item) => item.level === "BLOCKING");
    const executionAuthorized = role === "coder"
      && taskRoleMatches
      && !forcedReadOnly
      && blockingConflicts.length === 0;
    const auditorOwnedTask = role === "auditor" && task.values["角色"] === "VIEW::AUDITOR";
    const auditorWriteAuthorized = auditorOwnedTask
      && !forcedReadOnly
      && blockingConflicts.length === 0;

    const roleProjection = this.roleProjection({
      role,
      task,
      taskGraph,
      fpEdges,
      detailedRows,
      alignments,
      rpcs,
      machineContractFiles,
      runtimeEvidenceFiles,
      codeFiles,
      scopePatterns,
      executionAuthorized,
      conflicts,
    });
    const globalInvariants = this.globalInvariantRefs(task, roleView);
    const effectiveReadRefs = [
      ...globalInvariants,
      task.sourceRef,
      ...control.anchors,
      ...v7.anchors.map((entry) => entry.source_ref),
      ...prompt.anchors.map((entry) => entry.source_ref),
      ...prototype.anchors.map((entry) => ({ path: entry.path, anchor: entry.fp_id, kind: entry.anchor_kind, line_matches: entry.line_matches })),
      ...n8n.anchors.map((entry) => ({ path: entry.path, anchor: entry.fp_id, kind: "json_pointers", json_pointers: entry.json_pointers })),
      ...rpcs.map((entry) => entry.source_ref),
      ...machineContractFiles.map((file) => ({ path: file, anchor: "FILE", kind: "machine_contract_file" })),
      ...codeFiles.map((file) => ({ path: file, anchor: "FILE", kind: "code_file" })),
      ...runtimeEvidenceFiles.map((file) => ({ path: file, anchor: "FILE", kind: "runtime_evidence_file" })),
    ];

    let decisionLevel = "TASK_AUTONOMOUS";
    if (!gate.active_execution_gate_valid) decisionLevel = "CREATOR_REQUIRED";
    else if (blockingConflicts.some((item) => ["protected_hash_drift", "g05_registration", "g06_artifact", "control_status_narrative_drift"].includes(item.kind))) decisionLevel = "BLOCKED_TECHNICAL";
    else if (blockingConflicts.length) decisionLevel = "BLOCKED_TECHNICAL";
    else if (conflicts.some((item) => item.level === "WARNING")) decisionLevel = "P2_TECH_DEBT";
    if (!DECISION_LEVELS.has(decisionLevel)) throw new Error(`invalid decision level: ${decisionLevel}`);

    let recommendedNextRole = task.values["角色"].replace("VIEW::", "").toLowerCase();
    if (decisionLevel === "CREATOR_REQUIRED") recommendedNextRole = "creator";
    else if (blockingConflicts.some((item) => ["task_status", "task_dependencies"].includes(item.kind))) recommendedNextRole = "coordinator";
    else if (blockingConflicts.some((item) => ["task_fp_scope", "prompt_revision_not_instantiated"].includes(item.kind))) recommendedNextRole = "architect";
    else if (task.values["状态"] === "IMPLEMENTED") recommendedNextRole = "auditor";
    else if (task.values["状态"] === "VERIFYING") recommendedNextRole = "reviewer";

    const blockingConditions = blockingConflicts.map((item) => `BLOCKING:${item.kind}`);
    if (!taskRoleMatches && role === "coder") blockingConditions.push(`TASK_ROLE_IS_${task.values["角色"]}`);
    if (role !== "coder") blockingConditions.push("ROLE_IS_READ_ONLY_FOR_IMPLEMENTATION");
    if (forcedReadOnly) blockingConditions.push("CROSS_FP_REVIEW_IS_READ_ONLY");

    const result = {
      schema_version: "project-context-loader/v2",
      input: {
        role,
        view_id: viewId,
        task_id: taskId,
        fp_ids: normalizedFpIds,
        fp_ids_source: fpIdsWereExplicit ? "explicit" : "task_index_coverage",
        task_fp_ids: taskFpIds,
        cross_fp_review: Boolean(crossFpReview),
      },
      version_context: {
        base_commit: baseCommit ?? this.git.head,
        task_commit: taskCommit ?? this.git.head,
        git_head: this.git.head,
        worktree_dirty: this.git.statuses.size > 0,
      },
      decision: {
        level: decisionLevel,
        recommended_next_role: recommendedNextRole,
        blocking_count: blockingConflicts.length,
        warning_count: conflicts.filter((item) => item.level === "WARNING").length,
        expected_greenfield_count: conflicts.filter((item) => item.level === "EXPECTED_GREENFIELD").length,
      },
      gate_snapshot: gate,
      role_view: roleView,
      required_global_invariants: globalInvariants,
      task_index_row: { ...task.values, source_ref: task.sourceRef },
      dependencies: { task: taskGraph, fp_edges: fpEdges },
      slices: role === "coordinator"
        ? this.sliceRows.map((row) => ({ ...row.values, source_ref: row.sourceRef }))
        : this.sliceRows.filter((row) => row.values["切片"] === task.values["切片"]).map((row) => ({ ...row.values, source_ref: row.sourceRef })),
      anchors: {
        control: control.anchors,
        v7: v7.anchors,
        prompt: prompt.anchors,
        prototype: prototype.anchors,
        n8n: n8n.anchors,
        schema_and_machine_contracts: machineContractFiles.map((file) => ({ path: file, file_sha256: this.versionFor(file).sha256 })),
        rpc: rpcs,
        code: codeFiles.map((file) => ({ path: file, file_sha256: this.versionFor(file).sha256 })),
        runtime_evidence: runtimeEvidenceFiles.map((file) => ({ path: file, file_sha256: this.versionFor(file).sha256 })),
      },
      access: {
        effective_read_refs: effectiveReadRefs,
        declared_write_scope: task.values.write_scope,
        expanded_write_patterns: scopePatterns,
        matched_write_paths: matchedFiles,
        effective_write_scope: executionAuthorized || auditorWriteAuthorized ? scopePatterns : ["READ_ONLY"],
        execution_authorized: executionAuthorized,
        cross_fp_read_only: forcedReadOnly,
      },
      role_projection: roleProjection,
      unloaded_materials: [
        { material: V7_PATH, reason: normalizedFpIds.length ? "Only exact stable-heading ranges and hashes are emitted; source body is not copied into output" : "No FP was derived for this GLOBAL Task, so the source was not loaded" },
        { material: PROMPT_PATH, reason: normalizedFpIds.length ? "Only exact stable-heading ranges and hashes are emitted; source body is not copied into output" : "No FP was derived for this GLOBAL Task, so the source was not loaded" },
        { material: "unrequested FP sections", reason: fpIdsWereExplicit ? "fp_ids is an explicit allowlist" : "FP IDs were derived exactly from the Task coverage cell" },
        { material: "archive/backup/legacy/.tmp/.git paths", reason: "Excluded before discovery and never used as a fallback" },
        { material: "unmatched prototype and n8n assets", reason: "No exact stable ID or control-plane file route" },
        { material: "missing write-scope paths", reason: missingScopePatterns.length ? `No files match: ${missingScopePatterns.join(", ")}` : "NONE" },
      ],
      file_versions: fileVersions,
      context_budget: {
        source_bodies_emitted: false,
        v7_total_lines: v7Source?.lines.length ?? 0,
        v7_referenced_ranges: v7.anchors.map((entry) => ({ fp_id: entry.fp_id, start_line: entry.source_ref.start_line, end_line: entry.source_ref.end_line })),
        prompt_total_lines: promptSource?.lines.length ?? 0,
        prompt_referenced_ranges: prompt.anchors.map((entry) => ({ fp_id: entry.fp_id, start_line: entry.source_ref.start_line, end_line: entry.source_ref.end_line })),
      },
      blocking_conditions: [...new Set(blockingConditions)],
      conflicts_or_missing_references: conflicts,
    };
    result.context_hash = sha256(stableJson(result));
    return result;
  }

  roleProjection(context) {
    const { role, task, taskGraph, fpEdges, detailedRows, alignments, rpcs, machineContractFiles, runtimeEvidenceFiles, codeFiles, scopePatterns, executionAuthorized, conflicts } = context;
    if (role === "coordinator") {
      return {
        dependency_state: taskGraph,
        fp_dependency_edges: fpEdges,
        all_slice_results_included: true,
        status: task.values["状态"],
        gate: "#/gate_snapshot",
      };
    }
    if (role === "gap_auditor") {
      return {
        alignment_contracts: alignments.map((entry) => ({ ...entry.values, source_ref: entry.sourceRef })),
        business_rows: detailedRows.map((entry) => ({ fp_id: entry.fp_id, source_ref: entry.row.sourceRef })),
        evidence_gaps: conflicts.filter((item) => item.level !== "WARNING"),
        source_maturity_only: true,
        write_scope: ["READ_ONLY"],
      };
    }
    if (role === "coder") {
      return {
        business_contracts: detailedRows.map((entry) => ({ fp_id: entry.fp_id, ...entry.row.values, source_ref: entry.row.sourceRef })),
        alignment_contracts: alignments.map((entry) => ({ ...entry.values, source_ref: entry.sourceRef })),
        machine_contract_paths: machineContractFiles,
        write_scope: scopePatterns,
        acceptance_command: task.values["验收命令"],
        acceptance_scenario: task.values["业务验收场景"],
        related_code_paths: codeFiles,
        execution_authorized: executionAuthorized,
      };
    }
    if (role === "prompt_editor") {
      return {
        instantiated_revision_required: true,
        target_prompt_refs: "#/anchors/prompt",
        target_schema_paths: machineContractFiles,
        forbidden_changes: task.values["禁止项"],
        source_revision_only: true,
        publish_or_activate_allowed: false,
        write_scope: ["READ_ONLY"],
      };
    }
    if (role === "auditor") {
      return {
        business_acceptance: [task.values["业务验收场景"], ...detailedRows.flatMap((entry) => Object.entries(entry.row.values).filter(([key]) => key.includes("验收")).map(([, value]) => value))],
        exception_routes: { forbidden: task.values["禁止项"], replan: task.values["Replan 条件"] },
        runtime_evidence_paths: runtimeEvidenceFiles,
        machine_contract_paths: machineContractFiles,
        acceptance_command: task.values["验收命令"],
      };
    }
    if (role === "architect") {
      return {
        replan_categories: {
          A: "Alternative technical implementation inside the same approved write scope",
          B: "Technical step or evidence redesign without changing business result, dependencies, or owner",
          C: "Business, global decision, G04/Task meaning, dependency, ownership, or Gate change; CREATOR_REQUIRED",
          D: "Tool, platform, or environment blockage; BLOCKED_TECHNICAL or ENVIRONMENT_APPROVAL_REQUIRED",
        },
        facts: { task_graph: taskGraph, fp_edges: fpEdges, conflicts },
        permitted_decisions: ["REPLAN_A", "REPLAN_B", "REPLAN_D", "ESCALATE_REPLAN_C"],
        write_scope: ["READ_ONLY"],
      };
    }
    return {
      contracts: detailedRows.map((entry) => ({ fp_id: entry.fp_id, source_ref: entry.row.sourceRef })),
      diff_paths: this.worktreeDiffPaths(),
      cross_fp_impact: fpEdges,
      write_channels: { declared_scope: task.values.write_scope, rpcs },
      invariants: "#/required_global_invariants",
      reviewer_write_scope: ["READ_ONLY"],
    };
  }
}

function parseCli(argv) {
  const options = { format: "json", fpIds: null, crossFpReview: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--self-test") options.selfTest = true;
    else if (argument === "--role") options.role = argv[++index];
    else if (argument === "--task-id") options.taskId = argv[++index];
    else if (argument === "--fp-ids") options.fpIds = String(argv[++index] ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    else if (argument === "--cross-fp-review") options.crossFpReview = true;
    else if (argument === "--base-commit") options.baseCommit = argv[++index];
    else if (argument === "--task-commit") options.taskCommit = argv[++index];
    else if (argument === "--format") options.format = argv[++index];
    else if (argument === "--root") options.root = argv[++index];
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`unknown argument: ${argument}`);
  }
  return options;
}

function renderMarkdown(context) {
  const lines = [
    "# Project Context Route",
    "",
    `- Role: \`${context.input.role}\` (\`${context.input.view_id}\`)`,
    `- Task: \`${context.input.task_id}\` / status \`${context.task_index_row["状态"]}\``,
    `- FP allowlist: ${context.input.fp_ids.map((fp) => `\`${fp}\``).join(", ") || "NONE"} (${context.input.fp_ids_source})`,
    `- Context hash: \`${context.context_hash}\``,
    `- Decision: \`${context.decision.level}\`; next \`${context.decision.recommended_next_role}\``,
    `- G05 valid: \`${context.gate_snapshot.g05.valid}\``,
    `- G06 valid: \`${context.gate_snapshot.g06.valid}\``,
    "",
    "## Direct Task Graph",
    "",
    `- Upstream: ${context.dependencies.task.upstream.map((item) => `\`${item.task_id}:${item.status}\``).join(", ") || "NONE"}`,
    `- Downstream: ${context.dependencies.task.downstream.map((item) => `\`${item.task_id}:${item.status}\``).join(", ") || "NONE"}`,
    "",
    "## Exact Anchors",
    "",
  ];
  for (const [kind, anchors] of Object.entries(context.anchors)) {
    lines.push(`- ${kind}: ${anchors.length}`);
    for (const anchor of anchors) {
      const ref = anchor.source_ref ?? anchor;
      const suffix = ref.start_line ? `#L${ref.start_line}-L${ref.end_line}` : "";
      lines.push(`  - \`${ref.path ?? anchor.path}${suffix}\` (${ref.anchor ?? anchor.fp_id ?? anchor.rpc_id ?? kind})`);
    }
  }
  lines.push("", "## Access", "", `- Effective write scope: ${context.access.effective_write_scope.map((item) => `\`${item}\``).join(", ")}`);
  lines.push(`- Execution authorized: \`${context.access.execution_authorized}\``);
  lines.push("", "## Missing Or Conflicting References", "");
  for (const conflict of context.conflicts_or_missing_references) lines.push(`- ${conflict.level} / ${conflict.kind}: ${conflict.reason}`);
  return `${lines.join("\n")}\n`;
}

function assertCheck(checks, id, condition, evidence) {
  checks.push({ id, passed: Boolean(condition), evidence });
}

function containsContentProperty(value) {
  if (Array.isArray(value)) return value.some(containsContentProperty);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => key === "content" || key === "text" || containsContentProperty(child));
}

function runSelfTest(router) {
  const samples = [
    { domain: "book-opening", role: "coordinator", taskId: "S1-FP001-03", fpIds: ["FP001-03"] },
    { domain: "deduction", role: "coder", taskId: "S4-FP008-02", fpIds: ["FP008-02"] },
    { domain: "audit", role: "auditor", taskId: "S5-FP010-01", fpIds: ["FP010-01"] },
    { domain: "iteration", role: "reviewer", taskId: "S7-FP014-01", fpIds: ["FP014-01"] },
  ];
  const checks = [];
  const evidence = [];
  const contexts = [];

  for (const sample of samples) {
    const first = router.route(sample);
    const second = router.route(sample);
    contexts.push(first);
    const rawTask = router.taskById.get(sample.taskId);
    const expectedUpstream = parseDependsOn(rawTask.values.depends_on).sort();
    const expectedDownstream = router.tasks
      .filter((task) => parseDependsOn(task.values.depends_on).includes(sample.taskId))
      .map((task) => task.id)
      .sort();
    const actualUpstream = first.dependencies.task.upstream.map((item) => item.task_id).sort();
    const actualDownstream = first.dependencies.task.downstream.map((item) => item.task_id).sort();
    const loadedPaths = first.file_versions.map((item) => item.path);

    assertCheck(checks, `${sample.domain}:task-row`, first.task_index_row.source_ref.anchor === sample.taskId, first.task_index_row.source_ref);
    assertCheck(checks, `${sample.domain}:direct-upstream`, JSON.stringify(actualUpstream) === JSON.stringify(expectedUpstream), { expected: expectedUpstream, actual: actualUpstream });
    assertCheck(checks, `${sample.domain}:direct-downstream`, JSON.stringify(actualDownstream) === JSON.stringify(expectedDownstream), { expected: expectedDownstream, actual: actualDownstream });
    assertCheck(checks, `${sample.domain}:v7-anchor`, first.anchors.v7.some((item) => item.fp_id === sample.fpIds[0]), first.anchors.v7);
    assertCheck(checks, `${sample.domain}:prompt-anchor`, first.anchors.prompt.some((item) => item.fp_id === sample.fpIds[0]), first.anchors.prompt);
    assertCheck(checks, `${sample.domain}:n8n-anchor`, first.anchors.n8n.some((item) => item.fp_id === sample.fpIds[0] && item.json_pointers.length), first.anchors.n8n.map((item) => ({ path: item.path, pointers: item.json_pointers.length })));
    const explicitPrototypeMissing = first.conflicts_or_missing_references.some((item) => item.kind === "prototype" && item.fp_id === sample.fpIds[0] && item.reason);
    assertCheck(checks, `${sample.domain}:prototype-route-or-missing`, first.anchors.prototype.some((item) => item.fp_id === sample.fpIds[0]) || explicitPrototypeMissing, {
      anchors: first.anchors.prototype,
      explicit_missing: explicitPrototypeMissing,
    });
    assertCheck(checks, `${sample.domain}:archive-isolation`, loadedPaths.every((file) => !isExcludedPath(file)), loadedPaths);
    assertCheck(checks, `${sample.domain}:bounded-context`, !first.context_budget.source_bodies_emitted
      && first.context_budget.v7_referenced_ranges.every((range) => range.end_line - range.start_line + 1 < first.context_budget.v7_total_lines)
      && first.context_budget.prompt_referenced_ranges.every((range) => range.end_line - range.start_line + 1 < first.context_budget.prompt_total_lines)
      && !containsContentProperty(first.anchors.v7)
      && !containsContentProperty(first.anchors.prompt), first.context_budget);
    assertCheck(checks, `${sample.domain}:deterministic`, JSON.stringify(first) === JSON.stringify(second), { sha256: sha256(JSON.stringify(first)) });

    evidence.push({
      domain: sample.domain,
      role: sample.role,
      task_id: sample.taskId,
      fp_ids: sample.fpIds,
      direct_upstream: actualUpstream,
      direct_downstream: actualDownstream,
      v7_ranges: first.context_budget.v7_referenced_ranges,
      prompt_ranges: first.context_budget.prompt_referenced_ranges,
      prototype_anchor_count: first.anchors.prototype.length,
      n8n_pointer_count: first.anchors.n8n.reduce((count, item) => count + item.json_pointers.length, 0),
      route_sha256: sha256(JSON.stringify(first)),
    });
  }

  const graphEdges = router.tasks.flatMap((task) => parseDependsOn(task.values.depends_on).map((dependency) => [dependency, task.id]));
  assertCheck(checks, "global:all-dependency-targets-exist", graphEdges.every(([upstream]) => router.taskById.has(upstream)), { edge_count: graphEdges.length });
  assertCheck(checks, "global:reverse-edge-closure", graphEdges.every(([upstream, downstream]) => router.taskGraph(router.taskById.get(upstream)).downstream.some((item) => item.task_id === downstream)), { edge_count: graphEdges.length });
  assertCheck(checks, "global:archive-patterns", ["docs/archive/old.md", "docs/归档/old.md", ".tmp/old.md", "docs/legacy/old.md"].every(isExcludedPath), "generic archive segments rejected");
  assertCheck(checks, "global:task-count", router.tasks.length === 85, { actual: router.tasks.length });
  assertCheck(checks, "global:explicit-prototype-route", contexts[0].anchors.prototype.some((item) => item.path.endsWith("/new_book.html")), contexts[0].anchors.prototype);
  assertCheck(checks, "role:coordinator-projection", contexts[0].slices.length === 9 && contexts[0].role_projection.all_slice_results_included, { slice_count: contexts[0].slices.length });
  assertCheck(checks, "role:coder-projection", contexts[1].role_projection.business_contracts.length === 1
    && Boolean(contexts[1].role_projection.acceptance_command)
    && contexts[1].access.effective_write_scope[0] === "READ_ONLY", contexts[1].role_projection);
  assertCheck(checks, "role:auditor-projection", contexts[2].role_projection.business_acceptance.length > 0
    && Boolean(contexts[2].role_projection.exception_routes.replan)
    && contexts[2].access.effective_write_scope[0] === "READ_ONLY", contexts[2].role_projection);
  assertCheck(checks, "role:reviewer-projection", contexts[3].role_projection.reviewer_write_scope[0] === "READ_ONLY"
    && contexts[3].role_projection.cross_fp_impact.length > 0
    && Boolean(contexts[3].role_projection.write_channels), contexts[3].role_projection);

  const readyCoder = router.route({ role: "coder", taskId: "F0-01-REPO" });
  assertCheck(checks, "access:ready-coder-write-scope", readyCoder.access.execution_authorized
    && readyCoder.access.effective_write_scope[0] !== "READ_ONLY", readyCoder.access);
  assertCheck(checks, "access:ready-coder-exact-write-scope", JSON.stringify(readyCoder.access.effective_write_scope) === JSON.stringify([
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.base.json",
    "eslint.config.mjs",
    ".github/workflows/ci.yml",
    "apps/api/package.json",
    "apps/api/src/bootstrap/**",
    "apps/web/package.json",
    "apps/web/src/bootstrap/**",
  ]), readyCoder.access.effective_write_scope);
  assertCheck(checks, "access:planned-samples-read-only", contexts.every((context) => context.access.effective_write_scope[0] === "READ_ONLY"), contexts.map((context) => ({ task_id: context.input.task_id, scope: context.access.effective_write_scope })));

  assertCheck(checks, "global-task:empty-fp-set", readyCoder.input.fp_ids.length === 0
    && readyCoder.input.fp_ids_source === "task_index_coverage", readyCoder.input);
  assertCheck(checks, "global-task:no-unrelated-fp-anchors", ["v7", "prompt", "prototype", "n8n"].every((kind) => readyCoder.anchors[kind].length === 0), readyCoder.anchors);
  assertCheck(checks, "global-task:no-v7-or-prompt-load", readyCoder.context_budget.v7_total_lines === 0
    && readyCoder.context_budget.prompt_total_lines === 0
    && !readyCoder.file_versions.some((item) => item.path === V7_PATH || item.path === PROMPT_PATH), readyCoder.context_budget);
  assertCheck(checks, "global-task:context-hash", /^[a-f0-9]{64}$/.test(readyCoder.context_hash), readyCoder.context_hash);
  assertCheck(checks, "global-task:commit-context", Boolean(readyCoder.version_context.base_commit)
    && Boolean(readyCoder.version_context.task_commit), readyCoder.version_context);

  const plannedCoder = router.route({ role: "coder", taskId: "S1-FP001-03" });
  assertCheck(checks, "access:planned-coder-blocked", !plannedCoder.access.execution_authorized
    && plannedCoder.conflicts_or_missing_references.some((item) => item.level === "BLOCKING" && item.kind === "task_status"), plannedCoder.blocking_conditions);

  const outOfScopeCoder = router.route({ role: "coder", taskId: "F0-01-REPO", fpIds: ["FP001-03"] });
  assertCheck(checks, "scope:coder-outside-fp-blocked", !outOfScopeCoder.access.execution_authorized
    && outOfScopeCoder.conflicts_or_missing_references.some((item) => item.level === "BLOCKING" && item.kind === "task_fp_scope"), outOfScopeCoder.conflicts_or_missing_references);
  const outOfScopeAuditor = router.route({ role: "auditor", taskId: "F0-01-REPO", fpIds: ["FP001-03"] });
  assertCheck(checks, "scope:auditor-outside-fp-blocked", outOfScopeAuditor.conflicts_or_missing_references.some((item) => item.level === "BLOCKING" && item.kind === "task_fp_scope"), outOfScopeAuditor.conflicts_or_missing_references);
  const coordinatorWithoutCrossMode = router.route({ role: "coordinator", taskId: "F0-01-REPO", fpIds: ["FP001-03"] });
  assertCheck(checks, "scope:coordinator-cross-mode-required", coordinatorWithoutCrossMode.conflicts_or_missing_references.some((item) => item.level === "BLOCKING" && item.kind === "task_fp_scope"), coordinatorWithoutCrossMode.conflicts_or_missing_references);
  const coordinatorCrossReview = router.route({ role: "coordinator", taskId: "F0-01-REPO", fpIds: ["FP001-03"], crossFpReview: true });
  assertCheck(checks, "scope:coordinator-explicit-cross-read-only", coordinatorCrossReview.access.cross_fp_read_only
    && coordinatorCrossReview.access.effective_write_scope[0] === "READ_ONLY"
    && !coordinatorCrossReview.conflicts_or_missing_references.some((item) => item.level === "BLOCKING" && item.kind === "task_fp_scope"), coordinatorCrossReview.access);

  const gapAuditor = router.route({ role: "gap_auditor", taskId: "S1-FP001-03" });
  const promptEditor = router.route({ role: "prompt_editor", taskId: "S1-FP001-03" });
  const architect = router.route({ role: "architect", taskId: "S1-FP001-03" });
  assertCheck(checks, "role:gap-auditor-projection", gapAuditor.input.view_id === "VIEW::GAP_AUDITOR"
    && gapAuditor.role_projection.write_scope[0] === "READ_ONLY"
    && Array.isArray(gapAuditor.role_projection.evidence_gaps), gapAuditor.role_projection);
  assertCheck(checks, "role:prompt-editor-projection", promptEditor.input.view_id === "VIEW::PROMPT_EDITOR"
    && promptEditor.role_projection.publish_or_activate_allowed === false
    && promptEditor.conflicts_or_missing_references.some((item) => item.kind === "prompt_revision_not_instantiated"), promptEditor.role_projection);
  assertCheck(checks, "role:architect-projection", architect.input.view_id === "VIEW::ARCHITECT"
    && architect.role_projection.replan_categories.C.includes("CREATOR_REQUIRED")
    && architect.role_projection.write_scope[0] === "READ_ONLY", architect.role_projection);

  assertCheck(checks, "conflict:expected-greenfield-does-not-block", readyCoder.conflicts_or_missing_references.some((item) => item.level === "EXPECTED_GREENFIELD")
    && !readyCoder.conflicts_or_missing_references.some((item) => item.level === "BLOCKING")
    && readyCoder.access.execution_authorized, readyCoder.conflicts_or_missing_references);
  assertCheck(checks, "conflict:blocking-denies-execution", outOfScopeCoder.conflicts_or_missing_references.some((item) => item.level === "BLOCKING")
    && !outOfScopeCoder.access.execution_authorized, outOfScopeCoder.blocking_conditions);
  assertCheck(checks, "conflict:all-levels-valid", [readyCoder, plannedCoder, outOfScopeCoder, ...contexts]
    .flatMap((context) => context.conflicts_or_missing_references)
    .every((item) => CONFLICT_LEVELS.has(item.level)), "all routed conflicts use the three registered levels");

  const gate = router.gateSnapshot();
  assertCheck(checks, "gate:g05-exact", gate.g05.valid, gate.g05);
  assertCheck(checks, "gate:active-g04", gate.active_execution_gate_valid, { G04_GATE: router.gates.G04_GATE, G04_REVISION: router.gates.G04_REVISION });
  assertCheck(checks, "gate:status-counts", gate.task_status_counts.READY === 1 && gate.task_status_counts.PLANNED === 84, gate.task_status_counts);
  assertCheck(checks, "gate:g06-exact", gate.g06.registered && gate.g06.valid, gate.g06);

  const protectedHashes = router.registeredProtectedHashes();
  const v7Version = router.versionFor(V7_PATH, protectedHashes.get(V7_PATH));
  const promptVersion = router.versionFor(PROMPT_PATH, protectedHashes.get(PROMPT_PATH));
  assertCheck(checks, "source:v7-protected-hash", v7Version.matches_registered_sha256, v7Version);
  assertCheck(checks, "source:prompt-protected-hash", promptVersion.matches_registered_sha256, promptVersion);

  const originalG04Gate = router.gates.G04_GATE;
  router.gates.G04_GATE = "PENDING";
  const gateDrift = router.route({ role: "coder", taskId: "F0-01-REPO" });
  router.gates.G04_GATE = originalG04Gate;
  assertCheck(checks, "drift:gate-blocks", !gateDrift.access.execution_authorized
    && gateDrift.conflicts_or_missing_references.some((item) => item.level === "BLOCKING" && item.kind === "active_gate"), gateDrift.blocking_conditions);

  const originalArtifactHash = router.gates.G06_ARTIFACT_SHA256;
  router.gates.G06_ARTIFACT_SHA256 = "0".repeat(64);
  const artifactDrift = router.route({ role: "coder", taskId: "F0-01-REPO" });
  router.gates.G06_ARTIFACT_SHA256 = originalArtifactHash;
  assertCheck(checks, "drift:artifact-blocks", !artifactDrift.access.execution_authorized
    && artifactDrift.conflicts_or_missing_references.some((item) => item.level === "BLOCKING" && item.kind === "g06_artifact"), artifactDrift.blocking_conditions);

  const originalProtectedHashReader = router.registeredProtectedHashes.bind(router);
  router.registeredProtectedHashes = () => new Map([[V7_PATH, "0".repeat(64)], [PROMPT_PATH, protectedHashes.get(PROMPT_PATH)]]);
  const protectedDrift = router.route({ role: "reviewer", taskId: "S1-FP001-03" });
  router.registeredProtectedHashes = originalProtectedHashReader;
  assertCheck(checks, "drift:protected-source-blocks", protectedDrift.conflicts_or_missing_references.some((item) => item.level === "BLOCKING" && item.kind === "protected_hash_drift"), protectedDrift.blocking_conditions);

  let unknownTaskRejected = false;
  try {
    router.route({ role: "coder", taskId: "S7-NOT-A-TASK", fpIds: ["FP001-03"] });
  } catch {
    unknownTaskRejected = true;
  }
  assertCheck(checks, "input:unknown-task-rejected", unknownTaskRejected, "invalid task_id rejected before routing");

  const passed = checks.filter((check) => check.passed).length;
  const businessAcceptance = [
    { id: "G05-CTX-BA-01", passed: contexts.every((context) => context.task_index_row.source_ref), criterion: "Task Index current row is returned from the active control source" },
    { id: "G05-CTX-BA-02", passed: checks.filter((check) => check.id.includes("direct-upstream") || check.id.includes("direct-downstream")).every((check) => check.passed), criterion: "No direct Task upstream or downstream edge is omitted" },
    { id: "G05-CTX-BA-03", passed: checks.filter((check) => check.id.includes("archive-isolation")).every((check) => check.passed), criterion: "Archive, backup, legacy, .tmp and .git paths never enter routes" },
    { id: "G05-CTX-BA-04", passed: checks.filter((check) => check.id.includes("bounded-context")).every((check) => check.passed), criterion: "V7 and Prompt are emitted as exact range metadata, never full source bodies" },
    { id: "G05-CTX-BA-05", passed: contexts.every((context) => context.file_versions.every((version) => version.sha256)), criterion: "Every loaded file carries a current SHA-256 and Git worktree version" },
    { id: "G05-CTX-BA-06", passed: contexts.every((context) => context.access.effective_write_scope.length > 0), criterion: "Role and readiness produce an explicit effective read/write boundary" },
    { id: "G05-CTX-BA-07", passed: contexts.every((context) => context.conflicts_or_missing_references.every((item) => item.reason)), criterion: "Missing or conflicting references are explicit and never guessed" },
    { id: "G05-CTX-BA-08", passed: gate.g05.valid && gate.g06.valid, criterion: "G05 and the creator-approved G06 registration both validate from exact evidence" },
  ];

  return {
    schema_version: "project-context-loader-self-test/v2",
    passed: passed === checks.length && businessAcceptance.every((item) => item.passed),
    assertions: { passed, failed: checks.length - passed, total: checks.length },
    samples: evidence,
    failed_checks: checks.filter((check) => !check.passed),
    business_acceptance: businessAcceptance,
    gate_evidence: gate,
    retained_findings: contexts[0].conflicts_or_missing_references.filter((item) => item.kind === "control_status_narrative_drift"),
  };
}

function usage() {
  return [
    "Usage:",
    "  node tools/project-context-loader.mjs --role <coordinator|gap_auditor|coder|prompt_editor|auditor|reviewer|architect> --task-id <Task ID> [--fp-ids <FP IDs>] [--cross-fp-review] [--format json|markdown]",
    "  node tools/project-context-loader.mjs --self-test",
  ].join("\n");
}

function main() {
  try {
    const options = parseCli(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    const router = new ProjectContextRouter(options.root ?? DEFAULT_ROOT);
    if (options.selfTest) {
      const report = runSelfTest(router);
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      if (!report.passed) process.exitCode = 1;
      return;
    }
    if (!options.role || !options.taskId) throw new Error(usage());
    const context = router.route(options);
    if (options.format === "markdown") process.stdout.write(renderMarkdown(context));
    else if (options.format === "json") process.stdout.write(`${JSON.stringify(context, null, 2)}\n`);
    else throw new Error("format must be json or markdown");
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: error.message }, null, 2)}\n`);
    process.exitCode = 2;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();

export {
  CONTROL_PATH,
  DECISION_LEVELS,
  FP_ID_RE,
  ProjectContextRouter,
  ROLES,
  TASK_ID_RE,
  conflict,
  globToRegExp,
  normalizePath,
  parseDependsOn,
  runSelfTest,
  sha256,
  stableJson,
};

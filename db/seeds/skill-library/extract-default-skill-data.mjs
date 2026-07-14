import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(directory, "../../..");
const sourceFile = path.join(repositoryRoot, "docs", "前端原型_v2", "pages", "skill_library.html");
const outputFile = path.join(directory, "default-skill-data.json");
const source = readFileSync(sourceFile, "utf8").replaceAll("\r\n", "\n");
const start = source.indexOf("const defaultSkillData =");
const end = source.indexOf("\n    };\n\n    let activeCategory", start);

if (start < 0 || end < 0) throw new Error("defaultSkillData was not found in the prototype");

const context = {};
vm.runInNewContext(`${source.slice(start, end + 7).replace("const defaultSkillData =", "globalThis.defaultSkillData =")};`, context);

const categories = context.defaultSkillData;
const expectedCounts = {
  "theme-combos": 54,
  "chapter-expansion": 8,
  "art-presentation": 6,
  "camera-language": 4,
};

for (const [category, count] of Object.entries(expectedCounts)) {
  if (!Array.isArray(categories[category]) || categories[category].length !== count) {
    throw new Error(`unexpected ${category} count`);
  }
}

writeFileSync(outputFile, `${JSON.stringify(categories, null, 2)}\n`, "utf8");

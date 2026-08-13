import { access } from "node:fs/promises";
import { pageRoutes } from "../src/app/routes.mjs";

const files = [
  "src/app/routes.mjs",
  "src/app/server.mjs",
  "src/pages/prototype/common/header.js",
  "src/pages/prototype/common/sidebar.css",
  "src/pages/prototype/common/sidebar.js",
  "src/pages/prototype/common/theme.css",
  "src/pages/prototype/common/theme.js",
  "src/vendor/SOURCES.json",
  ...pageRoutes.map(({ page }) => `src/${page}`),
];
for (const file of files) await access(new URL(`../${file}`, import.meta.url));
console.log("web static build validation passed");

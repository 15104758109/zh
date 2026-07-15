import { access } from "node:fs/promises";
const files = ["src/app/index.html", "src/app/main.mjs", "src/app/server.mjs", "src/app/shell.css", "src/assets/theme.css", "src/assets/sidebar.css"];
for (const file of files) await access(new URL(`../${file}`, import.meta.url));
console.log("web static build validation passed");

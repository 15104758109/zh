import { ensureDatabase, sql } from "./database.mjs";

ensureDatabase();
sql("DROP SCHEMA zhreplan CASCADE; CREATE SCHEMA zhreplan");
await import("./migrate.mjs");

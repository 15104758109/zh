import { databaseSchema, ensureDatabase, sql } from "./database.mjs";

ensureDatabase();
sql(`DROP SCHEMA ${databaseSchema} CASCADE; CREATE SCHEMA ${databaseSchema}`);
await import("./migrate.mjs");

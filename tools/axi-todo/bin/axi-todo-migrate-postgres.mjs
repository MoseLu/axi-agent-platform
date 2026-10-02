#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = path.join(root, "migrations");
const migrationPaths = readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => path.join(migrationsDirectory, name));
// M2.S4: stop silently falling back to `postgresql:///axi_todo`. The previous
// implicit default has caused "looks connected, actually empty DB" incidents
// (see M2 ledger outOfScopeButFlagged). Operators must set DATABASE_URL or
// AXI_TODO_DATABASE_URL; if both are missing we exit with a clear error so
// the migrator never silently runs against the wrong database.
const databaseUrl = process.env.DATABASE_URL || process.env.AXI_TODO_DATABASE_URL;
if (!databaseUrl) {
  process.stderr.write(
    "axi-todo-migrate-postgres: DATABASE_URL (or AXI_TODO_DATABASE_URL) is required.\n" +
      "Refusing to silently fall back to an implicit database URL.\n",
  );
  process.exit(1);
}

if (!migrationPaths.length || migrationPaths.some((migrationPath) => !existsSync(migrationPath))) {
  process.stderr.write(`migration not found in ${migrationsDirectory}\n`);
  process.exit(1);
}

ensureDatabase(databaseUrl);

const result = spawnSync(process.env.PSQL_PATH || "psql", [databaseUrl, "-v", "ON_ERROR_STOP=1"], {
  input: migrationPaths.map((migrationPath) => readFileSync(migrationPath, "utf8")).join("\n\n"),
  stdio: ["pipe", "inherit", "inherit"],
});

process.exit(result.status ?? 1);

function ensureDatabase(url) {
  const check = spawnSync(process.env.PSQL_PATH || "psql", [url, "-Atc", "select 1"], { stdio: "ignore" });
  if (check.status === 0) return;

  const dbName = databaseName(url);
  const create = spawnSync(process.env.CREATEDB_PATH || "createdb", [dbName], { stdio: "inherit" });
  if (create.status !== 0) {
    process.stderr.write(`failed to create PostgreSQL database: ${dbName}\n`);
    process.exit(create.status ?? 1);
  }
}

function databaseName(url) {
  try {
    const parsed = new URL(url);
    const name = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    return name || "axi_todo";
  } catch {
    return "axi_todo";
  }
}

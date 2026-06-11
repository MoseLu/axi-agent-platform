#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_POSTGRES_DATABASE_URL } from "../lib/postgres-store.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationPath = path.join(root, "migrations", "001_task_memory.sql");
const databaseUrl = process.env.DATABASE_URL || process.env.AXI_TODO_DATABASE_URL || DEFAULT_POSTGRES_DATABASE_URL;

if (!existsSync(migrationPath)) {
  process.stderr.write(`migration not found: ${migrationPath}\n`);
  process.exit(1);
}

ensureDatabase(databaseUrl);

const result = spawnSync(process.env.PSQL_PATH || "psql", [databaseUrl, "-v", "ON_ERROR_STOP=1"], {
  input: readFileSync(migrationPath, "utf8"),
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

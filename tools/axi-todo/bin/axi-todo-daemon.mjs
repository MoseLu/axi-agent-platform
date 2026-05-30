#!/usr/bin/env node
import { runDaemon } from "../lib/daemon.mjs";
import { createStoreFromEnv } from "../lib/store.mjs";

const flags = parseFlags(process.argv.slice(2));

runDaemon({
  store: createStoreFromEnv(),
  intervalMs: parsePositiveInt(flags["interval-ms"], 300000),
  once: Boolean(flags.once),
}).catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i += 1;
    }
  }
  return flags;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

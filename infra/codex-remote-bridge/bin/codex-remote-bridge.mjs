#!/usr/bin/env node
import { packagePaths, readVersion } from "../lib/manager-core.mjs";
import { runBridge } from "../lib/runtime.mjs";

runBridge({ paths: packagePaths(), version: readVersion() }).catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});

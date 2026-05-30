#!/usr/bin/env node
import { startMcpStdio } from "../lib/mcp-server.mjs";

startMcpStdio().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});

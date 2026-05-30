#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runProcess } from "../lib/process.mjs";

const LABEL = "dev.axi-todo.daemon";
const PLIST_PATH = path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const ROOT = path.resolve(import.meta.dirname, "..");
const DAEMON = path.join(ROOT, "bin", "axi-todo-daemon.mjs");

const command = process.argv[2] || "help";

async function main() {
  if (command === "print") {
    process.stdout.write(buildPlist());
    return;
  }
  if (command === "install") {
    await fs.mkdir(path.dirname(PLIST_PATH), { recursive: true });
    await fs.mkdir(path.join(os.homedir(), ".axi-todo", "logs"), { recursive: true });
    await fs.writeFile(PLIST_PATH, buildPlist(), "utf8");
    await runProcess("launchctl", ["bootout", `gui/${process.getuid()}`, PLIST_PATH], { timeoutMs: 5000 });
    const result = await runProcess("launchctl", ["bootstrap", `gui/${process.getuid()}`, PLIST_PATH], { timeoutMs: 5000 });
    if (result.exitCode !== 0) throw new Error(result.stderr || `launchctl bootstrap exited ${result.exitCode}`);
    process.stdout.write(`${PLIST_PATH}\n`);
    return;
  }
  if (command === "uninstall") {
    await runProcess("launchctl", ["bootout", `gui/${process.getuid()}`, PLIST_PATH], { timeoutMs: 5000 });
    await fs.rm(PLIST_PATH, { force: true });
    process.stdout.write(`removed ${PLIST_PATH}\n`);
    return;
  }
  if (command === "status") {
    const result = await runProcess("launchctl", ["print", `gui/${process.getuid()}/${LABEL}`], { timeoutMs: 5000 });
    process.stdout.write(result.stdout || result.stderr || `exit ${result.exitCode}\n`);
    return;
  }
  process.stdout.write("Usage: axi-todo-launchd <print|install|uninstall|status>\n");
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});

function buildPlist() {
  const node = process.execPath;
  const logDir = path.join(os.homedir(), ".axi-todo", "logs");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(node)}</string>
    <string>${escapeXml(DAEMON)}</string>
    <string>--interval-ms</string>
    <string>300000</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(path.join(logDir, "daemon.out.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(path.join(logDir, "daemon.err.log"))}</string>
</dict>
</plist>
`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

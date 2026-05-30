#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { copyDirSync, ensureDir, readJsonFile, writeJsonAtomic } from "../lib/fs-json.mjs";
import {
  LABEL,
  buildLaunchdPlist,
  normalizeConfigForSave,
  packagePaths,
  readVersion,
  redactValue,
} from "../lib/manager-core.mjs";
import { readStatus, writeStatus } from "../lib/status.mjs";

const command = process.argv[2] || "status";
const flags = new Set(process.argv.slice(3));

try {
  if (command === "install") {
    install({ startAfterInstall: !flags.has("--no-start") });
  } else if (command === "start") {
    start();
  } else if (command === "stop") {
    stop();
  } else if (command === "restart") {
    stop();
    start();
  } else if (command === "status") {
    printStatus();
  } else if (command === "update") {
    install({ startAfterInstall: !flags.has("--no-start"), restartAfterInstall: true });
  } else if (command === "uninstall") {
    uninstall({ deleteConfig: flags.has("--delete-config") });
  } else {
    usage();
    process.exit(2);
  }
} catch (error) {
  console.error(error?.message || String(error));
  process.exit(1);
}

function install({ startAfterInstall, restartAfterInstall = false }) {
  const sourceDir = path.resolve(import.meta.dirname, "..");
  const version = readVersion(sourceDir);
  const paths = packagePaths(os.homedir(), version);
  ensureDir(paths.logsDir);
  const sourceForCopy = prepareSourceForCopy(sourceDir, paths.versionDir);
  try {
    copyDirSync(sourceForCopy.path, paths.versionDir);
  } finally {
    if (sourceForCopy.cleanup) {
      fs.rmSync(sourceForCopy.path, { recursive: true, force: true });
    }
  }
  fs.rmSync(paths.currentDir, { force: true, recursive: true });
  fs.symlinkSync(paths.versionDir, paths.currentDir, "dir");
  const config = migrateConfig(paths);
  writeStatus(paths, {
    running: false,
    enabled: config.enabled,
    connected: false,
    version,
    activeJobs: 0,
    clientId: config.clientId,
    serverUrl: config.serverUrl,
    runtimeMode: config.runtimeMode,
    lastError: undefined,
    lastUpdatedAt: new Date().toISOString(),
  });
  ensureDir(paths.launchAgentsDir);
  fs.writeFileSync(
    paths.plistPath,
    buildLaunchdPlist({ nodePath: process.execPath, paths }),
    { mode: 0o600 },
  );
  if (restartAfterInstall) {
    stop();
  }
  if (startAfterInstall) {
    start(paths);
  }
  console.log(JSON.stringify({ installed: true, version, currentDir: paths.currentDir }, null, 2));
}

function prepareSourceForCopy(sourceDir, targetDir) {
  const sourceReal = fs.realpathSync(sourceDir);
  const targetReal = fs.existsSync(targetDir) ? fs.realpathSync(targetDir) : null;
  if (targetReal && sourceReal === targetReal) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-remote-bridge-update-"));
    fs.cpSync(sourceDir, tempDir, { recursive: true });
    return { path: tempDir, cleanup: true };
  }
  return { path: sourceDir, cleanup: false };
}

function migrateConfig(paths) {
  const existing = readJsonFile(paths.configPath, {});
  const normalized = normalizeConfigForSave(existing);
  writeJsonAtomic(paths.configPath, normalized);
  return normalized;
}

function start(paths = packagePaths()) {
  if (!fs.existsSync(paths.plistPath)) {
    throw new Error(`LaunchAgent plist not found: ${paths.plistPath}`);
  }
  runLaunchctl(["bootstrap", guiDomain(), paths.plistPath], { allowFailure: true });
  runLaunchctl(["kickstart", "-k", `${guiDomain()}/${LABEL}`], { allowFailure: true });
}

function stop(paths = packagePaths()) {
  runLaunchctl(["bootout", guiDomain(), paths.plistPath], { allowFailure: true });
  runLaunchctl(["bootout", `${guiDomain()}/${LABEL}`], { allowFailure: true });
}

function printStatus() {
  const paths = packagePaths();
  const config = normalizeConfigForSave(readJsonFile(paths.configPath, {}));
  const status = {
    launchdLabel: LABEL,
    installed: fs.existsSync(paths.runnerPath),
    plistInstalled: fs.existsSync(paths.plistPath),
    configEnabled: config.enabled,
    configRuntimeMode: config.runtimeMode,
    ...readStatus(paths),
  };
  console.log(JSON.stringify(redactValue(status), null, 2));
}

function uninstall({ deleteConfig }) {
  const paths = packagePaths();
  stop(paths);
  fs.rmSync(paths.plistPath, { force: true });
  fs.rmSync(paths.packageRoot, { recursive: true, force: true });
  if (deleteConfig) {
    fs.rmSync(paths.configPath, { force: true });
  }
  console.log(JSON.stringify({ uninstalled: true, configDeleted: deleteConfig }, null, 2));
}

function runLaunchctl(args, { allowFailure = false } = {}) {
  const result = spawnSync("launchctl", args, { encoding: "utf8" });
  if (!allowFailure && result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "launchctl failed").trim());
  }
  return result;
}

function guiDomain() {
  return `gui/${os.userInfo().uid}`;
}

function usage() {
  console.log(`Usage: codex-remote-bridge-manager <install|start|stop|restart|status|update|uninstall> [--no-start] [--delete-config]`);
}

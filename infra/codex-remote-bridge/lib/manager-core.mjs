import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const LABEL = "cn.redamancy.codex-remote-bridge";
export const PACKAGE_NAME = "codex-remote-bridge";
export const DEFAULT_SERVER_URL = "wss://redamancy.com.cn/codex-bridge/ws";
export const DEFAULT_CLIENT_ID = "mose-mac-cockpit";
export const DEFAULT_PROJECTS_ROOT = "/Volumes/code/workspace";
export const DEFAULT_MAX_PROMPT_CHARS = 20_000;
export const DEFAULT_MAX_CONCURRENT_JOBS = 1;

const SECRET_KEYS = new Set([
  "authorization",
  "bridgetoken",
  "bridge_token",
  "access_token",
  "accesstoken",
  "refresh_token",
  "refreshtoken",
  "id_token",
  "idtoken",
  "openaikey",
  "openai_api_key",
  "apikey",
  "api_key",
  "token",
  "tokens",
]);

export function dataDir(home = os.homedir()) {
  return path.join(home, ".antigravity_cockpit");
}

export function packagePaths(home = os.homedir(), version = readVersion()) {
  const root = dataDir(home);
  const packageRoot = path.join(root, "packages", PACKAGE_NAME);
  return {
    home,
    dataDir: root,
    packageRoot,
    version,
    versionDir: path.join(packageRoot, `v${version}`),
    currentDir: path.join(packageRoot, "current"),
    configPath: path.join(root, "codex_remote_bridge.json"),
    statusPath: path.join(root, "codex_remote_bridge_status.json"),
    accountSwitchStatusPath: path.join(root, "codex_account_switch_status.json"),
    historyPath: path.join(root, "codex_wakeup_history.json"),
    logsDir: path.join(root, "logs"),
    outLogPath: path.join(root, "logs", "codex-remote-bridge.out.log"),
    errLogPath: path.join(root, "logs", "codex-remote-bridge.err.log"),
    launchAgentsDir: path.join(home, "Library", "LaunchAgents"),
    plistPath: path.join(home, "Library", "LaunchAgents", `${LABEL}.plist`),
    runnerPath: path.join(packageRoot, "current", "bin", "codex-remote-bridge.mjs"),
  };
}

export function readVersion(sourceDir = path.resolve(import.meta.dirname, "..")) {
  try {
    return fs.readFileSync(path.join(sourceDir, "VERSION"), "utf8").trim() || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function normalizeConfig(raw = {}) {
  const accountScope = raw.accountScope ?? raw.account_scope ?? {};
  const allowedWorkdirs = raw.allowedWorkdirs ?? raw.allowed_workdirs ?? [];
  return {
    enabled: Boolean(raw.enabled),
    serverUrl: stringOr(raw.serverUrl ?? raw.server_url, DEFAULT_SERVER_URL),
    clientId: stringOr(raw.clientId ?? raw.client_id, DEFAULT_CLIENT_ID),
    bridgeToken: optionalString(raw.bridgeToken ?? raw.bridge_token),
    accountScope: {
      mode: stringOr(accountScope.mode, "all"),
      accountIds: Array.isArray(accountScope.accountIds ?? accountScope.account_ids)
        ? [...new Set((accountScope.accountIds ?? accountScope.account_ids).filter(Boolean))]
        : [],
    },
    defaultModel: optionalString(raw.defaultModel ?? raw.default_model),
    defaultReasoningEffort: optionalString(
      raw.defaultReasoningEffort ?? raw.default_reasoning_effort,
    ),
    allowedWorkdirs: normalizeStringList(allowedWorkdirs),
    maxPromptChars: positiveInt(
      raw.maxPromptChars ?? raw.max_prompt_chars,
      DEFAULT_MAX_PROMPT_CHARS,
    ),
    maxConcurrentJobs: positiveInt(
      raw.maxConcurrentJobs ?? raw.max_concurrent_jobs,
      DEFAULT_MAX_CONCURRENT_JOBS,
    ),
    runtimeMode: stringOr(raw.runtimeMode ?? raw.runtime_mode, "sidecar"),
    sidecarAutoUpdate: raw.sidecarAutoUpdate ?? raw.sidecar_auto_update ?? true,
    sidecarUpdateChannel: stringOr(
      raw.sidecarUpdateChannel ?? raw.sidecar_update_channel,
      "stable",
    ),
  };
}

export function normalizeConfigForSave(raw = {}) {
  const config = normalizeConfig(raw);
  return {
    enabled: config.enabled,
    serverUrl: config.serverUrl,
    clientId: config.clientId,
    bridgeToken: config.bridgeToken,
    accountScope: config.accountScope,
    defaultModel: config.defaultModel,
    defaultReasoningEffort: config.defaultReasoningEffort,
    allowedWorkdirs: config.allowedWorkdirs,
    maxPromptChars: config.maxPromptChars,
    maxConcurrentJobs: config.maxConcurrentJobs,
    runtimeMode: config.runtimeMode,
    sidecarAutoUpdate: Boolean(config.sidecarAutoUpdate),
    sidecarUpdateChannel: config.sidecarUpdateChannel,
  };
}

export function buildLaunchdPlist({ nodePath = process.execPath, paths = packagePaths() } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(nodePath)}</string>
    <string>${escapeXml(paths.runnerPath)}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(paths.outLogPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(paths.errLogPath)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>
</dict>
</plist>
`;
}

export function redactValue(value) {
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SECRET_KEYS.has(key.toLowerCase()) ? "***" : redactValue(item);
  }
  return output;
}

export function maskAccountLabel(email) {
  const value = String(email || "");
  const [name, domain] = value.split("@");
  if (!domain) {
    return "Codex account";
  }
  return `${name.slice(0, 2) || "***"}***@${domain}`;
}

export function sanitizeLogText(text) {
  let output = String(text ?? "");
  output = output.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer ***");
  output = output.replace(/"(bridgeToken|bridge_token|access_token|refresh_token|id_token)"\s*:\s*"[^"]*"/gi, '"$1":"***"');
  return output;
}

function stringOr(value, fallback) {
  const text = optionalString(value);
  return text || fallback;
}

function optionalString(value) {
  if (value === null || value === undefined) {
    return undefined;
  }
  const text = String(value).trim();
  return text || undefined;
}

function normalizeStringList(values) {
  if (!Array.isArray(values)) {
    return [DEFAULT_PROJECTS_ROOT];
  }
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const text = optionalString(value);
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    output.push(text);
  }
  return output.length ? output : [DEFAULT_PROJECTS_ROOT];
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

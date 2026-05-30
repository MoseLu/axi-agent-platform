import { readJsonFile, writeJsonAtomic } from "./fs-json.mjs";
import { redactValue } from "./manager-core.mjs";

export function readStatus(paths) {
  return normalizeStatus(readJsonFile(paths.statusPath, {}));
}

export function writeStatus(paths, patch) {
  const status = normalizeStatus({ ...readStatus(paths), ...patch });
  writeJsonAtomic(paths.statusPath, redactValue(status));
  return status;
}

export function normalizeStatus(raw = {}) {
  return {
    running: Boolean(raw.running),
    enabled: Boolean(raw.enabled),
    connected: Boolean(raw.connected),
    version: raw.version || "0.0.0",
    activeJobs: Number.isFinite(Number(raw.activeJobs)) ? Number(raw.activeJobs) : 0,
    clientId: raw.clientId,
    serverUrl: raw.serverUrl,
    runtimeMode: raw.runtimeMode || "sidecar",
    lastError: raw.lastError,
    lastSeenAt: raw.lastSeenAt,
    lastUpdatedAt: raw.lastUpdatedAt || new Date().toISOString(),
  };
}

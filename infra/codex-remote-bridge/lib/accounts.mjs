import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ensureDir, readJsonFile, writeJsonAtomic } from "./fs-json.mjs";
import { maskAccountLabel } from "./manager-core.mjs";

export function listAccounts({ paths }) {
  return loadAccounts(paths).map((account) => ({
    account_id: account.id,
    label: maskAccountLabel(account.email),
    plan_type: account.plan_type,
    auth_mode: account.auth_mode,
    tags: account.tags,
    available: isUsableCodexAccount(account),
    hourly_percentage: readQuotaPercentage(account.quota, "hourly_percentage"),
    weekly_percentage: readQuotaPercentage(account.quota, "weekly_percentage"),
  }));
}

export function selectAccount({ paths, selector = { mode: "auto" }, accountScope = null }) {
  const selected = selectAccountCandidates({ paths, selector, accountScope })[0];
  if (!selected) {
    throw new Error(`No usable OAuth Plus Codex account matched selector: ${selector?.mode || "auto"}`);
  }
  return selected;
}

export function selectAccountCandidates({ paths, selector = { mode: "auto" }, accountScope = null }) {
  const accounts = loadAccounts(paths).filter((account) => scopeAllows(account, accountScope));
  const mode = selector?.mode || "auto";
  const value = selector?.value;
  let candidates = accounts.filter(isUsableCodexAccount);
  if (mode === "account_id") {
    candidates = candidates.filter((account) => account.id === value);
  } else if (mode === "tag") {
    candidates = candidates.filter((account) => account.tags.includes(value));
  }
  return candidates.sort(compareAccountCapacity);
}

export function prepareManagedCodexHome({ paths, account }) {
  const tokens = normalizeTokens(account.tokens);
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error(`Codex account ${account.id} is missing OAuth tokens`);
  }
  const homeDir = path.join(paths.dataDir, "codex_managed_homes", account.id);
  ensureDir(homeDir);
  writeJsonAtomic(path.join(homeDir, "auth.json"), {
    auth_mode: "chatgpt",
    OPENAI_API_KEY: null,
    tokens,
    last_refresh: new Date().toISOString(),
  });
  fs.writeFileSync(
    path.join(homeDir, "config.toml"),
    `managed_by = "codex-remote-bridge"\n`,
    { mode: 0o600 },
  );
  return homeDir;
}

export function appendWakeupHistory(paths, entry) {
  const existing = readJsonFile(paths.historyPath, []);
  const history = Array.isArray(existing) ? existing : [];
  history.push({
    id: randomUUID(),
    runId: entry.runId || randomUUID(),
    timestamp: Date.now(),
    triggerType: "remote_bridge",
    taskId: entry.jobId,
    taskName: entry.taskName || "WeChat Codex Bridge",
    accountId: entry.account?.id,
    accountEmail: entry.account?.email,
    accountContextText: entry.account?.account_structure || "personal",
    success: Boolean(entry.success),
    prompt: entry.prompt,
    model: entry.model,
    modelReasoningEffort: entry.reasoningEffort,
    reply: entry.reply,
    durationMs: entry.durationMs,
    cliPath: entry.cliPath,
    error: entry.error,
  });
  writeJsonAtomic(paths.historyPath, history.slice(-500));
}

export function loadAccounts(paths) {
  const index = readJsonFile(path.join(paths.dataDir, "codex_accounts.json"), {});
  const summaries = Array.isArray(index) ? index : index.accounts || [];
  return summaries
    .filter((account) => account && account.id)
    .map((summary) => ({ ...summary, ...loadAccountDetails(paths, summary.id) }))
    .map(normalizeAccount);
}

function loadAccountDetails(paths, accountId) {
  return readJsonFile(path.join(paths.dataDir, "codex_accounts", `${accountId}.json`), {});
}

function normalizeAccount(account) {
  return {
    ...account,
    id: String(account.id || ""),
    email: String(account.email || ""),
    auth_mode: account.auth_mode || "oauth",
    plan_type: String(account.plan_type || "").toLowerCase(),
    tags: Array.isArray(account.tags) ? account.tags.filter(Boolean).map(String) : [],
    tokens: normalizeTokens(account.tokens),
  };
}

function normalizeTokens(tokens) {
  if (!tokens || typeof tokens !== "object") {
    return {};
  }
  return {
    ...tokens,
    access_token: tokens.access_token || tokens.accessToken,
    refresh_token: tokens.refresh_token || tokens.refreshToken,
    id_token: tokens.id_token || tokens.idToken,
    account_id: tokens.account_id || tokens.accountId,
  };
}

function isUsableCodexAccount(account) {
  if (!account.id || account.auth_mode !== "oauth" || account.plan_type !== "plus") {
    return false;
  }
  if (!account.tokens?.access_token || !account.tokens?.refresh_token) {
    return false;
  }
  const rawRateLimit = account.quota?.raw_data?.rate_limit;
  if (rawRateLimit && rawRateLimit.allowed === false) {
    return false;
  }
  if (rawRateLimit?.limit_reached === true) {
    return false;
  }
  return readQuotaPercentage(account.quota, "hourly_percentage") < 100;
}

function scopeAllows(account, scope) {
  if (!scope || !scope.mode || scope.mode === "all") {
    return true;
  }
  if (scope.mode === "selected" || scope.mode === "account_ids") {
    return Array.isArray(scope.accountIds) && scope.accountIds.includes(account.id);
  }
  if (scope.mode === "tag") {
    return account.tags.includes(scope.value);
  }
  return true;
}

function compareAccountCapacity(left, right) {
  const leftHourly = readQuotaPercentage(left.quota, "hourly_percentage");
  const rightHourly = readQuotaPercentage(right.quota, "hourly_percentage");
  if (leftHourly !== rightHourly) {
    return leftHourly - rightHourly;
  }
  return Number(left.last_used || 0) - Number(right.last_used || 0);
}

function readQuotaPercentage(quota, key) {
  const value = Number(quota?.[key]);
  return Number.isFinite(value) ? value : 0;
}

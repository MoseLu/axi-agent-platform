import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  listAccounts,
  prepareManagedCodexHome,
  selectAccount,
  selectAccountCandidates,
} from "../lib/accounts.mjs";
import { packagePaths } from "../lib/manager-core.mjs";

test("selectAccount skips api-key accounts and chooses oauth plus accounts", () => {
  const home = makeTempHome();
  const paths = packagePaths(home, "0.1.0");
  seedAccounts(paths, [
    {
      id: "codex_api",
      email: "api@example.test",
      plan_type: "plus",
      auth_mode: "api_key",
      tokens: null,
    },
    {
      id: "codex_plus",
      email: "plus@example.test",
      plan_type: "plus",
      auth_mode: "oauth",
      tags: ["mobile"],
      tokens: { access_token: "access", refresh_token: "refresh", account_id: "acct" },
      quota: { hourly_percentage: 12, weekly_percentage: 34 },
    },
  ]);

  const account = selectAccount({ paths, selector: { mode: "auto" } });

  assert.equal(account.id, "codex_plus");
  assert.equal(account.email, "plus@example.test");
});

test("selectAccount can filter by tag and account id", () => {
  const home = makeTempHome();
  const paths = packagePaths(home, "0.1.0");
  seedAccounts(paths, [
    makePlusAccount("codex_a", "a@example.test", ["frontend"]),
    makePlusAccount("codex_b", "b@example.test", ["backend"]),
  ]);

  assert.equal(
    selectAccount({ paths, selector: { mode: "tag", value: "backend" } }).id,
    "codex_b",
  );
  assert.equal(
    selectAccount({ paths, selector: { mode: "account_id", value: "codex_a" } }).id,
    "codex_a",
  );
});

test("selectAccountCandidates returns all usable accounts in capacity order", () => {
  const home = makeTempHome();
  const paths = packagePaths(home, "0.1.0");
  seedAccounts(paths, [
    { ...makePlusAccount("codex_busy", "busy@example.test", []), quota: { hourly_percentage: 50 } },
    { ...makePlusAccount("codex_ready", "ready@example.test", []), quota: { hourly_percentage: 2 } },
    {
      ...makePlusAccount("codex_blocked", "blocked@example.test", []),
      quota: { raw_data: { rate_limit: { allowed: false } } },
    },
  ]);

  const candidates = selectAccountCandidates({ paths, selector: { mode: "auto" } });

  assert.deepEqual(candidates.map((account) => account.id), ["codex_ready", "codex_busy"]);
});

test("selectAccountCandidates respects account_id selector", () => {
  const home = makeTempHome();
  const paths = packagePaths(home, "0.1.0");
  seedAccounts(paths, [
    makePlusAccount("codex_a", "a@example.test", []),
    makePlusAccount("codex_b", "b@example.test", []),
  ]);

  const candidates = selectAccountCandidates({
    paths,
    selector: { mode: "account_id", value: "codex_b" },
  });

  assert.deepEqual(candidates.map((account) => account.id), ["codex_b"]);
});

test("prepareManagedCodexHome writes auth without changing the desktop codex home", () => {
  const home = makeTempHome();
  const paths = packagePaths(home, "0.1.0");
  seedAccounts(paths, [makePlusAccount("codex_a", "a@example.test", [])]);
  const account = selectAccount({ paths, selector: { mode: "auto" } });

  const managedHome = prepareManagedCodexHome({ paths, account });

  assert.equal(managedHome, path.join(paths.dataDir, "codex_managed_homes", "codex_a"));
  assert.equal(fs.existsSync(path.join(managedHome, "auth.json")), true);
  assert.equal(fs.existsSync(path.join(home, ".codex", "auth.json")), false);
});

test("listAccounts returns masked summaries", () => {
  const home = makeTempHome();
  const paths = packagePaths(home, "0.1.0");
  seedAccounts(paths, [makePlusAccount("codex_a", "alex@example.test", ["mobile"])]);

  const accounts = listAccounts({ paths });

  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].account_id, "codex_a");
  assert.equal(accounts[0].label, "al***@example.test");
  assert.deepEqual(accounts[0].tags, ["mobile"]);
  assert.equal(accounts[0].auth_mode, "oauth");
});

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "codex-bridge-accounts-"));
}

function makePlusAccount(id, email, tags) {
  return {
    id,
    email,
    plan_type: "plus",
    auth_mode: "oauth",
    tags,
    tokens: { access_token: `${id}-access`, refresh_token: `${id}-refresh`, account_id: id },
    quota: { hourly_percentage: 10, weekly_percentage: 20 },
  };
}

function seedAccounts(paths, accounts) {
  fs.mkdirSync(path.join(paths.dataDir, "codex_accounts"), { recursive: true });
  fs.writeFileSync(
    path.join(paths.dataDir, "codex_accounts.json"),
    JSON.stringify({
      version: "1.0",
      accounts: accounts.map(({ id, email, plan_type, tags }) => ({
        id,
        email,
        plan_type,
        tags,
      })),
      current_account_id: accounts[0]?.id,
    }),
  );
  for (const account of accounts) {
    fs.writeFileSync(
      path.join(paths.dataDir, "codex_accounts", `${account.id}.json`),
      JSON.stringify(account),
    );
  }
}

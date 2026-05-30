import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLaunchdPlist,
  normalizeConfig,
  packagePaths,
  redactValue,
} from "../lib/manager-core.mjs";

test("normalizeConfig preserves existing bridge fields and defaults to sidecar runtime", () => {
  const config = normalizeConfig({
    enabled: true,
    serverUrl: "wss://example.test/ws",
    clientId: "mose-mac-cockpit",
    bridgeToken: "secret",
    accountScope: { mode: "all", accountIds: [] },
    defaultModel: "gpt-5.3-codex",
    allowedWorkdirs: ["/Volumes/code/workspace"],
  });

  assert.equal(config.enabled, true);
  assert.equal(config.serverUrl, "wss://example.test/ws");
  assert.equal(config.clientId, "mose-mac-cockpit");
  assert.equal(config.bridgeToken, "secret");
  assert.equal(config.runtimeMode, "sidecar");
  assert.equal(config.sidecarAutoUpdate, true);
  assert.equal(config.sidecarUpdateChannel, "stable");
  assert.deepEqual(config.allowedWorkdirs, ["/Volumes/code/workspace"]);
});

test("buildLaunchdPlist points at the installed current package and sidecar logs", () => {
  const paths = packagePaths("/tmp/home", "1.2.3");
  const plist = buildLaunchdPlist({
    nodePath: "/usr/local/bin/node",
    paths,
  });

  assert.match(plist, /cn\.redamancy\.codex-remote-bridge/);
  assert.match(plist, /\/tmp\/home\/\.antigravity_cockpit\/packages\/codex-remote-bridge\/current\/bin\/codex-remote-bridge\.mjs/);
  assert.match(plist, /\/tmp\/home\/\.antigravity_cockpit\/logs\/codex-remote-bridge\.out\.log/);
  assert.doesNotMatch(plist, /bridgeToken|secret|Authorization/);
});

test("redactValue hides bridge and authorization secrets", () => {
  const value = {
    bridgeToken: "secret",
    nested: {
      Authorization: "Bearer secret",
      access_token: "access",
      ok: "visible",
    },
  };

  assert.deepEqual(redactValue(value), {
    bridgeToken: "***",
    nested: {
      Authorization: "***",
      access_token: "***",
      ok: "visible",
    },
  });
});

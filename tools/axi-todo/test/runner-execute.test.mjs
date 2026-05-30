import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { executeTaskWithCodex, resolveCodexCliPath } from "../lib/codex-runner.mjs";

test("resolveCodexCliPath prefers explicit env path", () => {
  assert.equal(resolveCodexCliPath({ env: { AXI_TODO_CODEX_PATH: "/tmp/codex" } }), "/tmp/codex");
});

test("resolveCodexCliPath prefers the Codex app binary over shell wrappers", () => {
  const existing = new Set([
    "/Applications/Codex.app/Contents/Resources/codex",
    "/Users/test/.local/bin/codex",
    "/Users/test/bin/codex",
  ]);
  assert.equal(
    resolveCodexCliPath({
      env: {},
      home: "/Users/test",
      existsSync: (candidate) => existing.has(candidate),
    }),
    "/Applications/Codex.app/Contents/Resources/codex",
  );
});

test("executeTaskWithCodex captures last message from a fake codex command", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-runner-"));
  const fakeCodex = path.join(home, "fake-codex.mjs");
  await fs.writeFile(
    fakeCodex,
    `import fs from "node:fs/promises";
const outIndex = process.argv.indexOf("--output-last-message");
if (outIndex === -1) process.exit(2);
await fs.writeFile(process.argv[outIndex + 1], "fake codex completed");
`,
    "utf8",
  );

  const result = await executeTaskWithCodex(
    {
      id: "task-1",
      title: "Fake",
      prompt: "Do it",
      cwd: home,
    },
    {
      home,
      codexCommand: process.execPath,
      codexArgsPrefix: [fakeCodex],
    },
  );

  assert.equal(result.success, true);
  assert.equal(result.summary, "fake codex completed");
});

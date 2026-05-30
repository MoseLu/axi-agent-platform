import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { listRuntimeCapabilities } from "../lib/runtime-capabilities.mjs";

test("listRuntimeCapabilities reads local skills and plugin skills", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-bridge-capabilities-"));
  writeSkill(
    path.join(home, ".codex", "skills", "git-commit-batch", "SKILL.md"),
    "git-commit-batch",
    "Group dirty git changes into intentional commits.",
  );
  writeSkill(
    path.join(home, ".codex", "plugins", "cache", "openai-curated", "github", "skills", "github", "SKILL.md"),
    "github",
    "Triage GitHub repository, pull request, and issue work.",
  );

  const capabilities = listRuntimeCapabilities({ home });

  assert.deepEqual(
    capabilities.map((item) => ({
      name: item.name,
      source: item.source,
      invocation_label: item.invocation_label,
    })),
    [
      { name: "git-commit-batch", source: "skill", invocation_label: "git-commit-batch" },
      { name: "github", source: "plugin_skill", invocation_label: "github" },
    ],
  );
  assert.match(capabilities[1].description, /GitHub repository/);
});

function writeSkill(filePath, name, description) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
  );
}

import fs from "node:fs";
import path from "node:path";

export function listRuntimeCapabilities({ home, maxItems = 100 } = {}) {
  const codexDir = path.join(home, ".codex");
  const roots = [
    { root: path.join(codexDir, "skills"), source: "skill" },
    { root: path.join(codexDir, "plugins", "cache"), source: "plugin_skill" },
  ];
  const seen = new Set();
  const capabilities = [];
  for (const { root, source } of roots) {
    for (const filePath of listSkillFiles(root)) {
      const capability = readSkillCapability(filePath, source);
      if (!capability || seen.has(capability.invocation_label)) {
        continue;
      }
      seen.add(capability.invocation_label);
      capabilities.push(capability);
    }
  }
  return capabilities
    .sort((left, right) => sourceRank(left.source) - sourceRank(right.source) || left.name.localeCompare(right.name))
    .slice(0, maxItems);
}

function sourceRank(source) {
  return source === "skill" ? 0 : 1;
}

function listSkillFiles(root) {
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSkillFiles(fullPath));
    } else if (entry.isFile() && entry.name === "SKILL.md") {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function readSkillCapability(filePath, source) {
  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  const frontmatter = parseFrontmatter(raw);
  const name = String(frontmatter.name || path.basename(path.dirname(filePath))).trim();
  if (!name) {
    return null;
  }
  return {
    name,
    description: String(frontmatter.description || "").trim(),
    source,
    invocation_label: name,
    path: filePath,
  };
}

function parseFrontmatter(raw) {
  const match = String(raw || "").match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return {};
  }
  const output = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) {
      continue;
    }
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim().replace(/^['"]|['"]$/g, "");
    output[key] = value;
  }
  return output;
}

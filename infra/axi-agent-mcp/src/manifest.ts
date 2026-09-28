/**
 * Tool manifest loader.
 *
 * Reads `infra/axi-agent-mcp/manifest.json` at server start and exposes
 * the server-side allowlist / mutating-tool sets for the `tools/call`
 * middleware installed in `src/index.ts`.
 *
 * Phase 1 commit 5 of the Axi Agent governance rollout. The server
 * MUST refuse to start when this file is missing or invalid — there is
 * no fallback that bypasses the middleware.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ToolManifest {
  manifestId: string;
  schemaVersion: string;
  issuedAt: string;
  allowedTools: string[];
  mutatingTools: string[];
  workstationSafeTools: string[];
  quarantine: string[];
}

const DEFAULT_MANIFEST_RELATIVE_PATH = join(
  __dirname,
  "..",
  "manifest.json",
);

export interface ManifestLoaderOptions {
  manifestPath?: string;
}

export class ToolManifestLoader {
  private readonly manifestPath: string;
  private cached: ToolManifest | null = null;

  constructor(options: ManifestLoaderOptions = {}) {
    this.manifestPath = options.manifestPath ?? DEFAULT_MANIFEST_RELATIVE_PATH;
  }

  load(): ToolManifest {
    const raw = readFileSync(this.manifestPath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `Failed to parse tool manifest at ${this.manifestPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const manifest = validateToolManifest(parsed, this.manifestPath);
    this.cached = manifest;
    return manifest;
  }

  isAllowed(toolName: string | undefined | null): boolean {
    if (!toolName) return false;
    const manifest = this.ensureLoaded();
    return manifest.allowedTools.includes(toolName);
  }

  isMutating(toolName: string | undefined | null): boolean {
    if (!toolName) return false;
    const manifest = this.ensureLoaded();
    return manifest.mutatingTools.includes(toolName);
  }

  isWorkstationSafe(toolName: string | undefined | null): boolean {
    if (!toolName) return false;
    const manifest = this.ensureLoaded();
    return manifest.workstationSafeTools.includes(toolName);
  }

  getCached(): ToolManifest {
    return this.ensureLoaded();
  }

  private ensureLoaded(): ToolManifest {
    if (this.cached) return this.cached;
    return this.load();
  }
}

export function validateToolManifest(
  value: unknown,
  sourcePath: string,
): ToolManifest {
  if (!value || typeof value !== "object") {
    throw new Error(`Tool manifest at ${sourcePath} is not an object.`);
  }

  const record = value as Record<string, unknown>;

  const requireString = (field: string): string => {
    const v = record[field];
    if (typeof v !== "string" || v.length === 0) {
      throw new Error(
        `Tool manifest at ${sourcePath} is missing required string field "${field}".`,
      );
    }
    return v;
  };

  const requireStringArray = (field: string): string[] => {
    const v = record[field];
    if (!Array.isArray(v) || v.some((entry) => typeof entry !== "string")) {
      throw new Error(
        `Tool manifest at ${sourcePath} field "${field}" must be an array of strings.`,
      );
    }
    return v as string[];
  };

  const allowedTools = requireStringArray("allowedTools");
  const mutatingTools = requireStringArray("mutatingTools");
  const workstationSafeTools = requireStringArray("workstationSafeTools");

  const seen = new Set<string>();
  for (const name of allowedTools) {
    if (seen.has(name)) {
      throw new Error(
        `Tool manifest at ${sourcePath} has duplicate entry "${name}" in allowedTools.`,
      );
    }
    seen.add(name);
  }

  for (const name of mutatingTools) {
    if (!allowedTools.includes(name)) {
      throw new Error(
        `Tool manifest at ${sourcePath} lists "${name}" in mutatingTools but it is not in allowedTools.`,
      );
    }
  }

  return {
    manifestId: requireString("manifestId"),
    schemaVersion: requireString("schemaVersion"),
    issuedAt: requireString("issuedAt"),
    allowedTools,
    mutatingTools,
    workstationSafeTools,
    quarantine: Array.isArray(record.quarantine)
      ? (record.quarantine as unknown[]).filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
  };
}

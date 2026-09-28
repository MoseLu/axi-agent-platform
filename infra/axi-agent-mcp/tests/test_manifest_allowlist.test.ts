/**
 * Tests for the server-side tool allowlist middleware.
 *
 * Phase 1 commit 5 of the Axi Agent governance rollout.
 *
 *   * manifest.isAllowed / isMutating 行为
 *   * manifest.json 缺失时的失败语义
 *   * 通过 JSON-RPC over stdio 调用未注册工具会被拒绝（code=-32601）
 *   * mutating 工具在缺少 capability_id 时被拒绝（code=-32602）
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ToolManifestLoader,
  validateToolManifest,
} from "../src/manifest.js";

const REPO_ROOT = join(import.meta.dirname, "..");

describe("ToolManifestLoader", () => {
  it("allows every name listed in manifest.allowedTools", () => {
    const loader = new ToolManifestLoader({
      manifestPath: join(REPO_ROOT, "manifest.json"),
    });
    loader.load();

    expect(loader.isAllowed("swarm_chat")).toBe(true);
    expect(loader.isAllowed("swarm_write_file")).toBe(true);
    expect(loader.isAllowed("swarm_modify_file")).toBe(true);
  });

  it("rejects tool names that are not in manifest.allowedTools", () => {
    const loader = new ToolManifestLoader({
      manifestPath: join(REPO_ROOT, "manifest.json"),
    });
    loader.load();

    expect(loader.isAllowed("swarm_some_unregistered_tool")).toBe(false);
    expect(loader.isAllowed("swarm_get_stats")).toBe(false);
    expect(loader.isAllowed("swarm_execute_workflow")).toBe(false);
    expect(loader.isAllowed("")).toBe(false);
  });

  it("classifies mutating tools vs read-mostly tools", () => {
    const loader = new ToolManifestLoader({
      manifestPath: join(REPO_ROOT, "manifest.json"),
    });
    loader.load();

    expect(loader.isMutating("swarm_write_file")).toBe(true);
    expect(loader.isMutating("swarm_modify_file")).toBe(true);
    expect(loader.isMutating("swarm_git_commit")).toBe(true);
    expect(loader.isMutating("swarm_git_create_branch")).toBe(true);
    expect(loader.isMutating("swarm_autofix_lint")).toBe(true);
    expect(loader.isMutating("swarm_vector_upsert")).toBe(true);

    expect(loader.isMutating("swarm_chat")).toBe(false);
    expect(loader.isMutating("swarm_git_status")).toBe(false);
    expect(loader.isMutating("swarm_validate_with_gates")).toBe(false);
    expect(loader.isMutating("swarm_run_test")).toBe(false);
  });

  it("fails loudly when manifest.json is missing", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "axi-agent-mcp-manifest-"));
    const missingPath = join(tmpDir, "does-not-exist.json");
    const loader = new ToolManifestLoader({ manifestPath: missingPath });

    expect(() => loader.load()).toThrow();
    expect(() => loader.isAllowed("swarm_chat")).toThrow();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rejects manifests whose mutating tools are not also allowed", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "axi-agent-mcp-manifest-"));
    const manifestPath = join(tmpDir, "manifest.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        manifestId: "test",
        schemaVersion: "tool-manifest/v1",
        issuedAt: "2026-09-29T00:00:00Z",
        allowedTools: ["swarm_chat"],
        mutatingTools: ["swarm_write_file"],
        workstationSafeTools: [],
      }),
      "utf8",
    );

    const loader = new ToolManifestLoader({ manifestPath });
    expect(() => loader.load()).toThrow(/mutatingTools/);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("validates parsed manifest payloads through validateToolManifest()", () => {
    const ok = validateToolManifest(
      {
        manifestId: "x",
        schemaVersion: "tool-manifest/v1",
        issuedAt: "2026-09-29T00:00:00Z",
        allowedTools: ["swarm_chat"],
        mutatingTools: [],
        workstationSafeTools: [],
      },
      "<inline>",
    );
    expect(ok.allowedTools).toEqual(["swarm_chat"]);

    expect(() =>
      validateToolManifest(
        { allowedTools: ["a", "a"], mutatingTools: [], workstationSafeTools: [] },
        "<inline>",
      ),
    ).toThrow(/duplicate/);

    expect(() => validateToolManifest(null, "<inline>")).toThrow();
  });
});

/**
 * Live JSON-RPC integration check.
 *
 * Spawns the actual MCP server in stdio mode and sends a `tools/call`
 * request for a tool that is NOT in the allowlist. The server MUST
 * respond with a JSON-RPC error whose `error.code === -32601` and
 * `error.data.reasonCode === "deny_unregistered_tool"`.
 *
 * The same flow is repeated for a mutating tool without `capability_id`
 * to confirm we get `error.code === -32602`.
 */
describe("axi-agent-mcp tools/call allowlist middleware", () => {
  let transport: ReturnType<typeof spawnServer>;

  beforeAll(async () => {
    transport = spawnServer();
    // Give the server a moment to register tools.
    await delay(150);
  }, 20_000);

  afterAll(async () => {
    if (transport) {
      await transport.stop();
    }
  }, 10_000);

  it("rejects tools/call for unallowlisted tools with JSON-RPC -32601", async () => {
    const response = await transport.request({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "swarm_get_stats",
        arguments: {},
      },
    });
    expect(response.id).toBe(1);
    expect(response.error).toBeDefined();
    expect(response.error?.code).toBe(-32601);
    expect(response.error?.data).toMatchObject({
      reasonCode: "deny_unregistered_tool",
      toolName: "swarm_get_stats",
    });
  });

  it("rejects mutating tools without capability_id with JSON-RPC -32602", async () => {
    const response = await transport.request({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "swarm_write_file",
        arguments: { path: "/tmp/x", content: "x" },
      },
    });
    expect(response.id).toBe(2);
    expect(response.error).toBeDefined();
    expect(response.error?.code).toBe(-32602);
    expect(response.error?.data).toMatchObject({
      reasonCode: "deny_unregistered_tool",
      toolName: "swarm_write_file",
    });
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface RunningServer {
  request(payload: Record<string, unknown>): Promise<McpResponse>;
  stop(): Promise<void>;
}

interface McpResponse {
  id?: number | string | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: { reasonCode?: string; toolName?: string };
  };
}

function spawnServer(): RunningServer {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { spawn } = require("node:child_process") as typeof import("node:child_process");
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "src/index.ts"],
    {
      cwd: REPO_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" },
    },
  );

  let buffer = "";
  const pending = new Map<
    number | string,
    { resolve: (value: McpResponse) => void; reject: (error: Error) => void }
  >();
  let nextId = 0;

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        try {
          const parsed = JSON.parse(line) as McpResponse;
          if (
            parsed.id !== undefined &&
            pending.has(parsed.id)
          ) {
            const entry = pending.get(parsed.id)!;
            pending.delete(parsed.id);
            entry.resolve(parsed);
          }
        } catch {
          // ignore non-JSON noise (e.g. framework banner)
        }
      }
      newlineIndex = buffer.indexOf("\n");
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", () => {
    // Swallow stderr for the test process; tests assert via JSON-RPC responses.
  });

  const request = (payload: Record<string, unknown>): Promise<McpResponse> => {
    const id = payload.id ?? ++nextId;
    const message = { ...payload, id };
    return new Promise<McpResponse>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify(message) + "\n", (error) => {
        if (error) {
          pending.delete(id);
          reject(error);
        }
      });
    });
  };

  const stop = (): Promise<void> => {
    return new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
        resolve();
      }, 1_500);
    });
  };

  return { request, stop };
}

import fs from "node:fs";
import path from "node:path";
import { DEFAULT_PROJECTS_ROOT } from "./manager-core.mjs";

export function resolveWorkdir({ config, job }) {
  const requested = job.project?.path || job.workdir || DEFAULT_PROJECTS_ROOT;
  const absolute = path.resolve(String(requested));
  if (!absolute.startsWith(DEFAULT_PROJECTS_ROOT)) {
    throw new Error(`项目路径必须位于 ${DEFAULT_PROJECTS_ROOT}`);
  }
  if (!config.allowedWorkdirs.some((root) => absolute === root || absolute.startsWith(`${root}/`))) {
    throw new Error("项目路径不在本机 Codex bridge allowlist 中");
  }
  fs.mkdirSync(absolute, { recursive: true });
  return absolute;
}

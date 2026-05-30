import fs from "node:fs";
import { sanitizeLogText } from "./manager-core.mjs";

export function formatCodexCliFailure(code, stderr = "") {
  const sanitized = sanitizeLogText(String(stderr || ""));
  const lower = sanitized.toLowerCase();
  const prefix = `Codex CLI exited with ${code}`;
  if (/"has_credits"\s*:\s*false/.test(lower) || lower.includes("insufficient_quota")) {
    return `${prefix}: Codex 账号额度不足，请等待额度恢复或切换可用账号后重试。`;
  }
  if (lower.includes("rate_limit") || lower.includes("rate limit") || lower.includes("429")) {
    return `${prefix}: Codex 账号触发限流，请稍后重试或切换账号。`;
  }
  if (lower.includes("no such file or directory") && lower.includes("node")) {
    return `${prefix}: 本机 Node.js 运行环境不可用。`;
  }
  if (lower.includes("unauthorized") || lower.includes("invalid token")) {
    return `${prefix}: Codex 账号认证失效，请在 Cockpit Tools 中刷新账号。`;
  }
  return `${prefix}: 本地 Codex 执行失败，详情已保存在本机任务记录。`;
}

export function shouldRetryCodexAccountFailure(message) {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("额度不足") ||
    text.includes("has_credits") ||
    text.includes("insufficient_quota") ||
    text.includes("触发限流") ||
    text.includes("rate_limit") ||
    text.includes("rate limit") ||
    text.includes("429")
  );
}

export function formatContextBundleForPrompt(
  bundle,
  { maxChars = 5000, maxContentChars = 700, maxDocuments = 8 } = {},
) {
  if (!bundle) {
    return "No Hermes context bundle was provided.";
  }
  const docs = extractContextDocuments(bundle).slice(0, maxDocuments);
  const lines = [
    "Hermes supplied these bounded knowledge sources. Use paths and hashes as evidence; do not quote long source text.",
  ];
  for (const [index, doc] of docs.entries()) {
    const sourcePath = String(doc.path || doc.source_path || doc.file || `source-${index + 1}`);
    const title = String(doc.title || doc.name || sourcePath);
    const hash = doc.sha256 || doc.hash ? ` sha256=${String(doc.sha256 || doc.hash).slice(0, 16)}` : "";
    const excerpt = cleanExcerpt(doc.content || doc.text || doc.excerpt || "", maxContentChars);
    lines.push(`- ${title} (${sourcePath})${hash}`);
    if (excerpt) {
      lines.push(`  excerpt: ${excerpt}`);
    }
  }
  if (!docs.length) {
    lines.push(`- Bundle keys: ${Object.keys(bundle || {}).slice(0, 12).join(", ") || "none"}`);
  }
  const output = lines.join("\n");
  return output.length > maxChars ? `${output.slice(0, maxChars - 20)}\n...[context truncated]` : output;
}

export function readLastMessage(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8").trim() || "Codex CLI 已完成，但未返回可读消息。";
  } catch {
    return "Codex CLI 已完成，但未返回可读消息。";
  }
}

export function summarizeReply(reply) {
  const lines = String(reply || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.slice(0, 12).join("\n").slice(0, 1600);
}

function extractContextDocuments(value) {
  if (Array.isArray(value)) {
    return value.flatMap(extractContextDocuments);
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  const direct = [];
  if (value.path || value.source_path || value.file || value.content || value.text || value.excerpt) {
    direct.push(value);
  }
  for (const key of ["documents", "sources", "items", "rules", "snippets"]) {
    direct.push(...extractContextDocuments(value[key]));
  }
  return direct;
}

function cleanExcerpt(value, maxChars) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer ***")
    .trim();
  if (!text) {
    return "";
  }
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}...` : text;
}

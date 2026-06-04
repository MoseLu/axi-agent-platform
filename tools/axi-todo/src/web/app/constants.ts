import type { AxiTagType } from "@axi/core";
import type { AxiTaskStatus } from "../native";
import type { ExportFormat } from "./types";

export const workspaceRoot = "/Volumes/code/workspace";
export const draftPrompt = "待填写";

export const statusOptions = [
  { color: "blue", label: "待处理", value: "pending" },
  { color: "gold", label: "运行中", value: "running" },
  { color: "green", label: "已完成", value: "completed" },
  { color: "red", label: "失败", value: "failed" },
  { color: "purple", label: "存疑", value: "blocked" },
  { color: "info", label: "已取消", value: "cancelled" },
] satisfies Array<{ color: AxiTagType; label: string; value: AxiTaskStatus }>;

export const exportFormatOptions = [
  { label: "Markdown", value: "markdown" },
  { label: "JSON", value: "json" },
] satisfies Array<{ label: string; value: ExportFormat }>;

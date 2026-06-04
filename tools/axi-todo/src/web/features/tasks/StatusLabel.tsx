import { AxiTag } from "@axi/core";
import { statusOptions } from "../../app/constants";
import type { AxiTaskStatus } from "../../native";

export function StatusLabel({ status }: { status: AxiTaskStatus }) {
  const option = statusOptions.find((item) => item.value === status) || statusOptions[0];
  return (
    <AxiTag className="todo-status-chip" effect="light" round type={option.color}>
      <span className="todo-status-dot" />
      {option.label}
    </AxiTag>
  );
}

import { AxiSettingsCompactRow, AxiSettingsPanel, AxiSettingsSection, AxiSettingsThemeSection } from "@axi/settings";

export function TodoSettingsPanel({
  compact,
  open,
  preference,
  projectLabel,
  taskCount,
  totalTaskCount,
  workspaceProjectSummary,
  onCompactChange,
  onOpenChange,
  onPreferenceChange,
}: {
  compact: boolean;
  open: boolean;
  preference: Parameters<typeof AxiSettingsThemeSection>[0]["value"];
  projectLabel: string;
  taskCount: number;
  totalTaskCount: number;
  workspaceProjectSummary?: { label: string; count: number }[];
  onCompactChange: (value: boolean) => void;
  onOpenChange: (value: boolean) => void;
  onPreferenceChange: Parameters<typeof AxiSettingsThemeSection>[0]["onChange"];
}) {
  return (
    <AxiSettingsPanel
      className="todo-settings-panel"
      labels={{ title: "设置" }}
      open={open}
      onOpenChange={onOpenChange}
    >
      <AxiSettingsThemeSection
        labels={{ theme: "主题" }}
        value={preference}
        onChange={onPreferenceChange}
      />
      <AxiSettingsCompactRow
        checked={compact}
        labels={{ compact: "紧凑密度" }}
        onChange={onCompactChange}
      />
      <AxiSettingsSection title="概览">
        <div className="todo-settings-summary">
          <span>当前项目</span>
          <strong>{projectLabel}</strong>
          <span>任务数量</span>
          <strong>{taskCount}/{totalTaskCount}</strong>
        </div>
      </AxiSettingsSection>
      {workspaceProjectSummary && workspaceProjectSummary.length > 0 && (
        <AxiSettingsSection title="工作区项目">
          <div className="todo-settings-summary">
            {workspaceProjectSummary.map((item) => (
              <div key={item.label} className="todo-settings-project-row">
                <span>{item.label}</span>
                <strong>{item.count}</strong>
              </div>
            ))}
          </div>
        </AxiSettingsSection>
      )}
    </AxiSettingsPanel>
  );
}

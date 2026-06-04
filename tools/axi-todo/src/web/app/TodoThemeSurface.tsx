import { ConfigProvider, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { createAxiAntdTheme, useAxiTheme } from "@axi/core";
import { useMemo, type ReactNode } from "react";

export function TodoThemeSurface({ children }: { children: ReactNode }) {
  const { mode, preset } = useAxiTheme();
  const antdTheme = useMemo(() => ({
    algorithm: mode === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
    ...createAxiAntdTheme(mode, preset, {
      borderRadius: 6,
      token: {
        fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      },
    }),
  }), [mode, preset]);

  return (
    <ConfigProvider button={{ autoInsertSpace: false }} locale={zhCN} theme={antdTheme}>
      {children}
    </ConfigProvider>
  );
}

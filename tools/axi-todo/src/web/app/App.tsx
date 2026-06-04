import { AxiThemeProvider } from "@axi/core";
import { TodoDashboard } from "../features/tasks/TodoDashboard";
import { TodoThemeSurface } from "./TodoThemeSurface";

export function AxiTodoApp() {
  return (
    <AxiThemeProvider defaultPreference="dark" storageNamespace="axi-todo-dashboard">
      <TodoThemeSurface>
        <TodoDashboard />
      </TodoThemeSurface>
    </AxiThemeProvider>
  );
}

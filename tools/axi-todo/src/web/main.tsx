import "antd/dist/reset.css";
import "@axi/tokens/css";
import "@axi/core/styles.css";
import "@axi/widgets/styles.css";
import "@axi/shell/styles.css";
import "@axi/crud/styles.css";
import "@axi/settings/styles.css";
import "./app/styles.css";
import "./features/tasks/styles.css";
import "./features/todo-items/styles.css";

import React from "react";
import { createRoot } from "react-dom/client";
import { AxiTodoApp } from "./app/App";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AxiTodoApp />
  </React.StrictMode>,
);

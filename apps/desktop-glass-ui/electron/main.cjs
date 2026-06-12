const { app, BrowserWindow } = require("electron");
const path = require("node:path");

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1380,
    height: 812,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: "#00000000",
    transparent: true,
    frame: false,
    hasShadow: true,
    title: "Axi Agent Platform",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.platform === "darwin") {
    mainWindow.setVibrancy("under-window");
  }

  mainWindow.loadFile(path.join(__dirname, "../dist/index.html"), {
    query: { shell: "mac" },
  });
};

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

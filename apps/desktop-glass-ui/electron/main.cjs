const { app, BrowserWindow, screen } = require("electron");
const path = require("node:path");

const createWindow = () => {
  const { width: workWidth, height: workHeight } =
    screen.getPrimaryDisplay().workAreaSize;
  const width = Math.max(960, Math.min(1380, Math.round(workWidth * 0.86)));
  const height = Math.max(620, Math.min(812, Math.round(workHeight * 0.84)));

  const mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 960,
    minHeight: 620,
    center: true,
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

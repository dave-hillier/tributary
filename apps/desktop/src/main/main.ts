import { app, BrowserWindow, ipcMain } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StubWorkspaceService } from './workspace-service.js';

const here = dirname(fileURLToPath(import.meta.url));
const service = new StubWorkspaceService();

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(here, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(here, '../renderer-bundle/index.html'));
  }
}

app.whenReady().then(() => {
  ipcMain.handle('workspace:getDocument', (_evt, id: string) => service.readDocument(id));
  ipcMain.handle('workspace:listDocuments', () => service.listDocuments());

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

import { app, BrowserWindow, ipcMain } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkspaceService } from './workspace-service.js';
import type { Document } from '@tributary/api';

const here = dirname(fileURLToPath(import.meta.url));
const service = new WorkspaceService();

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

app.whenReady().then(async () => {
  try {
    await service.openDemo();
  } catch (err) {
    console.error('failed to open demo workspace', err);
  }

  ipcMain.handle('workspace:getDocument', (_evt, id: string) => service.getDocument(id));
  ipcMain.handle('workspace:listDocuments', () => service.listDocuments());
  ipcMain.handle('workspace:saveDocument', (_evt, doc: Document, message?: string) => service.saveDocument(doc, message));
  ipcMain.handle('workspace:history', (_evt, id: string) => service.history(id));
  ipcMain.handle('workspace:resolveLink', (_evt, target: string) => service.resolveLink(target));
  ipcMain.handle('workspace:search', (_evt, query: string) => service.search(query));

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
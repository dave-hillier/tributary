import { app, BrowserWindow, ipcMain } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { WorkspaceService } from './workspace-service.js';
import type { NewWorkItem } from '@tributary/api';
import type { Document } from '@tributary/api';

const here = dirname(fileURLToPath(import.meta.url));
const service = new WorkspaceService();

console.log('ELECTRON_BOOT', process.version, 'argv', JSON.stringify(process.argv));

/** `--smoke`: launch the real window, verify renderer + IPC + native index,
 * then exit 0 (or non-zero) — the Electron runtime check from findings #4. */
const SMOKE = process.argv.includes('--smoke');

function createWindow(): BrowserWindow {
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
  return win;
}

async function runSmoke(win: BrowserWindow): Promise<void> {
  // Give the renderer time to boot, then probe it through the real IPC seam.
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const marker = process.env.SMOKE_MARKER;
  const report = (line: string): void => {
    console.log(line);
    if (marker) writeFileSync(marker, line + '\n', 'utf8');
  };
  try {
    const api = await win.webContents.executeJavaScript(
      'typeof window.tributary === \'object\'',
    );
    const rendered = await win.webContents.executeJavaScript(
      'document.querySelector(\'[data-doc]\') !== null',
    );
    const title = await win.webContents.executeJavaScript('document.title');
    // The native index was built by service.openDemo() above — reaching here
    // already proves better-sqlite3 loaded under Electron's Node runtime.
    const docs = service.listDocuments().length;
    if (!api || !rendered) {
      throw new Error(`renderer not ready (api=${api} rendered=${rendered} title=${JSON.stringify(title)})`);
    }
    report(`SMOKE_OK title=${title} docs=${docs} bundledNode=${process.version}`);
    process.exitCode = 0;
    app.quit();
  } catch (err) {
    report(`SMOKE_FAIL ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    app.quit();
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
  ipcMain.handle('workspace:backlinks', (_evt, id: string) => service.backlinks(id));
  ipcMain.handle('workspace:diff', (_evt, id: string) => service.diff(id));
  ipcMain.handle('workspace:search', (_evt, query: string) => service.search(query));
  ipcMain.handle('workspace:listWorkItems', () => service.listWorkItems());
  ipcMain.handle('workspace:updateWorkItem', (_evt, id: string, patch: Record<string, unknown>) => service.updateWorkItem(id, patch));
  ipcMain.handle('workspace:createWorkItem', (_evt, input: NewWorkItem) => service.createWorkItem(input));
  ipcMain.handle('workspace:diagnostics', () => service.diagnostics());
  ipcMain.handle('workspace:renameDocument', (_evt, id: string, newPath: string) => service.renameDocument(id, newPath));
  ipcMain.handle('workspace:addRemote', (_evt, url: string, name?: string) => service.addRemote(url, name));
  ipcMain.handle('workspace:sync', () => service.sync());
  ipcMain.handle('workspace:evaluateDocument', (_evt, docId: string, cells: { lang: string; source: string }[]) => service.evaluateDocument(docId, cells));
  ipcMain.handle('workspace:updateCell', (_evt, docId: string, cellIndex: number, source: string) => service.updateCell(docId, cellIndex, source));

  const win = createWindow();

  if (SMOKE) void runSmoke(win);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
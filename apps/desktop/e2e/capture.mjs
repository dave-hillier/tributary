import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { WorkspaceService } from '../dist/main/workspace-service.js';
import { createDemoWorkspace } from '@tributary/workspace';

const here = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(here, '../dist/renderer-bundle');
const OUT = join(here, 'captures');
mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

// --- static server for the built renderer ---
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let p = join(BUNDLE, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
  try {
    const data = readFileSync(p);
    res.setHeader('content-type', MIME[extname(p)] ?? 'application/octet-stream');
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end('not found');
  }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

// --- real workspace over a real temp git repo ---
const root = mkdtempSync(join(tmpdir(), 'tributary-cap-'));
await createDemoWorkspace(root);
const service = new WorkspaceService();
await service.open(root);

// --- browser + injected real service ---
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.exposeFunction('__getDocument', (id) => service.getDocument(id));
await context.exposeFunction('__listDocuments', () => service.listDocuments());
await context.exposeFunction('__saveDocument', (doc, msg) => service.saveDocument(doc, msg));
await context.exposeFunction('__history', (id) => service.history(id));
await context.exposeFunction('__resolveLink', (t) => service.resolveLink(t));
await context.exposeFunction('__search', (q) => service.search(q));
await context.exposeFunction('__listWorkItems', () => service.listWorkItems());
await context.exposeFunction('__updateWorkItem', (id, patch) => service.updateWorkItem(id, patch));
await context.exposeFunction('__createWorkItem', (input) => service.createWorkItem(input));
await context.addInitScript(() => {
  window.tributary = {
    getDocument: (id) => window.__getDocument(id),
    listDocuments: () => window.__listDocuments(),
    saveDocument: (doc, msg) => window.__saveDocument(doc, msg),
    history: (id) => window.__history(id),
    resolveLink: (t) => window.__resolveLink(t),
    search: (q) => window.__search(q),
    listWorkItems: () => window.__listWorkItems(),
    updateWorkItem: (id, patch) => window.__updateWorkItem(id, patch),
    createWorkItem: (input) => window.__createWorkItem(input),
  };
});

const page = await context.newPage();
await page.goto(`http://localhost:${port}/`);
await page.waitForSelector('h2', { timeout: 10000 });
await page.waitForTimeout(600);

async function shot(name) {
  await page.screenshot({ path: join(OUT, name + '.png'), fullPage: true });
  console.log('captured', name + '.png');
}

await shot('01-board');

await browser.close();
server.close();

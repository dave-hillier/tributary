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

const root = mkdtempSync(join(tmpdir(), 'tributary-cap-'));
await createDemoWorkspace(root);
const service = new WorkspaceService();
await service.open(root);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const expose = {
  getDocument: (id) => service.getDocument(id),
  listDocuments: () => service.listDocuments(),
  saveDocument: (doc, msg) => service.saveDocument(doc, msg),
  history: (id) => service.history(id),
  resolveLink: (t) => service.resolveLink(t),
  backlinks: (id) => service.backlinks(id),
  diff: (id) => service.diff(id),
  search: (q) => service.search(q),
  listWorkItems: () => service.listWorkItems(),
  updateWorkItem: (id, patch) => service.updateWorkItem(id, patch),
  createWorkItem: (input) => service.createWorkItem(input),
  renameDocument: (id, p) => service.renameDocument(id, p),
};
for (const [k, fn] of Object.entries(expose)) {
  await context.exposeFunction('__' + k, fn);
}
await context.addInitScript((keys) => {
  const api = {};
  for (const k of keys) api[k] = (...args) => window['__' + k](...args);
  window.tributary = api;
}, Object.keys(expose));

const page = await context.newPage();
await page.goto(`http://localhost:${port}/`);
await page.waitForSelector('h2', { timeout: 10000 });
await page.waitForTimeout(600);

let failed = false;
async function verify(text) {
  const count = await page.getByText(text).count();
  if (count > 0) console.log('verify ok: ' + text);
  else { console.error('VERIFY FAILED: ' + text); failed = true; }
}
async function shot(name) {
  await page.screenshot({ path: join(OUT, name + '.png'), fullPage: true });
  console.log('captured ' + name + '.png');
}

// 01 board baseline
await shot('01-board');
await verify('Ship the demo');

// 02 backlinks: load a work item and show what links to it
await page.getByRole('button', { name: 'Ship the demo' }).first().click();
await page.waitForTimeout(400);
await verify('Linked from');
await verify('Diff (last change)');
await shot('02-backlinks');

// 03 rename the same item; board still shows it by id
await page.getByPlaceholder('Rename to path (e.g. items/foo.md)').fill('items/ship-demo.md');
await page.getByRole('button', { name: 'Rename' }).click();
await page.waitForTimeout(600);
await shot('03-renamed');
await verify('Ship the demo');

// 04 board filters: status = done
await page.getByLabel('status filter').selectOption('done');
await page.waitForTimeout(400);
await shot('04-filtered');
await verify('Write tests');

await browser.close();
server.close();
if (failed) { console.error('CAPTURE VERIFY FAILURES'); process.exit(1); }
console.log('captures done');
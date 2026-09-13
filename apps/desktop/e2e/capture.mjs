import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
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
// a local bare remote for the sync capture
const bare = mkdtempSync(join(tmpdir(), 'tributary-bare-'));
execFileSync('git', ['init', '--bare', '-q', bare]);
await service.addRemote(bare);

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
  addRemote: (url, name) => service.addRemote(url, name),
  sync: () => service.sync(),
  evaluateDocument: (docId, cells) => service.evaluateDocument(docId, cells),
  updateCell: (docId, idx, source) => service.updateCell(docId, idx, source),
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
await page.waitForSelector('[data-doc] h1', { timeout: 10000 });
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

// 01 document (rendered) baseline
await verify('tributary');
await verify('Tributary Demo');
await shot('01-document');
const cells = await page.locator('figure[data-cell]').count();
if (cells === 4) console.log('verify ok: 4 cell figures');
else { console.error('VERIFY FAILED: expected 4 cells, got ' + cells); failed = true; }
await page.locator('strong', { hasText: 'Tributary renders TSX cells here' }).first().waitFor({ timeout: 5000 });
console.log('verify ok: tsx cell rendered as <strong>');

// 02 source pane (editor strip + checkpoint button)
await page.getByRole('button', { name: 'source' }).click();
await page.waitForTimeout(300);
await verify('source · index.md');
await verify('checkpoint ⌘S');
await shot('02-source');

// 03 diff pane
await page.getByRole('button', { name: 'diff' }).click();
await page.waitForTimeout(300);
await verify('working tree vs');
await shot('03-diff');

// 04 board + status change
await page.getByRole('button', { name: 'board', exact: true }).click();
await page.waitForTimeout(400);
await verify('work items · 2');
await shot('04-board');
const shipCard = page.locator('article', { hasText: 'Ship the demo' }).first();
await shipCard.locator('select').selectOption('done');
await page.waitForTimeout(400);
await shot('05-board-status-changed');

// 05 search
await page.locator('[data-search] input').fill('hello');
await page.locator('[data-search] input').press('Enter');
await page.waitForTimeout(400);
await verify('results · 1');
await shot('06-search');

// 06 cell editing (navigate to home, edit first cell, dependant re-evaluates)
await page.getByRole('button', { name: 'document', exact: true }).click();
await page.waitForTimeout(200);
await page.getByRole('button', { name: 'rendered', exact: true }).click();
await page.waitForTimeout(300);
const editButtons = await page.locator('figure[data-cell] button', { hasText: 'Edit cell' }).count();
if (editButtons === 4) console.log('verify ok: 4 Edit cell buttons');
else { console.error('VERIFY FAILED: expected 4 Edit cell buttons, got ' + editButtons); failed = true; }
await page.locator('figure[data-cell]').first().locator('button', { hasText: 'Edit cell' }).click();
await page.waitForTimeout(200);
await page.locator('figure[data-cell] textarea').first().fill('const greeting = "Updated greeting"');
await page.waitForTimeout(900);
await verify('Updated greeting');
await shot('07-cell-edit');
const persisted = service.getDocument('index').source;
if (persisted.includes('Updated greeting')) console.log('verify ok: cell edit persisted to .md');
else { console.error('VERIFY FAILED: cell edit not persisted'); failed = true; }

// 07 sync (fetch + push against the local remote)
await page.locator('[data-remote] button', { hasText: 'sync' }).click();
await page.waitForTimeout(800);
await verify('synced');
await shot('08-synced');

// 08 dark theme
await page.locator('[data-theme-toggle]').click();
await page.waitForTimeout(200);
const theme = await page.evaluate(() => document.documentElement.dataset.theme);
if (theme === 'dark') console.log('verify ok: dark theme');
else { console.error('VERIFY FAILED: expected dark theme, got ' + theme); failed = true; }
await shot('09-dark');

await browser.close();
server.close();
if (failed) { console.error('CAPTURE VERIFY FAILURES'); process.exit(1); }
console.log('captures done');

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { WorkspaceService } from '../dist/main/workspace-service.js';
import { createDemoWorkspace } from '@tributary/workspace';
import { PRELOAD_METHODS } from './preload-methods.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(here, '../dist/renderer-bundle');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

const root = mkdtempSync(join(tmpdir(), 'tributary-url-'));
await createDemoWorkspace(root);
const service = new WorkspaceService();
await service.open(root);

const METHODS = new Set(PRELOAD_METHODS);
const SHIM = "<script>window.tributary=new Proxy({},{get(_t,m){if(typeof m!=='string')return undefined;return(...a)=>fetch('/api/'+m,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(a)}).then(async r=>{if(!r.ok)throw new Error((await r.text())||r.statusText);return r.json();});}});</script>";

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const method = url.pathname.slice(5);
    if (!METHODS.has(method)) { res.statusCode = 404; res.end('unknown api'); return; }
    try {
      let body = '';
      for await (const chunk of req) body += chunk;
      const args = body ? JSON.parse(body) : [];
      const result = await service[method](...args);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(result ?? null));
    } catch (err) { res.statusCode = 500; res.end(String(err?.message ?? err)); }
    return;
  }
  const filePath = join(BUNDLE, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
  try {
    let data = readFileSync(filePath);
    if (url.pathname === '/' || url.pathname === '/index.html') data = Buffer.from(data.toString('utf8').replace('<script type="module"', SHIM + '<script type="module"'));
    res.setHeader('content-type', MIME[extname(filePath)] ?? 'application/octet-stream');
    res.end(data);
  } catch { res.statusCode = 404; res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = 'http://127.0.0.1:' + port + '/';

let failed = false;
function check(label, ok, extra = '') {
  console.log((ok ? 'PASS ' : 'FAIL ') + label + (extra ? ' — ' + extra : ''));
  if (!ok) failed = true;
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const hashOf = () => page.evaluate(() => location.hash);

try {
  await page.goto(base);
  await page.waitForSelector('[data-doc]', { timeout: 15000 });
  await page.waitForFunction(() => location.hash.startsWith('#/doc/'), { timeout: 5000 });
  check('initial URL carries the document path', (await hashOf()) === '#/doc/index.md', await hashOf());

  // Finding 5: cells reached through a transclusion evaluate (not stuck pending).
  const cellCount = await page.locator('figure[data-cell]').count();
  const pendingCells = await page.locator('figure[data-cell][data-status="pending"]').count();
  check('transcluded cells evaluate', cellCount === 5 && pendingCells === 0, 'cells=' + cellCount + ' pending=' + pendingCells);

  // A cell reached through a transclusion sits inside a click-to-edit block
  // (`![[notes/hello]]` parses as a paragraph). Clicking its Edit control must
  // open that cell's editor, not swap the enclosing paragraph for its own
  // editor — which would replace and destroy the embedded document.
  const embedded = page.locator('[data-transclusion-embed] figure[data-cell]').first();
  await embedded.locator('button.cell-edit-toggle').click();
  await page.waitForTimeout(400);
  check(
    'a control inside a transclusion does not destroy the embed',
    (await page.locator('[data-transclusion-embed]').count()) === 1 &&
      (await page.locator('[data-transclusion-embed] textarea.cell-editor').count()) === 1 &&
      (await page.locator('textarea.block-editor').count()) === 0,
    'embeds=' + (await page.locator('[data-transclusion-embed]').count()) +
      ' cellEditors=' + (await page.locator('textarea.cell-editor').count()) +
      ' blockEditors=' + (await page.locator('textarea.block-editor').count()),
  );
  await embedded.locator('button.cell-edit-toggle').click(); // close it again
  await page.waitForTimeout(200);

  // Notebook host lifecycle: leaving a document disposes its hosts, so coming
  // back must rebuild and re-evaluate them. A lost or double-disposed host shows
  // up here as cells stuck pending.
  await page.locator('[data-tree] a').filter({ hasText: 'Hello' }).first().click();
  await page.waitForFunction(() => location.hash.startsWith('#/doc/notes/hello'), { timeout: 5000 });
  await page.goto(base + '#/doc/index.md');
  await page.waitForSelector('[data-doc]', { timeout: 15000 });
  await page.waitForSelector('figure[data-cell]', { timeout: 8000 });
  const afterReturn = await page.locator('figure[data-cell]').count();
  const afterReturnPending = await page.locator('figure[data-cell][data-status="pending"]').count();
  check(
    'cells re-evaluate after leaving and returning',
    afterReturn === 5 && afterReturnPending === 0,
    'cells=' + afterReturn + ' pending=' + afterReturnPending,
  );

  // Stage 2 blocks render: a callout and a resolved query block.
  const callouts = await page.locator('[data-callout]').count();
  const queryHits = await page.locator('[data-query] a').count();
  check('callout + query blocks render', callouts >= 1 && queryHits >= 1, 'callouts=' + callouts + ' queryHits=' + queryHits);

  // Finding 7: the sidebar labels a project by its canonical type.
  const projectLabel = await page
    .locator('[data-tree] a')
    .filter({ hasText: 'Demo Project' })
    .locator('small[data-status]')
    .innerText();
  check('kindLabel reads the canonical type', projectLabel === 'project', projectLabel);

  await page.getByRole('button', { name: 'board', exact: true }).click();
  await page.waitForFunction(() => location.hash.startsWith('#/board'), { timeout: 5000 });
  check('board view in URL', (await hashOf()) === '#/board', await hashOf());

  await page.locator('select[aria-label="status filter"]').selectOption('doing');
  await page.waitForFunction(() => location.hash.includes('status=doing'), { timeout: 5000 });
  check('board filter in URL', (await hashOf()) === '#/board?status=doing', await hashOf());
  check('filter applied', (await page.locator('article[data-card]').count()) === 1);

  await page.locator('[data-tree] a').filter({ hasText: 'Hello' }).first().click();
  await page.waitForFunction(() => location.hash.startsWith('#/doc/'), { timeout: 5000 });
  check('sidebar navigation updates the document path', (await hashOf()) === '#/doc/notes/hello.md', await hashOf());

  // Finding 1: the debounced autosave persists the final keystroke.
  await page.getByRole('button', { name: 'source', exact: true }).click();
  await page.waitForSelector('.cm-content', { timeout: 8000 });
  await page.locator('.cm-content').click();
  await page.keyboard.press('Meta+A');
  await page.keyboard.type('# Hello\n\nAUTOSAVE-OK-Z');
  await page.waitForTimeout(2200);
  const saved = service.getDocument('notes/hello');
  check(
    'autosave persisted the final keystroke',
    !!saved && typeof saved.source === 'string' && saved.source.includes('AUTOSAVE-OK-Z'),
    saved && saved.source ? 'len=' + saved.source.length : 'missing',
  );

  // Fresh load on a filtered board URL: the filter must be restored from the URL.
  await page.goto(base + '#/board?status=doing&label=release');
  await page.reload();
  await page.waitForSelector('main[data-view="board"]', { timeout: 15000 });
  await page.waitForSelector('[data-board]', { timeout: 5000 });
  const statusValue = await page.locator('select[aria-label="status filter"]').inputValue();
  const labelValue = await page.locator('select[aria-label="label filter"]').inputValue();
  check('reload restores board filters', statusValue === 'doing' && labelValue === 'release', statusValue + '/' + labelValue);

  // Back/forward across a view + doc change.
  await page.goBack();
  await page.waitForTimeout(300);
  check('back leaves the filtered board URL', !(await hashOf()).includes('status=doing'), await hashOf());
} catch (err) {
  check('scenario ran without throwing', false, String(err));
} finally {
  await browser.close();
  server.close();
  rmSync(root, { recursive: true, force: true });
}
if (failed) { console.error('URL VERIFY FAILURES'); process.exit(1); }
console.log('url verification done');

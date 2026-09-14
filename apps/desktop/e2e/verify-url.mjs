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

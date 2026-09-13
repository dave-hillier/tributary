import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { WorkspaceService } from '../dist/main/workspace-service.js';
import { createDemoWorkspace } from '@tributary/workspace';

/**
 * Live browser preview of the Tributary renderer.
 *
 * The Electron shell normally injects `window.tributary` via its preload; this
 * server serves the built renderer bundle and injects an equivalent shim that
 * calls a real WorkspaceService over HTTP. Open the printed URL in a browser to
 * interact with the UI without launching Electron.
 */

const here = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(here, '../dist/renderer-bundle');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

// Fresh demo workspace + a local bare remote so sync works in the preview.
const root = mkdtempSync(join(tmpdir(), 'tributary-preview-'));
await createDemoWorkspace(root);
const service = new WorkspaceService();
await service.open(root);
const bare = mkdtempSync(join(tmpdir(), 'tributary-preview-bare-'));
execFileSync('git', ['init', '--bare', '-q', bare]);
await service.addRemote(bare);

// Allowed API surface (mirrors apps/desktop/src/preload.ts).
const METHODS = new Set([
  'getDocument', 'listDocuments', 'saveDocument', 'history', 'resolveLink',
  'backlinks', 'diff', 'search', 'listWorkItems', 'updateWorkItem',
  'createWorkItem', 'createProblem', 'diagnostics', 'renameDocument', 'addRemote',
  'sync', 'evaluateDocument',
  'updateCell',
]);

const SHIM = `<script>
window.tributary = new Proxy({}, {
  get(_t, method) {
    if (typeof method !== 'string') return undefined;
    return (...args) => fetch('/api/' + method, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(args),
    }).then(async (r) => {
      if (!r.ok) throw new Error((await r.text()) || r.statusText);
      return r.json();
    });
  }
});
</script>`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (pathname.startsWith('/api/')) {
    const method = pathname.slice('/api/'.length);
    if (!METHODS.has(method)) {
      res.statusCode = 404;
      res.end('unknown api method');
      return;
    }
    try {
      let body = '';
      for await (const chunk of req) body += chunk;
      const args = body ? JSON.parse(body) : [];
      const result = await service[method](...args);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(result ?? null));
    } catch (err) {
      res.statusCode = 500;
      res.end(String(err && err.message ? err.message : err));
    }
    return;
  }

  const filePath = join(BUNDLE, pathname === '/' ? 'index.html' : pathname.slice(1));
  try {
    let data = readFileSync(filePath);
    if (pathname === '/' || pathname === '/index.html') {
      data = Buffer.from(data.toString('utf8').replace('<script type="module"', SHIM + '<script type="module"'));
    }
    res.setHeader('content-type', MIME[extname(filePath)] ?? 'application/octet-stream');
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end('not found');
  }
});

const PORT = Number(process.env.PORT ?? 4173);
server.listen(PORT, '127.0.0.1', () => {
  console.log('Tributary preview running → http://127.0.0.1:' + server.address().port);
  console.log('(workspace root: ' + root + ')');
});

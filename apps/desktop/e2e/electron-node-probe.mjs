// Runs INSIDE Electron's bundled Node (v20.x, ELECTRON_RUN_AS_NODE=1).
// Proves the native binding + main-process imports load under Electron's
// runtime — the ABI-correctness half of findings #4, without needing a window.

import { writeFileSync } from 'node:fs';
import { SqliteIndex } from '@tributary/index';

const idx = new SqliteIndex(':memory:');
idx.rebuild([
  {
    id: 'a',
    path: 'a.md',
    frontmatter: { kind: 'work-item', status: 'todo' },
    root: {
      type: 'root',
      children: [{ type: 'paragraph', children: [{ type: 'text', value: 'alpha beta' }] }],
    },
  },
]);
const found = idx.search('beta').map((d) => d.id);
const items = idx.workItems().length;
idx.close();

const line =
  found.includes('a') && items === 1
    ? `ELECTRON_NODE_ABI_OK bundledNode=${process.version}`
    : `PROBE_UNEXPECTED ${JSON.stringify({ found, items })}`;
console.log(line);
// Robust handshake for piped stdout (electron-as-node buffers oddly): the
// runner asserts on this marker file, not on captured output.
const marker = process.env.SMOKE_MARKER;
if (marker) writeFileSync(marker, line + '\n');
if (!line.startsWith('ELECTRON_NODE_ABI_OK')) process.exit(1);
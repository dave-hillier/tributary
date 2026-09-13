import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createDemoWorkspace } from '@tributary/workspace';
import { buildIndex } from '@tributary/index';
import { DocumentView } from '@tributary/components';
import { WorkspaceService } from '../src/main/workspace-service.js';

describe('Stage 1 slice: the Git round-trip', () => {
  it('open -> index -> render -> edit -> checkpoint -> history -> rebuild', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tributary-e2e-'));
    try {
      await createDemoWorkspace(root);
      const service = new WorkspaceService();
      await service.open(root);

      // Home document parses and renders end-to-end.
      const home = service.getDocument('index');
      expect(home).toBeTruthy();
      const html = renderToString(createElement(DocumentView, { document: home! }));
      expect(html).toContain('data-replot');
      expect(html).toContain('data-transclusion');
      expect(html).toContain('notes/hello');

      // Wiki-link targets resolve against the derived index.
      expect(service.resolveLink('items/task-1')?.id).toBe('task-1');
      expect(service.resolveLink('notes/hello')?.id).toBe('notes/hello');

      // Edit -> checkpoint -> history.
      const hello = service.getDocument('notes/hello')!;
      const before = (await service.history('notes/hello')).length;
      hello.source = hello.source!.replace('A simple wiki document', 'A simple wiki document (edited)');
      const result = await service.saveDocument(hello, 'edit hello');
      expect(result.changed).toBe(true);
      expect(result.commit).toMatch(/^[0-9a-f]{40}$/);
      const hist = await service.history('notes/hello');
      expect(hist.length).toBe(before + 1);
      expect(hist[hist.length - 1].message).toBe('edit hello');

      // Full-text search over the SQLite+FTS5 index.
      expect(service.search('workspace').map((d) => d.id)).toContain('index');
      expect(service.search('Ship').map((d) => d.id)).toContain('task-1');

      // Derived state is disposable: rebuilding the index reproduces resolution.
      const rebuilt = buildIndex(service.listDocuments());
      expect(rebuilt.resolve('items/task-1')?.id).toBe('task-1');
      expect(rebuilt.resolve('notes/hello')?.id).toBe('notes/hello');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
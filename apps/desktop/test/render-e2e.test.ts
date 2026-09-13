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
      expect(html).toContain('language-tsx');
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

      // Diff view: the last commit's patch for the edited document.
      const diff = await service.diff('notes/hello');
      expect(diff).toContain('A simple wiki document (edited)');

      // Full-text search over the SQLite+FTS5 index.
      expect(service.search('workspace').map((d) => d.id)).toContain('index');
      expect(service.search('Ship').map((d) => d.id)).toContain('task-1');

      // Derived state is disposable: rebuilding the index reproduces resolution.
      const rebuilt = buildIndex(service.listDocuments());
      expect(rebuilt.resolve('items/task-1')?.id).toBe('task-1');
      expect(rebuilt.resolve('notes/hello')?.id).toBe('notes/hello');

      // Work-item board: projection, frontmatter update, and create with stable id.
      expect(service.listWorkItems().length).toBeGreaterThanOrEqual(2);
      expect(service.listWorkItems().find((w) => w.id === 'task-1')?.status).toBe('todo');

      const updated = await service.updateWorkItem('task-1', { status: 'done' });
      expect(updated.frontmatter.status).toBe('done');
      expect(service.listWorkItems().find((w) => w.id === 'task-1')?.status).toBe('done');

      const created = await service.createWorkItem({ title: 'New work item', assignee: 'carol' });
      expect(created.frontmatter.id).toBeTruthy();
      expect(created.frontmatter.kind).toBe('work-item');
      expect(created.frontmatter.assignee).toBe('carol');
      expect(service.listWorkItems().map((w) => w.id)).toContain(created.id);

      // Rename preserves id (board still shows the item by id).
      const renamed = await service.renameDocument('task-2', 'items/write-tests.md');
      expect(renamed.path).toBe('items/write-tests.md');
      expect(renamed.frontmatter.id).toBe('task-2');
      expect(service.listWorkItems().find((w) => w.id === 'task-2')?.title).toBe('Write tests');

      // Backlinks: which documents link to a given document.
      const inbound = service.backlinks('task-1').map((d) => d.id);
      expect(inbound).toContain('index');
      expect(inbound).toContain('notes/hello');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
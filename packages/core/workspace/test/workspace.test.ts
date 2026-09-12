import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace, deriveId } from '../src/index.js';
import { createDemoWorkspace } from '../src/seed.js';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'tributary-ws-'));
}

describe('deriveId', () => {
  it('prefers frontmatter id over path-derived id', () => {
    expect(deriveId('task-1', 'items/task-1.md')).toBe('task-1');
    expect(deriveId(undefined, 'notes/hello.md')).toBe('notes/hello');
  });
});

describe('Workspace (real temp Git repo)', () => {
  it('opens a repo, parses all markdown, and has no duplicate ids', async () => {
    const root = tempDir();
    try {
      const ws = await createDemoWorkspace(root);
      expect(ws.documents.length).toBe(5);
      expect(ws.duplicateIds).toEqual([]);
      expect(ws.getDocument('task-1')?.frontmatter.kind).toBe('work-item');
      expect(ws.getDocument('notes/hello')?.frontmatter.kind).toBe('wiki');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('detects duplicate ids across files', async () => {
    const root = tempDir();
    try {
      await createDemoWorkspace(root);
      writeFileSync(
        join(root, 'items/dupe.md'),
        '---\nid: task-1\ntitle: Duplicate\n---\n\n# Duplicate\n'
      );
      const ws = await Workspace.open(root);
      expect(ws.duplicateIds).toHaveLength(1);
      expect(ws.duplicateIds[0].id).toBe('task-1');
      expect(ws.duplicateIds[0].paths).toContain('items/task-1.md');
      expect(ws.duplicateIds[0].paths).toContain('items/dupe.md');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('save writes a checkpoint commit and history shows it', async () => {
    const root = tempDir();
    try {
      const ws = await createDemoWorkspace(root);
      const doc = ws.getDocument('notes/hello')!;
      const before = (await ws.history('notes/hello')).length; // seed commit only

      doc.source = doc.source!.replace('A simple wiki document', 'A simple wiki document (edited)');
      const { commit } = await ws.save(doc, 'edit hello');

      expect(commit).toMatch(/^[0-9a-f]{40}$/);
      const hist = await ws.history('notes/hello');
      expect(hist.length).toBe(before + 1);
      expect(hist[hist.length - 1].message).toBe('edit hello');
      expect(readFileSync(join(root, 'notes/hello.md'), 'utf8')).toContain('(edited)');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects directories that are not Git repositories', async () => {
    const root = tempDir();
    try {
      await expect(Workspace.open(root)).rejects.toThrow(/Not a Git repository/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

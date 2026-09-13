import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace, deriveId } from '../src/index.js';
import { createDemoWorkspace } from '../src/index.js';
import { git } from '../src/git.js';

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
      const result = await ws.save(doc, 'edit hello');

      expect(result.changed).toBe(true);
      expect(result.commit).toMatch(/^[0-9a-f]{40}$/);
      const hist = await ws.history('notes/hello');
      expect(hist.length).toBe(before + 1);
      expect(hist[hist.length - 1].message).toBe('edit hello');
      expect(readFileSync(join(root, 'notes/hello.md'), 'utf8')).toContain('(edited)');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('backfills the current id into frontmatter on save', async () => {
    const root = tempDir();
    try {
      const ws = await createDemoWorkspace(root);
      const doc = ws.getDocument('notes/hello')!;
      expect(doc.frontmatter.id).toBeUndefined();
      doc.source = doc.source!.replace('# Hello', '# Hello (edited)');
      await ws.save(doc, 'edit hello');
      const saved = ws.getDocument('notes/hello')!;
      expect(saved.frontmatter.id).toBe('notes/hello');
      expect(readFileSync(join(root, 'notes/hello.md'), 'utf8')).toContain('id: notes/hello');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('skips a commit when content is unchanged (no-op)', async () => {
    const root = tempDir();
    try {
      const ws = await createDemoWorkspace(root);
      const doc = ws.getDocument('task-1')!; // already has frontmatter.id, so no backfill
      const before = (await ws.history('task-1')).length;
      const result = await ws.save(doc, 'no-op');
      expect(result.changed).toBe(false);
      expect(result.commit).toBeNull();
      expect((await ws.history('task-1')).length).toBe(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('surfaces a merge conflict when the file changed externally', async () => {
    const root = tempDir();
    try {
      const ws = await createDemoWorkspace(root);
      const doc = ws.getDocument('notes/hello')!;
      // simulate an external concurrent edit + commit
      writeFileSync(join(root, 'notes/hello.md'), '---\ntitle: Hello\nkind: wiki\n---\n\n# External change\n');
      git(root, ['add', 'notes/hello.md']);
      git(root, ['commit', '-q', '-m', 'external change']);
      // saving the stale doc now merges (and conflicts here) instead of clobbering
      await expect(ws.save(doc, 'my edit')).rejects.toThrow(/Merge conflict/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns the last commit diff for a document', async () => {
    const root = tempDir();
    try {
      const ws = await createDemoWorkspace(root);
      const doc = ws.getDocument('notes/hello')!;
      doc.source = doc.source!.replace('# Hello', '# Hello (edited)');
      await ws.save(doc, 'edit hello');
      const diff = await ws.diff('notes/hello');
      expect(diff).toContain('+# Hello (edited)');
      expect(diff).toContain('-# Hello');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('renames a document and preserves its id', async () => {
    const root = tempDir();
    try {
      const ws = await createDemoWorkspace(root);
      const before = ws.getDocument('task-1')!;
      expect(before.path).toBe('items/task-1.md');
      await ws.rename('task-1', 'items/ship-demo.md');
      const after = ws.getDocument('task-1')!;
      expect(after.path).toBe('items/ship-demo.md');
      expect(after.frontmatter.id).toBe('task-1');
      expect(readFileSync(join(root, 'items/ship-demo.md'), 'utf8')).toContain('id: task-1');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('three-way merges non-overlapping concurrent edits', async () => {
    const root = tempDir();
    try {
      const ws = await createDemoWorkspace(root);
      const doc = ws.getDocument('notes/hello')!;
      // external edit to the title line
      writeFileSync(join(root, 'notes/hello.md'), doc.source!.replace('# Hello', '# Hello (theirs)'));
      git(root, ['add', 'notes/hello.md']);
      git(root, ['commit', '-q', '-m', 'external edit']);
      // ours edits a different (body) line
      doc.source = doc.source!.replace('A simple wiki document', 'A simple wiki document (ours)');
      const result = await ws.save(doc, 'our edit');
      expect(result.changed).toBe(true);
      const final = readFileSync(join(root, 'notes/hello.md'), 'utf8');
      expect(final).toContain('# Hello (theirs)');
      expect(final).toContain('A simple wiki document (ours)');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('surfaces a conflict on overlapping concurrent edits', async () => {
    const root = tempDir();
    try {
      const ws = await createDemoWorkspace(root);
      const doc = ws.getDocument('notes/hello')!;
      // external edit to the same heading line
      writeFileSync(join(root, 'notes/hello.md'), doc.source!.replace('# Hello', '# Hello (theirs)'));
      git(root, ['add', 'notes/hello.md']);
      git(root, ['commit', '-q', '-m', 'external edit']);
      // ours edits the same line
      doc.source = doc.source!.replace('# Hello', '# Hello (ours)');
      await expect(ws.save(doc, 'our edit')).rejects.toThrow(/Merge conflict/);
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
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { Workspace, deriveId, DEMO_FILES } from '../src/index.js';
import { createDemoWorkspace } from '../src/index.js';
import { git } from '../src/git.js';
import { parseMarkdown } from '@tributary/markdown';

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
      expect(ws.documents.length).toBe(Object.keys(DEMO_FILES).length);
      expect(ws.duplicateIds).toEqual([]);
      expect(ws.getDocument('task-1')?.frontmatter.type).toBe('work-item');
      expect(ws.getDocument('notes/hello')?.frontmatter.type).toBe('wiki');
      expect(ws.getDocument('problem-runtime-flakiness')?.frontmatter.type).toBe('problem');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports ontology diagnostics for the demo workspace without refusing it', async () => {
    const root = tempDir();
    try {
      const ws = await createDemoWorkspace(root);
      const diags = ws.diagnostics();
      // task-2 is deliberately legacy: `kind`, singular `assignee`, named
      // priority. All three are read, and all three are reported (ADR-005 §9).
      const forTask2 = diags.filter((d) => d.documentId === 'task-2');
      expect(forTask2.map((d) => d.key).sort()).toEqual(['assignee', 'kind', 'priority']);
      expect(forTask2.every((d) => d.severity === 'info')).toBe(true);
      // The document still opens and still carries its content.
      expect(ws.getDocument('task-2')?.frontmatter.title).toBe('Write tests');
      // The canonical item produces no diagnostics at all.
      expect(diags.filter((d) => d.documentId === 'task-1')).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('warns on an unresolvable project reference but still opens the document', async () => {
    const root = tempDir();
    try {
      const ws = await createDemoWorkspace(root);
      const path = join(root, 'items/task-3.md');
      writeFileSync(
        path,
        '---\nid: task-3\ntitle: Orphan\ntype: work-item\nstatus: todo\nproject: no-such-project\n---\n\n# Orphan\n',
        'utf8',
      );
      git(root, ['add', '--', 'items/task-3.md']);
      git(root, ['commit', '-q', '-m', 'add orphan item']);
      const reopened = await Workspace.open(root);
      const diag = reopened.diagnostics().find((d) => d.documentId === 'task-3' && d.key === 'project');
      expect(diag?.severity).toBe('warning');
      expect(reopened.getDocument('task-3')?.frontmatter.title).toBe('Orphan');
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

  it('push and clone against a local bare remote', async () => {
    const root = tempDir();
    const bare = mkdtempSync(join(tmpdir(), 'tributary-bare-'));
    const cloneDir = mkdtempSync(join(tmpdir(), 'tributary-clone-'));
    try {
      const ws = await createDemoWorkspace(root);
      git(dirname(bare), ['init', '--bare', '-q', bare]);
      await ws.addRemote('origin', bare);
      await ws.push('origin');
      await ws.fetch('origin');
      const ws2 = await Workspace.clone(bare, cloneDir);
      expect(ws2.documents.length).toBe(ws.documents.length);
      expect(ws2.getDocument('task-1')?.frontmatter.status).toBe('doing');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(bare, { recursive: true, force: true });
      rmSync(cloneDir, { recursive: true, force: true });
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
      expect(result.merged).toBe(true);
      // The merged document is returned so the caller can adopt it (finding 9).
      expect(result.document?.source).toContain('# Hello (theirs)');
      expect(result.document?.source).toContain('A simple wiki document (ours)');
      const final = readFileSync(join(root, 'notes/hello.md'), 'utf8');
      expect(final).toContain('# Hello (theirs)');
      expect(final).toContain('A simple wiki document (ours)');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('force-saves a user-resolved conflict without re-merging', async () => {
    const root = tempDir();
    try {
      const ws = await createDemoWorkspace(root);
      const doc = ws.getDocument('notes/hello')!;
      // External same-line edit → a conflicting save, then a resolved force-save.
      writeFileSync(join(root, 'notes/hello.md'), doc.source!.replace('# Hello', '# Hello (theirs)'));
      git(root, ['add', 'notes/hello.md']);
      git(root, ['commit', '-q', '-m', 'external edit']);
      doc.source = doc.source!.replace('# Hello', '# Hello (ours)');
      await expect(ws.save(doc, 'our edit')).rejects.toThrow(/Merge conflict/);
      doc.source = doc.source!.replace('# Hello (ours)', '# Hello (resolved)');
      const result = await ws.save(doc, 'resolve conflict', { force: true });
      expect(result.changed).toBe(true);
      expect(readFileSync(join(root, 'notes/hello.md'), 'utf8')).toContain('# Hello (resolved)');
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

  it('creates a revision-pinned worktree, commits on a branch and merges it (Stage 4)', async () => {
    const root = tempDir();
    const wtDir = mkdtempSync(join(tmpdir(), 'tributary-wt-'));
    try {
      const ws = await createDemoWorkspace(root);
      const rev = ws.revision();

      // Isolated worktree at the pinned revision, on a new branch.
      const wt = await ws.createWorktree(rev, join(wtDir, 'report'), 'jobs/weekly');
      expect(wt.documents.length).toBe(ws.documents.length);

      // Editing the MAIN checkout does not move the worktree's snapshot.
      const hello = ws.getDocument('notes/hello')!;
      hello.source = hello.source!.replace('# Hello', '# Hello (main edit)');
      await ws.save(hello, 'main edit');
      expect(wt.getDocument('notes/hello')!.source).toContain('# Hello');
      expect(wt.getDocument('notes/hello')!.source).not.toContain('main edit');

      // Commit a generated report on the branch, inside the worktree.
      const report = parseMarkdown('---\ntitle: Weekly\ntype: report\n---\n\n# Weekly\n', { path: 'reports/weekly.md' });
      await wt.save(report, 'generate weekly report');
      const tip = wt.revision();
      expect(tip).not.toBe(rev);

      // The branch is visible in the main checkout and reviewable as a diff.
      const diff = ws.diffBetween(rev, tip);
      expect(diff).toContain('reports/weekly.md');

      // Clean up the isolated worktree (the job's job), leaving the branch for
      // review, then accept: merge and delete the branch.
      ws.removeWorktree(join(wtDir, 'report'));
      await ws.merge('jobs/weekly');
      ws.deleteBranch('jobs/weekly');

      const reopened = await Workspace.open(root);
      expect(reopened.getDocument('reports/weekly')?.frontmatter.title).toBe('Weekly');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(wtDir, { recursive: true, force: true });
    }
  });
});
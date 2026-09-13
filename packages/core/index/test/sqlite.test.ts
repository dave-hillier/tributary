import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '@tributary/markdown';
import { formatRef } from '@tributary/ontology';
import { SqliteIndex } from '../src/sqlite.js';

const docs = [
  parseMarkdown('---\nkind: index\n---\n\n# Home\n\n- [[notes/hello|Hello]]\n- [[items/task-1]]\n', { path: 'index.md' }),
  parseMarkdown('---\nkind: wiki\n---\n\n# Hello\n\nLinks to [[items/task-1|task]] and mentions tributary. [[nowhere]]\n', { path: 'notes/hello.md' }),
  parseMarkdown('---\nid: task-1\nkind: work-item\nstatus: todo\nassignee: alice\ntitle: Ship the demo\n---\n\n# Task 1\n\nA work item body.\n', { path: 'items/task-1.md' }),
];

describe('SqliteIndex (better-sqlite3 + FTS5)', () => {
  it('resolves targets by id and path', () => {
    const idx = new SqliteIndex(':memory:');
    idx.rebuild(docs);
    expect(idx.resolve('notes/hello')?.id).toBe('notes/hello');
    expect(idx.resolve('items/task-1')?.id).toBe('task-1');
    expect(idx.resolve('task-1')?.id).toBe('task-1');
    expect(idx.resolve('nowhere')).toBeUndefined();
    idx.close();
  });

  it('builds links and backlinks', () => {
    const idx = new SqliteIndex(':memory:');
    idx.rebuild(docs);
    expect(idx.links('index').sort()).toEqual(['task-1', 'notes/hello'].sort());
    expect(idx.backlinks('task-1').sort()).toEqual(['index', 'notes/hello'].sort());
    idx.close();
  });

  it('projects work items from frontmatter, normalising legacy spellings', () => {
    const idx = new SqliteIndex(':memory:');
    idx.rebuild(docs);
    const items = idx.workItems();
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe('task-1');
    expect(items[0]!.assignees.map(formatRef)).toEqual(['user:alice']);
    expect(items[0]!.status).toBe('todo');
    idx.close();
  });

  it('round-trips the full ontology through SQLite (ADR-005)', () => {
    const idx = new SqliteIndex(':memory:');
    const corpus = [
      parseMarkdown('---\nid: proj\ntitle: Demo Project\ntype: project\naliases: [demo]\n---\n\n# Demo\n', {
        path: 'work/projects/demo.md',
      }),
      parseMarkdown(
        '---\nid: t1\ntitle: Ship\ntype: work-item\nstatus: doing\nassignees: [user:alice, user:carol]\npriority: 1\nproject: demo\nlabels: [release, demo]\ndue: 2026-09-30\n---\n\n# Ship\n',
        { path: 'items/t1.md' },
      ),
    ];
    idx.rebuild(corpus);
    const item = idx.workItems().find((w) => w.id === 't1')!;
    expect(item.assignees.map(formatRef)).toEqual(['user:alice', 'user:carol']);
    expect(item.priority).toBe(1);
    expect(item.labels.sort()).toEqual(['demo', 'release']);
    expect(item.due).toBe('2026-09-30');
    expect(item.projectId).toBe('proj');
    // The typed edge is queryable on its own, apart from prose links.
    expect(idx.links('t1', 'project')).toEqual(['proj']);
    expect(idx.backlinks('proj', 'project')).toEqual(['t1']);
    expect(idx.itemsInProject('proj').map((w) => w.id)).toEqual(['t1']);
    idx.close();
  });

  it('keeps project grouping when the project document is renamed', () => {
    const idx = new SqliteIndex(':memory:');
    const project = parseMarkdown('---\nid: proj\ntitle: Demo\ntype: project\naliases: [demo]\n---\n\n# Demo\n', {
      path: 'work/projects/demo.md',
    });
    const item = parseMarkdown('---\nid: t1\ntype: work-item\nproject: demo\n---\n\n# T\n', {
      path: 'items/t1.md',
    });
    idx.rebuild([{ ...project, path: 'work/projects/renamed.md' }, item]);
    expect(idx.itemsInProject('proj').map((w) => w.id)).toEqual(['t1']);
    idx.close();
  });

  it('full-text searches title + body (FTS5)', () => {
    const idx = new SqliteIndex(':memory:');
    idx.rebuild(docs);
    expect(idx.search('tributary').map((d) => d.id)).toContain('notes/hello');
    expect(idx.search('Ship').map((d) => d.id)).toContain('task-1');
    expect(idx.search('zzz-no-match')).toEqual([]);
    idx.close();
  });

  it('rebuild reproduces results (disposable derived state)', () => {
    const idx = new SqliteIndex(':memory:');
    idx.rebuild(docs);
    const before = idx.search('tributary').map((d) => d.id);
    const linksBefore = idx.links('index');
    idx.rebuild(docs);
    expect(idx.search('tributary').map((d) => d.id)).toEqual(before);
    expect(idx.links('index')).toEqual(linksBefore);
    idx.close();
  });

  it('ID-based resolution survives a rename (identity is the id, not the path)', () => {
    const idx = new SqliteIndex(':memory:');
    const renamed = docs.map((d) => (d.id === 'task-1' ? { ...d, path: 'items/renamed.md' } : d));
    idx.rebuild(renamed);
    // The new path resolves; the old path no longer does.
    expect(idx.resolve('items/renamed.md')?.id).toBe('task-1');
    expect(idx.resolve('items/task-1.md')).toBeUndefined();
    // The id itself still resolves, and the projection stays keyed on it.
    expect(idx.resolve('task-1')?.id).toBe('task-1');
    expect(idx.workItems().map((w) => w.id)).toContain('task-1');
    expect(idx.workItems().find((w) => w.id === 'task-1')?.path).toBe('items/renamed.md');
    idx.close();
  });

  it('the work-item projection reflects frontmatter after rebuild', () => {
    const idx = new SqliteIndex(':memory:');
    const updated = docs.map((d) =>
      d.id === 'task-1' ? { ...d, frontmatter: { ...d.frontmatter, status: 'done' } } : d,
    );
    idx.rebuild(updated);
    const items = idx.workItems();
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe('done');
    idx.close();
  });
});

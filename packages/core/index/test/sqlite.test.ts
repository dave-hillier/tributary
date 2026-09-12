import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '@tributary/markdown';
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

  it('projects work items from frontmatter', () => {
    const idx = new SqliteIndex(':memory:');
    idx.rebuild(docs);
    const items = idx.workItems();
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('task-1');
    expect(items[0].assignee).toBe('alice');
    expect(items[0].status).toBe('todo');
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
});

import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '@tributary/markdown';
import type { Document } from '@tributary/api';
import { buildIndex, collectTargets } from '../src/index.js';

function doc(id: string, path: string, source: string): Document {
  return parseMarkdown(source, { path });
}

const docs = [
  doc('index', 'index.md', '---\nkind: index\n---\n\n# Home\n\n- [[notes/hello|Hello]]\n- [[items/task-1]]\n'),
  doc('notes/hello', 'notes/hello.md', '---\nkind: wiki\n---\n\n# Hello\n\nLinks to [[items/task-1|task]] and a missing [[nowhere]].\n'),
  doc('task-1', 'items/task-1.md', '---\nid: task-1\nkind: work-item\nstatus: todo\nassignee: alice\n---\n\n# Task 1\n'),
];

describe('collectTargets', () => {
  it('collects wiki-link and transclusion targets', () => {
    const d = doc('x', 'x.md', 'See [[a]] and ![[b#sec]].\n');
    expect(collectTargets(d)).toEqual(['a', 'b']);
  });
});

describe('buildIndex', () => {
  it('resolves targets to documents by id and by path', () => {
    const idx = buildIndex(docs);
    expect(idx.resolve('notes/hello')?.id).toBe('notes/hello');
    expect(idx.resolve('notes/hello.md')?.id).toBe('notes/hello');
    expect(idx.resolve('task-1')?.id).toBe('task-1');
    expect(idx.resolve('nowhere')).toBeUndefined();
  });

  it('builds links and backlinks', () => {
    const idx = buildIndex(docs);
    expect(idx.links.get('index')?.sort()).toEqual(['task-1', 'notes/hello'].sort());
    expect(idx.backlinks.get('task-1')?.sort()).toEqual(['index', 'notes/hello'].sort());
    expect(idx.backlinks.get('notes/hello')).toEqual(['index']);
  });

  it('projects work items from frontmatter', () => {
    const idx = buildIndex(docs);
    expect(idx.workItems).toHaveLength(1);
    expect(idx.workItems[0].id).toBe('task-1');
    expect(idx.workItems[0].status).toBe('todo');
    expect(idx.workItems[0].assignee).toBe('alice');
  });

  it('rebuilds identically (derived state is disposable)', () => {
    const a = buildIndex(docs);
    const b = buildIndex(docs);
    expect([...b.links]).toEqual([...a.links]);
    expect([...b.backlinks]).toEqual([...a.backlinks]);
    expect(b.workItems).toEqual(a.workItems);
    expect(b.resolve('notes/hello')?.id).toBe(a.resolve('notes/hello')?.id);
  });
});
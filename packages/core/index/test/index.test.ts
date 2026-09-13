import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '@tributary/markdown';
import type { Document } from '@tributary/api';
import { buildIndex, collectTargets, findSection, headingText } from '../src/index.js';

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

describe('findSection (transclusion target#heading)', () => {
  const source = [
    '# Top',
    '',
    'intro',
    '',
    '## Alpha',
    '',
    'alpha body',
    '',
    '### Sub',
    '',
    'sub body',
    '',
    '## Beta',
    '',
    'beta body',
    '',
    '# End',
    '',
    'tail',
  ].join('\n');
  const d = doc('d', 'd.md', source + '\n');

  it('flattens heading text (inline markup ignored)', () => {
    const strong = doc('s', 's.md', '# Deploy *Status*\n');
    const h = strong.root.children.find((n) => n.type === 'heading')!;
    expect(headingText(h)).toBe('Deploy Status');
  });

  it('returns the heading plus siblings up to the next same-or-higher heading', () => {
    const slice = findSection(d, 'Alpha')!;
    const types = slice.map((n) => n.type);
    expect(types).toEqual(['heading', 'paragraph', 'heading', 'paragraph']);
    expect(slice[0]).toMatchObject({ depth: 2 });
  });

  it('stops a section at a HIGHER-level heading but includes deeper subsections', () => {
    const slice = findSection(d, 'Beta')!;
    const types = slice.map((n) => n.type);
    expect(types).toEqual(['heading', 'paragraph']);
  });

  it('includes nested subsections within a section', () => {
    const slice = findSection(d, 'Alpha')!;
    expect(slice.map((n) => n.type)).toContain('heading'); // '### Sub' heading included
    const sub = slice.find((n) => n.type === 'heading' && (n as { depth?: number }).depth === 3);
    expect(sub).toBeDefined();
  });

  it('is case-insensitive and trims', () => {
    expect(findSection(d, '  alpha ')).toBeDefined();
    expect(findSection(d, 'ALPHA')).toBeDefined();
  });

  it('returns undefined for a missing heading', () => {
    expect(findSection(d, 'Missing')).toBeUndefined();
  });

  it('does not match headings nested inside other blocks (top-level only)', () => {
    expect(findSection(d, 'Top')).toBeDefined();
  });
});
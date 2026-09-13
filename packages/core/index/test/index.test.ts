import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '@tributary/markdown';
import type { Document } from '@tributary/api';
import { formatRef } from '@tributary/ontology';
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

  it('projects work items from frontmatter, normalising the legacy spellings', () => {
    const idx = buildIndex(docs);
    expect(idx.workItems).toHaveLength(1);
    expect(idx.workItems[0]!.id).toBe('task-1');
    expect(idx.workItems[0]!.status).toBe('todo');
    // `kind:` + singular `assignee:` still project (ADR-005 tolerance).
    expect(idx.workItems[0]!.assignees.map(formatRef)).toEqual(['user:alice']);
  });

  it('resolves by alias and title, not only id and path (ADR-005 §7)', () => {
    const withAlias = [
      ...docs,
      doc('proj', 'work/projects/demo.md', '---\nid: proj\ntitle: Demo Project\ntype: project\naliases: [demo]\n---\n\n# Demo\n'),
    ];
    const idx = buildIndex(withAlias);
    expect(idx.resolve('demo')?.id).toBe('proj');
    expect(idx.resolve('Demo Project')?.id).toBe('proj');
  });

  it('records typed relations for frontmatter edges, distinct from prose links', () => {
    const corpus = [
      doc('proj', 'work/projects/demo.md', '---\nid: proj\ntitle: Demo\ntype: project\n---\n\n# Demo\n'),
      doc('t1', 'items/t1.md', '---\nid: t1\ntype: work-item\nproject: proj\nparent: t0\nblocks: [t2]\n---\n\nMentions [[work/projects/demo]] in prose too.\n'),
      doc('t0', 'items/t0.md', '---\nid: t0\ntype: work-item\n---\n\n# Parent\n'),
      doc('t2', 'items/t2.md', '---\nid: t2\ntype: work-item\n---\n\n# Blocked\n'),
    ];
    const idx = buildIndex(corpus);
    const kinds = (from: string, to: string): string[] =>
      idx.relations.filter((r) => r.from === from && r.to === to).map((r) => r.kind).sort();
    // The same pair carries both a prose mention and a typed project edge.
    expect(kinds('t1', 'proj')).toEqual(['link', 'project']);
    expect(kinds('t1', 't0')).toEqual(['parent']);
    expect(kinds('t1', 't2')).toEqual(['blocks']);
  });

  it('resolves a work item project reference to a document id', () => {
    const corpus = [
      doc('proj', 'work/projects/demo.md', '---\nid: proj\ntitle: Demo\ntype: project\naliases: [demo]\n---\n\n# Demo\n'),
      doc('t1', 'items/t1.md', '---\nid: t1\ntype: work-item\nproject: demo\n---\n\n# T\n'),
    ];
    const item = buildIndex(corpus).workItems[0]!;
    expect(item.project).toBe('demo');
    expect(item.projectId).toBe('proj');
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
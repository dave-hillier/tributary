import { describe, it, expect } from 'vitest';
import { parseMarkdown, stringifyMarkdown } from '../src/index.js';

/** Collect phrase-level nodes of a given type with their positions, in doc order. */
function collect(root: { children: Array<Record<string, unknown>> }, type: string) {
  const out: Array<Record<string, unknown>> = [];
  const walk = (node: Record<string, unknown>): void => {
    if (node.type === type) out.push(node);
    const children = node.children as Array<Record<string, unknown>> | undefined;
    if (children) for (const c of children) walk(c);
  };
  for (const c of root.children) walk(c);
  return out;
}

function paragraphChildren(doc: { root: { children: Array<{ children?: Array<{ type: string }> }> } }) {
  return doc.root.children[0].children ?? [];
}

describe('inline wiki links (micromark extension)', () => {
  it('parses `[[target|alias]]`', () => {
    const doc = parseMarkdown('See [[a|Alias]].\n', { path: 'x.md' });
    const wl = collect(doc.root, 'wikiLink')[0];
    expect(wl.target).toBe('a');
    expect(wl.alias).toBe('Alias');
  });

  it('keeps everything after the FIRST pipe as the alias (`[[a|b|c]]`)', () => {
    const doc = parseMarkdown('[[a|b|c]]\n', { path: 'x.md' });
    const wl = collect(doc.root, 'wikiLink')[0];
    expect(wl.target).toBe('a');
    expect(wl.alias).toBe('b|c');
  });

  it('round-trips a pipe inside the alias', () => {
    const doc = parseMarkdown('[[a|b|c]]\n', { path: 'x.md' });
    expect(stringifyMarkdown(doc)).toBe('[[a|b|c]]\n');
  });

  it('does not match an escaped `[` (`\\[[a]]` is text)', () => {
    const doc = parseMarkdown('\\[[a]]\n', { path: 'x.md' });
    expect(collect(doc.root, 'wikiLink')).toHaveLength(0);
    expect(paragraphChildren(doc).map((c) => c.type)).toEqual(['text']);
  });

  it('matches inside headings and adjacent to text', () => {
    const doc = parseMarkdown('# Heading [[a]] tail\n', { path: 'x.md' });
    expect(doc.root.children[0].type).toBe('heading');
    const wl = collect(doc.root, 'wikiLink')[0];
    expect(wl.target).toBe('a');
  });

  it('only matches on the same line (unclosed at line ending leaves text)', () => {
    const doc = parseMarkdown('[[a\nb]]\n', { path: 'x.md' });
    expect(collect(doc.root, 'wikiLink')).toHaveLength(0);
  });

  it('does not match inside code spans or fenced blocks', () => {
    const doc = parseMarkdown('`[[a]]`\n\n```ts\nconst x = "[[a]]"\n```\n', { path: 'x.md' });
    expect(collect(doc.root, 'wikiLink')).toHaveLength(0);
  });

  it('carries a position spanning the markers', () => {
    const doc = parseMarkdown('x [[a]] y\n', { path: 'x.md' });
    const wl = collect(doc.root, 'wikiLink')[0];
    const pos = wl.position as { start: { offset: number }; end: { offset: number } };
    expect(pos.start.offset).toBe(2);
    expect(pos.end.offset).toBe(7); // `[[a]]` is 5 chars: offsets 2..7
  });

  it('treats a lone `]` inside the target as text (`[[a]b]]` does not close)', () => {
    const doc = parseMarkdown('[[a]b]]\n', { path: 'x.md' });
    expect(collect(doc.root, 'wikiLink')).toHaveLength(0);
  });

  it('requires non-empty content (`[[]]` is text)', () => {
    const doc = parseMarkdown('[[]]\n', { path: 'x.md' });
    expect(collect(doc.root, 'wikiLink')).toHaveLength(0);
  });
});

describe('inline transclusions (micromark extension)', () => {
  it('parses `![[target#heading]]`', () => {
    const doc = parseMarkdown('![[b#sec]]\n', { path: 'x.md' });
    const tr = collect(doc.root, 'transclusion')[0];
    expect(tr.target).toBe('b');
    expect(tr.heading).toBe('sec');
  });

  it('treats `|` as part of the target in a transclusion', () => {
    const doc = parseMarkdown('![[b#sec|w]]\n', { path: 'x.md' });
    const tr = collect(doc.root, 'transclusion')[0];
    expect(tr.target).toBe('b');
    expect(tr.heading).toBe('sec|w');
  });

  it('does not treat `![a]` as a transclusion', () => {
    const doc = parseMarkdown('![a]\n', { path: 'x.md' });
    expect(collect(doc.root, 'transclusion')).toHaveLength(0);
  });

  it('does not treat an image `![alt](url)` as a transclusion', () => {
    const doc = parseMarkdown('![alt](https://example.com/x.png)\n', { path: 'x.md' });
    expect(collect(doc.root, 'transclusion')).toHaveLength(0);
  });

  it('parses plain `![[target]]` without heading', () => {
    const doc = parseMarkdown('x ![[b]] y\n', { path: 'x.md' });
    const tr = collect(doc.root, 'transclusion')[0];
    expect(tr.target).toBe('b');
    expect(tr.heading).toBeUndefined();
  });

  it('carries a position spanning the markers', () => {
    const doc = parseMarkdown('![[b#sec]]\n', { path: 'x.md' });
    const tr = collect(doc.root, 'transclusion')[0];
    const pos = tr.position as { start: { offset: number }; end: { offset: number } };
    expect(pos.start.offset).toBe(0);
    expect(pos.end.offset).toBe(10); // `![[b#sec]]` is 10 chars
  });

  it('round-trips `![[b#sec]]` verbatim', () => {
    const doc = parseMarkdown('x ![[b#sec]] y\n', { path: 'x.md' });
    expect(stringifyMarkdown(doc)).toBe('x ![[b#sec]] y\n');
  });
});
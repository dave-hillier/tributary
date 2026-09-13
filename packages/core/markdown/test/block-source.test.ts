import { describe, it, expect } from 'vitest';
import { parseMarkdown, nodeSource, replaceNodeSource } from '../src/index.js';
import type { Node } from '@tributary/api';

function walk(root: Node, type: string): Node[] {
  const out: Node[] = [];
  const visit = (n: Node): void => {
    if (n.type === type) out.push(n);
    if ('children' in n) for (const c of (n as { children: Node[] }).children) visit(c);
  };
  visit(root);
  return out;
}

const SRC = [
  '---',
  'title: T',
  'kind: wiki',
  '---',
  '',
  '# Hello',
  '',
  'First paragraph.',
  '',
  '- item one',
  '- item two',
  '',
].join('\n');

describe('nodeSource', () => {
  it('extracts a paragraph span from a source with frontmatter', () => {
    const doc = parseMarkdown(SRC, { path: 'x.md' });
    const para = walk(doc.root, 'paragraph')[0]!;
    expect(nodeSource(doc, para)).toBe('First paragraph.');
  });

  it('extracts a heading span including the # marker', () => {
    const doc = parseMarkdown(SRC, { path: 'x.md' });
    const heading = walk(doc.root, 'heading')[0]!;
    expect(nodeSource(doc, heading)).toBe('# Hello');
  });

  it('extracts a list item span including the bullet marker', () => {
    const doc = parseMarkdown(SRC, { path: 'x.md' });
    const item = walk(doc.root, 'listItem')[0]!;
    expect(nodeSource(doc, item)).toBe('- item one');
  });

  it('returns null when the document has no source', () => {
    const doc = parseMarkdown(SRC, { path: 'x.md' });
    doc.source = undefined;
    const para = walk(doc.root, 'paragraph')[0]!;
    expect(nodeSource(doc, para)).toBeNull();
  });

  it('returns null for a node with no position', () => {
    const doc = parseMarkdown(SRC, { path: 'x.md' });
    const synthetic: Node = { type: 'paragraph', children: [] };
    expect(nodeSource(doc, synthetic)).toBeNull();
  });
});

describe('replaceNodeSource', () => {
  it('replaces a paragraph and preserves frontmatter and other blocks', () => {
    const doc = parseMarkdown(SRC, { path: 'x.md' });
    const para = walk(doc.root, 'paragraph')[0]!;
    const updated = replaceNodeSource(doc, para, 'Rewritten body.');
    expect(updated).not.toBeNull();
    expect(updated!.source).toContain('title: T');
    expect(updated!.source).toContain('Rewritten body.');
    expect(updated!.source).not.toContain('First paragraph.');
    expect(updated!.source).toContain('# Hello');
    expect(updated!.source).toContain('- item one');
  });

  it('replaces a heading with a different depth', () => {
    const doc = parseMarkdown(SRC, { path: 'x.md' });
    const heading = walk(doc.root, 'heading')[0]!;
    const updated = replaceNodeSource(doc, heading, '## Changed title');
    const newHeading = walk(updated!.root, 'heading')[0] as { depth: number };
    expect(newHeading.depth).toBe(2);
    expect(updated!.source).toContain('## Changed title');
  });

  it('round-trips: the new source re-parses to the edited text', () => {
    const doc = parseMarkdown(SRC, { path: 'x.md' });
    const para = walk(doc.root, 'paragraph')[0]!;
    const updated = replaceNodeSource(doc, para, 'Now with **emphasis** and a [[link|alias]].');
    expect(updated).not.toBeNull();
    const text = updated!.source ?? '';
    expect(text).toContain('**emphasis**');
    expect(text).toContain('[[link|alias]]');
  });

  it('returns null when the span cannot be located', () => {
    const doc = parseMarkdown(SRC, { path: 'x.md' });
    const synthetic: Node = { type: 'paragraph', children: [] };
    expect(replaceNodeSource(doc, synthetic, 'x')).toBeNull();
  });
});

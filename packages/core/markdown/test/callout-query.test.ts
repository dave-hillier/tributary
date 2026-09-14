import { describe, it, expect } from 'vitest';
import { parseMarkdown, stringifyMarkdown } from '../src/index.js';

// Position fields differ between first parse and re-parse for custom nodes;
// round-trip equality is compared position-insensitively.
function stripPosition(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripPosition);
  if (value && typeof value === 'object') {
    const rest: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'position') continue;
      rest[k] = stripPosition(v);
    }
    return rest;
  }
  return value;
}

type AnyNode = { type: string; [key: string]: unknown };

describe('callout blocks', () => {
  it('parses a [!NOTE] blockquote into a callout and round-trips', () => {
    const doc = parseMarkdown('> [!NOTE]\n> Body text\n', { path: 'x.md' });
    const node = doc.root.children[0] as AnyNode;
    expect(node.type).toBe('callout');
    expect(node.kind).toBe('note');

    const paragraph = (node.children as AnyNode[])[0]!;
    const first = (paragraph.children as AnyNode[])[0]!;
    expect(paragraph.type).toBe('paragraph');
    expect(first.value).toBe('Body text');

    const out = stringifyMarkdown(doc);
    expect(out).toContain('> [!NOTE]');
    expect(out).toContain('> Body text');

    const doc2 = parseMarkdown(out, { path: 'x.md' });
    expect(stripPosition(doc2.root)).toEqual(stripPosition(doc.root));
  });

  it('accepts every kind case-insensitively', () => {
    const cases: Array<[string, string]> = [
      ['NOTE', 'note'],
      ['tip', 'tip'],
      ['Important', 'important'],
      ['WARNING', 'warning'],
      ['Caution', 'caution'],
    ];
    for (const [marker, kind] of cases) {
      const doc = parseMarkdown('> [!' + marker + ']\n> body\n', { path: 'x.md' });
      const node = doc.root.children[0] as AnyNode;
      expect(node.type).toBe('callout');
      expect(node.kind).toBe(kind);
    }
  });

  it('drops the marker paragraph when it holds only the marker', () => {
    const doc = parseMarkdown('> [!TIP]\n>\n> Body\n', { path: 'x.md' });
    const node = doc.root.children[0] as AnyNode;
    expect(node.type).toBe('callout');
    expect(node.kind).toBe('tip');
    const children = node.children as AnyNode[];
    expect(children).toHaveLength(1);
    expect(children[0]!.type).toBe('paragraph');
  });

  it('leaves a normal blockquote untouched', () => {
    const doc = parseMarkdown('> Just a quote\n', { path: 'x.md' });
    expect((doc.root.children[0] as AnyNode).type).toBe('blockquote');
  });

  it('leaves an unknown alert marker as a normal blockquote', () => {
    const doc = parseMarkdown('> [!DANGER]\n> nope\n', { path: 'x.md' });
    expect((doc.root.children[0] as AnyNode).type).toBe('blockquote');
  });
});

describe('query blocks', () => {
  it('parses a query fence into a query node and round-trips', () => {
    const doc = parseMarkdown('\u0060\u0060\u0060query\nstatus: open\n\u0060\u0060\u0060\n', { path: 'x.md' });
    const node = doc.root.children[0] as AnyNode;
    expect(node.type).toBe('query');
    expect(node.value).toBe('status: open');

    const out = stringifyMarkdown(doc);
    expect(out).toContain('\u0060\u0060\u0060query');
    expect(out).toContain('status: open');

    const doc2 = parseMarkdown(out, { path: 'x.md' });
    expect(stripPosition(doc2.root)).toEqual(stripPosition(doc.root));
  });

  it('leaves other fence languages alone', () => {
    const doc = parseMarkdown('\u0060\u0060\u0060python\nprint(1)\n\u0060\u0060\u0060\n', { path: 'x.md' });
    const node = doc.root.children[0] as AnyNode;
    expect(node.type).toBe('code');
    expect(node.lang).toBe('python');
  });
});

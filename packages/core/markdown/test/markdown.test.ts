import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMarkdown, stringifyMarkdown, parseFrontmatter } from '../src/index.js';

function repoRoot(): string {
  let d = dirname(fileURLToPath(import.meta.url));
  while (d !== dirname(d)) {
    if (existsSync(join(d, 'pnpm-workspace.yaml'))) return d;
    d = dirname(d);
  }
  return process.cwd();
}

// mdast position fields differ between first parse and re-parse for custom
// nodes; round-trip equality is compared position-insensitively.
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

function demoSource(name: string): string {
  return readFileSync(join(repoRoot(), 'docs/examples/slice-0', name), 'utf8');
}

describe('parseFrontmatter', () => {
  it('splits frontmatter from body', () => {
    const { frontmatter, body } = parseFrontmatter('---\ntitle: Hi\nkind: wiki\n---\n\n# H\n');
    expect(frontmatter.title).toBe('Hi');
    expect(frontmatter.kind).toBe('wiki');
    expect(body).toContain('# H');
  });

  it('returns empty frontmatter when absent', () => {
    const { frontmatter, body } = parseFrontmatter('# Just body\n');
    expect(frontmatter).toEqual({});
    expect(body).toBe('# Just body\n');
  });
});

describe('dialect features', () => {
  it('parses wiki links (with alias) and transclusions (with heading)', () => {
    const doc = parseMarkdown('See [[a|Alias]] and ![[b#sec]].\n', { path: 'x.md' });
    const p = doc.root.children[0] as { children: Array<{ type: string } & Record<string, unknown>> };
    expect(p.children.map((c) => c.type)).toEqual(['text', 'wikiLink', 'text', 'transclusion', 'text']);
    const wl = p.children[1];
    expect(wl.target).toBe('a');
    expect(wl.alias).toBe('Alias');
    const tr = p.children[3];
    expect(tr.target).toBe('b');
    expect(tr.heading).toBe('sec');
  });

  it('parses js/ts/jsx/tsx fences as cells, with source opting out', () => {
    const doc = parseMarkdown(
      '\u0060\u0060\u0060tsx\n<x/>\n\u0060\u0060\u0060\n\n\u0060\u0060\u0060js\n1+1\n\u0060\u0060\u0060\n\n\u0060\u0060\u0060js source\nplain\n\u0060\u0060\u0060\n\n\u0060\u0060\u0060python\nprint(1)\n\u0060\u0060\u0060\n',
      { path: 'x.md' }
    );
    const children = doc.root.children as Array<{ type: string; lang?: string }>;
    expect(children.map((c) => c.type)).toEqual(['cell', 'cell', 'code', 'code']);
    expect(children[0].lang).toBe('tsx');
    expect(children[1].lang).toBe('js');
  });
});

describe('round-trip', () => {
  const files = ['index.md', 'notes/hello.md', 'items/task-1.md'];
  for (const f of files) {
    it('round-trips ' + f + ' (parse -> stringify -> parse idempotent)', () => {
      const source = demoSource(f);
      const doc1 = parseMarkdown(source, { path: f });
      const doc2 = parseMarkdown(stringifyMarkdown(doc1), { path: f });
      expect(stripPosition(doc2.root)).toEqual(stripPosition(doc1.root));
      expect(doc2.frontmatter).toEqual(doc1.frontmatter);
    });
  }

  it('derives id from frontmatter or path', () => {
    const task = parseMarkdown(demoSource('items/task-1.md'), { path: 'items/task-1.md' });
    expect(task.id).toBe('task-1'); // from frontmatter.id
    const wiki = parseMarkdown(demoSource('notes/hello.md'), { path: 'notes/hello.md' });
    expect(wiki.id).toBe('notes/hello'); // derived from path (no frontmatter.id)
  });

  it('canonicalizes setext headings but preserves cell bodies verbatim', () => {
    const src = [
      'Title',
      '=====',
      '',
      '\u0060\u0060\u0060js',
      'const x =  1  // deliberate spacing',
      '\u0060\u0060\u0060',
      '',
      '\u0060\u0060\u0060tsx',
      '  <div  className="x" />  ',
      '\u0060\u0060\u0060',
      '',
    ].join('\n');
    const doc = parseMarkdown(src, { path: 'x.md' });
    const out = stringifyMarkdown(doc);
    // prose is canonical: setext heading -> ATX
    expect(out).toContain('# Title');
    expect(out).not.toContain('=====');
    // cell bodies are verbatim: internal spacing survives the round-trip
    expect(out).toContain('const x =  1  // deliberate spacing');
    expect(out).toContain('  <div  className="x" />  ');
  });

  it('golden: canonical serialization is stable', () => {
    const doc = parseMarkdown('---\ntitle: T\n---\n\n# Hi\n\n[[a|A]]\n', { path: 'x.md' });
    expect(stringifyMarkdown(doc)).toBe('---\ntitle: T\n---\n\n# Hi\n\n[[a|A]]\n');
  });
});
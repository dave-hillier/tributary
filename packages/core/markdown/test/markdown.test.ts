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

  it('parses typed fences and leaves plain fences source-only', () => {
    const doc = parseMarkdown(
      '\u0060\u0060\u0060replot\n{"x":1}\n\u0060\u0060\u0060\n\n\u0060\u0060\u0060js cell=foo\n1+1\n\u0060\u0060\u0060\n\n\u0060\u0060\u0060js\nplain\n\u0060\u0060\u0060\n',
      { path: 'x.md' }
    );
    const types = doc.root.children.map((c) => c.type);
    expect(types).toContain('replotBlock');
    expect(types).toContain('cellBlock');
    expect(types).toContain('code');
    const cell = doc.root.children.find((c) => c.type === 'cellBlock') as { cellName?: string; lang?: string };
    expect(cell.cellName).toBe('foo');
    expect(cell.lang).toBe('js');
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

  it('golden: canonical serialization is stable', () => {
    const doc = parseMarkdown('---\ntitle: T\n---\n\n# Hi\n\n[[a|A]]\n', { path: 'x.md' });
    expect(stringifyMarkdown(doc)).toBe('---\ntitle: T\n---\n\n# Hi\n\n[[a|A]]\n');
  });
});
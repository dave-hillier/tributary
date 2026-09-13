import { describe, it, expect } from 'vitest';
import { parseMarkdown, replaceCellSource, stringifyMarkdown } from '../src/index.js';

describe('replaceCellSource', () => {
  it('replaces one cell while preserving the rest of the source', () => {
    const src = '---\ntitle: T\nkind: index\n---\n\n# Hi\n\n' + '\u0060\u0060\u0060js\nconst a = 1\n\u0060\u0060\u0060' + '\n\n' + '\u0060\u0060\u0060jsx\n<strong>{a}</strong>\n\u0060\u0060\u0060' + '\n';
    const out = replaceCellSource(src, 0, 'const a = 2');
    expect(out).toContain('const a = 2');
    expect(out).not.toContain('const a = 1');
    expect(out).toContain('<strong>{a}</strong>');
    expect(out).toContain('title: T');
  });

  it('round-trips after replacement', () => {
    const src = '---\ntitle: T\nkind: index\n---\n\n' + '\u0060\u0060\u0060js\nconst a = 1\n\u0060\u0060\u0060' + '\n\n' + '\u0060\u0060\u0060jsx\n<strong>{a}</strong>\n\u0060\u0060\u0060' + '\n';
    const out = replaceCellSource(src, 0, 'const a = 2');
    const doc = parseMarkdown(out, { path: 'x.md' });
    const cells: string[] = [];
    const walk = (n: any) => { if (n.type === 'cell') cells.push(n.value as string); if (n.children) n.children.forEach(walk); };
    walk(doc.root);
    expect(cells).toHaveLength(2);
    expect(cells[0]).toContain('const a = 2');
    expect(stringifyMarkdown(doc)).toContain('const a = 2');
  });
});

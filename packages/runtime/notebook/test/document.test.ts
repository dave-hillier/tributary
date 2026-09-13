import { describe, it, expect } from 'vitest';
import { compileDocument } from '../src/compiler.js';

function createElement(type, props, ...children) {
  return { type, props: { ...(props || {}), children: children.length === 1 ? children[0] : children } };
}

describe('compileDocument', () => {
  it('shims @tributary/api imports to the injected capability scope', async () => {
    const run = compileDocument([
      { lang: 'js', source: 'import { workItems } from "@tributary/api"\nconst items = workItems()' },
      { lang: 'jsx', source: '<ul>{items.map((w) => <li>{w.title}</li>)}</ul>' },
    ]);
    const outs = await run({ React: { createElement }, api: { workItems: () => [{ title: 'A' }, { title: 'B' }] } });
    expect(outs[1].type).toBe('ul');
  });

  it('shares declarations across cells (declarations available downstream)', async () => {
    const run = compileDocument([
      { lang: 'js', source: 'const data = [1, 2, 3]' },
      { lang: 'jsx', source: '<ul>{data.map((n) => <li>{n}</li>)}</ul>' },
    ]);
    const outs = await run({ React: { createElement } });
    expect(outs[0]).toBeUndefined();
    expect(outs[1].type).toBe('ul');
  });
});
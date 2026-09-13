import { describe, it, expect } from 'vitest';
import { ReactiveHost, compileReactiveCell } from '../src/index.js';
import type { ReactiveCell } from '../src/reactive.js';

function createElement(type: string, props: unknown, ...children: unknown[]) {
  return { type, props: { ...(props as object), children: children.length === 1 ? children[0] : children } };
}

/** Compile source cells and build a host (mirrors the shell's main-process step). */
function hostOf(cells: ReactiveCell[]): ReactiveHost {
  return new ReactiveHost(cells.map((c) => compileReactiveCell(c.source, c.lang)));
}

describe('ReactiveHost', () => {
  it('evaluates a document with no cells to an empty output (finding 14)', async () => {
    const host = new ReactiveHost([]);
    expect(await host.evaluate({ React: { createElement } })).toEqual([]);
  });

  it('isolates a runtime error to its own cell (finding 8)', async () => {
    const host = hostOf([
      { lang: 'js', source: 'throw new Error("boom")' },
      { lang: 'js', source: '1 + 1' },
    ]);
    const outs = await host.evaluate({ React: { createElement } });
    expect(outs[0]).toBeInstanceOf(Error);
    expect((outs[0] as Error).message).toContain('boom');
    expect(outs[1]).toBe(2);
  });

  it('recomputes only the edited cell and its dependants', async () => {
    const host = hostOf([
      { lang: 'js', source: 'const a = 1' },
      { lang: 'js', source: 'const b = a + 1' },
      { lang: 'js', source: 'const c = 100' },
    ]);
    await host.evaluate({ React: { createElement } });
    host.lastEvaluated = [];
    await host.update(0, compileReactiveCell('const a = 2', 'js'), { React: { createElement } });
    expect(host.lastEvaluated.slice().sort()).toEqual([0, 1]);
  });

  it('updates a downstream tsx cell when an upstream cell changes', async () => {
    const host = hostOf([
      { lang: 'js', source: 'const items = ["a", "b"]' },
      { lang: 'jsx', source: '<ul>{items.map((x) => <li>{x}</li>)}</ul>' },
    ]);
    const outs = await host.evaluate({ React: { createElement } });
    expect((outs[1] as any).type).toBe('ul');
    const outs2 = await host.update(0, compileReactiveCell('const items = ["x"]', 'js'), { React: { createElement } });
    expect((outs2[1] as any).type).toBe('ul');
  });
});

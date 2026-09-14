import { describe, it, expect } from 'vitest';
import { ReactiveHost, compileReactiveCell, withName } from '../src/index.js';
import type { ReactiveCell, ReactiveContext } from '../src/reactive.js';

function createElement(type: string, props: unknown, ...children: unknown[]) {
  return { type, props: { ...(props as object), children: children.length === 1 ? children[0] : children } };
}

/**
 * Compile source cells and build a host (mirrors the shell's main-process
 * compile step followed by the renderer's host construction).
 */
function hostOf(cells: ReactiveCell[], context: ReactiveContext = {}): ReactiveHost {
  return new ReactiveHost(
    cells.map((c, i) => withName('c' + i, compileReactiveCell(c.source, c.lang))),
    { context }
  );
}

const react = { React: { createElement } };

describe('ReactiveHost', () => {
  it('evaluates a document with no cells to an empty output (finding 14)', async () => {
    const host = new ReactiveHost([], { context: react });
    expect(await host.evaluate()).toEqual(new Map());
  });

  it('isolates a runtime error to its own cell (finding 8)', async () => {
    const host = hostOf(
      [
        { lang: 'js', source: 'throw new Error("boom")' },
        { lang: 'js', source: '1 + 1' },
      ],
      react
    );
    const outs = await host.evaluate();
    expect(outs.get('c0')).toBeInstanceOf(Error);
    expect((outs.get('c0') as Error).message).toContain('boom');
    expect(outs.get('c1')).toBe(2);
  });

  it('recomputes only the edited cell and its dependants', async () => {
    const host = hostOf(
      [
        { lang: 'js', source: 'const a = 1' },
        { lang: 'js', source: 'const b = a + 1' },
        { lang: 'js', source: 'const c = 100' },
      ],
      react
    );
    await host.evaluate();
    host.define(withName('c0', compileReactiveCell('const a = 2', 'js')));
    await host.evaluate();
    expect(host.lastEvaluated.slice().sort()).toEqual([0, 1]);
  });

  it('recomputes only the invalidated cell and its dependants', async () => {
    const host = hostOf(
      [
        { lang: 'js', source: 'const a = 1' },
        { lang: 'js', source: 'const b = a + 1' },
        { lang: 'js', source: 'const c = 100' },
      ],
      react
    );
    await host.evaluate();
    host.invalidate('c0');
    await host.evaluate();
    expect(host.lastEvaluated.slice().sort()).toEqual([0, 1]);
  });

  it('updates a downstream tsx cell when an upstream cell changes', async () => {
    const host = hostOf(
      [
        { lang: 'js', source: 'const items = ["a", "b"]' },
        { lang: 'jsx', source: '<ul>{items.map((x) => <li>{x}</li>)}</ul>' },
      ],
      react
    );
    const outs = await host.evaluate();
    expect((outs.get('c1') as any).type).toBe('ul');
    host.define(withName('c0', compileReactiveCell('const items = ["x"]', 'js')));
    const outs2 = await host.evaluate();
    expect((outs2.get('c1') as any).type).toBe('ul');
  });

  it('exposes destructured declarations to downstream cells (finding 12)', async () => {
    const compiled = compileReactiveCell('const { a, b: { c } } = { a: 1, b: { c: 2 } }; const [d = 3, ...rest] = [4, 5]', 'js');
    expect(compiled.provided).toEqual(expect.arrayContaining(['a', 'c', 'd', 'rest']));

    const host = hostOf(
      [
        { lang: 'js', source: 'const { a, b } = { a: 1, b: 2 }' },
        { lang: 'js', source: 'a + b' },
      ],
      react
    );
    const outs = await host.evaluate();
    expect(outs.get('c1')).toBe(3);
  });

  it('reports a circular dependency instead of leaving cells undefined (finding 13)', async () => {
    const host = hostOf(
      [
        { lang: 'js', source: 'const a = b + 1' },
        { lang: 'js', source: 'const b = a + 1' },
      ],
      react
    );
    const outs = await host.evaluate();
    expect(outs.get('c0')).toBeInstanceOf(Error);
    expect(outs.get('c1')).toBeInstanceOf(Error);
    expect((outs.get('c0') as Error).message).toMatch(/Circular dependency/);
    expect((outs.get('c1') as Error).message).toMatch(/Circular dependency/);
  });

  it('applies the capability lock on the live runtime path (finding 3)', async () => {
    const api = { marker: 1 };
    const host = hostOf(
      [
        {
          lang: 'js',
          source:
            'const probe = [typeof window, typeof document, typeof fetch, typeof localStorage].join("/")' +
            ' + "|" + Object.isFrozen(__scope.api); probe',
        },
      ],
      { React: { createElement }, api, components: {} }
    );
    const outs = await host.evaluate();
    expect(outs.get('c0')).toBe('undefined/undefined/undefined/undefined|true');
  });

  // --- semantics ported from the custom evaluator ---------------------------
  // Each of these fails against the previous ReactiveHost: it kept the stale
  // binding after an edit and let dependants read a failed cell's old value.

  it('propagates a failed cell to its dependants instead of serving a stale value', async () => {
    const host = hostOf(
      [
        { lang: 'js', source: 'const a = 1' },
        { lang: 'js', source: 'a + 1' },
      ],
      react
    );
    expect((await host.evaluate()).get('c1')).toBe(2);

    host.define(withName('c0', compileReactiveCell('const a = (() => { throw new Error("boom") })()', 'js')));
    const outs = await host.evaluate();
    expect(outs.get('c0')).toBeInstanceOf(Error);
    // The dependant must see the failure, not the pre-error value of 1.
    expect(outs.get('c1')).toBeInstanceOf(Error);
    expect((outs.get('c1') as Error).message).toContain('boom');
  });

  it('leaks no partial binding from a cell that threw mid-body', async () => {
    const host = hostOf(
      [
        { lang: 'js', source: 'const a = 1; throw new Error("boom")' },
        { lang: 'js', source: 'a + 1' },
      ],
      react
    );
    const outs = await host.evaluate();
    // `scope.a = 1` runs before the throw; the dependant must not read it.
    expect(outs.get('c1')).toBeInstanceOf(Error);
    expect((outs.get('c1') as Error).message).toContain('boom');
  });

  it('drops a binding the cell no longer provides', async () => {
    const host = hostOf(
      [
        { lang: 'js', source: 'const a = 1' },
        { lang: 'js', source: 'a + 1' },
      ],
      react
    );
    expect((await host.evaluate()).get('c1')).toBe(2);

    host.define(withName('c0', compileReactiveCell('const z = 9', 'js')));
    const outs = await host.evaluate();
    // `a` is gone, so the dependant must fail rather than read the orphan.
    expect(outs.get('c1')).toBeInstanceOf(Error);
  });

  it('clears a recorded error once the cell succeeds again', async () => {
    const host = hostOf(
      [
        { lang: 'js', source: 'const a = (() => { throw new Error("boom") })()' },
        { lang: 'js', source: 'a' },
      ],
      react
    );
    expect((await host.evaluate()).get('c1')).toBeInstanceOf(Error);

    host.define(withName('c0', compileReactiveCell('const a = 42', 'js')));
    expect((await host.evaluate()).get('c1')).toBe(42);
  });

  it('reports failures to onError with the cell name', async () => {
    const seen: Array<[string, unknown]> = [];
    const host = new ReactiveHost(
      [withName('doc#0', compileReactiveCell('throw new Error("boom")', 'js'))],
      { context: react, onError: (name, err) => seen.push([name, err]) }
    );
    await host.evaluate();
    expect(seen).toHaveLength(1);
    expect(seen[0]![0]).toBe('doc#0');
    expect((seen[0]![1] as Error).message).toContain('boom');
  });

  it('stops a superseded evaluate from writing', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const host = hostOf([{ lang: 'js', source: 'await __scope.api.wait(); const a = "late"' }], {
      React: { createElement },
      api: { wait: () => gate },
    });

    const inFlight = host.evaluate();
    host.dispose();
    release();
    const outs = await inFlight;
    expect(outs.size).toBe(0);
  });

  it('dispose releases state and is idempotent', async () => {
    const host = hostOf([{ lang: 'js', source: 'const a = 1' }], react);
    await host.evaluate();
    host.dispose();
    host.dispose();
    // Post-dispose the host is inert rather than throwing at the call site.
    expect(await host.evaluate()).toEqual(new Map());
    host.define(withName('c0', compileReactiveCell('const a = 2', 'js')));
    expect(await host.evaluate()).toEqual(new Map());
  });
});

import { describe, it, expect } from 'vitest';
import { createCustomNotebookHost } from '../src/custom-evaluator.js';
import { createObservableNotebookHost } from '../src/observable-adapter.js';
import { ReactiveHost, compileReactiveCell, withName } from '../src/index.js';
import type { NotebookHost } from '../src/index.js';

function makeCounter() {
  const calls: string[] = [];
  return {
    calls,
    builtins: { count: (n: string) => (calls.push(n), n) },
  };
}

describe('custom evaluator', () => {
  it('evaluates a dependency graph in topological order', async () => {
    const host = createCustomNotebookHost();
    host.define({ name: 'a', source: '6 * 7' });
    host.define({ name: 'b', source: 'a * 2' });
    const out = await host.evaluate();
    expect(out.get('a')).toBe(42);
    expect(out.get('b')).toBe(84);
    host.dispose();
  });

  it('on invalidate recomputes only the cell and its dependants', async () => {
    const { calls, builtins } = makeCounter();
    const host = createCustomNotebookHost({ builtins });
    host.define({ name: 'a', source: "count('a')" });
    host.define({ name: 'b', source: "count('b') + '-' + a" });
    host.define({ name: 'c', source: "count('c')" });

    await host.evaluate();
    expect(calls.slice().sort()).toEqual(['a', 'b', 'c']);

    calls.length = 0;
    host.invalidate('a');
    await host.evaluate();
    // only 'a' and its dependant 'b' re-ran; 'c' stayed cached
    expect(calls.slice().sort()).toEqual(['a', 'b']);
    host.dispose();
  });

  it('surfaces per-cell errors without killing the host', async () => {
    const errors: Array<[string, unknown]> = [];
    const host = createCustomNotebookHost({ onError: (n, e) => errors.push([n, e]) });
    host.define({ name: 'bad', source: 'missing * 2' });
    host.define({ name: 'ok', source: '1 + 1' });
    const out = await host.evaluate();
    expect(out.get('ok')).toBe(2);
    expect(errors.some(([n]) => n === 'bad')).toBe(true);
    host.dispose();
  });
});

describe('swap test (every host behind NotebookHost)', () => {
  const defs = [
    { name: 'a', source: '6 * 7' },
    { name: 'b', source: 'a * 2' },
    { name: 'c', source: 'b + 1' },
  ];

  /**
   * Drive a host through the shared interface. Typing this generically over
   * `NotebookHost<D>` is the point: if an implementation stopped satisfying the
   * seam, this file would not compile.
   */
  async function evaluateThrough<D extends { name: string }>(
    host: NotebookHost<D>,
    cells: D[]
  ): Promise<Map<string, unknown>> {
    for (const cell of cells) host.define(cell);
    const out = await host.evaluate();
    host.dispose();
    return out;
  }

  /**
   * The same graph expressed for the compiled host.
   *
   * This translation is the seam's one real impedance mismatch, so it is worth
   * spelling out. Two differences, both about where a value lives:
   *
   * - An expression host names a cell by its definition's `name` and binds the
   *   computed value under that name. The compiled host instead publishes the
   *   names a cell *declares* (compiler.ts emits `scope.x = x` per declaration),
   *   so a bare expression declares nothing and is invisible downstream — hence
   *   the `const <name> = (…)` binding.
   * - The map returned by `evaluate` holds each cell's *return value*, and the
   *   compiled dialect returns the last expression. A declaration alone returns
   *   undefined, so the trailing `<name>` is what makes the cell's output match
   *   the expression hosts'.
   */
  const compiled = () =>
    defs.map((d) =>
      withName(d.name, compileReactiveCell(`const ${d.name} = (${d.source});\n${d.name}`, 'js'))
    );

  it('both expression hosts evaluate the same graph to the same values', async () => {
    const customOut = await evaluateThrough(createCustomNotebookHost(), defs);
    const obsOut = await evaluateThrough(createObservableNotebookHost(), defs);

    expect(obsOut.get('a')).toBe(customOut.get('a'));
    expect(obsOut.get('b')).toBe(customOut.get('b'));
    expect(obsOut.get('c')).toBe(customOut.get('c'));
  });

  it('the host the app actually runs agrees with them', async () => {
    const customOut = await evaluateThrough(createCustomNotebookHost(), defs);
    const realOut = await evaluateThrough(new ReactiveHost([]), compiled());

    expect(realOut.get('a')).toBe(customOut.get('a'));
    expect(realOut.get('b')).toBe(customOut.get('b'));
    expect(realOut.get('c')).toBe(customOut.get('c'));
  });
});

import { describe, it, expect } from 'vitest';
import { createCustomNotebookHost } from '../src/custom-evaluator.js';
import { createObservableNotebookHost } from '../src/observable-adapter.js';

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

describe('swap test (custom vs Observable)', () => {
  it('both hosts evaluate the same graph to the same values', async () => {
    const defs = [
      { name: 'a', source: '6 * 7' },
      { name: 'b', source: 'a * 2' },
      { name: 'c', source: 'b + 1' },
    ];

    const custom = createCustomNotebookHost();
    for (const d of defs) custom.define(d);
    const customOut = await custom.evaluate();
    custom.dispose();

    const obs = createObservableNotebookHost();
    for (const d of defs) obs.define(d);
    const obsOut = await obs.evaluate();
    obs.dispose();

    expect(obsOut.get('a')).toBe(customOut.get('a'));
    expect(obsOut.get('b')).toBe(customOut.get('b'));
    expect(obsOut.get('c')).toBe(customOut.get('c'));
  });
});

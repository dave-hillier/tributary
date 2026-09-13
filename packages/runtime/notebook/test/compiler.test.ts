import { describe, it, expect } from 'vitest';
import { compileCell, evaluateCell } from '../src/compiler.js';

function createElement(type: string, props: unknown, ...children: unknown[]) {
  return { type, props: { ...(props as object), children: children.length === 1 ? children[0] : children } };
}

describe('compileCell', () => {
  it('compiles a tsx expression to a React element', async () => {
    const run = compileCell('<strong>hello</strong>', 'tsx');
    const out = await run({ React: { createElement } }) as { type: string; props: { children: string } };
    expect(out.type).toBe('strong');
    expect(out.props.children).toBe('hello');
  });

  it('evaluates a js expression', async () => {
    expect(await evaluateCell('6 * 7', 'js')).toBe(42);
  });

  it('wraps the final expression when declarations precede it', async () => {
    expect(await evaluateCell('const x = 6 * 7\nx + 1', 'ts')).toBe(43);
  });

  it('supports top-level await', async () => {
    expect(await evaluateCell('const d = await Promise.resolve(42)\nd', 'ts')).toBe(42);
  });

  it('returns undefined for a declaration-only cell', async () => {
    expect(await evaluateCell('const x = 1', 'js')).toBeUndefined();
  });
});

describe('capability boundary (ADR-004 scope lock)', () => {
  it('denies ambient runtime names to cells', async () => {
    expect(await evaluateCell('typeof require', 'js')).toBe('undefined');
    expect(await evaluateCell('typeof process', 'js')).toBe('undefined');
    expect(await evaluateCell('typeof module', 'js')).toBe('undefined');
    expect(await evaluateCell('typeof globalThis', 'js')).toBe('undefined');
    expect(await evaluateCell('typeof window', 'js')).toBe('undefined');
    expect(await evaluateCell('typeof Buffer', 'js')).toBe('undefined');
  });

  it('throws when a cell tries to reach an ambient power', async () => {
    await expect(evaluateCell('process.exit(1)', 'js')).rejects.toThrow();
    await expect(evaluateCell('require("fs")', 'js')).rejects.toThrow();
  });

  it('still exposes the capability API via shimmed imports', async () => {
    const source = 'import { workItems } from "@tributary/api"\nworkItems()';
    const run = compileCell(source, 'js');
    const out = await run({
      React: {},
      api: { workItems: () => ['a', 'b'] },
      components: {},
    } as never);
    expect(out).toEqual(['a', 'b']);
  });

  it('freezes the granted capability surface', async () => {
    const api = { workItems: () => [] };
    const run = compileCell('import { workItems } from "@tributary/api"\nworkItems()', 'js');
    await run({ React: {}, api, components: {} } as never);
    expect(Object.isFrozen(api)).toBe(true);
  });
});

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

import { describe, it, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compileCell,
  compileDocument,
  compileReactiveCell,
  evaluateCell,
  ReactiveHost,
  type ResolveOptions,
} from '../src/index.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const resolve: ResolveOptions = { resolveDir: testDir };

function createElement(type: unknown, props: unknown, ...children: unknown[]) {
  return {
    type,
    props: {
      ...((props as object) ?? {}),
      children: children.length === 1 ? children[0] : children,
    },
  };
}

describe('cell module resolution (finding 11)', () => {
  it('imports a bare package specifier and uses it', async () => {
    const out = await evaluateCell('import { parse } from "acorn"\nparse("const x = 1", { ecmaVersion: "latest" }).type', 'js', {}, resolve);
    expect(out).toBe('Program');
  });

  it('imports a relative module and uses its named exports', async () => {
    const out = await evaluateCell('import { add } from "./fixtures/fake-lib"\nadd(2, 3)', 'ts', {}, resolve);
    expect(out).toBe(5);
  });

  it('imports a default export', async () => {
    const out = await evaluateCell('import identity from "./fixtures/fake-lib"\nidentity(21)', 'ts', {}, resolve);
    expect(out).toBe(21);
  });

  it('imports a namespace object', async () => {
    const out = await evaluateCell('import * as lib from "./fixtures/fake-lib"\nlib.answer', 'ts', {}, resolve);
    expect(out).toBe(42);
  });

  it('lets a tsx cell render an imported component', async () => {
    const run = compileCell('import { Strong } from "./fixtures/fake-lib"\nconst n = 7;\n<Strong n={n} />', 'tsx', resolve);
    const out = (await run({ React: { createElement } })) as {
      type: unknown;
      props: { n: number };
    };
    expect(typeof out.type).toBe('function');
    expect(out.props.n).toBe(7);
  });

  it('resolves imports inside compileDocument while sharing declarations', async () => {
    const run = compileDocument(
      [
        { lang: 'js', source: 'import { answer } from "./fixtures/fake-lib"\nconst data = answer' },
        { lang: 'js', source: 'data + 1' },
      ],
      resolve
    );
    const outs = await run({ React: { createElement } });
    expect(outs[0]).toBeUndefined();
    expect(outs[1]).toBe(43);
  });
});

describe('capability import robustness (finding 12)', () => {
  const api = { workItems: () => ['a', 'b'] };

  it('shims single-quoted named imports', async () => {
    const out = await evaluateCell("import { workItems } from '@tributary/api'\nworkItems()", 'js', { api });
    expect(out).toEqual(['a', 'b']);
  });

  it('shims default imports', async () => {
    const out = await evaluateCell("import api from '@tributary/api'\napi.workItems()", 'js', { api });
    expect(out).toEqual(['a', 'b']);
  });

  it('shims namespace imports', async () => {
    const out = await evaluateCell("import * as api from '@tributary/api'\napi.workItems()", 'js', { api });
    expect(out).toEqual(['a', 'b']);
  });
});

describe('per-cell error isolation (finding 12)', () => {
  it('an unresolvable import becomes an error, not a document failure', async () => {
    const host = new ReactiveHost(
      [
        { lang: 'js', source: 'const good = 1' },
        { lang: 'js', source: 'import { missing } from "this-package-does-not-exist"\nmissing' },
        { lang: 'js', source: 'good + 1' },
      ].map((c) => compileReactiveCell(c.source, c.lang, resolve))
    );
    const outs = await host.evaluate({ React: { createElement } });
    expect(outs[0]).toBeUndefined();
    expect(outs[1]).toBeInstanceOf(Error);
    expect(outs[2]).toBe(2);
  });

  it('compileDocument isolates a bad cell into its own slot', async () => {
    const run = compileDocument(
      [
        { lang: 'js', source: 'import { missing } from "this-package-does-not-exist"\nmissing' },
        { lang: 'js', source: '1 + 1' },
      ],
      resolve
    );
    const outs = await run({ React: { createElement } });
    expect(outs[0]).toBeInstanceOf(Error);
    expect(outs[1]).toBe(2);
  });
});

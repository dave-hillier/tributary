import { transformSync } from 'esbuild';
import { parse } from 'acorn';
import { resolveImports, type ResolveOptions } from './resolve.js';
import type { CompiledReactiveCell } from './reactive.js';

export type CellLanguage = 'js' | 'ts' | 'jsx' | 'tsx';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function wrapLastExpression(js: string): string {
  const trimmed = js.trimEnd();
  try {
    const ast = parse(trimmed, { ecmaVersion: 'latest', sourceType: 'module' });
    const body = ast.body;
    if (body.length === 0) return 'return undefined;';
    const last = body[body.length - 1]!;
    if (last.type !== 'ExpressionStatement') {
      return trimmed + '\nreturn undefined;';
    }
    const expr = last.expression;
    return trimmed.slice(0, expr.start) + 'return (' + trimmed.slice(expr.start, expr.end) + ');';
  } catch {
    return 'return undefined;';
  }
}

function wrapFinalExpression(js: string, outName: string): string {
  const trimmed = js.trimEnd();
  try {
    const ast = parse(trimmed, { ecmaVersion: 'latest', sourceType: 'module' });
    const body = ast.body;
    if (body.length === 0) return 'var ' + outName + ';';
    const last = body[body.length - 1]!;
    if (last.type !== 'ExpressionStatement') {
      return trimmed + '\nvar ' + outName + ';';
    }
    const expr = last.expression;
    return trimmed.slice(0, expr.start) + 'var ' + outName + ' = (' + trimmed.slice(expr.start, expr.end) + ');';
  } catch {
    return 'var ' + outName + ';';
  }
}

// Matches \`import … from "@tributary/api|components"\` with any quote style and
// any clause shape (named { a, b as c }, default api, or namespace * as api).
// @tributary/api|components are capability namespaces that must never be
// bundled — they resolve to the injected __scope.
const APP_IMPORT_RE =
  /import\s+(?:(\*\s*as\s+[A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)|\{([^}]*)\})\s*from\s*(["'\x60])@tributary\/(api|components)\4\s*;?/g;

// Side-effect-only capability imports (import "@tributary/api").
const APP_SIDE_EFFECT_RE = /import\s*(["'\x60])@tributary\/(?:api|components)\1\s*;?/g;

export function shimImports(source: string): string {
  const shimmed = source.replace(APP_IMPORT_RE, (_m, ns: string | undefined, def: string | undefined, named: string | undefined, _q: string, mod: string) => {
    if (named !== undefined) {
      const clean = named.replace(/\s+/g, ' ').trim();
      return 'const { ' + clean + ' } = __scope.' + mod + ';';
    }
    if (ns !== undefined) {
      const name = ns.replace(/^\*\s*as\s+/, '').trim();
      return 'const ' + name + ' = __scope.' + mod + ';';
    }
    return 'const ' + def + ' = __scope.' + mod + ';';
  });
  return shimmed.replace(APP_SIDE_EFFECT_RE, '');
}

/**
 * Capability boundary preamble (ADR-004): cells execute with ONLY React and
 * __scope (api/components) in scope. Shadowing the ambient runtime binding
 * names as local undefineds denies the ambient power set — process, require,
 * module hooks, the browser globals and globalThis itself — so a cell must go
 * through the capability API to touch the host. (Workspaces are trusted in v1
 * per arch §8; this seals the API seam, not a hostile sandbox.)
 */
const AMBIGUOUS_NAMES = [
  'process', 'require', 'module', 'exports', 'Buffer', 'global',
  '__dirname', '__filename', 'window', 'document', 'globalThis', 'fetch',
  'XMLHttpRequest', 'WebSocket', 'navigator', 'location',
  'history', 'localStorage', 'sessionStorage', 'electron',
];

const SCOPE_LOCK_PREFIX =
  'const ' +
  AMBIGUOUS_NAMES.join('= undefined, ') +
  '= undefined;\n' +
  // The capability surface itself is sealed: a cell cannot hot-swap the API
  // it was granted.
  'Object.freeze(__scope.api);\n' +
  'Object.freeze(__scope.components);\n';

/** Wrap a single AsyncFunction body in the capability-boundary preamble. */
export function withScopeLock(body: string): string {
  return SCOPE_LOCK_PREFIX + body;
}

export interface DocumentCell {
  lang: CellLanguage;
  source: string;
}

/**
 * Compile a document's cells into ONE shared evaluation (ADR-004: declarations
 * in one cell are available to downstream cells). Each cell's final expression
 * becomes its output slot; a cell that fails to compile yields an Error in its
 * own slot instead of failing the whole document.
 */
export function compileDocument(
  cells: DocumentCell[],
  options: ResolveOptions = {}
): (scope: Record<string, unknown>) => Promise<unknown[]> {
  const parts = cells.map((c, i) => {
    try {
      const js = transformSync(shimImports(c.source), {
        loader: c.lang,
        jsx: 'transform',
        jsxFactory: 'React.createElement',
        jsxFragment: 'React.Fragment',
      }).code;
      const resolved = resolveImports(js, options);
      if (resolved.unresolved) throw new Error('unresolved import');
      return wrapFinalExpression(resolved.preamble + '\n' + resolved.body, '__out_' + i);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return 'var __out_' + i + ' = new Error(' + JSON.stringify('Cell compile error: ' + msg) + ');';
    }
  });
  const outs = cells.map((_, i) => '__out_' + i).join(', ');
  const body = parts.join('\n') + '\nreturn [' + outs + '];';
  const fn = new AsyncFunction('React', '__scope', withScopeLock(body));
  return (scope) => fn(scope.React, { api: scope.api, components: scope.components });
}

export type CompiledCell = (scope: Record<string, unknown>) => Promise<unknown>;

export function compileCell(source: string, lang: CellLanguage, options: ResolveOptions = {}): CompiledCell {
  const js = transformSync(shimImports(source), {
    loader: lang,
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
  }).code;
  const resolved = resolveImports(js, options);
  if (resolved.unresolved) {
    throw new Error('Cell import could not be resolved: ' + JSON.stringify(source.trim().split('\n')[0]));
  }
  const body = wrapLastExpression(resolved.preamble + '\n' + resolved.body);
  const fn = new AsyncFunction('React', '__scope', withScopeLock(body));
  return (scope) => fn(scope.React, { api: scope.api, components: scope.components });
}

export async function evaluateCell(
  source: string,
  lang: CellLanguage,
  scope: Record<string, unknown> = {},
  options: ResolveOptions = {}
) {
  return compileCell(source, lang, options)(scope);
}
function collectIdentifiers(js: string): Set<string> {
  const names = new Set<string>();
  let ast;
  try {
    ast = parse(js, { ecmaVersion: 'latest', sourceType: 'module' });
  } catch {
    return names;
  }
  const walk = (node: any): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node.type === 'Identifier' && typeof node.name === 'string') names.add(node.name);
    for (const key of Object.keys(node)) {
      if (key === 'start' || key === 'end' || key === 'loc' || key === 'type' || key === 'name') continue;
      walk(node[key]);
    }
  };
  walk(ast);
  return names;
}

/**
 * Compile one cell to its self-contained JS body plus dependency metadata
 * (esbuild; main process only). The returned object is fully serializable so a
 * renderer can reconstruct a runner via \`makeReactiveRunner\` without esbuild.
 *
 * Top-level \`const X = ...\` declarations are written to the shared \`scope\`
 * object; references to other cells' names resolve through \`with (scope)\`.
 * Imports are bundled into a preamble hoisted OUTSIDE the \`with\` block so
 * imported bindings stay per-cell. A cell that cannot be compiled yields a
 * throwing body, so one bad cell does not fail the whole document.
 */
export function compileReactiveCell(source: string, lang: CellLanguage, options: ResolveOptions = {}): CompiledReactiveCell {
  try {
    const js = transformSync(shimImports(source), {
      loader: lang,
      jsx: 'transform',
      jsxFactory: 'React.createElement',
      jsxFragment: 'React.Fragment',
    }).code;
    const resolved = resolveImports(js, options);
    if (resolved.unresolved) throw new Error('unresolved import');

    const refs = collectIdentifiers(resolved.body);
    const provided: string[] = [];

    let ast;
    try {
      ast = parse(resolved.body, { ecmaVersion: 'latest', sourceType: 'module' });
    } catch {
      ast = null;
    }

    let body: string;
    if (!ast || ast.body.length === 0) {
      body = 'with (scope) { return undefined; }';
    } else {
      let out = 'with (scope) {';
      let cursor = 0;
      const stmts = ast.body;
      for (let idx = 0; idx < stmts.length; idx++) {
        const stmt = stmts[idx]!;
        out += resolved.body.slice(cursor, stmt.start);
        if (stmt.type === 'VariableDeclaration') {
          out += resolved.body.slice(stmt.start, stmt.end);
          const names = stmt.declarations
            .filter((d) => d.id.type === 'Identifier')
            .map((d) => (d.id as any).name as string);
          for (const n of names) {
            provided.push(n);
            refs.delete(n);
            out += '\nscope.' + n + ' = ' + n + ';';
          }
        } else if (idx === stmts.length - 1 && stmt.type === 'ExpressionStatement') {
          out += 'return (' + resolved.body.slice(stmt.expression.start, stmt.expression.end) + ');';
        } else {
          out += resolved.body.slice(stmt.start, stmt.end);
        }
        cursor = stmt.end;
      }
      out += '}';
      body = out;
    }

    return { provided, refs: [...refs], js: resolved.preamble + '\n' + body };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      provided: [],
      refs: [],
      js: 'throw new Error(' + JSON.stringify('Cell compile error: ' + msg) + ');',
    };
  }
}


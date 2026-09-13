import { transformSync } from 'esbuild';
import { parse } from 'acorn';

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

export interface DocumentCell {
  lang: CellLanguage;
  source: string;
}

/**
 * Compile a document's cells into ONE shared evaluation (ADR-004: declarations
 * in one cell are available to downstream cells). Declarations are lowered to
 * function-scoped `var`s (esbuild target es5), and each cell's final
 * expression becomes its output slot.
 */
export function compileDocument(cells: DocumentCell[]): (scope: Record<string, unknown>) => Promise<unknown[]> {
  const parts = cells.map((c, i) => {
    const js = transformSync(c.source, {
      loader: c.lang,
      jsx: 'transform',
      jsxFactory: 'React.createElement',
      jsxFragment: 'React.Fragment',
    }).code;
    return wrapFinalExpression(js, '__out_' + i);
  });
  const outs = cells.map((_, i) => '__out_' + i).join(', ');
  const body = parts.join('\n') + '\nreturn [' + outs + '];';
  const fn = new AsyncFunction('React', 'api', body);
  return (scope) => fn(scope.React, scope.api);
}

export type CompiledCell = (scope: Record<string, unknown>) => Promise<unknown>;

export function compileCell(source: string, lang: CellLanguage): CompiledCell {
  const js = transformSync(source, {
    loader: lang,
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
  }).code;
  const body = wrapLastExpression(js);
  const fn = new AsyncFunction('React', body);
  return (scope) => fn(scope.React);
}

export async function evaluateCell(source: string, lang: CellLanguage, scope: Record<string, unknown> = {}) {
  return compileCell(source, lang)(scope);
}
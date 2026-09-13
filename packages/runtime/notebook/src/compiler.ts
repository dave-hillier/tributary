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
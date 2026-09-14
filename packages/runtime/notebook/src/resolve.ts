import { build, buildSync, type BuildOptions } from 'esbuild';
import { parse } from 'acorn';

/**
 * Where a cell's bare/relative import specifiers are resolved from.
 *
 * The shell passes the workspace root as resolveDir (so relative imports
 * resolve against the document's repository) and a list of nodePaths roots
 * (the workspace's own node_modules, then the host app's) so bare package
 * specifiers resolve against installed dependencies. The notebook package
 * itself stays Electron-independent: it only consumes these paths.
 */
export interface ResolveOptions {
  /** Directory esbuild resolves relative specifiers against. Defaults to cwd. */
  resolveDir?: string;
  /** Additional node_modules roots searched after the resolveDir walk-up. */
  nodePaths?: string[];
}

export interface ResolvedCell {
  /** The cell source with import statements removed. */
  body: string;
  /** Self-contained JavaScript declaring the imported bindings. */
  preamble: string;
  /** True when an import could not be resolved (left in place for the error path). */
  unresolved: boolean;
}

interface ImportDecl {
  start: number;
  end: number;
  specifiers: Array<{
    type: 'ImportSpecifier' | 'ImportDefaultSpecifier' | 'ImportNamespaceSpecifier';
    local: { name: string };
    imported?: { name: string };
  }>;
}

let counter = 0;

/** Parse a cell's imports; null means the source is not parseable as a module. */
function parseImports(source: string): ImportDecl[] | null {
  let ast;
  try {
    ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  } catch {
    return null;
  }
  return (ast.body as unknown[]).filter(
    (n) => (n as { type: string }).type === 'ImportDeclaration'
  ) as ImportDecl[];
}

/** Re-emit every import as-is plus one export of all local names. */
function syntheticEntry(source: string, imports: ImportDecl[]): string {
  const locals: string[] = [];
  const parts: string[] = [];
  for (const imp of imports) {
    parts.push(source.slice(imp.start, imp.end));
    for (const spec of imp.specifiers) locals.push(spec.local.name);
  }
  return parts.join('\n') + (locals.length > 0 ? '\nexport { ' + locals.join(', ') + ' };' : '');
}

function buildOptions(entry: string, globalName: string, options: ResolveOptions): BuildOptions {
  return {
    bundle: true,
    write: false,
    format: 'iife',
    globalName,
    platform: 'browser',
    // React and friends probe NODE_ENV at import time; resolve it at build time
    // so bundled libraries never touch the scope-locked process binding.
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    logLevel: 'silent',
    stdin: {
      contents: entry,
      resolveDir: options.resolveDir ?? process.cwd(),
      loader: 'js',
    },
    nodePaths: options.nodePaths,
  };
}

/** Bind each imported local off the namespace returned by the bundle IIFE. */
function finalize(source: string, imports: ImportDecl[], output: string, globalName: string): ResolvedCell {
  const decls: string[] = [];
  for (const imp of imports) {
    for (const spec of imp.specifiers) {
      decls.push('var ' + spec.local.name + ' = ' + globalName + '.' + spec.local.name + ';');
    }
  }
  let body = source;
  const sorted = [...imports].sort((a, b) => b.start - a.start);
  for (const imp of sorted) {
    body = body.slice(0, imp.start) + body.slice(imp.end);
  }
  return { body, preamble: output + '\n' + decls.join('\n') + '\n', unresolved: false };
}

/**
 * Rewrite a cell's ES module imports into self-contained var bindings.
 *
 * The cell is already JS by the time it reaches here (the compiler strips
 * TS/JSX first), so we can parse it with acorn to find import declarations.
 * For each import we build a synthetic re-export entry and bundle it with
 * esbuild into an IIFE whose return value is the module namespace; the cell
 * body then binds the imported local names off that namespace.
 *
 * @tributary/api and @tributary/components never reach this point; they are
 * shimmed to the injected capability scope before resolution.
 */
export function resolveImports(source: string, options: ResolveOptions = {}): ResolvedCell {
  const imports = parseImports(source);
  if (imports === null || imports.length === 0) {
    return { body: source, preamble: '', unresolved: false };
  }
  const base = '__imp_' + counter++;
  try {
    const result = buildSync(buildOptions(syntheticEntry(source, imports), base, options));
    const output = result.outputFiles?.[0]?.text;
    if (output === undefined) return { body: source, preamble: '', unresolved: true };
    return finalize(source, imports, output, base);
  } catch {
    return { body: source, preamble: '', unresolved: true };
  }
}

/**
 * Async twin of resolveImports, used by the shell's IPC path so esbuild's
 * bundling work never blocks the main-process event loop. The synchronous
 * resolveImports is retained for tests and synchronous callers.
 */
export async function resolveImportsAsync(source: string, options: ResolveOptions = {}): Promise<ResolvedCell> {
  const imports = parseImports(source);
  if (imports === null || imports.length === 0) {
    return { body: source, preamble: '', unresolved: false };
  }
  const base = '__imp_' + counter++;
  try {
    const result = await build(buildOptions(syntheticEntry(source, imports), base, options));
    const output = result.outputFiles?.[0]?.text;
    if (output === undefined) return { body: source, preamble: '', unresolved: true };
    return finalize(source, imports, output, base);
  } catch {
    return { body: source, preamble: '', unresolved: true };
  }
}

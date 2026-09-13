import { buildSync } from 'esbuild';
import { parse } from 'acorn';

/**
 * Where a cell's bare/relative import specifiers are resolved from.
 *
 * The shell passes the workspace root as \`resolveDir\` (so relative imports
 * resolve against the document's repository) and a list of \`nodePaths\` roots
 * (the workspace's own \`node_modules\`, then the host app's) so bare package
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

let counter = 0;

/**
 * Rewrite a cell's ES module imports into self-contained \`var\` bindings.
 *
 * The cell is already JS by the time it reaches here (the compiler strips
 * TS/JSX first), so we can parse it with acorn to find \`import\` declarations.
 * For each import we build a synthetic re-export entry and bundle it with
 * esbuild into an IIFE whose return value is the module namespace; the cell
 * body then binds the imported local names off that namespace.
 *
 * \`@tributary/api\` / \`@tributary/components\` never reach this point — they
 * are shimmed to the injected capability scope before resolution.
 */
export function resolveImports(source: string, options: ResolveOptions = {}): ResolvedCell {
  let ast;
  try {
    ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  } catch {
    // Not parseable as a module: leave as-is and let the caller surface it.
    return { body: source, preamble: '', unresolved: false };
  }

  const imports = (ast.body as unknown[]).filter(
    (n) => (n as { type: string }).type === 'ImportDeclaration'
  ) as Array<{
    start: number;
    end: number;
    specifiers: Array<{
      type: 'ImportSpecifier' | 'ImportDefaultSpecifier' | 'ImportNamespaceSpecifier';
      local: { name: string };
      imported?: { name: string };
    }>;
  }>;

  if (imports.length === 0) {
    return { body: source, preamble: '', unresolved: false };
  }

  // Re-emit every import as-is plus one export of all local names, so the
  // bundle's namespace exposes exactly the names the cell binds.
  const locals: string[] = [];
  const entryParts: string[] = [];
  for (const imp of imports) {
    entryParts.push(source.slice(imp.start, imp.end));
    for (const spec of imp.specifiers) {
      locals.push(spec.local.name);
    }
  }
  const base = '__imp_' + counter++;
  const entry = entryParts.join('\n') + (locals.length > 0 ? '\nexport { ' + locals.join(', ') + ' };' : '');

  let output: string;
  try {
    const result = buildSync({
      bundle: true,
      write: false,
      format: 'iife',
      globalName: base,
      platform: 'browser',
      // React and friends probe NODE_ENV at import time; resolve it at build
      // time so bundled libraries never touch the (scope-locked) \`process\`.
      define: { 'process.env.NODE_ENV': JSON.stringify('production') },
      logLevel: 'silent',
      stdin: {
        contents: entry,
        resolveDir: options.resolveDir ?? process.cwd(),
        loader: 'js',
      },
      nodePaths: options.nodePaths,
    });
    output = result.outputFiles[0]!.text;
  } catch {
    // Unresolvable import: leave the import in place so the per-cell error
    // path surfaces a clear failure instead of throwing out of the document.
    return { body: source, preamble: '', unresolved: true };
  }

  // Bind each imported local off the namespace returned by the bundle IIFE.
  // The synthetic entry re-exports every binding under its LOCAL name, so the
  // namespace property is always the local name regardless of import form
  // (named, aliased, default or namespace).
  const decls: string[] = [];
  for (const imp of imports) {
    for (const spec of imp.specifiers) {
      const local = spec.local.name;
      decls.push('var ' + local + ' = ' + base + '.' + local + ';');
    }
  }

  // Remove the import statements from the body (last-to-first keeps offsets).
  let body = source;
  const sorted = [...imports].sort((a, b) => b.start - a.start);
  for (const imp of sorted) {
    body = body.slice(0, imp.start) + body.slice(imp.end);
  }

  return { body, preamble: output + '\n' + decls.join('\n') + '\n', unresolved: false };
}

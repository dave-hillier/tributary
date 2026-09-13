import { transformSync } from 'esbuild';
import { parse } from 'acorn';
import type { CellLanguage } from './compiler.js';
import { shimImports } from './compiler.js';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

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

export interface ReactiveCell {
  lang: CellLanguage;
  source: string;
}

export interface ReactiveContext {
  React?: unknown;
  api?: unknown;
  components?: unknown;
}

export interface CompiledReactiveCell {
  provided: string[];
  refs: Set<string>;
  run: (scope: Record<string, unknown>, context: ReactiveContext) => Promise<unknown>;
}

/**
 * Compile one cell so it shares a scope with others: top-level `const X = ...`
 * declarations are written to the shared `scope` object, references to other
 * cells' names resolve through `with (scope)`, and the final expression is
 * the cell's output.
 */
export function compileReactiveCell(source: string, lang: CellLanguage): CompiledReactiveCell {
  const js = transformSync(shimImports(source), {
    loader: lang,
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
  }).code;

  const refs = collectIdentifiers(js);
  const provided: string[] = [];

  let ast;
  try {
    ast = parse(js, { ecmaVersion: 'latest', sourceType: 'module' });
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
      out += js.slice(cursor, stmt.start);
      if (stmt.type === 'VariableDeclaration') {
        out += js.slice(stmt.start, stmt.end);
        const names = stmt.declarations
          .filter((d) => d.id.type === 'Identifier')
          .map((d) => (d.id as any).name as string);
        for (const n of names) {
          provided.push(n);
          refs.delete(n);
          out += '\nscope.' + n + ' = ' + n + ';';
        }
      } else if (idx === stmts.length - 1 && stmt.type === 'ExpressionStatement') {
        out += 'return (' + js.slice(stmt.expression.start, stmt.expression.end) + ');';
      } else {
        out += js.slice(stmt.start, stmt.end);
      }
      cursor = stmt.end;
    }
    out += '}';
    body = out;
  }

  const fn = new AsyncFunction('scope', '__scope', 'React', body);
  return {
    provided,
    refs,
    run: (scope, context) => fn(scope, { api: context.api, components: context.components }, context.React),
  };
}

export class ReactiveHost {
  private compiled: CompiledReactiveCell[] = [];
  private scope: Record<string, unknown> = {};
  private outputs: unknown[] = [];
  private reverse = new Map<number, number[]>();
  lastEvaluated: number[] = [];

  constructor(private cells: ReactiveCell[]) {
    this.compiled = cells.map((c) => compileReactiveCell(c.source, c.lang));
    this.buildReverse();
  }

  private buildReverse(): void {
    this.reverse.clear();
    for (let i = 0; i < this.cells.length; i++) {
      for (const d of this.dependencies(i)) {
        const arr = this.reverse.get(d) ?? [];
        arr.push(i);
        this.reverse.set(d, arr);
      }
    }
  }

  private dependencies(i: number): number[] {
    const out: number[] = [];
    for (let j = 0; j < this.cells.length; j++) {
      if (j === i) continue;
      if (this.compiled[j]!.provided.some((p) => this.compiled[i]!.refs.has(p))) {
        out.push(j);
      }
    }
    return out;
  }

  private topoOrder(indices: number[]): number[] {
    const set = new Set(indices);
    const indeg = new Map<number, number>();
    for (const i of indices) {
      indeg.set(i, this.dependencies(i).filter((d) => set.has(d)).length);
    }
    const queue = indices.filter((i) => (indeg.get(i) ?? 0) === 0);
    const order: number[] = [];
    while (queue.length) {
      const i = queue.shift()!;
      order.push(i);
      for (const d of this.reverse.get(i) ?? []) {
        if (!set.has(d)) continue;
        const nd = (indeg.get(d) ?? 0) - 1;
        indeg.set(d, nd);
        if (nd === 0) queue.push(d);
      }
    }
    return order;
  }

  private async evaluateOne(i: number, context: ReactiveContext): Promise<void> {
    this.outputs[i] = await this.compiled[i]!.run(this.scope, context);
  }

  async evaluate(context: ReactiveContext): Promise<unknown[]> {
    this.scope = {};
    this.outputs = new Array(this.cells.length).fill(undefined);
    this.lastEvaluated = [];
    for (const i of this.topoOrder(this.cells.map((_, k) => k))) {
      await this.evaluateOne(i, context);
      this.lastEvaluated.push(i);
    }
    return this.outputs;
  }

  async update(i: number, newSource: string, context: ReactiveContext): Promise<unknown[]> {
    const cell = this.cells[i]!;
    this.cells[i] = { lang: cell.lang, source: newSource };
    this.compiled[i] = compileReactiveCell(newSource, cell.lang);
    this.buildReverse();
    const affected = new Set<number>([i]);
    const stack = [i];
    while (stack.length) {
      const n = stack.pop()!;
      for (const d of this.reverse.get(n) ?? []) {
        if (!affected.has(d)) {
          affected.add(d);
          stack.push(d);
        }
      }
    }
    this.lastEvaluated = [];
    for (const j of this.topoOrder([...affected])) {
      await this.evaluateOne(j, context);
      this.lastEvaluated.push(j);
    }
    return this.outputs;
  }
}
/**
 * Renderer-safe notebook runtime: evaluates already-compiled cells with the
 * shared-scope reactive model. This module deliberately imports NO esbuild and
 * NO acorn, so it can be bundled into the browser renderer (see
 * @tributary/notebook/runtime). Compilation lives in compiler.ts (main only).
 */

export interface ReactiveCell {
  lang: 'js' | 'ts' | 'jsx' | 'tsx';
  source: string;
}

export interface ReactiveContext {
  React?: unknown;
  api?: unknown;
  components?: unknown;
}

/** A cell already compiled to a self-contained JS body plus its graph metadata. */
export interface CompiledReactiveCell {
  /** Top-level names this cell writes into the shared scope. */
  provided: string[];
  /** Names this cell references (for dependency detection). */
  refs: string[];
  /** Self-contained JS: import preamble + the \`with (scope) { … }\` block. */
  js: string;
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/**
 * Capability boundary preamble (ADR-004): cells execute with ONLY React and
 * __scope (api/components) in scope. Shadowing the ambient runtime binding
 * names as local undefineds denies the ambient power set — process, require,
 * module hooks, the browser globals and globalThis itself — so a cell must go
 * through the capability API to touch the host. (Workspaces are trusted in v1
 * per arch §8; this seals the API seam, not a hostile sandbox.)
 *
 * This lives in the esbuild-free runtime entry so the renderer can apply the
 * same lock the compiler applies on the main-process path.
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

/** Wrap a compiled AsyncFunction body in the capability-boundary preamble. */
export function withScopeLock(body: string): string {
  return SCOPE_LOCK_PREFIX + body;
}

/** Reconstruct a runnable cell from its compiled JS (no esbuild required). */
export function makeReactiveRunner(compiled: CompiledReactiveCell) {
  const fn = new AsyncFunction('scope', '__scope', 'React', withScopeLock(compiled.js));
  return (scope: Record<string, unknown>, context: ReactiveContext): Promise<unknown> =>
    fn(scope, { api: context.api, components: context.components }, context.React);
}

export class ReactiveHost {
  private scope: Record<string, unknown> = {};
  private outputs: unknown[] = [];
  private reverse = new Map<number, number[]>();
  private deps: number[][] = [];
  private runners: Array<(scope: Record<string, unknown>, context: ReactiveContext) => Promise<unknown>> = [];
  lastEvaluated: number[] = [];

  constructor(private cells: CompiledReactiveCell[]) {
    this.runners = cells.map(makeReactiveRunner);
    this.buildReverse();
  }

  private buildReverse(): void {
    this.reverse.clear();
    // Cache each cell's dependencies once; topoOrder used to recompute them per
    // node on every sort (O(n^3)).
    this.deps = this.cells.map((_, i) => this.dependencies(i));
    for (let i = 0; i < this.cells.length; i++) {
      for (const d of this.deps[i]!) {
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
      if (this.cells[j]!.provided.some((p) => this.cells[i]!.refs.includes(p))) {
        out.push(j);
      }
    }
    return out;
  }

  private topoOrder(indices: number[]): number[] {
    const set = new Set(indices);
    const indeg = new Map<number, number>();
    for (const i of indices) {
      indeg.set(i, (this.deps[i] ?? []).filter((d) => set.has(d)).length);
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

  /** Any cell the topological sort could not place sits in a dependency cycle. */
  private reportCycles(indices: number[], order: number[]): void {
    const placed = new Set(order);
    for (const i of indices) {
      if (placed.has(i)) continue;
      this.outputs[i] = new Error('Circular dependency involving cell ' + (i + 1));
      this.lastEvaluated.push(i);
    }
  }

  private async evaluateOne(i: number, context: ReactiveContext): Promise<void> {
    try {
      this.outputs[i] = await this.runners[i]!(this.scope, context);
    } catch (e) {
      // Per-cell error isolation: a thrown cell becomes that cell's error
      // output rather than failing the whole document.
      this.outputs[i] = e instanceof Error ? e : new Error(String(e));
    }
  }

  async evaluate(context: ReactiveContext): Promise<unknown[]> {
    this.scope = {};
    this.outputs = new Array(this.cells.length).fill(undefined);
    this.lastEvaluated = [];
    const all = this.cells.map((_, k) => k);
    const order = this.topoOrder(all);
    for (const i of order) {
      await this.evaluateOne(i, context);
      this.lastEvaluated.push(i);
    }
    this.reportCycles(all, order);
    return this.outputs;
  }

  async update(i: number, compiled: CompiledReactiveCell, context: ReactiveContext): Promise<unknown[]> {
    this.cells[i] = compiled;
    this.runners[i] = makeReactiveRunner(compiled);
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
    const affectedList = [...affected];
    const order = this.topoOrder(affectedList);
    for (const j of order) {
      await this.evaluateOne(j, context);
      this.lastEvaluated.push(j);
    }
    this.reportCycles(affectedList, order);
    return this.outputs;
  }
}

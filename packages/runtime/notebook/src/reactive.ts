/**
 * Renderer-safe notebook runtime: evaluates already-compiled cells with the
 * shared-scope reactive model. This module deliberately imports NO esbuild and
 * NO acorn, so it can be bundled into the browser renderer (see
 * @tributary/notebook/runtime). Compilation lives in compiler.ts (main only).
 *
 * This is the `NotebookHost` implementation the app runs (arch §6, ADR-002):
 * the esbuild/TSX dialect is executed here, while the expression evaluators in
 * custom-evaluator.ts / observable-adapter.ts share the same contract. Keeping
 * the reactive semantics identical across those implementations is what makes
 * the boundary swappable — the shared test drives all of them.
 */

import type {
  CompiledCellDef,
  CompiledReactiveCell,
  NotebookHost,
  NotebookHostOptions,
} from './types.js';

export type { CompiledCellDef, CompiledReactiveCell };

export interface ReactiveCell {
  lang: 'js' | 'ts' | 'jsx' | 'tsx';
  source: string;
}

export interface ReactiveContext {
  React?: unknown;
  api?: unknown;
  components?: unknown;
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

/**
 * Stamp a name onto compiled output. Cells are anonymous in the Markdown
 * dialect, so the name is supplied by the caller — the shell uses
 * `${docId}#${index}`.
 */
export function withName(name: string, compiled: CompiledReactiveCell): CompiledCellDef {
  return { name, ...compiled };
}

/** Reconstruct a runnable cell from its compiled JS (no esbuild required). */
export function makeReactiveRunner(compiled: CompiledReactiveCell) {
  const fn = new AsyncFunction('scope', '__scope', 'React', withScopeLock(compiled.js));
  return (scope: Record<string, unknown>, context: ReactiveContext): Promise<unknown> =>
    fn(scope, { api: context.api, components: context.components }, context.React);
}

/**
 * Reactive host over compiled cells, keyed by cell name.
 *
 * Semantics mirror `createCustomNotebookHost` (the seam's other implementation)
 * so the two are genuinely swappable:
 * - only dirty cells and their transitive dependants recompute;
 * - invalidating a cell drops its stale bindings AND its recorded error;
 * - a cell's failure propagates to its dependants rather than letting them read
 *   the pre-error value;
 * - a superseded `evaluate` stops writing;
 * - `dispose` cancels in-flight work and releases every binding.
 */
export class ReactiveHost implements NotebookHost<CompiledCellDef> {
  private cells: CompiledCellDef[] = [];
  private runners: Array<(scope: Record<string, unknown>, context: ReactiveContext) => Promise<unknown>> = [];
  private outputs: unknown[] = [];
  private names: string[] = [];
  private byName = new Map<string, number>();

  /** Live bindings published by cells (name -> value). */
  private bindings: Record<string, unknown> = {};
  /** The error recorded for a published name, so dependants see the failure. */
  private errors = new Map<string, unknown>();
  /**
   * Stable view handed to runners as `scope`. `with (scope)` resolves names
   * through `has`/`get`, which is the only way to make a failed cell poison its
   * dependants: the compiled body reads bare names, not a getter we control.
   */
  private scope: Record<string, unknown>;

  private deps: number[][] = [];
  private reverse = new Map<number, number[]>();
  private dirty = new Set<number>();
  private generation = 0;
  private disposed = false;

  /** Indices recomputed by the last `evaluate` — the observable dirty subset. */
  lastEvaluated: number[] = [];

  constructor(cells: CompiledCellDef[] = [], private options: NotebookHostOptions = {}) {
    this.scope = this.makeScope();
    for (const cell of cells) this.define(cell);
  }

  /**
   * `with (scope)` asks `has` whether a name is bound, and only falls through to
   * the enclosing scope when it is not. So `has` must be FALSE for ambient names
   * (Promise, Object, Math, undefined) or every cell breaks, and `get` must throw
   * the recorded error for a name whose providing cell failed.
   */
  private makeScope(): Record<string, unknown> {
    const host = this;
    return new Proxy(this.bindings, {
      has(_target, prop): boolean {
        if (typeof prop !== 'string') return false;
        return prop in host.bindings || host.errors.has(prop);
      },
      get(_target, prop): unknown {
        // `with` reads this to build its unscopables list; returning a value
        // makes the whole block stop resolving names.
        if (prop === Symbol.unscopables) return undefined;
        if (typeof prop !== 'string') return undefined;
        if (host.disposed) throw new Error('notebook host disposed');
        const failure = host.errors.get(prop);
        if (failure !== undefined) throw failure;
        return host.bindings[prop];
      },
    });
  }

  private context(): ReactiveContext {
    return (this.options.context ?? {}) as ReactiveContext;
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

  /** Drop a cell's published bindings and recorded error. */
  private clearBindings(i: number): void {
    for (const name of this.cells[i]?.provided ?? []) {
      delete this.bindings[name];
      this.errors.delete(name);
    }
  }

  /** Mark a cell and its transitive dependants dirty, dropping stale state. */
  private markDirtyFrom(i: number): void {
    const stack = [i];
    const seen = new Set<number>();
    while (stack.length) {
      const j = stack.pop()!;
      if (seen.has(j)) continue;
      seen.add(j);
      this.dirty.add(j);
      this.outputs[j] = undefined;
      this.clearBindings(j);
      for (const d of this.reverse.get(j) ?? []) stack.push(d);
    }
  }

  define(cell: CompiledCellDef): void {
    if (this.disposed) return;
    // Bumping here (not just in evaluate) matters: define mutates the very
    // arrays an in-flight evaluate is indexing.
    this.generation++;

    const existing = this.byName.get(cell.name);
    if (existing === undefined) {
      const i = this.cells.length;
      this.names.push(cell.name);
      this.byName.set(cell.name, i);
      this.cells.push(cell);
      this.outputs.push(undefined);
      this.runners[i] = makeReactiveRunner(cell);
      this.buildReverse();
      this.markDirtyFrom(i);
      return;
    }

    // Dirty against the OLD shape first: if this cell stops providing a name,
    // the cells that used to read it are no longer adjacent in the new graph,
    // so this is the only chance to mark them. It also drops the cell's own
    // stale bindings while `this.cells[i].provided` still describes them.
    const previous = this.cells[existing]!.provided;
    this.markDirtyFrom(existing);

    this.cells[existing] = cell;
    this.runners[existing] = makeReactiveRunner(cell);
    this.outputs[existing] = undefined;
    // Then against the new shape, so newly-introduced dependants are covered.
    this.buildReverse();
    this.markDirtyFrom(existing);

    // A cell that failed to compile declares nothing, so the names it used to
    // publish have just been dropped. Record the real cause against each, so its
    // dependants report the compile failure rather than a bare ReferenceError —
    // this is the common case while typing in the cell editor. Deliberately
    // after the markDirty above, which clears errors for the old names.
    if (cell.compileError !== undefined) {
      for (const name of previous) this.errors.set(name, new Error(cell.compileError));
    }
  }

  invalidate(name: string): void {
    if (this.disposed) return;
    const i = this.byName.get(name);
    if (i === undefined) return;
    this.markDirtyFrom(i);
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
      const err = new Error('Circular dependency involving cell ' + (i + 1));
      this.outputs[i] = err;
      // Record it against the names the cell would have published, so its
      // dependants see the cycle rather than a bare ReferenceError.
      for (const name of this.cells[i]?.provided ?? []) this.errors.set(name, err);
      this.lastEvaluated.push(i);
    }
  }

  private async evaluateOne(i: number, context: ReactiveContext): Promise<void> {
    const cell = this.cells[i];
    if (!cell) return;
    try {
      this.outputs[i] = await this.runners[i]!(this.scope, context);
      for (const name of cell.provided) this.errors.delete(name);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      // The compiled body publishes `scope.x = x` at each declaration, so a cell
      // that throws mid-body has already leaked its earlier names. Drop them and
      // record the failure under each, so dependants fail too instead of reading
      // a half-built value.
      for (const name of cell.provided) {
        delete this.bindings[name];
        this.errors.set(name, err);
      }
      this.outputs[i] = err;
      this.options.onError?.(cell.name, err);
    }
  }

  private currentValues(): Map<string, unknown> {
    const out = new Map<string, unknown>();
    for (let i = 0; i < this.names.length; i++) out.set(this.names[i]!, this.outputs[i]);
    return out;
  }

  async evaluate(): Promise<Map<string, unknown>> {
    if (this.disposed) return new Map();
    const gen = ++this.generation;
    this.lastEvaluated = [];

    const dirtyList = [...this.dirty].filter((i) => i < this.cells.length);
    const order = this.topoOrder(dirtyList);
    this.reportCycles(dirtyList, order);

    const context = this.context();
    for (const i of order) {
      // A newer evaluate/define superseded this one; stop writing.
      if (gen !== this.generation) return this.currentValues();
      await this.evaluateOne(i, context);
      if (gen !== this.generation) return this.currentValues();
      this.lastEvaluated.push(i);
    }

    this.dirty.clear();
    return this.currentValues();
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    for (const name of Object.keys(this.bindings)) delete this.bindings[name];
    this.errors.clear();
    this.dirty.clear();
    this.cells = [];
    this.runners = [];
    this.outputs = [];
    this.names = [];
    this.byName.clear();
    this.deps = [];
    this.reverse.clear();
    this.lastEvaluated = [];
  }
}

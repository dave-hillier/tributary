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

/** Reconstruct a runnable cell from its compiled JS (no esbuild required). */
export function makeReactiveRunner(compiled: CompiledReactiveCell) {
  const fn = new AsyncFunction('scope', '__scope', 'React', compiled.js);
  return (scope: Record<string, unknown>, context: ReactiveContext): Promise<unknown> =>
    fn(scope, { api: context.api, components: context.components }, context.React);
}

export class ReactiveHost {
  private scope: Record<string, unknown> = {};
  private outputs: unknown[] = [];
  private reverse = new Map<number, number[]>();
  private runners: Array<(scope: Record<string, unknown>, context: ReactiveContext) => Promise<unknown>> = [];
  lastEvaluated: number[] = [];

  constructor(private cells: CompiledReactiveCell[]) {
    this.runners = cells.map(makeReactiveRunner);
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
    for (const i of this.topoOrder(this.cells.map((_, k) => k))) {
      await this.evaluateOne(i, context);
      this.lastEvaluated.push(i);
    }
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
    for (const j of this.topoOrder([...affected])) {
      await this.evaluateOne(j, context);
      this.lastEvaluated.push(j);
    }
    return this.outputs;
  }
}

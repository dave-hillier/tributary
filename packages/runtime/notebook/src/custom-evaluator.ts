import type { CellDef, NotebookHost, NotebookHostOptions } from './types.js';
import { compileCell } from './dependency.js';

/**
 * A minimal reactive dependency evaluator: auto-discovers dependencies,
 * computes in topological order, caches values, and on invalidate() recomputes
 * only the affected cell and its transitive dependants.
 */
export function createCustomNotebookHost(options: NotebookHostOptions = {}): NotebookHost {
  const { onError, builtins = {} } = options;
  const cells = new Map<string, CellDef>();
  const values = new Map<string, unknown>();
  const errors = new Map<string, unknown>();
  const dirty = new Set<string>();
  const reverse = new Map<string, Set<string>>(); // name -> dependant names
  let generation = 0;

  function getValue(name: string): unknown {
    if (errors.has(name)) throw errors.get(name);
    if (values.has(name)) return values.get(name);
    if (name in builtins) return builtins[name];
    if (cells.has(name)) throw new Error(`Cell not computed yet (circular?): ${name}`);
    throw new ReferenceError(`Unknown cell or builtin: ${name}`);
  }

  function markDirtyFrom(name: string): void {
    const stack = [name];
    const seen = new Set<string>();
    while (stack.length) {
      const n = stack.pop()!;
      if (seen.has(n)) continue;
      seen.add(n);
      dirty.add(n);
      values.delete(n);
      errors.delete(n);
      for (const d of reverse.get(n) ?? []) stack.push(d);
    }
  }

  return {
    define(cell: CellDef): void {
      cells.set(cell.name, cell);
      values.delete(cell.name);
      errors.delete(cell.name);
      dirty.add(cell.name);
      // if re-defining, propagate to known dependants
      if (reverse.size > 0) markDirtyFrom(cell.name);
    },

    invalidate(name: string): void {
      if (!cells.has(name)) return;
      markDirtyFrom(name);
    },

    async evaluate(): Promise<Map<string, unknown>> {
      const gen = ++generation;
      const compiled = new Map<string, ReturnType<typeof compileCell>>();

      // (re)discover dependencies and build the reverse adjacency map.
      reverse.clear();
      for (const [name, cell] of cells) {
        compiled.set(name, compileCell(cell.source));
      }
      for (const [name, c] of compiled) {
        for (const dep of c.deps) {
          if (!cells.has(dep)) continue;
          let s = reverse.get(dep);
          if (!s) {
            s = new Set();
            reverse.set(dep, s);
          }
          s.add(name);
        }
      }

      // Topologically sort only the dirty cells (Kahn over the dirty subset).
      const dirtyList = [...dirty];
      const indegree = new Map<string, number>();
      for (const name of dirtyList) {
        const c = compiled.get(name);
        indegree.set(name, c ? c.deps.filter((d) => dirty.has(d)).length : 0);
      }
      const queue = dirtyList.filter((n) => (indegree.get(n) ?? 0) === 0);
      const order: string[] = [];
      while (queue.length) {
        const n = queue.shift()!;
        order.push(n);
        for (const dep of reverse.get(n) ?? []) {
          if (!dirty.has(dep)) continue;
          const nd = (indegree.get(dep) ?? 0) - 1;
          indegree.set(dep, nd);
          if (nd === 0) queue.push(dep);
        }
      }
      // Any remaining dirty cells form a cycle; surface an error for them.
      for (const n of dirtyList) {
        if (!order.includes(n)) {
          errors.set(n, new Error(`Circular dependency involving ${n}`));
          onError?.(n, errors.get(n));
        }
      }

      // Evaluate dirty cells in dependency order, tolerating per-cell errors.
      for (const name of order) {
        if (gen !== generation) return new Map(values);
        const c = compiled.get(name);
        if (!c) continue;
        try {
          const result = c.run(getValue);
          const v = result instanceof Promise ? await result : result;
          if (gen !== generation) return new Map(values);
          values.set(name, v);
        } catch (e) {
          errors.set(name, e);
          onError?.(name, e);
        }
      }
      dirty.clear();
      return new Map(values);
    },

    dispose(): void {
      generation++;
      cells.clear();
      values.clear();
      errors.clear();
      dirty.clear();
      reverse.clear();
    },
  };
}
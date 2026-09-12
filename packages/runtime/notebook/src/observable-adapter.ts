import { Runtime, Library } from '@observablehq/runtime';
import type { CellDef, NotebookHost, NotebookHostOptions } from './types.js';
import { compileCell } from './dependency.js';

/**
 * Thin adapter exposing the SAME NotebookHost surface over Observable
 * (@observablehq/runtime). Dependencies are discovered with the same technique
 * as the custom evaluator, then handed to Observable as explicit `inputs`.
 * This is what proves the two implementations are swappable behind NotebookHost.
 */
export function createObservableNotebookHost(options: NotebookHostOptions = {}): NotebookHost {
  const { onError } = options;
  const cells = new Map<string, CellDef>();
  let runtime: Runtime | null = null;

  return {
    define(cell: CellDef): void {
      cells.set(cell.name, cell);
    },

    invalidate(): void {
      // Observable tracks its own dirty state; a re-evaluate recomputes all.
    },

    async evaluate(): Promise<Map<string, unknown>> {
      runtime?.dispose();
      runtime = new Runtime(new Library());
      const main = runtime.module();
      const results = new Map<string, unknown>();
      const pending: Promise<void>[] = [];

      // Discover dependencies first so we can pass explicit input lists.
      const discovered = new Map<string, string[]>();
      for (const [name, cell] of cells) {
        discovered.set(name, compileCell(cell.source).deps.filter((d) => cells.has(d)));
      }

      for (const [name, cell] of cells) {
        const deps = discovered.get(name)!;
        const fn = new Function(...deps, `return (${cell.source});`) as (...inputs: unknown[]) => unknown;
        let resolve!: () => void;
        pending.push(new Promise<void>((res) => (resolve = res)));
        const observer = {
          fulfilled(value: unknown) {
            results.set(name, value);
            resolve();
          },
          rejected(err: unknown) {
            onError?.(name, err);
            resolve();
          },
        };
        main.variable(observer).define(name, deps, fn);
      }

      await Promise.all(pending);
      return results;
    },

    dispose(): void {
      runtime?.dispose();
      runtime = null;
      cells.clear();
    },
  };
}
/**
 * Renderer-safe runtime entry: evaluation only, no esbuild / no acorn, so the
 * browser renderer can import it without pulling in the native esbuild binary.
 * Compilation stays behind the package's main entry (main process only).
 */
export {
  ReactiveHost,
  makeReactiveRunner,
  withName,
  type CompiledReactiveCell,
  type ReactiveCell,
  type ReactiveContext,
} from './reactive.js';

export type {
  CompiledCellDef,
  NotebookHost,
  NotebookHostOptions,
} from './types.js';

/**
 * Shared vocabulary for the notebook host boundary.
 *
 * NotebookHost is the swap boundary for notebook execution (arch §6, ADR-002).
 * Moving between implementations must not change the persisted document — cells
 * live in Markdown, only their *evaluation* is hosted here.
 */

/** A single named computational cell, as authored: a name plus source text. */
export interface CellDef {
  name: string;
  /** JS expression; may reference other cells or builtins by bare name. */
  source: string;
  lang?: string;
}

/** A cell already compiled to a self-contained JS body plus its graph metadata. */
export interface CompiledReactiveCell {
  /** Top-level names this cell writes into the shared scope. */
  provided: string[];
  /** Names this cell references (for dependency detection). */
  refs: string[];
  /** Self-contained JS: import preamble + the `with (scope) { … }` block. */
  js: string;
  /**
   * Set when the cell could not be compiled; `js` throws this same message.
   * A failed cell declares nothing, so without this a host cannot tell a
   * dependant why a name it used to read has gone.
   */
  compileError?: string;
}

/**
 * A cell definition the compiler has already processed (the esbuild/TSX path).
 * Compilation happens in the main process — the renderer bundle cannot include
 * esbuild (see `@tributary/notebook/runtime`) — so a host on that path receives
 * the compiled artefact rather than source text. `name` is the host key.
 */
export interface CompiledCellDef extends CompiledReactiveCell {
  name: string;
}

export interface NotebookHostOptions {
  /** Called once per cell that fails to compute. */
  onError?: (name: string, err: unknown) => void;
  /** Extra functions/values made available to cell expressions. */
  builtins?: Record<string, unknown>;
  /**
   * Opaque host context threaded to cell runners — the renderer passes React
   * and the component registry here, which a compiled cell body references as
   * bare names.
   */
  context?: unknown;
}

/**
 * NotebookHost is the swap boundary for notebook execution (arch §6). Moving
 * between implementations must not change the persisted document — cells live
 * in Markdown, only their *evaluation* is hosted here.
 *
 * Generic over the cell definition a host consumes, so an expression evaluator
 * (`CellDef`, source text) and the compiled esbuild/TSX host (`CompiledCellDef`)
 * satisfy one contract.
 */
export interface NotebookHost<TDef extends { name: string } = CellDef> {
  /** Register (or replace) a cell definition. */
  define(cell: TDef): void;
  /** (Re)compute dirty cells and return the latest value per cell name. */
  evaluate(): Promise<Map<string, unknown>>;
  /** Mark a cell and its transitive dependants dirty. */
  invalidate(name: string): void;
  /** Stop in-flight work and release state. */
  dispose(): void;
}

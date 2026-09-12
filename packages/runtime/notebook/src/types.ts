/** A single named computational cell. */
export interface CellDef {
  name: string;
  /** JS expression; may reference other cells or builtins by bare name. */
  source: string;
  lang?: string;
}

export interface NotebookHostOptions {
  /** Called once per cell that fails to compute. */
  onError?: (name: string, err: unknown) => void;
  /** Extra functions/values made available to cell expressions. */
  builtins?: Record<string, unknown>;
}

/**
 * NotebookHost is the swap boundary for notebook execution (arch §6). Moving
 * between implementations must not change the persisted document — cells live
 * in Markdown, only their *evaluation* is hosted here.
 */
export interface NotebookHost {
  /** Register (or replace) a cell definition. */
  define(cell: CellDef): void;
  /** (Re)compute dirty cells and return the latest value per cell name. */
  evaluate(): Promise<Map<string, unknown>>;
  /** Mark a cell and its transitive dependants dirty. */
  invalidate(name: string): void;
  /** Stop in-flight work and release state. */
  dispose(): void;
}

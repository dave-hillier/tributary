/**
 * Debounced save scheduling. The important property (and the one the renderer
 * got wrong) is that a scheduled save runs with the value that *triggered* it,
 * never with whatever mutable state the surrounding render might see later.
 */
export interface Autosave {
  /** Schedule a save for `source`, replacing any pending one. */
  schedule: (source: string) => void;
  /** Drop any pending save. */
  cancel: () => void;
}

export function createAutosave(
  save: (source: string) => void | Promise<void>,
  delayMs: number
): Autosave {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule(source: string): void {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void save(source);
      }, delayMs);
    },
    cancel(): void {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

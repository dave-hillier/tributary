// Minimal ambient types for @observablehq/runtime@5 (ships no TypeScript types).
declare module '@observablehq/runtime' {
  export class Library {
    constructor();
  }
  export class RuntimeError extends Error {}
  export class Inspector {
    constructor(node: unknown);
  }
  export interface VariableObserver {
    pending?(): void;
    fulfilled?(value: unknown): void;
    rejected?(error: unknown): void;
  }
  export class Variable {
    define(name: string, inputs: string[], value: (...inputs: unknown[]) => unknown): Variable;
  }
  export class Module {
    variable(observer: VariableObserver): Variable;
  }
  export class Runtime {
    constructor(builtins?: Library, global?: unknown);
    module(
      define?: (runtime: Runtime, observer: (name?: string) => VariableObserver) => void,
      observer?: VariableObserver
    ): Module;
    dispose(): void;
    fileAttachments(name: string): unknown;
  }
}

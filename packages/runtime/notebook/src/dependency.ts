/**
 * Compile a cell source into a dependency-aware runner.
 *
 * Dependencies are discovered by evaluating the expression once against a
 * Proxy that records every bare-name read (the classic `with` + Proxy trick).
 * The discovery scope returns a callable proxy for every name so that calling a
 * builtin (e.g. `count('a')`) does not throw mid-expression and hide later
 * dependencies. The returned runner evaluates the same expression against a
 * live scope that resolves names through the supplied `get` callback.
 */
export interface CompiledCell {
  deps: string[];
  run: (get: (name: string) => unknown) => unknown;
}

export function compileCell(source: string): CompiledCell {
  const accessed = new Set<string>();
  const fn = new Function('cells', `with (cells) { return (${source}); }`);

  // A callable, self-proxying value so discovery never throws on call/property
  // access (it just continues, recording more bare names).
  const discoveryValue: unknown = new Proxy(function () {}, {
    apply() {
      return undefined;
    },
    get(_t, p) {
      return p === Symbol.unscopables || p === 'then' ? undefined : discoveryValue;
    },
    has(_t, p) {
      return p !== Symbol.unscopables;
    },
  });

  const discovery = new Proxy<Record<string, unknown>>({}, {
    has(_t, p) {
      if (p === Symbol.unscopables) return false;
      const n = String(p);
      if (n !== 'cells') accessed.add(n);
      return true;
    },
    get(_t, p) {
      if (p === Symbol.unscopables) return undefined;
      const n = String(p);
      if (n !== 'cells') accessed.add(n);
      return discoveryValue;
    },
  });

  try {
    fn(discovery);
  } catch {
    // partial discovery on a throwing expression is acceptable
  }

  return {
    deps: [...accessed],
    run(get) {
      const live = new Proxy<Record<string, unknown>>({}, {
        has(_t, p) {
          return p !== Symbol.unscopables;
        },
        get(_t, p) {
          if (p === Symbol.unscopables) return undefined;
          return get(String(p));
        },
      });
      return fn(live);
    },
  };
}

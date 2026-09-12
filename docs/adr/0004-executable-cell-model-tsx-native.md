# ADR-004 — Executable cell model: TSX-native

- **Status:** Proposed (supersedes the `replotBlock`/`cellBlock` split in ADR-001)
- **Date:** 2026-09-12
- **Source:** architecture §4.3 (Block semantics), §6 (Notebook and rendered-block execution)

## Context

ADR-001 introduced two block types — a static `replotBlock` and a generic
`cellBlock` (`js cell=name`). On review, treating Replot as a special block
was the wrong split: Replot is just a React component, and the format should
have **one** executable cell type, with `tsx` as the native language for rich
rendered output.

## Decision

- **Fenced blocks are notebook cells.** `js`, `ts`, `jsx`, `tsx` are
  variants of a single cell model (a `cell` node carrying `lang`); later
  languages (`sql`, `python`, `shell`) slot into the same model.
- **TSX is the native rich-output language.** Replot is a React component from
  `@tributary/components`, not a block type. Anything visual is whatever the
  cell evaluates to.
- **Notebook-like output semantics:** the final expression of a cell becomes its
  output (compiled to a `return`); declarations are available to downstream
  cells; component definitions can be referenced reactively by later cells.
- **Pipeline:** Markdown → mdast → cell → (js/ts/jsx/tsx transform) → JS AST →
  dependency extraction → reactive runtime → value/ReactElement → React.
  Cells are compiled with **esbuild** (`jsx: "automatic"`, `jsxImportSource:
  "react"`) in a worker/process, never in the renderer.
- **Output renderers:** string/number → Inspector, array/object → table,
  ReactElement → React, Promise → await then render, undefined → no output.
- **Imports:** normal package imports plus two app namespaces —
  `@tributary/components` (stable component API) and `@tributary/api`
  (capabilities: `workspace`, `git`, `query`).

## Open questions

1. **Executable marker.** ADR-001 says "execution is never inferred from the
   language" (bare fences are source-only; `cell=` opts in). This ADR's examples
   use bare `ts`/`tsx` fences as cells. The two are in tension. Options: (a)
   keep an explicit marker (safe, portable, but less ergonomic); (b) make
   `js/ts/jsx/tsx` fences cells by default with an explicit `source` opt-out
   (ergonomic, but a code snippet in a note would execute — a portability/safety
   surprise). **Recommendation:** keep execution explicit via a single uniform
   marker, and defer "fences are cells by default" to a workspace-level policy
   (per §12 trust posture). Needs a call.
2. **Trust posture.** "Workspaces are trusted → permissive initially" relaxes §8.
   The `@tributary/api` capability surface (`workspace`/`git`/`query`) is
   permissive in v1; sandboxing lands in Stage 7.

## Consequences

- The Markdown dialect stays small: no `chart`/`replot`/`component`/`table`
  block zoo — one `cell` block.
- Markdown is never compiled to JSX at the document level (no MDX); TSX exists
  only inside executable cells.
- Reactive component definitions make the dependency graph genuinely valuable
  (Observable-style analysis on a compiled JS AST).
- Current code must migrate: `replotBlock` and `cellBlock` collapse into one
  `cell` node (api, markdown, render, components, demo fixtures).

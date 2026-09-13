# ADR-004 — Executable cell model: TSX-native

- **Status:** Accepted (supersedes the `replotBlock`/`cellBlock` split in ADR-001)
- **Date:** 2026-09-12
- **Source:** architecture §4.3 (Block semantics), §6 (Notebook and rendered-block execution)

## Context

ADR-001 introduced two block types — a static `replotBlock` and a generic
`cellBlock` (`js cell=name`). On review, treating Replot as a special block
was the wrong split: Replot is just a React component, and the format should
have **one** executable cell type, with `tsx` as the native language for rich
rendered output.

## Decision

- **Fenced blocks are notebook cells, by default.** `js`, `ts`, `jsx`, `tsx`
  fences are `cell` nodes (one model carrying `lang`); a `source` meta opts out
  to a static `code` node; later languages (`sql`, `python`, `shell`) slot into
  the same model.
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

## Resolved decisions

1. **Executable marker:** a fence whose language is `js`/`ts`/`jsx`/`tsx` is
   a **cell by default** — it joins the reactive graph and runs on demand (run
   cell / run all / input change), never automatically on open. A `source` meta
   opts out to a static `code` node. Non-cell languages and unlabelled fences
   stay static. This reverses the earlier "never infer execution from language"
   rule.
2. **Trust posture:** the `@tributary/api` capability surface
   (`workspace`/`git`/`query`) is **permissive in v1** (workspaces are
   trusted, single-user and local), but cells execute in a **worker with a
   minimal scope** and reach the app only through the injected capability object
   — no direct main-process or raw-filesystem access. Sandboxing (permissions,
   allowlists, audit) is deferred to Stage 7 behind the unchanged
   `WorkspaceCapabilities`/`NotebookHost` boundary.

## Consequences

- The Markdown dialect stays small: no `chart`/`replot`/`component`/`table`
  block zoo — one `cell` block.
- Markdown is never compiled to JSX at the document level (no MDX); TSX exists
  only inside executable cells.
- Reactive component definitions make the dependency graph genuinely valuable
  (Observable-style analysis on a compiled JS AST).
- Current code must migrate: `replotBlock` and `cellBlock` collapse into one
  `cell` node (api, markdown, render, components, demo fixtures).
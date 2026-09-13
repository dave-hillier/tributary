# Stage 3 — Executable Cells: TSX-Native Reactive Documents

**Source:** architecture §10 "Slice 3", ADR-004.
**Outcome:** Add computational documents while retaining Markdown-first
authoring — fenced blocks are notebook cells, and TSX is the native language
for rich rendered output.
**Status:** ✅ complete — cells compile and run end-to-end (esbuild+acorn),
edit reactively with per-dependant invalidation, and persist back into the
`.md`; suite green at `e101911` (09-13). The ADR-004 capability boundary is
enforced (`57fe30b`): cells run behind a scope lock that denies ambient runtime
powers and freezes the granted `api`/`components` surface. Cells execute in the
app main process (compiled/evaluated there, results serialised to the
renderer); full separate-process isolation remains a Stage 7 hardening item —
see [`findings.md`](./findings.md).

## Goal

Treat every `js`/`ts`/`jsx`/`tsx` fenced block as a first-class executable
cell (one cell model, not a special "Replot block"), compile cells into a
dependency graph, and render cell outputs as React. Replot is just a React
library a cell imports — not a distinct format block, and not part of any
first-party component API.

## Cell model

````markdown
# Deployment status

```ts
const deployments = await api.deployments.list()
```

```tsx
import { Plot, BarY } from "replot/react"

<Plot>
  <BarY data={deployments} x="service" y="count" />
</Plot>
```
````

- `js`, `ts`, `jsx`, `tsx` are variants of the **same cell model**.
- Any React component is allowed in a `tsx` cell; nothing about Replot is
  special-cased.
- The **final expression** of a cell is its output; earlier declarations become
  available to downstream cells (notebook ergonomics, no `display()` required).

## Pipeline

```text
Markdown
  -> mdast
  -> fenced executable cell
  -> JS  : parse
     TS  : strip/compile types
     JSX : JSX transform
     TSX : TS + JSX transform
  -> JavaScript AST
  -> dependency extraction
  -> reactive cell runtime
  -> value / ReactElement
  -> React
```

- Compile cells with **esbuild** (`jsx: "automatic"`, `jsxImportSource:
  "react"`).
- Compilation runs in a **worker/process**, not the React renderer.

## Output semantics

| cell evaluates to | rendered as              |
|-------------------|--------------------------|
| string / number   | Inspector / default      |
| array / object    | Inspector / table        |
| ReactElement      | React                    |
| Promise           | awaited, then the above  |
| undefined         | no output                |

## Work breakdown

### 3.1 One executable cell block (`@tributary/markdown`, `api`)
- Replace `replotBlock`/`cellBlock` with a single `cell` block carrying
  `lang` in {js,ts,jsx,tsx} (migration of current code; see findings.md).
- Settle how executability is marked (ADR-004 open question).

### 3.2 Cell compiler (`@tributary/notebook`, or new `@tributary/cell`)
- esbuild transform (TS/TSX → JS, JSX → `createElement` via automatic
  runtime); rewrite the final expression into a `return`.

### 3.3 Dependency graph & invalidation (`@tributary/notebook`)
- Extract dependencies from the compiled JS AST (not the `with`+Proxy
  discovery used by the Stage 0 spike).
- Recompute only dependants; surface errors inline; dispose stale async work.

### 3.4 Capability & component API (`@tributary/api`, `components`)
- `import { workspace, git, query } from "@tributary/api"` — permissive for
  v1 (workspaces are trusted; sandboxing deferred to Stage 7).
- Ordinary React libraries — Replot included — are imported by the cell from
  the workspace's dependencies; they are not a first-party component API
  (finding 11). `@tributary/components` is reserved for components that must be
  injected rather than installed.

### 3.5 Rendering (`@tributary/render`, `components`)
- Render cell outputs per the output-semantics table. Replot needs no help to
  honour §6.1: its marks are JSX, so React owns the DOM by construction.

## Resolved decisions (ADR-004)

- **Executable marker** — cell-by-default for `js`/`ts`/`jsx`/`tsx` fences,
  with a `source` opt-out; execution is never inferred from other languages.
- **Trust posture** — permissive `@tributary/api` capabilities for v1
  (workspaces are trusted); sandboxing deferred to Stage 7.
- **Compilation location** — the worker/process boundary is the recorded v1
  posture; implemented in-process for now (open finding).

## Exit criteria

- [x] A cell defines data and a downstream `tsx` cell renders it reactively.
- [x] Editing an upstream cell recomputes only dependants (stale async disposed).
- [~] Plain wiki docs incur **no notebook runtime cost** — no cells means no
      compilation, but the host is still constructed and an IPC evaluate still
      runs for every document (finding 14).
- [x] A `tsx` cell renders a React component from the final expression with no
      `display()` call.
- [~] A cell can `import` a component library (e.g. Replot) — **imports now
      resolve** (bare/relative/default/namespace, finding 11 module-resolution
      core); an imported component function still can't cross the main→renderer
      IPC boundary to render, so a Replot chart remains the open half.
- [x] Execution stays behind `NotebookHost` + the capability boundary.

**Computational documents, still `.md` — TSX lives inside cells, never at the
document level.**

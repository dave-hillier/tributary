# Stage 3 — Executable Cells: TSX-Native Reactive Documents

**Source:** architecture §10 "Slice 3", ADR-004.
**Outcome:** Add computational documents while retaining Markdown-first
authoring — fenced blocks are notebook cells, and TSX is the native language
for rich rendered output.

## Goal

Treat every `js`/`ts`/`jsx`/`tsx` fenced block as a first-class executable
cell (one cell model, not a special "Replot block"), compile cells into a
dependency graph, and render cell outputs as React. Replot is just a React
component from the app API, not a distinct format block.

## Cell model

````markdown
# Deployment status

```ts
const deployments = await api.deployments.list()
```

```tsx
<Replot>
  <BarY data={deployments} x="service" y="count" />
</Replot>
```
````

- `js`, `ts`, `jsx`, `tsx` are variants of the **same cell model**.
- Ordinary React components (not only Replot) are allowed in `tsx` cells.
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
- `import { WorkItem, Assignee, Replot } from "@tributary/components"` — the
  stable app component API.

### 3.5 Rendering (`@tributary/render`, `components`)
- Render cell outputs per the output-semantics table; Replot consumes data
  without owning the DOM (§6.1).

## Open decisions

- Executable marker: explicit vs inferred-from-language (ADR-004).
- Trust posture: permissive v1 vs §8 sandboxing.
- Compilation location: worker vs separate process.

## Exit criteria

- [ ] A cell defines data and a downstream `tsx` cell renders it reactively.
- [ ] Editing an upstream cell recomputes only dependants (stale async disposed).
- [ ] Plain wiki docs incur **no notebook runtime cost**.
- [ ] A `tsx` cell renders an app component (`Replot`, `WorkItem`) from the
      final expression with no `display()` call.
- [ ] Execution stays behind `NotebookHost` + the capability boundary.

**Computational documents, still `.md` — TSX lives inside cells, never at the
document level.**

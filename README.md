# Tributary

A Git-native Markdown notebook workspace: a local-first React/Electron desktop
application over **one Git repository per workspace**.

Plain `.md` files are the only durable format. There is no notebook container
format, no proprietary database of record — executable cells, frontmatter, wiki
links and transclusions are additive Markdown extensions, and everything else
(the SQLite index, caches, search) is disposable derived state that rebuilds
from Git.

## Why

- **Git is the source of truth.** Documents, work items and generated reports
  are files; history is commits; review is a diff. Semantic checkpoints, not
  keystroke commits.
- **Markdown stays readable.** A document remains useful in any editor, on any
  forge, with no runtime installed.
- **Computation lives in the document.** `js`/`ts`/`jsx`/`tsx` fences are
  reactive cells (ADR-004), compiled with esbuild and invalidated through a
  dependency graph, with rich output rendered by React.
- **React owns the DOM.** Render integrations return values and specifications;
  they never compete for DOM ownership.

## Layout

```
tributary/
├── apps/desktop/             # Electron shell: main process, preload, renderer
└── packages/
    ├── core/
    │   ├── api/              # typed document/workspace model, capability contracts
    │   ├── markdown/         # parser: frontmatter, wiki links, transclusion, cells
    │   ├── render/           # AST -> React component registry
    │   ├── workspace/        # workspace service: Git adapter, checkpoints
    │   └── index/            # SQLite + FTS5 derived index
    ├── runtime/
    │   ├── notebook/         # NotebookHost, cell compiler, dependency graph
    │   └── jobs/             # revision-pinned offline jobs (stub)
    └── ui/components/        # React block registry, work-item views
```

Core packages are ordinary TypeScript packages and never import Electron; a
build-time guard (`scripts/check-electron-boundary.mjs`) enforces it. See
[`docs/plan/package-boundaries.md`](docs/plan/package-boundaries.md) for the
dependency rules.

## Getting started

Requires Node >= 22 and pnpm >= 10.

```sh
pnpm install
pnpm build      # per-package tsc + renderer bundle + Electron boundary guard
pnpm test       # vitest across the workspace (real temp Git repos, not mocks)
pnpm lint       # tsc --noEmit
```

The Electron native binding (`better-sqlite3`) is compiled for Node; rebuild it
for the Electron ABI and verify it loads with:

```sh
pnpm --filter app-desktop smoke          # ABI + binding, headless
pnpm --filter app-desktop smoke:window   # window + contextBridge, needs a desktop session
```

## Documentation

- [Architecture proposal](git_native_markdown_notebook_architecture_v0_3.md) —
  why the system is shaped this way.
- [`docs/plan/`](docs/plan/README.md) — the staged build plan (stages map to
  end-to-end vertical slices), plus a living critical-review log in
  [`findings.md`](docs/plan/findings.md).
- [`docs/adr/`](docs/adr/README.md) — decision records: Markdown dialect,
  notebook runtime, local-first sync/checkpoint, the TSX-native cell model.
- [`docs/examples/`](docs/examples/) — acceptance fixtures: incremental slices
  of the canonical demo workspace.

## Status

Early. Stages 0–3 are implemented (Git-backed workspace, transclusion, reactive
cells); Stage 4 onward is not. Cell execution is in-process for v1 — the
ADR-004 worker/process boundary and sandboxing are not yet enforced. Open gaps
are tracked honestly in [`docs/plan/findings.md`](docs/plan/findings.md).

## Licence

MIT — see [LICENSE](LICENSE).

# Package Boundaries & Monorepo Layout

## Repository shape

Tributary is a **pnpm workspaces monorepo**. Each package is a first-class
TypeScript package; domain packages are kept **Electron-independent** per the
architecture (§5.1, §9). The shell and renderer are the only components that
touch the desktop boundary.

```
tributary/
├── package.json              # root: scripts, engines (node >= 22)
├── pnpm-workspace.yaml       # packages/* + apps/*
├── tsconfig.base.json        # shared strict TS compiler options
├── .gitignore / .editorconfig
├── docs/                     # architecture + plan + ADRs + demo workspace spec
├── apps/
│   ├── desktop/              # Electron shell (bundles renderer + main process)
│   └── web/                  # (later) hosted/web client — not v1
└── packages/
    ├── core/
    │   ├── markdown/         # parser: AST, frontmatter, wiki links, fences, round-trip
    │   ├── render/           # AST -> React component registry
    │   ├── api/              # typed document/workspace model & shared types
    │   ├── workspace/        # local workspace service: Git adapter, checkpoint
    │   └── index/            # SQLite + FTS5 derived index
    ├── runtime/
    │   ├── notebook/         # NotebookHost abstraction + runtime adapter
    │   └── jobs/             # offline job/agent workers over isolated worktrees
    └── ui/
        └── components/       # React block registry, work-item views, cell output
```

Both `packages/*` and `apps/*` are pnpm workspace members from the scaffold,
so solution-wide root scripts (`build`, `test`, `lint`, `dev`) cover both
trees. `apps/desktop` is created at Stage 0.4 and does not exist yet.

## Package map

| Package            | Responsibility (arch ref)                                      | Depends on                       | Electron? |
|--------------------|----------------------------------------------------------------|----------------------------------|-----------|
| `@tributary/api`   | Typed document/workspace model, capability contracts (§5.3, §6) | —                                | never     |
| `@tributary/markdown` | Parser: frontmatter, wiki links, transclusion, typed fences, round-trip (§4) | `api`                | never     |
| `@tributary/render`| AST → React registry (safe extension point) (§5.1, §11)        | `api`, `markdown`               | never     |
| `@tributary/workspace`| Workspace service: one repo per workspace, Git adapter, checkpoints (§5.2) | `api`                  | never     |
| `@tributary/index` | SQLite + FTS5 derived projections (§5.3)                        | `api`                            | never     |
| `@tributary/notebook`| NotebookHost, cell compiler (esbuild), dependency graph, invalidation (§6, ADR-004) | `api`, `markdown` | never |
| `@tributary/jobs`  | Revision-pinned jobs in isolated worktrees/workers (§5.5, §7)   | `workspace`, `index`, `markdown` | never     |
| `@tributary/components` | React block registry, work-item views, document/cell rendering | `render`, `notebook` | no (React only) |
| `app-desktop` (apps/desktop) | Electron shell, IPC/typed API over local workspace service (§5.1, §5.2) | all core + components | yes |

## Dependency rules

- **No core package imports Electron.** `app-desktop` is the only package that
  may. CI fails a build if a non-shell package pulls in `electron`.
- **Dependency direction is acyclic:** `api` → `markdown` → `render`;
  `workspace`/`index`/`notebook`/`jobs` sit beside each other and all depend on
  `api` (and, for parser work, `markdown`). The renderer depends on the service
  only through the typed `api` boundary (IPC in the shell).
- **`components` depends on `render` + `notebook`** but not on `workspace`
  internals; it renders values/specifications, it does not own the repository.
- Shell-flavoured logic (IPC wiring, Electron lifecycle, SQLite native binding)
  lives only in `app-desktop`.

**Struck:** the "Replot bridge" / app component API (`Replot`, `WorkItem`,
`Assignee`) earlier drafts credited `components` with is not a requirement —
Replot is an ordinary React library a cell imports. What is missing is module
resolution for cell imports; see finding 11 in [`findings.md`](./findings.md).

**Cells (ADR-004):** executable fenced blocks are a single `cell` node with
`lang` in {js,ts,jsx,tsx}. Cells are compiled with esbuild in a worker/process
and may `import` from `@tributary/components` (component API) and
`@tributary/api` (capabilities: workspace/git/query). This supersedes the
earlier `replotBlock`/`cellBlock` split.

## Naming & versioning

- Package scope: `@tributary/*`. Versioned as a set at `0.1.0` until v1.
- Public API surface is explicit: only `src/index.ts`-exported symbols are
  importable from outside a package (enforced by `exports` in each package.json).

## Tooling baseline

- **Node** `>=22`, **pnpm** `>=10`, strict **TypeScript** (`tsconfig.base.json`).
- Build per package to `dist/` (ESNext, declared/bundler resolution).
- Tests: Vitest (parser golden files, index rebuild, notebook dependency,
  work-item round-trip, real temporary-Git integration). Surface headless via
  Playwright in the shell package where needed.
- Lint/format: configured per package but sharing root conventions; core
  packages must not require a running desktop to pass lint/test.

## Conventions

- **Modules are import-by-index:** `only src/index.ts` is public.
- **Golden files:** parser fixtures live under `packages/core/markdown/test/fixtures/`.
- **Repository fixtures** for Git/integration tests live under
  `test/git-fixtures/` in `workspace`/`index`/`jobs` with a shared helper.
- **Real-temp-repo policy:** integration tests create disposable repos on
  `fs.mkdtemp` and run the real binary, not mocks at the boundary.
**Architecture & High-Level Vertical Slice Implementation Plan**

Draft 0.3 • 12 September 2026

| Working product definition — A local-first React desktop application over one Git repository per workspace where .md Markdown is the primary durable format. Work items, projects, documents, notebook-like analyses and generated reports share that substrate. The local Git checkout provides durable truth, history and conflict semantics; a local derived index provides work-board/graph/search projections; optional remote Git plus a realtime relay provide sync, presence and notifications of committed changes. |
|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

Status: architecture proposal. Core repository, work-item, autosave,
trust and deployment-shape decisions are now settled. v1 is local-first,
with Electron as the recommended desktop shell and remote Git/realtime
services as optional collaboration infrastructure.

# 1. Executive summary

The application should treat the document as a core product primitive,
not the notebook as a separate subsystem. The canonical representation
is Git-tracked Markdown with stable document identity in frontmatter.
Ordinary Markdown remains useful on its own; notebook behaviour is
introduced through typed fenced blocks, wiki links, transclusion, and a
reactive execution layer only where a document needs it.

The architecture deliberately separates three kinds of state:

- Durable content and semantic history: one Git repository per workspace
  containing .md work items, projects, documents, templates, assets and
  generated reports.

- Derived query state: document metadata, aliases, backlinks, headings,
  full-text search, block/cell metadata and job provenance, rebuilt from
  Git when necessary.

- Live operational state: presence, edit sessions, job progress and
  notifications carried on an event channel. Durable edits are recovered
  from Git checkpoints; no separate collaborative-edit log is required
  for v1.

| **Core architectural principle —** A fresh clone of the repository must contain enough durable information to rebuild the document graph and render the workspace. Caches, indexes and realtime state are disposable. |
|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# 2. Goals and non-goals

## 2.1 Goals

- Make Markdown the default authoring and storage format for work items,
  projects, wiki-like knowledge, reports and notebook-like documents.

- Keep the repository human-readable, diffable, branchable and useful
  outside the application.

- Support Obsidian-style wiki links and document transclusion while
  adding stable machine identity so renames and moves do not destroy
  relationships.

- Allow selected fenced blocks to compute values or render rich
  React/Replot outputs without converting the whole document into a
  notebook container format.

- Allow an index/home document to act as workspace navigation: mostly
  links, with optional embedded documents or dynamic/rendered blocks.

- Support offline jobs and agents that read repository state at a
  specific revision and produce durable reports or document changes back
  into Git.

- Use React as the sole owner of application presentation; rendering
  integrations should return values/specifications rather than competing
  for DOM ownership.

- Provide realtime presence, assignment/status feedback and
  repository-change notifications without using Git as a keystroke
  transport; rely on Git merge semantics for concurrent saves before
  introducing CRDT collaboration.

## 2.2 Non-goals for the first release

- Reimplementing a full IDE or JupyterLab-style kernel ecosystem.

- Making arbitrary Markdown capable of invoking arbitrary application
  code.

- Using the event stream as the canonical long-term document history.

- Committing every keystroke or every transient UI action to Git.

- Making the derived database authoritative for document content.

- Solving simultaneous multi-user character-level editing before the
  basic Git/wiki/report workflow is proven.

# 3. Product and domain model

The product is a Git-native workspace combining a Linear-like work
surface, an Obsidian-like knowledge graph and Observable-like
computational documents. Work items, projects, wiki pages, reports and
notebook-like analyses are all Markdown documents in the same
repository, distinguished by typed frontmatter and rendered through
different application views rather than separate storage systems.

Workspace  
├── index.md \# home / navigation document  
├── work/ \# work items and project documents  
│ ├── issues/  
│ └── projects/  
├── docs/ \# wiki, ADRs, design docs, runbooks  
├── reports/ \# generated and hand-authored reports  
├── templates/ \# reusable document/report templates  
└── assets/ \# attachments and datasets

## 3.1 Document identity

Paths and titles are for humans; IDs are for durable relationships.
Every managed document receives a stable ID the first time the
application creates or imports it. The ID survives title changes,
renames and moves.

---  
id: 01K4YH8B5RM4YQ8MGB2JKS76A1  
title: Runtime Architecture  
aliases: \[Runtime, Notebook Runtime\]  
tags: \[architecture, runtime\]  
---  
  
\# Runtime Architecture  
  
See \[\[Authentication Architecture\]\].

| **Concern**      | **Canonical identifier**        | **Notes**                                                                   |
|------------------|---------------------------------|-----------------------------------------------------------------------------|
| Document         | Stable ULID/UUID in frontmatter | Never derived from path or title.                                           |
| Current location | Git path                        | May change freely.                                                          |
| Human name       | title + aliases                 | Used for wiki-link resolution and display.                                  |
| Revision         | Git commit/blob SHA             | Used for optimistic concurrency, jobs and provenance.                       |
| Block/cell       | Optional stable local ID        | Needed only where outputs, comments or dependencies require block identity. |

## 3.2 One document continuum

| **Document style**     | **Typical content**                                             | **Execution**         |
|------------------------|-----------------------------------------------------------------|-----------------------|
| Wiki page              | Markdown, links, images                                         | None                  |
| Living document        | Markdown plus embedded query/metric/chart blocks                | Selective             |
| Generated report       | Snapshot prose, tables, charts, provenance                      | Usually precomputed   |
| Notebook-like analysis | Markdown plus executable cells and outputs                      | Reactive / on demand  |
| Home/index page        | Collections of links, transclusions, optional dynamic blocks    | Usually none or light |
| Work item / project    | Typed frontmatter plus Markdown body, links and optional embeds | None by default       |

## 3.3 Work items are Markdown documents

Linear-like work items are not a separate database domain. They are
managed Markdown documents with typed frontmatter, stable IDs and
ordinary Markdown bodies. The index projects their structured metadata
into fast list, board, assignment and project views. Changing assignee,
status, priority or project is therefore a document edit and
participates in normal Git history.

---  
id: 01K...  
type: work-item  
title: Investigate runtime invalidation  
status: in-progress  
assignees: \[user:dave\]  
project: 01K-PROJECT...  
priority: 2  
labels: \[runtime, notebook\]  
---  
  
\# Investigate runtime invalidation  
  
The current behaviour is described in \[\[Runtime Architecture\]\].

The exact directory convention is organisational rather than semantic.
The provisional layout uses work/issues and work/projects, but identity
and relationships are ID-based so those paths can change without
changing the model.

# 4. Canonical document format

The canonical representation is .md Markdown. The architecture should
not use Notebook Kit’s XML/HTML notebook envelope as the durable format.
Notebook semantics, work-item metadata and rendered blocks are additive
Markdown extensions rather than a container around it.

## 4.1 Conservative Markdown dialect

- CommonMark/GFM-compatible Markdown for ordinary prose.

- YAML frontmatter for durable identity and application metadata.

- Obsidian-style \[\[wiki links\]\] for human-friendly internal links.

- Obsidian-style \![\[transclusion\]\] for embedding another document or
  section.

- Typed fenced blocks for executable or rendered content.

- A deliberately small application component/block registry rather than
  unrestricted MDX/JSX in arbitrary prose.

---  
id: 01K...  
title: Weekly Engineering Report  
template: report  
series: engineering-weekly  
period: 2026-W37  
generatedBy: jobs/engineering-weekly  
sourceRevision: a81bd2c  
---  
  
\# Weekly Engineering Report  
  
See \[\[Runtime Architecture\]\].  
  
\## Deployment activity  
  
\`\`\`js cell=deployments  
const deployments = await workspace.deployments();  
\`\`\`  
  
\`\`\`replot source=deployments  
\<BarY x="service" y="count" /\>  
\`\`\`  
  
\## Context  
  
\![\[Release Process\]\]

| **Portability rule —** If another Markdown renderer does not understand a typed block, it should still show readable source as a fenced code block. Unknown extensions should degrade, not corrupt the document. |
|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

## 4.2 Frontmatter

Keep required frontmatter small. Additional metadata should be additive
and schema-tolerant.

| **Field**       | **Requirement**           | **Purpose**                                           |
|-----------------|---------------------------|-------------------------------------------------------|
| id              | Required for managed docs | Stable identity.                                      |
| title           | Recommended               | Display name; may also be inferred from H1.           |
| aliases         | Optional                  | Rename resilience and ergonomic wiki-link resolution. |
| tags            | Optional                  | Navigation, search and query blocks.                  |
| template        | Optional                  | Selects presentation or report template.              |
| generatedBy     | Optional                  | Job/agent provenance.                                 |
| sourceRevision  | Optional                  | Git revision the generated output describes.          |
| series / period | Optional                  | Groups repeated reports.                              |

## 4.3 Block semantics

Fences have one of three roles: source-only code, executable cells, or
render specifications. The runtime should not infer execution from every
language fence; execution must be explicit.

| **Example fence**     | **Meaning**                   | **Default trust**                              |
|-----------------------|-------------------------------|------------------------------------------------|
| \`\`\`ts              | Display source code only      | Safe                                           |
| \`\`\`js cell=name    | Executable JavaScript cell    | Trusted workspace execution; capability-hosted |
| \`\`\`replot source=x | Render a Replot visualisation | Safe if spec is declarative                    |
| \`\`\`query           | Workspace/query projection    | Trusted workspace query capability             |
| \`\`\`sql cell=name   | Optional future data cell     | Executed by configured backend                 |

# 5. Logical architecture

┌───────────────────────────────────────────────────────────────┐  
│ Electron desktop app │  
│ │  
│ React renderer/editor │  
│ Markdown + work-item views + Replot │  
│ │ IPC / typed local API │  
│ ▼ │  
│ Local workspace service │  
│ Git adapter • checkpoint coordinator • SQLite index │  
│ notebook worker • job/agent workers │  
└───────────────┬───────────────────────┬───────────────────────┘  
│ │  
▼ ▼  
local Git repository local derived cache/index  
canonical working copy rebuildable from Git  
│  
│ fetch / push optional  
▼  
┌────────────────────┐ ┌─────────────────────────┐  
│ Git remote │◄──────►│ sync / realtime service │  
│ durable shared log │ │ presence • notifications│  
└────────────────────┘ └─────────────────────────┘

**Local-first invariant:** with no network connection, a user can open
an existing workspace, navigate/search indexed content, edit work items
and documents, render notebook blocks, run normal local jobs, inspect
history and create checkpoint commits. Remote services only add sync,
identity/presence and cross-device/team collaboration.

## 5.1 Electron desktop application

- Use Electron as the v1 shell, but keep domain/parser/index/runtime
  code in ordinary packages with typed interfaces so it can later run
  under another desktop shell or hosted service.

- React renderer process owns application chrome, Markdown editing,
  navigation, work-item boards and document rendering.

- Markdown parser plus custom syntax extensions for frontmatter, wiki
  links, transclusions and typed fences; parser/render packages must not
  depend on Electron.

- React block registry for known rendered block types, including Replot
  and application-provided components.

- Replot for native React visualisation; React remains the only DOM
  owner.

- Notebook runtime adapter runs behind a local worker boundary so
  execution failures/resource use do not destabilise the renderer.

- Workspace navigation is driven by index.md and derived graph/search
  data; work-item lists/boards are projections over typed Markdown
  documents.

- Renderer never writes repository files directly; it calls a typed
  local workspace API over IPC with base revision/blob SHA for
  optimistic saves.

## 5.2 Local workspace / Git service

- Maps exactly one workspace to one local Git repository and optional
  remote configuration.

- Runs in the Electron main process or a local companion process and
  provides filesystem/Git operations while preserving Git semantics.

- Validates frontmatter IDs, detects duplicate IDs and enforces safe
  repository paths.

- Batches autosaves into local semantic checkpoint commits, with
  immediate/near-immediate checkpoints at obvious state transitions such
  as assignment/status changes, navigation away and explicit actions.

- Exposes diffs, history, branches, fetch/push and merge/review
  workflows through the local API.

- Emits local repository-change events to update the index and renderer;
  remote notifications are optional and layered on top.

## 5.3 Derived index

The index is a local projection over a repository revision, not another
source of truth. SQLite + FTS5 is the v1 default and lives alongside the
local workspace as rebuildable application state. A remote service may
maintain its own projection for collaboration/search later, but the
desktop app must not depend on it for normal use.

documents(id, path, title, aliases, tags, blob_sha, modified_at,
metadata_json)  
links(source_id, target_id, target_text, kind, source_anchor)  
headings(document_id, anchor, text, level, position)  
blocks(document_id, block_id, type, position, dependency_names)  
job_outputs(document_id, job_id, source_revision, generated_at)  
fts_documents(...)

## 5.4 Remote sync and realtime service

The desktop application is fully usable without this service. When a Git
remote is configured, the realtime channel makes collaboration feel
immediate without treating Git as a keystroke transport. It carries
ephemeral presence/edit-session state plus notifications about durable
repository changes such as assignment, status and document checkpoint
commits. SSE or WebSockets are sufficient initially. A permanent
event-sourced domain model is unnecessary; events must be recoverable
from current Git/index state after reconnect.

WorkspaceChanged { commitSha, changedPaths\[\] }  
WorkItemChanged { documentId, commitSha, changedFields\[\] }  
DocumentSessionChanged { documentId, actorId, state }  
DocumentCheckpointed { documentId, commitSha }  
JobStarted / JobProgress / JobCompleted / JobFailed  
NotificationCreated  
PresenceChanged

| Recommended default — Git is the sole durable model. Presence/edit-session state and job progress are ephemeral. Assignment/status changes checkpoint promptly to Git and are broadcast as change notifications. Ordinary typing is batched into timer/navigation checkpoints. Use three-way merge for concurrency; defer CRDT until proven necessary. |
|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

## 5.5 Local jobs and agents

1.  Receive an explicit local source revision and job configuration.

2.  Create an isolated local checkout/worktree at that revision.

3.  Run in a worker/child process and read documents through the same
    parser/index APIs used by the application.

4.  Produce or update Markdown documents with provenance metadata.

5.  Commit changes to a local job branch (or directly when policy
    permits).

6.  Emit local progress/completion events and surface a diff/review in
    the UI.

7.  Merge or fast-forward according to workspace policy; push is a
    separate sync concern when a remote is configured.

# 6. Notebook and rendered-block execution

Notebook behaviour should be implemented behind a host abstraction so
the durable format does not depend on Observable Notebook Kit or any
single runtime. Observable Runtime / Notebook Kit can be evaluated as an
implementation detail for dependency analysis and invalidation, but the
application contract should remain its own.

interface NotebookHost {  
compile(document: ParsedDocument): ExecutionPlan;  
subscribe(cellId: string, onValue: (value: unknown) =\> void):
Unsubscribe;  
invalidate(cellId?: string): void;  
dispose(): void;  
}

## 6.1 Ownership boundary

| **Concern**                                | **Owner**                        |
|--------------------------------------------|----------------------------------|
| Application state, routing, chrome, editor | React application                |
| Markdown layout and rendered output tree   | React renderer                   |
| Charts and visualisation                   | Replot / React components        |
| Cell dependency graph and invalidation     | NotebookHost implementation      |
| Access to workspace data/services          | Capability API supplied to cells |
| Arbitrary network/filesystem access        | Denied unless explicitly granted |

## 6.2 Generated reports vs live notebooks

Generated reports should normally capture the result of an offline
computation rather than silently recompute historical truth when opened.
Live notebooks may evaluate on demand. Both use the same document
format, but provenance and execution policy differ.

| **Mode** | **Behaviour**                                           | **Good for**                                     |
|----------|---------------------------------------------------------|--------------------------------------------------|
| Snapshot | Data/results persisted in document or attached artifact | Historical reports, audits, weekly summaries     |
| Live     | Cells evaluate against current workspace/services       | Exploration, current dashboards, ad-hoc analysis |
| Hybrid   | Snapshot data with optional refresh/re-run action       | Reproducible reports that can be regenerated     |

# 7. Git lifecycle and concurrency

## 7.1 Git is the durable journal, not the live transport

The user edits a local working document state and autosave batches
changes rather than committing individual keystrokes. The desktop
workspace service writes/checkpoints locally first, so saving never
depends on network availability. It creates Git checkpoint commits on an
idle/timer boundary and at obvious semantic boundaries: navigation away,
editor close, structured work-item changes, explicit save/checkpoint,
and completed automated changes. Fetch/push happens independently when a
remote is configured.

Git blob A  
│  
├─ local/live edits  
├─ validation + link resolution  
└─ checkpoint  
↓  
Git blob B + semantic commit

## 7.2 Initial concurrency model

Start with optimistic concurrency using the base blob SHA for each
edited document. Within one local app instance, the workspace service
serialises branch updates. Remote concurrency is reconciled at
fetch/push/sync time: if upstream changed different files, rebase/merge
normally; if the same file diverged, perform a three-way merge from the
common base and surface unresolved conflicts in the editor. Presence
reduces surprise but is never a lock.

| Resolved Q1 — Realtime v1 means presence/edit awareness, immediate assignment/status updates, job progress and notifications of checkpointed changes. Same-character simultaneous co-editing is not a launch requirement; Git three-way merge handles concurrent saves. CRDT remains an optional later slice. |
|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

## 7.3 Checkpoint and realtime semantics

Git history is semantic history, not autosave telemetry. Typing can
remain local until the next checkpoint, while presence is broadcast
immediately. Structured work-item actions such as assign/unassign,
status changes, priority changes and project moves are obvious semantic
boundaries and should checkpoint promptly, then emit a
WorkItemChanged/WorkspaceChanged event. Other clients update from the
resulting commit rather than from a parallel authoritative event state.

This keeps reconnect simple: transient presence may be lost, but durable
state is recovered by fetching repository HEAD and rebuilding or
incrementally updating the index. Git remains the sole durable
conflict-resolution substrate for v1.

# 8. Trust and security boundaries

- Markdown is inert content by default; HTML should be sanitised or
  disabled unless explicitly needed.

- Wiki links and transclusions resolve through the document index;
  transclusion must detect recursion and enforce depth limits.

- Rendered blocks resolve only against an allow-listed React component
  registry.

- Workspaces are trusted in v1: opening a repository is not treated as
  opening hostile code. Notebook cells therefore do not require a
  hostile-repository sandbox as a launch requirement. Keep execution
  behind a host/capability API anyway so permissions, server resources
  and future untrusted sharing can be constrained without changing
  document syntax.

- Expose explicit capability APIs (read current document, query index,
  fetch workspace services/datasets) rather than making browser cells
  depend directly on repository implementation details. This is
  primarily an architectural boundary in v1, not a hostile-code security
  boundary.

- Jobs/agents execute in a separate trust boundary from browser notebook
  cells and write through Git workflow APIs.

- Every generated report should record source revision and generator/job
  identity.

| Resolved Q2 — Workspaces are trusted. v1 does not need to sandbox notebooks as hostile repository content. Keep a capability-oriented NotebookHost boundary for clean architecture, resource control and future sharing models. |
|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# 9. Deployment shape

The implementation plan is deliberately local-first: repository
checkout, index, notebook execution and ordinary jobs live on the user
machine and remain available offline. Electron is the recommended v1
shell, but the core application packages should not depend on Electron.
A Git remote and optional realtime service add collaboration and
cross-device sync; a hosted/web client remains a later deployment
option.

| Shape               | Decision                                | Notes                                                                                          |
|---------------------|-----------------------------------------|------------------------------------------------------------------------------------------------|
| Local-first desktop | Selected for v1                         | Repository, index, notebook execution and jobs live on the user machine and work offline.      |
| Electron shell      | Recommended initial shell               | Strong fit for React + Node Git/SQLite/worker ecosystem; keep core packages shell-independent. |
| Git remote          | Optional but expected for collaboration | Fetch/push synchronises durable state; app remains usable without it.                          |
| Realtime service    | Optional augmentation                   | Presence and low-latency commit/job notifications only; not durable workspace state.           |
| Hosted/web client   | Later option                            | Can reuse parser/render/domain packages, but is not the v1 architectural centre.               |

| Resolved Q3 — v1 is local-first. The local checkout is the canonical working copy; SQLite/indexing, notebook execution and ordinary jobs run locally. Electron is the recommended shell, while Git remote + realtime relay provide collaboration and sync. Core packages must remain Electron-independent. |
|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# 10. High-level implementation plan: vertical slices

Each slice should produce an end-to-end usable capability and exercise
the durable format, Git integration, index and React surface together.
Avoid building “the parser”, “the backend” and “the event system” as
disconnected horizontal projects.

## Slice 0 — Local-first shell + format/runtime spike

Outcome: Prove the local desktop boundary and core content/runtime bets
with one repository and no multi-user infrastructure.

**Implementation:**

- Define the v0 Markdown dialect: frontmatter, wiki links, transclusion
  and typed fences.

- Parse to a typed AST and round-trip without losing source formatting
  important to Git diffs.

- Render ordinary Markdown, wiki links and one static Replot block in
  React.

- Spike NotebookHost against Observable Runtime/Notebook Kit and a
  minimal custom dependency evaluator; compare coupling and API
  stability.

- Write a short decision record selecting the initial execution
  implementation.

**Exit criteria:**

- A sample repo renders end-to-end.

- Unknown blocks degrade to code fences.

- Moving implementation between NotebookHost candidates does not change
  the persisted document.

## Slice 1 — Git-backed workspace: wiki + work items

Outcome: Deliver the first genuinely usable offline product: open a
local Git repository, browse/edit/autosave/checkpoint Markdown knowledge
and Markdown-backed work items, and rebuild all derived state locally.

**Implementation:**

- Open or clone a local workspace/repository from the Electron app and
  build the SQLite document index.

- Assign/check stable IDs; detect duplicate IDs.

- Render index.md as the workspace home.

- Project typed work-item frontmatter into list/board views with status,
  assignee, priority and project filters.

- Allow create/assign/status/move operations to edit Markdown
  frontmatter and create prompt semantic checkpoints.

- Support \[\[links\]\], aliases, backlinks and search.

- Edit Markdown with batched autosave, timer/navigation checkpoints and
  base-blob optimistic concurrency with three-way merge.

- Show local Git history/diff for a document; expose fetch/push only
  when a remote exists.

**Exit criteria:**

- A user can open a repo, navigate docs and work items, edit either, see
  autosaved checkpoint history, and assign/move work items without
  leaving the Git-backed model.

- A rename/move preserves relationships because identity is ID-based.

- Deleting the derived index and rebuilding it preserves behaviour.

## Slice 2 — Transclusion and rich document blocks

**Outcome:** Make documents composable without turning the format into
MDX.

**Implementation:**

- Support \![\[Document\]\] and heading/section transclusion.

- Add block registry and one or two safe declarative blocks (e.g.
  callout/table/query).

- Add recursion/cycle handling and render diagnostics.

- Allow index.md to combine links with embedded documents.

**Exit criteria:**

- A home page can be mostly links but embed a selected report/doc.

- Transcluded content follows document renames/moves.

- Circular transclusion fails visibly and safely.

## Slice 3 — Replot and notebook-like reactive cells

**Outcome:** Add computational documents while retaining Markdown-first
authoring.

**Implementation:**

- Introduce explicit executable fence syntax and optional stable cell
  IDs.

- Compile cells into a dependency graph and surface execution errors
  inline.

- Expose a narrow workspace capability API to cells.

- Render cell values through React; Replot consumes value/spec data
  without owning the DOM.

- Implement invalidation/re-run semantics and document-level disposal.

**Exit criteria:**

- A Markdown document can define data in one cell and render a dependent
  Replot block later in the page.

- Editing an upstream cell recomputes only dependants.

- Plain wiki docs incur no notebook runtime cost.

## Slice 4 — Offline jobs and generated reports

**Outcome:** Make the reporting workflow a first-class product
capability.

**Implementation:**

- Job runner checks out a specific Git revision in an isolated worktree.

- A job reads indexed documents and generates/updates a report document.

- Report records sourceRevision, generatedBy and period/series metadata.

- Job produces a branch/commit and UI surfaces a diff.

- Merge/accept flow writes the report into durable workspace history.

**Exit criteria:**

- A scheduled/manual job can generate a weekly report over repository
  documents.

- A reader can tell exactly which repository revision the report
  describes.

- Old reports remain stable even when source docs later change.

## Slice 5 — Realtime workspace experience

Outcome: Add optional remote collaboration to an already-complete
local-first product—presence, work-item assignment/status notifications,
Git sync and job progress—without introducing a second durable document
model.

**Implementation:**

- Optional WebSocket/SSE relay for presence/edit sessions, committed
  workspace/work-item changes and job progress.

- Remote commits are fetched/merged locally; each client then refreshes
  its own derived views from local Git/index state.

- Show who is viewing/editing a document or work item; use this as
  awareness, not a hard edit lock.

- Broadcast checkpoint commits and assignment/status changes
  immediately; surface merge/conflict state when concurrent same-file
  edits cannot be cleanly reconciled.

- Keep event data operational; Git remains durable truth.

**Exit criteria:**

- Two desktop sessions using the same remote see assignment/status
  changes, checkpointed document changes, job completion and presence
  without polling.

- A lost event stream can recover by fetching Git and
  rebuilding/updating local index state; offline clients continue to
  work and sync later.

## Slice 6 — Optional character-level co-editing, only if required

Outcome: Add Google-Docs-style same-document character-level co-editing
only if presence + Git three-way merge proves insufficient.

**Implementation:**

- Integrate Yjs/CRDT (or selected alternative) as live working state.

- Anchor live sessions to a base Git revision.

- Checkpoint CRDT state into Markdown and Git at deliberate boundaries.

- Define conflict semantics between external Git changes and active CRDT
  sessions.

**Exit criteria:**

- Two users can type concurrently without destructive overwrite.

- Closing all sessions still leaves a clean Markdown file and normal Git
  history.

## Slice 7 — Agent/review workflow and hardening

**Outcome:** Use Git-native change review as a product feature.

**Implementation:**

- Agents/jobs create branches and proposed changes.

- Render semantic Markdown diffs and notebook block diffs.

- Add permissions, execution policy, sandboxing and audit surfaces
  required by deployment model.

- Scale index/search and background rebuilds; add incremental
  invalidation.

- Add import/export and repository health diagnostics.

**Exit criteria:**

- Agent changes are reviewable before merge.

- Repository remains usable outside the app.

- Security boundaries are testable and explicit.

# 11. Cross-cutting technical decisions

| **Decision**     | **Recommended starting point**                                    | **Reason**                                                                              |
|------------------|-------------------------------------------------------------------|-----------------------------------------------------------------------------------------|
| Parser           | Unified/micromark ecosystem + explicit extensions                 | Strong Markdown AST ecosystem; lets syntax stay additive.                               |
| Editor           | Markdown-first editor (CodeMirror 6 likely)                       | Source remains canonical; easier Git diffs and notebook fences.                         |
| React rendering  | AST → React component registry                                    | Single presentation owner and safe extension point.                                     |
| Visualisation    | Replot                                                            | Already aligns Plot concepts with React ownership.                                      |
| Notebook runtime | Adapter; spike Observable Runtime/Notebook Kit                    | Avoid format/runtime lock-in.                                                           |
| Local index      | SQLite + FTS5 in the desktop workspace                            | Rebuildable, offline and excellent for repo-sized datasets.                             |
| Remote index     | Defer; optional service projection later                          | Desktop must not require remote query infrastructure.                                   |
| Realtime         | Optional WebSocket/SSE relay: presence + commit/job notifications | Improves collaboration without becoming durable state.                                  |
| Collaboration    | Presence + Git 3-way merge; CRDT later if necessary               | Uses Git’s existing conflict semantics and keeps v1 simple.                             |
| Job isolation    | Local Git worktree + worker/child process                         | Offline-capable, revision-pinned and easy to review; remote runners can be added later. |

# 12. Settled decisions and remaining questions

The following major product-model decisions are now explicit. Directory
naming, checkpoint timer values and the eventual remote-hosting
implementation can be tuned without changing the architecture.

Settled: realtime and concurrent editing

v1 provides presence/edit awareness, immediate assignment/status
notifications, job progress and notifications of Git checkpoints.
Same-file concurrent saves use Git-style three-way merge.
Character-level CRDT collaboration is deferred.

Decision: Git remains the durable concurrency model; presence is
ephemeral and non-locking.

Settled: deployment shape

v1 is local-first. The workspace repository is checked out on the user’s
machine; indexing, editing, history, notebook execution and normal jobs
work locally and offline. Electron is the recommended initial shell
because it fits the existing React application and gives straightforward
access to Git, SQLite and worker processes.

Decision: local-first desktop application. Keep core
parser/index/Git/notebook packages independent of Electron so a web or
alternative desktop shell can be added later. Remote Git and realtime
services provide collaboration and sync rather than hosting the
canonical working copy.

Settled: executable-cell trust

Workspace authors are trusted. Hostile-repository sandboxing is not
required for v1, although notebook execution remains behind an explicit
host/capability boundary.

Decision: capability-oriented host for architecture/resource control,
not a hostile-code sandbox requirement.

Settled: Git checkpoint semantics

Autosave is batched. Commits/checkpoints occur on a timer/idle boundary
and at obvious semantic boundaries such as navigation away,
assignment/status changes, explicit save/commit and completed automated
changes.

Decision: Git history should show useful semantic checkpoints rather
than keystroke-level autosave noise.

Settled: repository granularity

Each workspace maps one-to-one to a Git repository.

Decision: one repository per workspace.

Settled: file format and extension

Persist ordinary .md files with frontmatter, wiki links/transclusion and
typed fences as additive extensions. No dedicated .okl extension is
required.

Decision: .md is canonical.

Settled: work-item model

Linear-like work items and projects are Git-backed Markdown documents.
The index projects their frontmatter into structured list/board/search
views.

Decision: no separate authoritative work-item database.

# 13. Testing strategy

- Golden-file parser tests: Markdown input → typed AST and round-trip
  preservation.

- Repository fixtures: renames, moves, duplicate IDs, aliases, dangling
  links, transclusion cycles and merge conflicts.

- Index rebuild tests: delete index → full rebuild produces equivalent
  graph/search results.

- Notebook dependency tests: upstream edits invalidate only dependent
  cells and dispose stale async work.

- Security tests: unknown blocks, HTML sanitisation, transclusion loops
  and capability denial.

- Work-item projection tests: frontmatter assignment/status/project
  changes round-trip through Markdown, index projections and Git
  history.

- Realtime recovery tests: drop the event connection, reconnect, and
  recover all durable state from Git/index while presence safely
  expires.

- Git concurrency tests: divergent blob SHAs, external commits, branch
  merges and job-generated changes.

- End-to-end vertical slice tests against a real temporary Git
  repository rather than mocks at every boundary.

# 14. Immediate next steps

1\. Establish the local-first package boundaries and Electron shell:
renderer, IPC/API boundary, local workspace service, Git adapter, SQLite
index and worker execution.

2\. Build Slice 0 inside the desktop shell: open a local repository,
parse/render one Markdown document, then add one Replot block and one
executable cell without coupling the format to Electron.

3\. Write ADR-001 for the canonical Markdown dialect, ADR-002 for
notebook runtime choice after the spike, and ADR-003 for local-first
sync/checkpoint semantics.

4\. Create a representative demo workspace with index.md, several wiki
documents, several Markdown work items/projects, one transclusion, one
generated report and one notebook-like analysis. Use it as the
acceptance fixture for all slices.

5\. Then implement Slice 1 end-to-end as an offline-capable desktop
workspace before adding remote collaboration or more notebook/runtime
sophistication.

| Recommended sequencing — Prove the local-first substrate first: Electron shell → local repo → parser/index → edit/autosave/checkpoint → history. Then add rich blocks/notebook execution, and only afterwards remote Git sync/realtime. Do not make network services a prerequisite for basic workspace use. |
|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

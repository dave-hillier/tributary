# ADR-003 — Local-first sync and checkpoint

- **Status:** Accepted
- **Date:** 2026-09-12
- **Source:** architecture §7 (Git lifecycle and concurrency), §5.4 (remote
  sync), §12 (settled decisions)

## Context

Tributary is a Git-native Markdown notebook workspace: .md files plus a
local Git repository are the sole durable truth. Documents, work items and
reports are all Markdown; the SQLite index, caches and realtime state are
projections that must rebuild from Git alone (arch §1 core principle).

We had to decide how edits become durable history, how concurrent saves are
reconciled, and what role remote services play in the write path — without
making network availability a precondition for using the product.

## Decision

**Git is the durable journal, not the live transport.** The local checkout is
the canonical working copy and writes land locally first. Remote services
carry presence and change notifications; they never hold durable document
state.

### Checkpoint semantics

- Checkpoints are **semantic, not keystroke-level**. Git history should show
  useful state transitions, not autosave telemetry. Ordinary typing stays in
  local working state until the next checkpoint.
- **Batched autosave** commits on a timer/idle boundary and at obvious
  semantic boundaries: navigation away, editor close, structured work-item
  changes (assign/status/priority/project), explicit save/checkpoint, and
  completed automated changes. Structured work-item actions checkpoint
  promptly and then broadcast a change event.

### Concurrency

- Optimistic concurrency is keyed on the **base blob SHA** of each edited
  document. Within one app instance the workspace service serialises branch
  updates.
- Remote concurrency is reconciled at sync time: if upstream changed
  different files, rebase/merge normally; if the same file diverged, perform
  a **three-way merge** from the common base and surface unresolved conflicts
  in the editor. Presence is awareness, never a lock. CRDT is deferred.

### Remote sync

- Sync is **fetch/merge of commits**, not a stream of live edits. Fetch/push
  runs independently when a remote is configured; remote commits are fetched
  and merged locally, and each client refreshes its derived views from local
  Git/index state rather than a parallel authoritative event log.

### Derived state

- The SQLite index (FTS5), caches and realtime state are **disposable
  projections** that rebuild from Git. Deleting and rebuilding the index must
  preserve behaviour, and a fresh clone must contain enough durable
  information to render the workspace.

### Offline-first

- Network services are not a prerequisite for basic use. With no connection a
  user can open a workspace, navigate and search, edit, render notebook
  blocks, run local jobs, inspect history and create checkpoints. Remote Git
  and realtime only add sync and collaboration.

## Consequences

Positive:

- One durable model (Git) with no second event-sourced write log to keep
  consistent; reconnect recovery is "fetch HEAD, rebuild/update the index".
- Human-readable, diffable, branchable history that stays useful outside the
  app.
- Fully offline-capable; collaboration is an optional additive layer.

Trade-offs:

- Edits between checkpoints can be lost on crash (mitigated by the batched
  autosave boundaries; accepted for v1).
- No character-level co-editing at launch; same-file concurrent edits resolve
  via three-way merge, which can surface conflicts the user must resolve.
- History granularity is coarser than a per-keystroke event log, by design.

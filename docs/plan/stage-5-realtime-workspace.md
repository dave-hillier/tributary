# Stage 5 — Realtime Workspace Experience

**Source:** architecture §10 "Slice 5".
**Outcome:** Add optional remote collaboration to an already-complete local-
first product — presence, work-item assignment/status notifications, Git sync,
job progress — without introducing a second durable document model.

## Goal

Optional WebSocket/SSE relay for ephemeral presence/edit sessions, committed
workspace/work-item change notifications and job progress. Remote commits are
fetched/merged locally; each client refreshes its own derived views from local
Git/index state. Git remains sole durable truth (§5.4, §7.3).

## Work breakdown

### 5.1 Relay service (optional infra)
- SSE/WebSockets relay carrying: committed changes, presence, job progress,
  notifications (§5.4 event set). Ephemeral only.

### 5.2 Client sync loop (`workspace`, `app-desktop`)
- Fetch/merge remote commits locally on events (and on timer).
- Rebuild/update local index from local Git state after fetch (§5.3).

### 5.3 Awareness (`components`)
- Show who is viewing/editing a document or work item — awareness, not a hard
  edit lock (§12).

### 5.4 Conflict surfacing
- Broadcast checkpoint commits + assignment/status changes immediately.
- Surface merge/conflict state when concurrent same-file edits cannot be cleanly
  reconciled (§7.2).

## Exit criteria

- [ ] Two desktop sessions using the same remote see assignment/status changes,
      checkpointed document changes, job completion and presence without
      polling (real two-clients test over a temp shared remote).
- [ ] A dropped event connection recovers by fetching Git and rebuilding/
      updating local index state; offline clients keep working and sync later
      (realtime recovery test, §13).
- [ ] Event data is operational only — Git remains durable truth.

**Collaboration added without a second durable model.**
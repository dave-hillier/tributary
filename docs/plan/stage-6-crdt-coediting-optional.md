# Stage 6 — Character-Level Co-Editing (Optional, Gated)

**Source:** architecture §10 "Slice 6", §12.
**Status:** **Not planned for v1.** Undertaken only if presence + Git three-way
merge (§7.2) prove insufficient. This stage is gated on demonstrated need by
real usage, not prefixed work.

## Goal (if triggered)

Google-Docs-style same-document character-level co-editing.

## Work breakdown (deferred)

- Integrate Yjs/CRDT (or selected alternative) as *live working state* only.
- Anchor live sessions to a base Git revision (§10 Slice 6).
- Checkpoint CRDT state into Markdown and Git at deliberate boundaries.
- Define conflict semantics between external Git changes and active CRDT
  sessions.

## Exit criteria (if triggered)

- [ ] Two users can type concurrently without destructive overwrite.
- [ ] Closing all sessions still leaves a clean `.md` file and normal Git
      history.

## Interlock

- Sequence only after Stages 1–5 are proven in the field and three-way merge is
  demonstrably insufficient.
- Must not weaken the invariant that `.md` + Git is the durable source of truth.
# Stage 7 — Agent / Review Workflow + Hardening

**Source:** architecture §10 "Slice 7".
**Outcome:** Use Git-native change review as a product feature; harden security
and scale.

## Goal

Agents/jobs create branches and proposed changes; render semantic Markdown and
notebook-block diffs; add the permissions/execution policy/sandboxing/audit
surfaces the deployment model needs; scale index/search with incremental
invalidation; add import/export and repository health diagnostics.

## Work breakdown

### 7.1 Agent proposed changes (`jobs`, `workspace`)
- Agents/jobs create branches + proposed changes (§5.5).
- Render **semantic Markdown diffs** and **notebook-block diffs**.

### 7.2 Review as a product feature (`app-desktop`, `components`)
- Approve/merge flow writing changes into durable workspace history
  (reuses Job/report diff surface from Stage 4).

### 7.3 Security & policy (`api`, `workspace`, `jobs`)
- Permissions, execution policy, sandboxing and audit surfaces per the
  deployment model (§8, §4.3 trust table).
- **ADR-004 worker/process boundary** (re-filed here from the 2026-09 review,
  which is now retired). Cell execution currently runs in the renderer with a
  defense-in-depth capability lock (`withScopeLock` shadows ambient globals and
  freezes the injected scope), which seals the API seam but is not a
  hostile-code sandbox. Move compilation/evaluation behind a local worker or
  child process so execution failures and resource use cannot destabilise the
  renderer, and add the capability-denial tests the exit criteria call for.
- Health diagnostics + import/export. **Already in place:** ontology
  diagnostics (ADR-005 §9) report deprecated keys, unknown vocabulary and
  unresolvable references via `Workspace.diagnostics()`. Repository health here
  means extending that surface — duplicate ids, orphaned links, index staleness
  — not building a second validation path. Validation must keep *reporting*
  rather than rejecting (§4.2).

### 7.4 Scale & index health (`index`)
- Scale index/search; background rebuilds; **incremental invalidation** (§13).

## Exit criteria

- [ ] Agent changes are reviewable before merge (semantic diff, branch→merge).
- [ ] Repository remains usable *outside* the app (plain `.md` + Git).
- [ ] Security boundaries are testable and explicit (unknown blocks, sanitised
      HTML, transclusion loops, capability denial — §13).
- [ ] Reaching this stage only after the local-first substrate is proven
      (Stages 0–5).

## Final definition-of-done (whole app)

- [ ] Every stage exit criterion above passes against real temp Git repos.
- [ ] `.md` dialect unchanged from architecture; core packages Electron-free.
- [ ] Derived index rebuild reproduces behaviour.
- [ ] Offline, a user can open/edit/checkpoint/browse history; remote only adds
      sync/collab.
---
id: SPEC-177
type: spec
role: spec
title: "Completing an adopted report's own task closes its GitHub issue"
status: approved
priority: medium
created: 2026-10-12
updated: 2026-10-16
tags: []
---
# Completing an adopted report's own task closes its GitHub issue

**Goal**: when the task that IS a filed defect report (the task `lore issue adopt` mints, or the task a filing creates) is completed with `lore done`, its GitHub issue is closed as completed — the most direct binding between work and issue. `lore issues --sync --apply` closes the same cases that were missed. User decision 2026-10-12 ("补上这种绑定并关掉这 5 个").

**Why (measured 2026-10-12)**: a read-only `lore issues --sync --json` on the live corpus listed #177, #178, #179, #180, #181 with computed resolution `closed` and GitHub state `open`: another session completed each report's own task (merges on main, e.g. a7ae2e22 for #180, edfc4028 for #177), but no `resolves` link exists, so `spec-archiving-the-work-that-resolves-a-defect-report-closes` (which closes only through `resolves` links) does not fire, and its `--sync` only labels `closed` reports.

**Baseline**: change set of this spec (`lore rule changes spec-completing-an-adopted-report-s-own-task-closes-its-github`).

## Design Decisions

- **D1 — trigger.** `lore done` archiving a task that carries `extra.issue_report` with a `github` ref closes that issue: state_reason `completed`, comment `Fixed by task <slug> (completed <date>)`, label `resolution:closed`. Same closer port, same failure handling (printed, `issue_close_failed` audit row, never undoes the archive) as BR-1082.
- **D2 — only completion closes.** An issue task archived any other way (archive sweep, a plain status change) is not claimed as fixed: no close, label only — archiving alone does not prove the defect is gone. `lore done` requires a runner-attested pass, which is the proof.
- **D3 — sync.** `lore issues --sync --apply` also closes a report whose own task reached `archived` through `lore done` (an audit row of the done walk exists) while its GitHub issue is open; other `closed` reports keep label-only.

## Edge cases

| Situation | Result |
|---|---|
| issue task completed with lore done, gh ok | issue closed completed, comment, label |
| issue task archived by sweep | not closed; label only |
| issue task without a github ref | nothing to close; one line says so |
| issue already closed | no-op success |
| gh failure | archive kept; printed + audited; sync repairs |
| `--sync --apply` over #177–#181 (done-archived) | closed |

## Acceptance Criteria

Declared with `lore ac add` (AC-IT-1..3).


## Acceptance Criteria (structured)

- [⚑] [script] AC-IT-1: Service level with a recording fake closer (new file issue-task-done-close.test.ts): (a) TaskWorkflowService.done on a task carrying extra.issue_report with a github ref calls close(#N) once with state_reason completed and a comment naming the task, then label(resolution:closed); (b) the same task archived through the archive sweep or a plain status change -> no close call, label only; (c) close failure -> task still archived, one issue_close_failed audit row, the result names the failure; (d) no github ref -> no call, the result says so; (e) already closed -> no-op success. Smallest red mutation: closing from the sweep path fails (b).
  script: test — bunx vitest run packages/lore/tests/unit/service/issue-task-done-close.test.ts
- [⚑] [script] AC-IT-2: Compiled CLI, stub gh first on PATH, throwaway corpus with a {repo} feedback.upstream (new file issue-task-done-close-compiled.bun.test.ts, hermetic session ids): a filed report task for #9 completed with lore done (after a runner-attested pass) exits 0 and the stub log shows a close with state_reason completed naming the task; lore issues --sync --json lists a done-archived report whose close had failed and --sync --apply closes it, while a sweep-archived report is only labelled. Smallest red mutation: done not calling the step leaves the stub log empty.
  script: e2e — bun run build && cd packages/lore && bun test tests/e2e/issue-task-done-close-compiled.bun.test.ts
- [⚑] [script] AC-IT-3: bun run typecheck exits 0.
  script: tsc — bun run typecheck

## Code anchors

- packages/lore/src/service/issue-closer-port.ts
- packages/lore/src/service/issue-close-on-archive.ts

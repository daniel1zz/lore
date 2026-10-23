---
id: KN-669
type: knowledge
role: knowledge
title: "Assessment: Archiving the work that resolves a defect report closes its GitHub issue (2026-10-12)"
status: archived
priority: medium
created: 2026-10-12
updated: 2026-10-23
tags: []
parent: PLAN-155
links:
  - {id: PLAN-155, type: informs}
---
# Assessment: met (84/100)

Scope: plan `01M4QF6ZY62YK67Q9EQQR5VHHR`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-IC-1 | 87 | Red-first record (module missing), then 17/17 passing three times. The diff shows the step runs post-commit from set, the plan-close cascade and the sweep, with audit rows and prose warnings. The done path (task-workflow-service.ts) is not shown. An already-closed issue still gets a label call. | 01M4QF70TC07Q2SSG26V9QVA91 (evidence [1] red, [6][16][25] pass) |
| AC-IC-2 | 84 | A real red was recorded (exit 2, expected 4, for a resolves target that is not a filed report), then three passing runs. create-resolves.ts validates every target before any write. The pass output tails show only build logs, not the bun test summary, so the pass rests on runner attestation. | 01M4QF70TC07Q2SSG26V9QVA91 (evidence [5] red, [11][20][26] pass) |
| AC-IC-3 | 88 | GhIssueCloser closes with PATCH state=closed and state_reason=completed. It reads the issue first and makes no write when it is already closed. Comment and label are separate calls that return typed errors, with no retries. Red-first, then 10/10 passing three times. | 01M4QF70TC07Q2SSG26V9QVA91 (evidence [2] red, [7][17][27] pass) |
| AC-IC-4 | 83 | planSync and applySync match drift cases (a) and (b), and non-fixed reports are only labelled, never closed. --check-issues no longer flags computed-fixed reports. Exit codes go beyond the spec: unconfigured or unreadable gives exit 1, even without --apply. Whether retired assertions were deleted r… | 01M4QF70TC07Q2SSG26V9QVA91 (evidence [3][4] red, [8][18][28] pass) |
| AC-IC-5 | 88 | Typecheck was attested passing three times. app.ts wires the step into both the SQLite and Turso branches. The output tail is truncated before the dashboard typecheck finishes. | 01M4QF70TC07Q2SSG26V9QVA91 (evidence [15][24][29]) |

## Gaps

- In packages/lore/src/service/issue-close-on-archive.ts, closeOne calls labelIssue even when closeIssue reports alreadyClosed. AC-IC-1(g) says this case should be a no-op success.
- In packages/lore/src/service/issue-close-on-archive.ts, read_failed outcomes are printed but write no issue_close_failed audit row, which is weaker than invariant I3.
- packages/lore/src/adapters/cli/issues-sync.ts returns 1 without --apply when GitHub is not configured or an issue is unreadable. AC-IC-4 specifies exit 0 without --apply.
- packages/lore/tests/e2e/baseline-slice2-rollback.bun.test.ts adds capture_source_runner_unattested_count, attributed to a different spec (#48). This is outside this plan's scope.
- In packages/lore/src/app.ts, the wireIssueCloseOnArchive JSDoc is placed after createApp's JSDoc, so the D-007 doc now attaches to the wrong function.

## Recommendations

- State the exit code for `lore issues --sync` without --apply when GitHub is not configured or an issue is unreadable, and say whether an already-closed issue still gets the resolution:fixed label.
- Capture evidence tails from the end of test and tsc output, including the pass summary, instead of build preludes.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 44420ms
- Retried: false
- Truncated sections: diff:packages/lore/src/service/task-workflow-service.ts, diff:packages/lore/tests/e2e/issue-check.bun.test.ts, diff:packages/lore/tests/e2e/issue-close-on-archive-compiled.bun.test.ts, diff:packages/lore/tests/e2e/issue-closure-e2e.bun.test.ts, diff:packages/lore/tests/unit/adapters/issues-sync.test.ts, diff:packages/lore/tests/unit/adapters/status-check-issues.test.ts, diff:packages/lore/tests/unit/service/issue-close-on-archive.test.ts, diff:packages/lore/tests/unit/service/issue-closer-port.test.ts
- Reasoning clipped for: AC-IC-4

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 85 | 0.7 | evidence | Every component is present and wired. Minor departures from the spec: a label call on already-closed issues, extra exit-1 cases in sync, and the done path is unseen. |
| evidence_integrity | 82 | 0.7 | evidence | Red-first records exist for every test AC, followed by three attested passes. The e2e and tsc pass tails are truncated before their summary lines. |
| scope_fidelity | 80 | 0.65 | evidence | Mostly on-scope. An unrelated status-key re-baseline in baseline-slice2-rollback.bun.test.ts and an unrelated capture-source test run show some drift. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | minor | AC-IC-1 | In packages/lore/src/service/issue-close-on-archive.ts, closeOne calls labelIssue even when closeIssue reports alreadyClosed. AC-IC-1(g) says this case should be a no-op success. |
| outcome | minor | AC-IC-1 | In packages/lore/src/service/issue-close-on-archive.ts, read_failed outcomes are printed but write no issue_close_failed audit row, which is weaker than invariant I3. |
| outcome | minor | AC-IC-4 | packages/lore/src/adapters/cli/issues-sync.ts returns 1 without --apply when GitHub is not configured or an issue is unreadable. AC-IC-4 specifies exit 0 without --apply. |
| scope_fidelity | minor | — | packages/lore/tests/e2e/baseline-slice2-rollback.bun.test.ts adds capture_source_runner_unattested_count, attributed to a different spec (#48). This is outside this plan's scope. |
| outcome | minor | AC-IC-5 | In packages/lore/src/app.ts, the wireIssueCloseOnArchive JSDoc is placed after createApp's JSDoc, so the D-007 doc now attaches to the wrong function. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| spec | State the exit code for `lore issues --sync` without --apply when GitHub is not configured or an issue is unreadable, and say whether an already-closed issue still gets the resolution:fixed label. | The implementation decided both cases where the spec is silent or conflicts. |
| process | Capture evidence tails from the end of test and tsc output, including the pass summary, instead of build preludes. | The e2e and tsc pass tails do not show the result they attest. |

## Unverifiable Materials

- packages/lore/src/service/task-workflow-service.ts: Omitted from the diff. The done-path wiring of the post-archive step cannot be inspected.
- packages/lore/tests/unit/adapters/status-check-issues.test.ts: Omitted from the diff. Cannot confirm retired assertions were deleted rather than skipped.
- plan dispatch ordering after plan-one-worktree-removal-test-for-the-guard-lore-done-and-a: Nothing in the materials shows the merge order.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 5
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 5 declared criteria
- Task evidence: 1 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.83

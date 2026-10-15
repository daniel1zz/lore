---
id: KN-667
type: knowledge
role: knowledge
title: "Assessment: Completing an adopted report's own task closes its GitHub issue (2026-10-12)"
status: approved
priority: medium
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PLAN-179
links:
  - {id: PLAN-179, type: informs}
---
# Assessment: met (85/100)

Scope: plan `01M4QPSD6YH4PS961DCR6ZQ1HY`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-IT-1 | 84 | 8 vitest cases pass (attested), with a red-first run before. They cover (a) close→comment→label, (c)–(e) and sync. Gap: (b) asserts zero writes on sweep or plain archive, but the spec says 'label only', so labelling at archive time is never checked. The fake closer cannot check state_reason. | 01M4QPSDSX7A8X4MMBN8X4NS7T (evidence [1] expected-fail, [3]/[8] pass 8/8) |
| AC-IT-2 | 86 | The compiled-binary e2e uses a stub gh that never calls the real one, plus mkdtemp and hermetic sessions. It asserts the PATCH with state_reason=completed, the comment naming the task, the label, the failure path, and that sync --apply closes the done-archived #10 and only labels #11. It was red fi… | 01M4QPSDSX7A8X4MMBN8X4NS7T (evidence [2] expected-fail, [6]/[9] pass) |
| AC-IT-3 | 95 | bun run typecheck passes (attested). The tail shows every sub-typecheck being invoked. | 01M4QPSDSX7A8X4MMBN8X4NS7T (evidence [5]/[10]) |

## Gaps

- AC-IT-1(b) requires 'no close call, label only' for sweep or plain-status archives. packages/lore/tests/unit/service/issue-task-done-close.test.ts asserts closer.writes equals [] in those cases, so no label is applied at archive time. Labelling happens only through issues --sync.
- wasCompletedThroughDone in packages/lore/src/service/issue-close-on-archive.ts depends on an audit-row shape written by packages/lore/src/service/task-workflow-service.ts (writeTaskStatus). That writer is not part of this diff, and no test pins the shape directly.

## Recommendations

- Restate AC-IT-1(b) as 'no close or comment at archive time; sync labels it later', or require an immediate label and test for it.
- Require attested e2e output tails to include the test runner's pass/fail summary, not just the build preamble.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 31103ms
- Retried: false
- Truncated sections: (none)
- Reasoning clipped for: AC-IT-2

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 85 | 0.75 | evidence | Done-triggered close, failure handling, and sync close of done-archived reports are implemented and tested. The (b) 'label only' wording differs from the tested behaviour. |
| evidence_integrity | 86 | 0.8 | evidence | Red-first runs, then attested passes for all three ACs. The AC-IT-2 tail is truncated to build output; 2 of the 10 records are self-reported. |
| scope_fidelity | 88 | 0.75 | evidence | The diff touches only the closer step, done(), and two new test files, which matches the single planned task. The after-landing ops are not evidenced but are outside the code scope. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | minor | AC-IT-1 | AC-IT-1(b) requires 'no close call, label only' for sweep or plain-status archives. packages/lore/tests/unit/service/issue-task-done-close.test.ts asserts closer.writes equals [] in those cases, so no label is applied at archive time. Labelling happens only through issues --sync. |
| evidence_integrity | minor | AC-IT-1 | wasCompletedThroughDone in packages/lore/src/service/issue-close-on-archive.ts depends on an audit-row shape written by packages/lore/src/service/task-workflow-service.ts (writeTaskStatus). That writer is not part of this diff, and no test pins the shape directly. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| spec | Restate AC-IT-1(b) as 'no close or comment at archive time; sync labels it later', or require an immediate label and test for it. | The spec text and the tested behaviour differ. |
| process | Require attested e2e output tails to include the test runner's pass/fail summary, not just the build preamble. | The AC-IT-2 tail does not show the test result. |

## Unverifiable Materials

- TaskWorkflowService.writeTaskStatus audit details: Not in the diff. The D3 detection relies on its details.done/status_to shape.
- Post-landing live sync and baseline prose update: No evidence that #177–#181 were closed or that the BR-1084 prose was updated.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 3
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 3 declared criteria
- Task evidence: 1 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.80

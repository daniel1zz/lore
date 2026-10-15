---
id: KN-683
type: knowledge
role: knowledge
title: "Assessment: An active spec counts as approved for claims and plan approval (2026-10-15)"
status: approved
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PLAN-180
links:
  - {id: PLAN-180, type: informs}
---
# Assessment: met (83/100)

Scope: plan `01M4ZE2765T9F0VW438G97ZCH4`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-ACT-1 | 86 | A red run was recorded first ([1]), then 4 attested passes with 6 tests passing. The integration test covers active claim and plan approval, the ready flag, draft and in-review exit-4 refusals. Gaps: the draft case reopens from approved, not from active, and spec status is set by a raw DB UPDATE. | task-skill-implement-upstream-approved-statuses-becomes (evidence [1] expected-fail, [2][4][5][7] pass) |
| AC-ACT-2 | 88 | Grep evidence confirms the set is {approved, active} at task-workflow.ts:1072. Both consumers reference the constant and neither builds its own set. Unit tests are updated to size 2. No red run was recorded for this AC, and record [3] uses oracle=other. | task-skill-implement-upstream-approved-statuses-becomes (evidence [3][6][8]) |

## Gaps

- The landing task's only evidence is a lore verify run scoped to the implement task. The exit criteria require bun run test:vitest, bun run test:bun and bun run typecheck on main, but none of those runs is recorded.
- packages/lore/tests/integration/gates/active-spec-counts-as-approved.bun.test.ts reopens the spec from approved, not from active, and sets status with a raw DB UPDATE. The spec's 'same spec reopened to draft' after active is therefore not literally exercised.
- No expected-fail run was recorded for AC-ACT-2 before the change to packages/core/src/task-workflow.ts, which goes against invariant I3.

## Recommendations

- Require the landing task to attach evidence for the full suite and typecheck runs on main before lore done.
- Amend AC-ACT-1 to say the draft-refusal case reopens from approved, or define a lifecycle path from active to draft.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 25301ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 87 | 0.8 | evidence | The constant change reaches all three consumers, shown by integration and unit tests. Refusals for draft and in-review are preserved. |
| evidence_integrity | 72 | 0.7 | evidence | AC-ACT-1 has red-then-green evidence. AC-ACT-2 has no red run. Landing evidence is thin: no full-suite or typecheck record on main. |
| scope_fidelity | 92 | 0.8 | evidence | The diff covers only the constant, JSDoc, the new AC test and the R1-pinned tests. No drift beyond the plan. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | — | The landing task's only evidence is a lore verify run scoped to the implement task. The exit criteria require bun run test:vitest, bun run test:bun and bun run typecheck on main, but none of those runs is recorded. |
| outcome | minor | AC-ACT-1 | packages/lore/tests/integration/gates/active-spec-counts-as-approved.bun.test.ts reopens the spec from approved, not from active, and sets status with a raw DB UPDATE. The spec's 'same spec reopened to draft' after active is therefore not literally exercised. |
| evidence_integrity | minor | AC-ACT-2 | No expected-fail run was recorded for AC-ACT-2 before the change to packages/core/src/task-workflow.ts, which goes against invariant I3. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require the landing task to attach evidence for the full suite and typecheck runs on main before lore done. | The exit criteria name these runs, but the evidence trail does not show them. |
| spec | Amend AC-ACT-1 to say the draft-refusal case reopens from approved, or define a lifecycle path from active to draft. | The AC wording assumes an active->draft transition that the test says is illegal. |

## Unverifiable Materials

- packages/lore/src/adapters/cli/task-feed-wiring.ts contents: This file is not in the diff. Only the grep evidence shows that it imports UPSTREAM_APPROVED_STATUSES.
- Full suite / typecheck output on main: No evidence record contains these runs.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 2
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 2 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.89

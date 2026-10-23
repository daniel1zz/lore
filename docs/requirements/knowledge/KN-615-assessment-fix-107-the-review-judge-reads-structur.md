---
id: KN-615
type: knowledge
role: knowledge
title: "Assessment: Fix #107: the review judge reads structured parts of the document (2026-10-10)"
status: archived
priority: medium
created: 2026-10-10
updated: 2026-10-23
tags: []
parent: PLAN-171
links:
  - {id: PLAN-171, type: informs}
---
# Assessment: met (82/100)

Scope: plan `01M4HVBDN4VAS3X0YKYG98QBHX`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-RJI-1 | 86 | A RED run (expected-fail) is followed by GREEN runs: 12/12 pass in the worktree and on main. Tests use the real getReviewBundle and judgeDoc with a stub provider. They cover leaf rules and depends_on, branch glossary, parent-spec ACs not named in the body, and a counted omission line, with negative… | 01M4HVBEE4YHM6S3CRR0VR37VY (implement task: worktree pass, main pass, expected-fail), 01M4HVBE3B8SH559AW0DV5QH7Z (RED task: expected-fail then pass) |

## Gaps

- The risk mitigation (test:changed and a main re-run after merge) and the census invariant have no recorded evidence. The prompt change in packages/lore/src/ai/review-template.ts may affect existing v2 prompt snapshot tests.
- The criteria cap path is not exercised. The 120-criterion case in packages/lore/tests/unit/service/review-judge-structured-input.test.ts fits under STRUCTURED_BLOCK_MAX_CHARS, so the counted criteria omission line is untested.
- The structured section in packages/lore/src/ai/review-template.ts is uncapped against the overall prompt budget (60k per list, several lists), which risks exceeding the provider context.

## Recommendations

- Require full-suite or test:changed evidence on main after merge, plus a census report, before archiving tasks.
- Add a boundary test for criteria over the cap so the omission count is actually rendered and checked.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 27019ms
- Retried: false
- Truncated sections: (none)
- Reasoning clipped for: AC-RJI-1

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 86 | 0.75 | evidence | The diff renders baseline rules, glossary and depends_on and parent-spec ACs in v2, with counted omission. The tests exercise the production bundle and judge path. |
| evidence_integrity | 70 | 0.65 | evidence | RED then GREEN, with 3 attested passes. Attested ratio is only 0.60, the RED tails are truncated, and there is no regression-suite or census evidence. |
| scope_fidelity | 90 | 0.8 | evidence | The change touches only review-template.ts and the new test. v1 is left unchanged. No unrelated drift. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-RJI-1 | The risk mitigation (test:changed and a main re-run after merge) and the census invariant have no recorded evidence. The prompt change in packages/lore/src/ai/review-template.ts may affect existing v2 prompt snapshot tests. |
| outcome | minor | AC-RJI-1 | The criteria cap path is not exercised. The 120-criterion case in packages/lore/tests/unit/service/review-judge-structured-input.test.ts fits under STRUCTURED_BLOCK_MAX_CHARS, so the counted criteria omission line is untested. |
| outcome | minor | — | The structured section in packages/lore/src/ai/review-template.ts is uncapped against the overall prompt budget (60k per list, several lists), which risks exceeding the provider context. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require full-suite or test:changed evidence on main after merge, plus a census report, before archiving tasks. | The plan's risk register and invariants name these checks, but no evidence for them was recorded. |
| plan | Add a boundary test for criteria over the cap so the omission count is actually rendered and checked. | The current test passes because nothing is omitted, so the counting branch is never run. |

## Unverifiable Materials

- Full test suite / test:changed run on main after merge: No evidence record is provided. Snapshot tests for existing v2 prompts may be affected.
- Census coverage report: The plan invariant says 0 gaps, but no output is attached.
- Production review prompt version selection (v1 vs v2): The fix only applies in v2. The test path shows judgeDoc uses v2, but the production config is not visible.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 3
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 1 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.60

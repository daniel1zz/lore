---
id: KN-613
type: knowledge
role: knowledge
title: "Assessment: Fix #104: the site census follows dependency-injected functions (2026-10-10)"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PLAN-169
links:
  - {id: PLAN-169, type: informs}
---
# Assessment: partially_met (52/100)

Scope: plan `01M4HVAAKGW9TBKT3HMRPNH5T4`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-BLS2-20 | 72 | The attested RED came before the attested GREEN, with 10 tests passing. A later diff loosened the insertWithProvenance assertion to also accept a dynamic: key. The plan says the implementer never edits assertions, and the materials don't say who made this edit. The weaker check still fits the AC's … | task-red-for-104-ac-bls2-20 (expected-fail then pass), task-implement-104-make-ac-bls2-20-green (pass, 10 tests) |
| AC-BLS2-12 | 70 | One attested pass covers the specification and execution branches after the merge. The output tail shows only bootstrap lines, not the measured exit codes. That supports this AC but not task 3's claim that all 12 branches are back to 0 gaps. | task-map-104-s-newly-found-census-sites-on-main-and-restore-0 |
| AC-BLS2-5 | 25 | The risk register promised to re-run AC-BLS2-5 on main after the merge as a regression check. There is no evidence that it ran, even though this diff changes when census.ts records a dynamic interface site. | — |
| AC-BLS2-15 | 25 | A determinism and fidelity re-run was promised but not evidenced. The new whole-program binding indexes could change site keys, and nothing shows they don't. | — |
| AC-BLS2-13 | 10 | Not targeted beyond the plan's all-12-branches coverage exit. There is no evidence of per-branch exit 0 for all 12 branches. | — |
| AC-BLS2-18 | 10 | Not targeted by this plan. Only branch coverage could be affected, and there is no evidence about the 9 fast-mode branches. | — |
| AC-BLS2-1 | 10 | Not targeted by this plan. No evidence. | — |
| AC-BLS2-2 | 10 | Not targeted by this plan. No evidence. | — |
| AC-BLS2-3 | 10 | Not targeted by this plan. No evidence. | — |
| AC-BLS2-4 | 10 | Not targeted by this plan. No evidence. | — |
| AC-BLS2-6 | 10 | Not targeted by this plan. No evidence. | — |
| AC-BLS2-7 | 10 | Not targeted by this plan. No evidence. | — |
| AC-BLS2-8 | 10 | Not targeted by this plan. No evidence. | — |
| AC-BLS2-9 | 10 | Not targeted by this plan. No evidence. | — |
| AC-BLS2-10 | 10 | Not targeted by this plan. No evidence. | — |
| AC-BLS2-11 | 10 | Not targeted by this plan. No evidence. | — |
| AC-BLS2-14 | 10 | Not targeted by this plan. No evidence. | — |
| AC-BLS2-16 | 10 | Not targeted by this plan. No evidence. | — |
| AC-BLS2-17 | 10 | Not targeted by this plan. No evidence. | — |
| AC-BLS2-19 | 10 | Not targeted by this plan. No evidence. | — |
| AC-BLS2-21 | 10 | Not targeted by this plan. No evidence. | — |
| AC-BLS2-22 | 10 | Not targeted by this plan. No evidence. | — |
| AC-BLS2-23 | 10 | Not targeted by this plan. No evidence. | — |

## Gaps

- Task 3 requires coverage exit 0 on all 12 branches, but its only evidence runs coverage on the specification and execution branches. The other 10 branches are unverified, yet the task is archived.
- After RED, the insertWithProvenance assertion in packages/lore/tests/unit/service/site-census-injection.test.ts was loosened to accept dynamic: keys. Who made the change isn't recorded, which may break the 'implementer never edits test assertions' invariant.
- In packages/lore/src/service/site-census.ts, valuesBoundTo returns opaque:false for properties even though it ignores assignment writes, untyped literals and spreads. A single visible binding can then be followed as the only implementation, with no dynamic site recorded. That silently omits real targets, which C1 forbids.
- The promised regression re-runs of AC-BLS2-5 and AC-BLS2-15 after the merge have no evidence, even though the interface-dispatch path in packages/lore/src/service/site-census.ts changed.

## Recommendations

- Block plan-close unless coverage evidence for all 12 armed branches, with measured exit codes, is attached to the mapping task.
- Make each risk-register mitigation that names a re-run (AC-BLS2-5/15) carry its own evidence record.
- Require any test-assertion amendment after RED to be recorded as a tester action with its reason, separate from the implementer's commits.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 43180ms
- Retried: false
- Truncated sections: spec
- Reasoning clipped for: AC-BLS2-20

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 60 | 0.6 | evidence | AC-BLS2-20 is green and the injection logic is static and reasonable. But the 12-branch 0-gap close condition and the regression re-runs are not shown. |
| evidence_integrity | 50 | 0.6 | evidence | RED before GREEN is attested. But an assertion was loosened by an unrecorded author after RED, and task 3's evidence covers 2 of 12 branches. |
| scope_fidelity | 75 | 0.6 | evidence | Changes are limited to site-census.ts and the new test. The SourceFile guard is a small fix that the diff explains. Whole-program binding scan goes beyond the composition-root claim. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-BLS2-12 | Task 3 requires coverage exit 0 on all 12 branches, but its only evidence runs coverage on the specification and execution branches. The other 10 branches are unverified, yet the task is archived. |
| evidence_integrity | major | AC-BLS2-20 | After RED, the insertWithProvenance assertion in packages/lore/tests/unit/service/site-census-injection.test.ts was loosened to accept dynamic: keys. Who made the change isn't recorded, which may break the 'implementer never edits test assertions' invariant. |
| outcome | major | AC-BLS2-15 | In packages/lore/src/service/site-census.ts, valuesBoundTo returns opaque:false for properties even though it ignores assignment writes, untyped literals and spreads. A single visible binding can then be followed as the only implementation, with no dynamic site recorded. That silently omits real targets, which C1 forbids. |
| outcome | minor | AC-BLS2-5 | The promised regression re-runs of AC-BLS2-5 and AC-BLS2-15 after the merge have no evidence, even though the interface-dispatch path in packages/lore/src/service/site-census.ts changed. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Block plan-close unless coverage evidence for all 12 armed branches, with measured exit codes, is attached to the mapping task. | The invariant demands all 12 branches at 0 gaps. Here 2 were evidenced. |
| process | Make each risk-register mitigation that names a re-run (AC-BLS2-5/15) carry its own evidence record. | Promised mitigations went unevidenced. |
| prompt | Require any test-assertion amendment after RED to be recorded as a tester action with its reason, separate from the implementer's commits. | The author of the loosened assertion is unknown. |

## Unverifiable Materials

- Coverage outputs and exit codes for the 10 branches other than specification and execution: Not in the evidence. Task 3 claims all 12.
- Author of the second test-file hunk: The diff doesn't show who made it, so the invariant can't be checked.
- AC-BLS2-5/15 regression runs after the merge: No evidence records.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 3
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 23 declared criteria
- Task evidence: 3 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.60

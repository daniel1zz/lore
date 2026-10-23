---
id: KN-610
type: knowledge
role: knowledge
title: "Assessment: Fix #104: the site census follows dependency-injected functions (2026-10-10)"
status: archived
priority: medium
created: 2026-10-10
updated: 2026-10-23
tags: []
parent: PLAN-169
links:
  - {id: PLAN-169, type: informs}
---
# Assessment: partially_met (62/100)

Scope: plan `01M4HVAAKGW9TBKT3HMRPNH5T4`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-BLS2-20 | 72 | RED expected-fail and later pass of site-census-injection.test.ts (10 tests) are both recorded. Two weaknesses: after RED, the orchestrator loosened the insertWithProvenance oracle to accept dynamic: keys (disclosed), and the case-3 'no guess' assertion (count%2==0) is weak. | task-red-for-104-ac-bls2-20 (expected-fail at the RED moment), task-implement-104-make-ac-bls2-20-green (pass, 10 tests) |
| AC-BLS2-12 | 60 | Spec/execution coverage command recorded as pass, but the tail shows only bootstrap lines and no exit code. The all-12 claim comes from a scratchpad script outside the repo, and its 134-byte tail says 'after the #94 census fix', not #104. | task-map-104-s-newly-found-census-sites-on-main-and-restore-0 (evidence [1] and [2]) |
| AC-BLS2-5 | 35 | The plan's risk register promises a re-run of site-census.test.ts on main after merge as regression. No evidence of that run exists, and the change alters dynamic-site emission for interface calls. | — |
| AC-BLS2-15 | 35 | The plan promises a regression re-run of site-census-fidelity.test.ts after merge. None is recorded, and the census's key and dynamic-site behaviour changed in site-census.ts. | — |

## Gaps

- The all-12 branch coverage pass is a scratchpad script outside the repo. Its output names the '#94 census fix', not #104, so it may not reflect coverage after the #104 merge.
- The plan promised post-merge regression re-runs of AC-BLS2-5/15 (site-census.test.ts, site-census-fidelity.test.ts). No evidence of either is recorded.
- valuesBoundTo in packages/lore/src/service/site-census.ts only enumerates object-literal members, initializers and call arguments. Assignment bindings are missed, so a call with one visible binding is followed as the sole implementation and no dynamic site is recorded (#118). This contradicts the C1 not_measured rule.
- After RED, the orchestrator loosened the insertWithProvenance oracle in packages/lore/tests/unit/service/site-census-injection.test.ts to accept dynamic: keys. It was disclosed with a rationale, but the measured bar was relaxed after measurement.

## Recommendations

- Require regression ACs named in the risk register (AC-BLS2-5/15) to carry evidence before the plan closes.
- Coverage evidence across branches must come from a script committed to the repo, with an exit code per branch and a reference to the issue being closed.
- State in C1 or AC-BLS2-20 that bindings the census cannot enumerate (assignments, external callers) make the call not_measured.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 41448ms
- Retried: false
- Truncated sections: spec

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 68 | 0.6 | evidence | Census follows injected calls and the AC-BLS2-20 tests pass. The soundness gap (#118) and the loosened oracle limit how much the change proves. |
| evidence_integrity | 55 | 0.6 | evidence | RED-then-GREEN is recorded. All-12 evidence is an off-repo script with a '#94' label, there are no regression runs, and the oracle was edited after RED (disclosed). |
| scope_fidelity | 82 | 0.7 | evidence | Diff is limited to site-census.ts plus the new test. A small enclosingSymbolName SourceFile guard was added and justified inline. The oracle change is disclosed. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-BLS2-12 | The all-12 branch coverage pass is a scratchpad script outside the repo. Its output names the '#94 census fix', not #104, so it may not reflect coverage after the #104 merge. |
| evidence_integrity | major | AC-BLS2-15 | The plan promised post-merge regression re-runs of AC-BLS2-5/15 (site-census.test.ts, site-census-fidelity.test.ts). No evidence of either is recorded. |
| outcome | major | AC-BLS2-20 | valuesBoundTo in packages/lore/src/service/site-census.ts only enumerates object-literal members, initializers and call arguments. Assignment bindings are missed, so a call with one visible binding is followed as the sole implementation and no dynamic site is recorded (#118). This contradicts the C1 not_measured rule. |
| evidence_integrity | minor | AC-BLS2-20 | After RED, the orchestrator loosened the insertWithProvenance oracle in packages/lore/tests/unit/service/site-census-injection.test.ts to accept dynamic: keys. It was disclosed with a rationale, but the measured bar was relaxed after measurement. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require regression ACs named in the risk register (AC-BLS2-5/15) to carry evidence before the plan closes. | Mitigations were promised but never evidenced. |
| process | Coverage evidence across branches must come from a script committed to the repo, with an exit code per branch and a reference to the issue being closed. | Off-repo scratchpad output labelled with a different issue can't be checked against this commit. |
| spec | State in C1 or AC-BLS2-20 that bindings the census cannot enumerate (assignments, external callers) make the call not_measured. | Closes the #118 soundness hole. |

## Unverifiable Materials

- AC-BLS2-20 full statement: The spec AC table is truncated at AC-BLS2-18. AC-BLS2-20's wording is inferred from the echo text.
- all12.sh scratchpad script: Not in the repo and its content isn't shown. Only a 134-byte tail is available.
- newly found site list and baseline map records: Neither the implementer's site report nor the map invocations are in the materials.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 4
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 23 declared criteria
- Task evidence: 3 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.67

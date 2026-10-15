---
id: KN-609
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
# Assessment: partially_met (62/100)

Scope: plan `01M4HVAAKGW9TBKT3HMRPNH5T4`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-BLS2-20 | 72 | There is a RED run (expected-fail) and a GREEN run (10/10) on the named test file. After RED, the orchestrator loosened one regex to accept dynamic: keys. It recorded why, had the change reviewed independently and added a pin. The 'no guess' test uses a weak %2 check. The AC text is truncated in th… | task-red-for-104-ac-bls2-20, task-implement-104-make-ac-bls2-20-green |
| AC-BLS2-12 | 68 | Two attested passes. Evidence [1] covers only the specification and execution branches. The all-12 output_tail [2] says 'after the #94 census fix', not #104, so this may be reused evidence from an earlier fix. The script content is not shown. | task-map-104-s-newly-found-census-sites-on-main-and-restore-0 |
| AC-BLS2-5 | 25 | The risk register promises a regression re-run after merge. No evidence of it was recorded (0 pass). The census change touches interface-dispatch handling, which this AC covers. | — |
| AC-BLS2-15 | 25 | A regression re-run was promised in the plan answers and the risk register, but none was recorded. The change could affect determinism and keys. | — |
| AC-BLS2-1 | 15 | The plan does not target this AC and there is no evidence. Mitigation: the plan's stated acceptance is AC-BLS2-20 only. | — |
| AC-BLS2-2 | 15 | Not targeted by this plan; no evidence. | — |
| AC-BLS2-3 | 15 | Not targeted by this plan; no evidence. | — |
| AC-BLS2-4 | 15 | Not targeted by this plan; no evidence. | — |
| AC-BLS2-6 | 15 | Not targeted by this plan; no evidence. | — |
| AC-BLS2-7 | 15 | Not targeted by this plan; no evidence. | — |
| AC-BLS2-8 | 15 | Not targeted by this plan; no evidence. | — |
| AC-BLS2-9 | 15 | Not targeted by this plan; no evidence. | — |
| AC-BLS2-10 | 15 | Not targeted by this plan; no evidence. | — |
| AC-BLS2-11 | 15 | Not targeted by this plan; no evidence. | — |
| AC-BLS2-13 | 15 | Not targeted by this plan. The all-12 coverage result is relevant to item (1), but no fast-mode assessment is shown. | — |
| AC-BLS2-14 | 15 | Not targeted by this plan; no evidence. | — |
| AC-BLS2-16 | 15 | Not targeted by this plan; no evidence. | — |
| AC-BLS2-17 | 15 | Not targeted by this plan; no evidence. | — |
| AC-BLS2-18 | 20 | Not targeted by this plan. The all-12 coverage result is indirectly relevant. The statement is truncated. | — |
| AC-BLS2-19 | 15 | Not targeted by this plan; the statement is not visible; no evidence. | — |
| AC-BLS2-21 | 15 | Not targeted by this plan; the statement is not visible; no evidence. | — |
| AC-BLS2-22 | 15 | Not targeted by this plan; the statement is not visible; no evidence. | — |
| AC-BLS2-23 | 15 | Not targeted by this plan; the statement is not visible; no evidence. | — |

## Gaps

- Task 3's all-12 evidence output says 'record.sh re-run on main after the #94 census fix', not #104. It may not reflect coverage after the #104 merge.
- The risk register mitigation (re-run AC-BLS2-5/15 after merge) has no recorded evidence, even though packages/lore/src/service/site-census.ts changed interface-dispatch handling.
- The plan answer says injected calls resolve via the declared type to an implementation reachable from the command's composition root. In packages/lore/src/service/site-census.ts, valuesBoundTo scans the whole program instead (#118).
- The assertion in packages/lore/tests/unit/service/site-census-injection.test.ts was loosened after RED to accept dynamic: keys. This is disclosed and reviewed, and a pin was added, but the oracle is weaker than at RED.

## Recommendations

- Require attested regression runs for every AC named in a plan's risk register before the plan closes.
- Make coverage evidence include the commit hash it ran against.
- Declare extra.ac_scope listing only AC-BLS2-20 and its regression ACs.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 37353ms
- Retried: false
- Truncated sections: spec
- Reasoning clipped for: AC-BLS2-20

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 70 | 0.6 | evidence | AC-BLS2-20 is green with fixtures and real-repo cases, and all-12 coverage passes. The regression re-runs are missing, and resolution scope differs from the plan. |
| evidence_integrity | 58 | 0.55 | evidence | There is a RED→GREEN trail, and the post-RED oracle change is disclosed and reviewed. The all-12 evidence mentions #94, not #104. One self-reported run per task. |
| scope_fidelity | 78 | 0.6 | evidence | The diff is confined to site-census.ts and its test. A small SourceFile guard is explained. Bound values are resolved program-wide, not from the composition root. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-BLS2-12 | Task 3's all-12 evidence output says 'record.sh re-run on main after the #94 census fix', not #104. It may not reflect coverage after the #104 merge. |
| outcome | major | AC-BLS2-15 | The risk register mitigation (re-run AC-BLS2-5/15 after merge) has no recorded evidence, even though packages/lore/src/service/site-census.ts changed interface-dispatch handling. |
| scope_fidelity | minor | AC-BLS2-20 | The plan answer says injected calls resolve via the declared type to an implementation reachable from the command's composition root. In packages/lore/src/service/site-census.ts, valuesBoundTo scans the whole program instead (#118). |
| evidence_integrity | minor | AC-BLS2-20 | The assertion in packages/lore/tests/unit/service/site-census-injection.test.ts was loosened after RED to accept dynamic: keys. This is disclosed and reviewed, and a pin was added, but the oracle is weaker than at RED. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require attested regression runs for every AC named in a plan's risk register before the plan closes. | The promised AC-BLS2-5/15 re-runs were never recorded. |
| process | Make coverage evidence include the commit hash it ran against. | The all-12 evidence text references #94, which makes its timing ambiguous. |
| plan | Declare extra.ac_scope listing only AC-BLS2-20 and its regression ACs. | Without it, 21 unrelated ACs count as in scope. |

## Unverifiable Materials

- Full AC-BLS2-20 statement and AC-BLS2-19/21-23: The spec table is truncated after AC-BLS2-18.
- all12.sh script contents and full output: Only a 134-byte tail is shown, so I can't confirm it covers the post-#104 state.
- Commit of oracle change and lore-reviewer record: They are described in the plan but not shown.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 3
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 23 declared criteria
- Task evidence: 3 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 2 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.67

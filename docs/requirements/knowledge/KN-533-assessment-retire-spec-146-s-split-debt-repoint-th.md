---
id: KN-533
type: knowledge
role: knowledge
title: "Assessment: Retire SPEC-146's split debt — repoint the eight stale claude-md-check references, one of them a live error message (2026-08-24)"
status: approved
priority: medium
created: 2026-08-24
updated: 2026-08-24
tags: []
parent: PLAN-141
links:
  - {id: PLAN-141, type: informs}
  - {id: KN-532, type: supersedes}
---
# Assessment: inconclusive (N/A (fully truncated))

Scope: plan `01M0SJ54XVV9SFNNJZZ8NMCMP0`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-SPLITDEBT-1 | 93 | Red-before (unmarked=8 marked=4, exit 1) and green-after (unmarked=0 marked=4) both recorded, three passing attested runs, plus an attested-red falsifier mutation of claude-md-budget.ts (unmarked=1 marked=3). Diff shows exactly 8 repointed sites and the 4 marked mentions intact. | 01M0SJCHR5EQK4NHA90S3YE14T (evidence [1][2][5][11][12] + diff) |
| AC-PURE-1 | 55 | Its oracle was re-run after the message edit and passed (evidence [10], tail 320B) and a falsification run with a bogus TARGET_FILES entry failed as intended [4], but both rows carry ac_ref=(none), so the coverage table shows 0 pass / 0 fail for this AC. | 01M0SJCHR5EQK4NHA90S3YE14T (evidence [3][4][10] unattributed to AC-PURE-1) |
| AC-WIRE-1 | 45 | No oracle run in this bundle (0 pass / 0 fail). Delivered by an earlier slice; nothing here confirms it still holds. Mitigation: plan names AC-SPLITDEBT-1 as the single gate and the diff is comment/string-only, so regression risk is low. | — |
| AC-WIRE-2 | 45 | No oracle run in this bundle (0 pass / 0 fail). Out of the plan's declared gate; comment-only diff makes regression unlikely but unverified here. | — |
| AC-COMPOSE-1 | 45 | No oracle run in this bundle (0 pass / 0 fail). Not the plan's gate; the diff touches no call sites, but the composition lint was not executed. | — |
| AC-SLUG-1 | 45 | No oracle run in this bundle (0 pass / 0 fail). Prior-slice AC, unverified from these materials. | — |
| AC-SLUG-2 | 45 | No oracle run in this bundle (0 pass / 0 fail). Prior-slice AC, unverified from these materials. | — |
| AC-EMPH-1 | 45 | No oracle run in this bundle (0 pass / 0 fail). Prior-slice AC, unverified from these materials. | — |
| AC-EMPH-2 | 45 | No oracle run in this bundle (0 pass / 0 fail). Prior-slice AC, unverified from these materials. | — |
| AC-GRAM-1 | 45 | No oracle run in this bundle (0 pass / 0 fail). Prior-slice AC, unverified from these materials. | — |
| AC-RULES-1 | 45 | No oracle run in this bundle (0 pass / 0 fail). Prior-slice AC, unverified from these materials. | — |
| AC-CONTRACT-1 | 45 | No oracle run in this bundle (0 pass / 0 fail). Prior-slice AC, unverified from these materials. | — |
| AC-ADV-1 | 45 | No oracle run in this bundle (0 pass / 0 fail). Prior-slice AC, unverified from these materials. | — |
| AC-TEMPLATE-1 | 45 | No oracle run in this bundle (0 pass / 0 fail). Prior-slice AC, unverified from these materials. | — |

## Gaps

- The plan declares no ac_scope, so all 14 spec ACs are formally in scope, but 13 of them (AC-WIRE-1/2, AC-COMPOSE-1, AC-PURE-1, AC-SLUG-1/2, AC-EMPH-1/2, AC-GRAM-1, AC-RULES-1, AC-CONTRACT-1, AC-ADV-1, AC-TEMPLATE-1) have 0 pass / 0 fail in this bundle. Only AC-SPLITDEBT-1 is evidenced.
- The task required re-running AC-PURE-1's oracle after editing scripts/check-claude-md-purity.ts. A passing run of that script exists (evidence [10]) and a falsification run exists (evidence [4]), but both are tagged ac_ref=(none), so AC-PURE-1 shows zero coverage. Evidence [4] also shows no output tail, so it cannot be confirmed that the new message names the real cause.
- The replacement PurityCheckError text in scripts/check-claude-md-purity.ts names three modules (claude-md-budget.ts / claude-md-admission.ts / claude-md-findings.ts) as candidates for having been deleted or renamed, while AC-PURE-1 declares only the two service modules as purity targets. On the live missing-target path the message can therefore implicate a file that is not in TARGET_FILES — a milder version of the misdirection the task set out to remove.
- Evidence [6] (bun run typecheck) and [9] (typecheck:lore) are recorded as fail, with a later [13] pass, on a change the task itself asserts cannot break typecheck. No explanation ties the intermediate failures to a pre-existing condition or to an intervening fix, so the trail does not establish that the comment-only diff was inert.
- The task's site table routed packages/lore/src/service/context-facts.ts:65 to claude-md-budget.ts, but the diff repoints it to claude-md-admission.ts. The task authorised deviation from the table after grep verification and admission is the plausibly correct home for the risk-posture stance, so this reads as a corrected target rather than drift — but no evidence row records the grep that justified it.

## Recommendations

- Require ac_ref tagging on any oracle run the task text names as an AC's oracle, and reject 'result=pass' rows for such commands with ac_ref=(none).
- State an explicit ac_scope of [AC-SPLITDEBT-1] when a plan is a single-gate debt paydown, so prior-slice ACs are not scored as unevidenced in-scope items.
- For runtime-message deliverables, retain the observed stderr of the falsification run in the evidence tail rather than only an exit code.
- Derive user-facing diagnostic text from the guard's own data (TARGET_FILES) instead of hardcoding a module list in the message.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 79494ms
- Retried: false
- Truncated sections: spec, task:task-skill-implement-repoint-the-8-stale-claude-md-check
- Overall confidence: low (degraded by truncation)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 86 | 0.8 | evidence | The plan's single gate AC-SPLITDEBT-1 is fully evidenced red→green with an attested falsifier; all 8 sites appear repointed in the diff. Remaining 13 spec ACs carry no runs here. |
| evidence_integrity | 78 | 0.75 | evidence | 11/13 rows attested, red-before and falsifier both recorded. Weaknesses: purity runs unattributed to AC-PURE-1, falsification output tail not shown, unexplained typecheck fail at [6]/[9]. |
| scope_fidelity | 92 | 0.85 | evidence | Diff is 7 JSDoc edits plus one error string; guard condition, throw and exit path untouched; 4 history-marked mentions preserved; no test or behaviour changes. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | — | The plan declares no ac_scope, so all 14 spec ACs are formally in scope, but 13 of them (AC-WIRE-1/2, AC-COMPOSE-1, AC-PURE-1, AC-SLUG-1/2, AC-EMPH-1/2, AC-GRAM-1, AC-RULES-1, AC-CONTRACT-1, AC-ADV-1, AC-TEMPLATE-1) have 0 pass / 0 fail in this bundle. Only AC-SPLITDEBT-1 is evidenced. |
| evidence_integrity | minor | AC-PURE-1 | The task required re-running AC-PURE-1's oracle after editing scripts/check-claude-md-purity.ts. A passing run of that script exists (evidence [10]) and a falsification run exists (evidence [4]), but both are tagged ac_ref=(none), so AC-PURE-1 shows zero coverage. Evidence [4] also shows no output tail, so it cannot be confirmed that the new message names the real cause. |
| outcome | minor | AC-PURE-1 | The replacement PurityCheckError text in scripts/check-claude-md-purity.ts names three modules (claude-md-budget.ts / claude-md-admission.ts / claude-md-findings.ts) as candidates for having been deleted or renamed, while AC-PURE-1 declares only the two service modules as purity targets. On the live missing-target path the message can therefore implicate a file that is not in TARGET_FILES — a milder version of the misdirection the task set out to remove. |
| evidence_integrity | minor | — | Evidence [6] (bun run typecheck) and [9] (typecheck:lore) are recorded as fail, with a later [13] pass, on a change the task itself asserts cannot break typecheck. No explanation ties the intermediate failures to a pre-existing condition or to an intervening fix, so the trail does not establish that the comment-only diff was inert. |
| scope_fidelity | minor | — | The task's site table routed packages/lore/src/service/context-facts.ts:65 to claude-md-budget.ts, but the diff repoints it to claude-md-admission.ts. The task authorised deviation from the table after grep verification and admission is the plausibly correct home for the risk-posture stance, so this reads as a corrected target rather than drift — but no evidence row records the grep that justified it. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require ac_ref tagging on any oracle run the task text names as an AC's oracle, and reject 'result=pass' rows for such commands with ac_ref=(none). | AC-PURE-1's required re-run happened but is invisible in coverage, which understates delivered verification. |
| plan | State an explicit ac_scope of [AC-SPLITDEBT-1] when a plan is a single-gate debt paydown, so prior-slice ACs are not scored as unevidenced in-scope items. | Plan prose says AC-SPLITDEBT-1 is the single gate, but the structured absence of ac_scope forces all 14 ACs into scope. |
| process | For runtime-message deliverables, retain the observed stderr of the falsification run in the evidence tail rather than only an exit code. | When the message string IS the deliverable, exit status alone cannot show the new text names the real cause. |
| plan | Derive user-facing diagnostic text from the guard's own data (TARGET_FILES) instead of hardcoding a module list in the message. | A hardcoded list re-introduces dual-write drift the moment the target set changes. |

## Unverifiable Materials

- Oracle runs for AC-WIRE-1/2, AC-COMPOSE-1, AC-SLUG-1/2, AC-EMPH-1/2, AC-GRAM-1, AC-RULES-1, AC-CONTRACT-1, AC-ADV-1, AC-TEMPLATE-1: No evidence rows for these ACs in this bundle (0 pass / 0 fail); they were delivered by earlier slices not represented here.
- Observed stderr of the purity falsification run (evidence [4]): Only tail_bytes=381 and result=expected-fail are recorded; the message text actually printed is not shown.
- Post-edit source of scripts/check-claude-md-purity.ts around the guard condition: Only the diff hunk of the message is visible; the unchanged condition/throw/exit lines are inferred from the diff context, not read in full.
- grep -n '^export' verification of the symbol→module map: The task mandated it before writing targets; no evidence row records its output, so retarget correctness rests on the diff alone.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 0
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 3

## Facts Summary

- AC coverage: 14 declared criteria
- Task evidence: 1 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.85

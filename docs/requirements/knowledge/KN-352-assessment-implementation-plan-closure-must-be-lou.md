---
id: KN-352
type: knowledge
role: knowledge
title: "Assessment: Implementation — plan closure must be loud (2026-07-29)"
status: archived
priority: medium
created: 2026-07-29
updated: 2026-10-23
tags: []
parent: PLAN-111
links:
  - {id: PLAN-111, type: informs}
---
# Assessment: met (82/100)

Scope: plan `01KYMFMYRZ6X7RDA64W05EX84M`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-CLOSURE-1 | 88 | Detector RED→GREEN documented: 6 matched tests (3 failing pre-impl with 'Expected:1 Received:0'), then attested passes in the verify worktree covering HAPPY, vacuous-zero-task, non-terminal-sibling, already-archived, deprecated-as-terminal. 10 attested passes, 0 fails. | task-skill-test-closure-terminality-detector-red-scenarios (RED baseline, matched-count=6 asserted non-zero), task-skill-implement-plan-terminality-drift-kind-status (GREEN + typecheck exit 0) |
| AC-CLOSURE-2 | 78 | Oracle initially matched ZERO tests (attested inconclusive/fail); repaired by a dedicated task adding 2 CLI scenarios (nonzero exit + slug + literal command; --fix leaves drift and doc untouched), now 8 attested passes. But the impl task's own AC — record the repo corpus's plan-terminality drift co… | task-skill-test-check-tree-cli-scenarios-for-plan-terminality (closes the zero-match gap), task-skill-implement-plan-terminality-drift-kind-status (corpus drift count never recorded) |
| AC-CLOSURE-3 | 88 | 5 matched tests (last-task advisory, non-last negative, no-plan-write state, adhoc boundary, deprecated-sibling) RED with named missing symbols (plan_now_fully_terminal, formatLastTaskAdvisory) then attested green. Self-reported e2e smoke shows plan doc status=draft v1 unchanged after done. | task-skill-implement-lore-done-last-task-advisory-service (manual smoke is self-reported, not attested) |
| AC-CLOSURE-4 | 84 | Dedicated bun suite attested passing (HAPPY approved+--content-file prints advisory and lands draft; NEGATIVE draft prints none). One tsc fail was remediated by a later passing typecheck. Shared-constant identity assertion is claimed by the task AC but only visible via test names, not diff. | task-skill-implement-surface-approved-to-draft-demotion-on (evidence[2] tsc fail → evidence[4] tsc pass) |
| AC-CLOSURE-5 | 87 | RED run named the exact defect (verifyReachability(undefined) returned 'parent-not-spec'; feed text still contained 'no spec-tier ancestor'), true-negative 'prd' and boundary 'spec' cases passed pre-impl and stayed green. 4 matched tests attested passing post-impl. | task-skill-implement-reachability-unknown-outcome-plan-close (class fix (a) plus full checkpoint-registry suite green) |
| AC-CLOSURE-6 | 87 | Live-incident regression on a throwaway mkdtemp corpus: RED reproduced the false 'no spec-tier ancestor at all' claim alongside a correct ATTESTATION_FLOOR_NOT_MET denial; post-impl attested pass, 11 expect() calls. Invariant 4 satisfied — both AC-5 and AC-6 pass, not just the call-site. | task-skill-test-absence-as-assertion-red-scenarios (RED reproduction), task-skill-implement-reachability-unknown-outcome-plan-close (GREEN) |

## Gaps

- No diff provided. Invariant 1 (no auto-close write in `lore done` / `--fix`), Invariant 2 (VALID_TRANSITIONS + DEFAULT_ATTESTATION_MIN_RATIO unchanged) and Invariant 3 (no packages/dashboard/** edits) are claimed but never mechanically demonstrated. Test names referencing the behaviours are not a substitute for the git diff the plan itself names as the oracle for Invariant 2.
- The terminality impl task's AC requires evidence recording how many plan-terminality drifts this repo's own corpus has at landing. No evidence record contains that count. The risk register flags [M] that hooks/pre-push runs --check-tree and will newly fail for fully-terminal-but-open plans; without the count, an intended detector firing is indistinguishable from a regression for the next consumer.
- The plan's Exit Criterion 'full two-runner suite exit 0 on a clean tree at a named commit' is evidenced only by recorder=agent:main-orchestrator (self-reported) on the dashboard-sweep task. The strongest claim in the log — 387 vitest files / 6624 tests / bun 1494 pass 0 fail at 0f15043 — is the least independently corroborated.
- AC-CLOSURE-2 carries an attested fail and an attested inconclusive from the zero-match window (7 tests, 7 skipped, exit 0). The repair task landed >=2 matching scenarios, but the episode confirms the runner silently passes on zero matches — no permanent guard against a future AC oracle drifting to zero matches is evidenced beyond this one file.
- The AC requires both set() paths to resolve to ONE shared exported constant ('a duplicated string literal fails this AC'). The attested suite shows advisory-printed / not-printed behaviour; nothing in the visible output_tail demonstrates the identity-of-constant assertion, and without a diff the single-source-of-truth claim is unverified.
- 0 knowledge docs linked. The log itself identifies two class-level recurrences (ambient test precondition, previously fixed once in dashboard-command.bun.test.ts; vitest zero-match -t filter). Both were fixed as instances again with no durable capture, which is the same failure mode the sweep task was created to address.

## Recommendations

- Require the git diff (or at minimum `git diff --stat` plus targeted diffs of schemas.ts and packages/dashboard/**) to be attached to closure evidence whenever a plan declares file-level invariants.
- Add the missing landing-time corpus drift count for plan-terminality as an evidence record before archiving, and note it where pre-push consumers will see it.
- Have the full-suite Exit Criterion run recorded by an attesting recorder rather than agent:main-orchestrator self-report.
- Make test-writing skills assert a non-zero matched count for every -t filtered oracle command, and forbid tests that read ambient build artifacts without controlling them.
- Emit knowledge docs for the two recurrences before closing; a plan whose theme is 'silence is the defect' closing with zero captured lessons is thematically self-undermining.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 78233ms
- Retried: false
- Truncated sections: (none)
- Reasoning clipped for: AC-CLOSURE-2

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 86 | 0.78 | evidence | All 6 ACs carry attested passes with credible RED→GREEN arcs; Invariant 4's both-ACs rule met. Docked for the unrecorded corpus drift count required by the impl task's own AC. |
| evidence_integrity | 71 | 0.8 | evidence | RED baselines name concrete missing symbols and match-counts — strong. But ratio 0.64, several records lack output_tail, and the full-suite Exit Criterion rests on a self-reported line. |
| scope_fidelity | 72 | low | absence | Tasks map cleanly to phases and the one added task was a justified verify-driven repair; but with no diff, Invariants 1-3 (no plan write, transitions/ratio untouched, no dashboard) are unverifiable. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| scope_fidelity | major | — | No diff provided. Invariant 1 (no auto-close write in `lore done` / `--fix`), Invariant 2 (VALID_TRANSITIONS + DEFAULT_ATTESTATION_MIN_RATIO unchanged) and Invariant 3 (no packages/dashboard/** edits) are claimed but never mechanically demonstrated. Test names referencing the behaviours are not a substitute for the git diff the plan itself names as the oracle for Invariant 2. |
| outcome | major | AC-CLOSURE-2 | The terminality impl task's AC requires evidence recording how many plan-terminality drifts this repo's own corpus has at landing. No evidence record contains that count. The risk register flags [M] that hooks/pre-push runs --check-tree and will newly fail for fully-terminal-but-open plans; without the count, an intended detector firing is indistinguishable from a regression for the next consumer. |
| evidence_integrity | major | — | The plan's Exit Criterion 'full two-runner suite exit 0 on a clean tree at a named commit' is evidenced only by recorder=agent:main-orchestrator (self-reported) on the dashboard-sweep task. The strongest claim in the log — 387 vitest files / 6624 tests / bun 1494 pass 0 fail at 0f15043 — is the least independently corroborated. |
| evidence_integrity | minor | AC-CLOSURE-2 | AC-CLOSURE-2 carries an attested fail and an attested inconclusive from the zero-match window (7 tests, 7 skipped, exit 0). The repair task landed >=2 matching scenarios, but the episode confirms the runner silently passes on zero matches — no permanent guard against a future AC oracle drifting to zero matches is evidenced beyond this one file. |
| outcome | minor | AC-CLOSURE-4 | The AC requires both set() paths to resolve to ONE shared exported constant ('a duplicated string literal fails this AC'). The attested suite shows advisory-printed / not-printed behaviour; nothing in the visible output_tail demonstrates the identity-of-constant assertion, and without a diff the single-source-of-truth claim is unverified. |
| evidence_integrity | minor | — | 0 knowledge docs linked. The log itself identifies two class-level recurrences (ambient test precondition, previously fixed once in dashboard-command.bun.test.ts; vitest zero-match -t filter). Both were fixed as instances again with no durable capture, which is the same failure mode the sweep task was created to address. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require the git diff (or at minimum `git diff --stat` plus targeted diffs of schemas.ts and packages/dashboard/**) to be attached to closure evidence whenever a plan declares file-level invariants. | Plan Invariant 2 names `git diff` as its own oracle; that oracle was never run in the visible evidence. |
| plan | Add the missing landing-time corpus drift count for plan-terminality as an evidence record before archiving, and note it where pre-push consumers will see it. | It is an explicit AC of the impl task and the stated mitigation for an [M] risk. |
| process | Have the full-suite Exit Criterion run recorded by an attesting recorder rather than agent:main-orchestrator self-report. | attested ratio 0.64; the highest-leverage claim is currently self-reported. |
| skill | Make test-writing skills assert a non-zero matched count for every -t filtered oracle command, and forbid tests that read ambient build artifacts without controlling them. | Both classes recurred in this plan after being fixed once already. |
| process | Emit knowledge docs for the two recurrences before closing; a plan whose theme is 'silence is the defect' closing with zero captured lessons is thematically self-undermining. | 0 linked knowledge docs; both lessons are class-level, not instance-level. |

## Unverifiable Materials

- Implementation diff (all touched source files): diff_available: false — no code was shown, so invariants and implementation quality are judged only from evidence records and prose.
- packages/core/src/schemas.ts VALID_TRANSITIONS + DEFAULT_ATTESTATION_MIN_RATIO unchanged: Plan names `git diff` as the oracle; no such run appears in evidence.
- packages/dashboard/** untouched (Invariant 3): No diff or file list; dashboard typecheck passing does not prove absence of changes.
- Full two-runner suite result at commit 0f15043: Recorded by agent:main-orchestrator (self-reported), not attested; cannot distinguish from a summarized claim.
- Count of plan-terminality drifts in this repo's corpus at landing: Required by the impl task AC; absent from every evidence record.
- Final status of this plan (archived through the plan-close gate): Exit Criterion marked ⛔ self-refuting if bypassed, but plan status is not shown in the materials.
- Shared-constant identity between the two lore set advisory paths: Only pass/fail test titles are visible; no output demonstrating the same exported constant is used by both paths.

## Rubric Warnings

- Dimension "scope_fidelity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 6 declared criteria
- Task evidence: 9 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.64

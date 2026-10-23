---
id: KN-296
type: knowledge
role: knowledge
title: "Assessment: git-safety-gate argument-aware probes (2026-07-31)"
status: archived
priority: medium
created: 2026-07-31
updated: 2026-10-23
tags: []
parent: PLAN-098
links:
  - {id: PLAN-098, type: informs}
---
# Assessment: inconclusive (N/A (fully truncated))

Scope: plan `01KYVEHPA6FVB5T8CFAZ2VTPTX`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-GS-1 | 85 | Two passing test-oracle runs, one attested by an independent recorder with output tail showing 2 matched cases (51 skipped), so the -t filter was not vacuous. No diff, so the load-bearing negative half (other entries absent) cannot be inspected. | task-t1-argument-aware-probes-in-git-safety-gate-d1-d5-ac-gs-1-7 (evidence [1],[14]) |
| AC-GS-2 | 86 | Attested run shows 3 matched cases passing, consistent with the quoted case plus the SPEC-066 paired control. Cannot confirm from materials that the control actually asserts command-position matching survived; no diff or test source provided. | task-t1-argument-aware-probes-in-git-safety-gate-d1-d5-ac-gs-1-7 (evidence [2],[10]) |
| AC-GS-3 | 83 | Attested 'verb dispatch' run: 3 cases passed. AC requires an observable closure check (git stash pop exits 0, stderr free of BLOCKED/WOULD DESTROY); case count is consistent but the assertion text is unverifiable without the diff. | task-t1-argument-aware-probes-in-git-safety-gate-d1-d5-ac-gs-1-7 (evidence [3],[15]) |
| AC-GS-4 | 86 | Attested run shows 3 matched cases passing for 'reports only the named path'. The distinguishing other-path-absence assertion is claimed by the AC but not inspectable here. | task-t1-argument-aware-probes-in-git-safety-gate-d1-d5-ac-gs-1-7 (evidence [4],[11]) |
| AC-GS-5 | 82 | Attested 'fallback widens' run: 3 cases passed, matching fallback + rev-parse control + reset --hard D2 pin. The literal [ARG-FALLBACK] marker and the anti-vacuity control run cannot be confirmed without source or diff. | task-t1-argument-aware-probes-in-git-safety-gate-d1-d5-ac-gs-1-7 (evidence [5],[16]) |
| AC-GS-6 | 88 | assets-ssot suite passed twice (227/227, attested), which is the declared oracle for manifest sha256 equality. Not verifiable: whether the committed manifest change was limited to the gate entry as the task required. | task-t1-argument-aware-probes-in-git-safety-gate-d1-d5-ac-gs-1-7 (evidence [6],[12]) |
| AC-GS-7 | 90 | Attested full-suite run: 53 passed, 0 failed, 0 skipped — exactly the zero-fail/zero-skip regression floor the AC demands, with no hardcoded total. Strongest evidence in the bundle; typecheck and test:changed also pass (self-reported). | task-t1-argument-aware-probes-in-git-safety-gate-d1-d5-ac-gs-1-7 (evidence [7],[13],[9]) |
| AC-GS-8 | 32 | Zero evidence records: 0 pass, 0 fail. Its declared oracle (-t 'D1 REGRESSION') was never run and the task's ac_scope stops at AC-GS-7. Partial mitigation only: the full-suite run passed 53/53 with 0 skipped, but nothing shows a D6/D1 regression case exists. | task-t1-argument-aware-probes-in-git-safety-gate-d1-d5-ac-gs-1-7 (no evidence for this AC; [13] full suite only) |

## Gaps

- AC-GS-8 has zero oracle records (0 pass, 0 fail). Its declared verify command, `bunx vitest run packages/lore/tests/unit/hooks/git-safety-gate.test.ts -t 'D1 REGRESSION'`, appears in no evidence entry. The full-suite pass (53/53, 0 skipped) is weak mitigation: it proves nothing failed, not that the D6 under-block case — pre-fix exit 0 with a destructive reset walking through — is asserted anywhere.
- Plan declares no extra.ac_scope, so all 8 spec ACs are in scope, yet the plan's single task scopes itself to AC-GS-1..7 and its title/objective omit AC-GS-8. The eighth AC is neither implemented-and-evidenced nor explicitly deferred — an unreconciled seam between spec and plan.
- AC-GS-5 demands a literal `[ARG-FALLBACK]` marker plus an anti-vacuity control that runs `git rev-parse --verify --quiet stash@{99}`. The attested run shows 3 matched cases, consistent with that shape, but with no diff or test source the marker and control remain claims rather than verified facts.
- The task declares red-first as binding discipline ('a test that passes before the change is measuring nothing'), but no pre-fix failing run is recorded. Every evidence entry is green. Non-vacuity of the new negative halves therefore rests on assertion, not measurement.
- diff_available=false and tests_touched=false. Implementation quality — whether trigger matching still consumes the sanitized segment while probes get raw text, and whether probeDirtyTree/probeClean/probeWorktreeForce were left alone per D2 and the out-of-scope list — cannot be judged from these materials.

## Recommendations

- Block task archival while any declared AC on the governing spec has zero evidence records. AC-GS-8 reached archived status with an unrun oracle; a coverage-completeness check before archive would have caught it.
- Set extra.ac_scope explicitly on the plan. If AC-GS-8 is intentionally out of this plan's scope, say so and name the follow-up; if in scope, add it to the task's ac_scope and run its oracle.
- Require the diff in the audit bundle for SSOT hook changes, or attach the changed hook + test hunks. Marker literals ([ARG-FALLBACK]), D2 non-regression, and manifest-entry containment are diff-only facts.
- Record the red-first failing runs as first-class evidence alongside the green ones for every new assertion.
- Attest the remaining oracles (typecheck, test:changed) with a second recorder to lift the 0.44 attested ratio.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 69735ms
- Retried: false
- Truncated sections: task:task-t1-argument-aware-probes-in-git-safety-gate-d1-d5-ac-gs-1-7
- Overall confidence: low (degraded by truncation)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 79 | 0.72 | evidence | AC-GS-1..7 each carry an independently attested vitest run with non-zero matched cases; full suite 53/53, 0 skipped. AC-GS-8 delivered no run at all. |
| evidence_integrity | 73 | 0.7 | evidence | External oracles only, 7 attested runs with real output tails and matched-case counts that defeat the -t zero-match trap. But ratio 0.44, no red-first records, one AC unrun. |
| scope_fidelity | 68 | low | absence | No diff, so D2 (probeDirtyTree untouched), out-of-scope probes, and manifest-change containment are unconfirmable. No positive signal of drift either. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-GS-8 | AC-GS-8 has zero oracle records (0 pass, 0 fail). Its declared verify command, `bunx vitest run packages/lore/tests/unit/hooks/git-safety-gate.test.ts -t 'D1 REGRESSION'`, appears in no evidence entry. The full-suite pass (53/53, 0 skipped) is weak mitigation: it proves nothing failed, not that the D6 under-block case — pre-fix exit 0 with a destructive reset walking through — is asserted anywhere. |
| scope_fidelity | major | AC-GS-8 | Plan declares no extra.ac_scope, so all 8 spec ACs are in scope, yet the plan's single task scopes itself to AC-GS-1..7 and its title/objective omit AC-GS-8. The eighth AC is neither implemented-and-evidenced nor explicitly deferred — an unreconciled seam between spec and plan. |
| evidence_integrity | minor | AC-GS-5 | AC-GS-5 demands a literal `[ARG-FALLBACK]` marker plus an anti-vacuity control that runs `git rev-parse --verify --quiet stash@{99}`. The attested run shows 3 matched cases, consistent with that shape, but with no diff or test source the marker and control remain claims rather than verified facts. |
| evidence_integrity | minor | — | The task declares red-first as binding discipline ('a test that passes before the change is measuring nothing'), but no pre-fix failing run is recorded. Every evidence entry is green. Non-vacuity of the new negative halves therefore rests on assertion, not measurement. |
| outcome | minor | — | diff_available=false and tests_touched=false. Implementation quality — whether trigger matching still consumes the sanitized segment while probes get raw text, and whether probeDirtyTree/probeClean/probeWorktreeForce were left alone per D2 and the out-of-scope list — cannot be judged from these materials. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Block task archival while any declared AC on the governing spec has zero evidence records. AC-GS-8 reached archived status with an unrun oracle; a coverage-completeness check before archive would have caught it. | Zero-evidence ACs are invisible in green-only trails; the full-suite pass masks a missing case. |
| plan | Set extra.ac_scope explicitly on the plan. If AC-GS-8 is intentionally out of this plan's scope, say so and name the follow-up; if in scope, add it to the task's ac_scope and run its oracle. | An empty ac_scope silently pulls in every spec AC, so plan and task coverage diverged without warning. |
| process | Require the diff in the audit bundle for SSOT hook changes, or attach the changed hook + test hunks. Marker literals ([ARG-FALLBACK]), D2 non-regression, and manifest-entry containment are diff-only facts. | Test exit codes cannot distinguish a correct narrow probe from an over-narrowed one, which the plan names as the worst outcome. |
| process | Record the red-first failing runs as first-class evidence alongside the green ones for every new assertion. | The task made red-first binding; without recorded reds, non-vacuity of the negative halves is unverified. |
| process | Attest the remaining oracles (typecheck, test:changed) with a second recorder to lift the 0.44 attested ratio. | Self-reported-only oracles carry less weight in the integrity dimension. |

## Unverifiable Materials

- Diff for assets/hooks/pre-bash-git-safety-gate.mjs: diff_available=false; cannot confirm probeStash/probePathArg now read arguments, the raw-vs-sanitized split, the [ARG-FALLBACK] literal, or that probeDirtyTree (D2) was left untouched.
- Added cases in packages/lore/tests/unit/hooks/git-safety-gate.test.ts: tests_touched=false and no test source in bundle; the load-bearing negative halves (other stash entries / other path absent) cannot be inspected for content.
- Oracle run for AC-GS-8 (-t 'D1 REGRESSION'): No evidence record exists; 0 pass and 0 fail in coverage facts.
- assets-manifest.ts change scope: No diff; cannot confirm only the hooks/pre-bash-git-safety-gate.mjs entry changed, as the task required given a concurrent session in the repo.
- Knowledge capture docs: 0 linked docs in the bundle, so no record of the SPEC-066 single-consumer assumption that caused the defect.

## Rubric Warnings

- Dimension "scope_fidelity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 8 declared criteria
- Task evidence: 1 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.44

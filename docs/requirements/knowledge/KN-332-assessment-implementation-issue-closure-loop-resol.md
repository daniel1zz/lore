---
id: KN-332
type: knowledge
role: knowledge
title: "Assessment: Implementation — issue closure loop (resolves edge, computed resolution, agent-reachable surfaces) (2026-07-29)"
status: approved
priority: medium
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: PLAN-103
links:
  - {id: PLAN-103, type: informs}
---
# Assessment: met (86/100)

Scope: plan `01KYPTG5K2Y2XJN21TXHDX8Z5X`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-ICL-1 | 90 | 3 pass / 0 fail, 2 orchestrator-attested vitest runs of the named oracle. Filter shows 6 passed / 18 skipped of 24, consistent with a per-AC filtered subset. No diff to confirm the VALIDATION_ERROR is named in CorpusService.link rather than per-adapter. | task-p1-resolves-link-type-computed-resolution-foundation |
| AC-ICL-2 | 90 | 3 pass / 0 fail, 2 attested. Same suite, filtered oracle green in both orchestrator re-runs. Purity/store-free constraint is plausible (vitest, no bun:sqlite) but not directly verifiable without the diff. | task-p1-resolves-link-type-computed-resolution-foundation |
| AC-ICL-3 | 92 | 4 pass / 0 fail, 3 attested. Output tail names HAPPY and NEGATIVE cases explicitly, including the plain-task path where the fixed-check fires before issue_report validation. Post-hack-removal re-run also green. | task-p2-cli-verbs-lore-issue-resolve-lore-issues |
| AC-ICL-4 | 90 | 4 pass / 0 fail, 3 attested. Tails show wontfix and rejected persistence plus version bump. The AC's 'computed resolution reports that terminal state over any edge computation' half is implied by a third truncated case, not shown. | task-p2-cli-verbs-lore-issue-resolve-lore-issues |
| AC-ICL-5 | 86 | 4 pass / 0 fail, 3 attested. Earliest attested run carried [KNOWN-GAP workaround] titles — attested against substitute state; later attested runs show the markers gone after AC-ICL-12's hack removal, so the final green is on the real path. Zero-report empty-list case not visible in tails. | task-p2-cli-verbs-lore-issue-resolve-lore-issues, task-p3-retire-the-test-only-check-widening-hack-suites-must |
| AC-ICL-6 | 84 | 3 pass / 0 fail, 2 attested. Tails confirm the unclosed-escalation lifecycle cases and the stale/consistent shapes. The AC's decisive 'byte-comparison before and after proves nothing mutated' assertion is not visible in any tail and not confirmable without the diff. | task-p2-lore-status-check-issues-detector-stale-after-days |
| AC-ICL-7 | 90 | 3 pass / 0 fail, 2 attested. Tails name the decisive case (archived resolves-source reports 'fixed', never 'draft') and the rejection-reason echo. The unreachable-degradation case is a third truncated line; AC-072-10 evidence elsewhere corroborates it. | task-p2-consumer-report-issue-list-reports-computed-resolution |
| AC-ICL-8 | 88 | 3 pass / 0 fail, 2 attested. Tails show both the fixed-computation/--open omission case and the --check-issues flag-then-quiet lifecycle with an executable remediation. Live-corpus half is manual-oracle only (see evidence gaps), but the AC itself is the throwaway-corpus e2e. | task-p3-e2e-closure-proof-live-backlog-closure |
| AC-ICL-9 | 78 | 3 pass / 0 fail, 2 attested Playwright runs, serialized on a fixed port as required. But the single spec covers only list rows + nav badge; D8's IssueDetail rendering is named in the task and never appears in any test title or tail. | task-p2-http-projection-dashboard-issues-page-render-computed |
| AC-ICL-10 | 88 | 4 pass / 0 fail, 3 attested. Tails show HAPPY (closed, excluded from --open, in --resolved/--all), NEGATIVE, ERROR (plain archived task never leaks) and REGRESSION (exact counts). The AC's precedence half (terminal state and edge each beat archived) is not visible in any shown title. | task-p2-computed-closed-state-for-archived-issues-without-a |
| AC-ICL-11 | 80 | 3 pass / 0 fail, 2 attested; tail explicitly shows the rejected row computing 'rejected' with reason plus unreachable degradation. Weakness: the oracle is a reconciled pre-existing case (AC-072-10), so the AC's green came partly from rewriting a red expectation rather than a fresh red-before-green … | task-p2-computed-closed-state-for-archived-issues-without-a |
| AC-ICL-12 | 90 | 3 pass / 0 fail, 2 attested. The compound oracle (both suites pass AND grep finds no helper) is run verbatim as a single shell conjunction, so a silent partial pass is unlikely. Tail confirms AC-ICL-10 and issue-closure cases green without the hack. | task-p3-retire-the-test-only-check-widening-hack-suites-must |

## Gaps

- No diff was provided. Every structural constraint the plan leans on — single link-type SSOT derived from linkTypeSchema.options, computeIssueResolution kept pure/store-free, validation enforced once in CorpusService.link, minimal UpstreamPort extension, dashboard never importing @lore/core/node — is asserted in task text and confirmed only by green tests that could pass under a worse shape.
- AC-ICL-5 was attested pass by agent:main-orchestrator while three of its test titles still carried the literal [KNOWN-GAP workaround] marker, i.e. verified against substitute state rather than genuine resolves edges. It took a later `lore assess` to surface this. The re-attestation loop did not treat a self-declared workaround marker as disqualifying.
- The plan's declared terminal proof — closing task-no-init-setup-path-provisions-feedback-upstream-lore on the real corpus — is backed only by two `manual` oracle records whose 'command' fields are prose summaries, recorded by the same actor that performed the mutation. Not independently reproducible from the bundle.
- The AC makes byte-comparison of every issue doc before and after the run its own explicit requirement ('not by inspection'). No captured output tail shows that case; the visible titles are the HAPPY/ERROR escalation-lifecycle cases only.
- D8 names IssuesList, IssueDetail, IssueReportsCard and the nav badge. The single passing Playwright test is titled for list rows and the nav badge only; IssueDetail's computed resolution has no evidence in the bundle.
- The task demands each precedence step be asserted directly ('do not infer it from one combined case'). Visible test titles cover HAPPY/NEGATIVE/ERROR/REGRESSION for the closed state but none names the precedence steps (explicit terminal > edge > review-rejection > archived).
- migration-012 — the SQLite links.link_type CHECK widening that P1's deliverable actually depended on — was discovered late and landed inside the P2 dashboard task, outside the anchor discipline the plan declared. Documented as a deviation and captured as a retro, but it means a P1 AC was green while the real write path rejected 'resolves'.

## Recommendations

- Make the attestation step fail any evidence record whose captured output contains a self-declared workaround marker ([KNOWN-GAP], TEST-ONLY, skip/todo counts above zero on an AC's own cases). The AC-ICL-5 miss was detectable from the output tail alone.
- Require the diff in audit bundles, or mark every structural/architectural claim in a task's deliverables as unverified when it is absent.
- For live-corpus mutations, record the literal command and its full stdout as a script/test-kind oracle rather than a `manual` record with a prose command field, or run a read-only detector afterwards whose output is machine-captured.
- When an AC's statement contains a distinct proof obligation (AC-ICL-6's byte-comparison, AC-ICL-10's per-step precedence), require a test title naming it so the obligation is visible in captured output.
- When an AC is satisfied by reconciling a pre-existing failing test, attach the before/after expectation as evidence alongside the pass.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 85494ms
- Retried: false
- Truncated sections: task:task-p2-computed-closed-state-for-archived-issues-without-a
- Reasoning clipped for: AC-ICL-11

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 88 | 0.75 | evidence | All 12 ACs pass with ≥2 orchestrator-attested runs each, zero fails. Output tails corroborate the decisive cases. Two ACs (6, 9) have unevidenced sub-clauses. |
| evidence_integrity | 74 | 0.7 | evidence | Re-run attestation is real and caught nothing false, but an AC-ICL-5 attestation passed over [KNOWN-GAP] substitute state; live closure is manual-only; ratio 0.51; no diff. |
| scope_fidelity | 84 | 0.8 | evidence | 8→12 ACs, each addition tied to a measured finding and reconciled in the plan. migration-012 and the orchestrator-run live closure are declared deviations, not silent drift. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | — | No diff was provided. Every structural constraint the plan leans on — single link-type SSOT derived from linkTypeSchema.options, computeIssueResolution kept pure/store-free, validation enforced once in CorpusService.link, minimal UpstreamPort extension, dashboard never importing @lore/core/node — is asserted in task text and confirmed only by green tests that could pass under a worse shape. |
| evidence_integrity | major | AC-ICL-5 | AC-ICL-5 was attested pass by agent:main-orchestrator while three of its test titles still carried the literal [KNOWN-GAP workaround] marker, i.e. verified against substitute state rather than genuine resolves edges. It took a later `lore assess` to surface this. The re-attestation loop did not treat a self-declared workaround marker as disqualifying. |
| evidence_integrity | major | — | The plan's declared terminal proof — closing task-no-init-setup-path-provisions-feedback-upstream-lore on the real corpus — is backed only by two `manual` oracle records whose 'command' fields are prose summaries, recorded by the same actor that performed the mutation. Not independently reproducible from the bundle. |
| outcome | minor | AC-ICL-6 | The AC makes byte-comparison of every issue doc before and after the run its own explicit requirement ('not by inspection'). No captured output tail shows that case; the visible titles are the HAPPY/ERROR escalation-lifecycle cases only. |
| outcome | minor | AC-ICL-9 | D8 names IssuesList, IssueDetail, IssueReportsCard and the nav badge. The single passing Playwright test is titled for list rows and the nav badge only; IssueDetail's computed resolution has no evidence in the bundle. |
| outcome | minor | AC-ICL-10 | The task demands each precedence step be asserted directly ('do not infer it from one combined case'). Visible test titles cover HAPPY/NEGATIVE/ERROR/REGRESSION for the closed state but none names the precedence steps (explicit terminal > edge > review-rejection > archived). |
| scope_fidelity | minor | — | migration-012 — the SQLite links.link_type CHECK widening that P1's deliverable actually depended on — was discovered late and landed inside the P2 dashboard task, outside the anchor discipline the plan declared. Documented as a deviation and captured as a retro, but it means a P1 AC was green while the real write path rejected 'resolves'. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Make the attestation step fail any evidence record whose captured output contains a self-declared workaround marker ([KNOWN-GAP], TEST-ONLY, skip/todo counts above zero on an AC's own cases). The AC-ICL-5 miss was detectable from the output tail alone. | An attested green over substitute state is worse than no attestation — it consumed the verification budget without verifying. |
| process | Require the diff in audit bundles, or mark every structural/architectural claim in a task's deliverables as unverified when it is absent. | Scoring 12 ACs from evidence records alone cannot separate a correct implementation from a test-shaped one. |
| plan | For live-corpus mutations, record the literal command and its full stdout as a script/test-kind oracle rather than a `manual` record with a prose command field, or run a read-only detector afterwards whose output is machine-captured. | The plan's stated terminal proof is currently the least reproducible evidence in the bundle. |
| spec | When an AC's statement contains a distinct proof obligation (AC-ICL-6's byte-comparison, AC-ICL-10's per-step precedence), require a test title naming it so the obligation is visible in captured output. | Sub-clauses buried inside a passing suite are indistinguishable from unimplemented ones in the evidence trail. |
| process | When an AC is satisfied by reconciling a pre-existing failing test, attach the before/after expectation as evidence alongside the pass. | AC-ICL-11's green is currently indistinguishable from a relaxed assertion, despite a well-argued semantic justification. |

## Unverifiable Materials

- Implementation diff (none provided): Bundle states diff_available: false; all structural constraints in the plan are asserted only in task prose.
- Live-corpus closure output (lore link --type resolves, lore issues --all, lore status --check-issues on the real .lore/): Recorded as two `manual` oracle entries with prose command fields by the acting agent; no reproducible captured output.
- AC-ICL-6 byte-comparison assertion: Not present in any captured output tail; suite passes but the specific proof obligation is not observable.
- IssueDetail computed-resolution rendering (D8): No test title or tail in the bundle references it.
- Full test file contents (six-dimension coverage claims): Only truncated output tails are available; coverage discipline cannot be checked case by case.

## Facts Summary

- AC coverage: 12 declared criteria
- Task evidence: 8 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 5 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.51

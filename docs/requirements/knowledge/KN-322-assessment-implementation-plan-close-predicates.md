---
id: KN-322
type: knowledge
role: knowledge
title: "Assessment: Implementation — plan-close predicates measure invariants (applicability type, per-claimed-AC coverage, attributable sync) (2026-07-30)"
status: archived
priority: medium
created: 2026-07-30
updated: 2026-10-23
tags: []
parent: PLAN-102
links:
  - {id: PLAN-102, type: informs}
---
# Assessment: met (86/100)

Scope: plan `01KYS1FSHTF9X1G396894Y4QNX`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-PCI-1 | 90 | Pinned oracle 'notApplicable shape' passes on 8 attested runs across T1/T3–T8; T1's RED run recorded first. Type-shape assertions unverifiable without diff. | task-t1-applicability-verdict-in-the-predicate-s-own-type-both (expected-fail then pass) |
| AC-PCI-2 | 88 | Pinned 'never a fail' passes on 8 attested runs. Was RED post-T3/T4 merge (6 failures) and repaired by T8 with fresh evidence — currently green but fixture-fragile. | task-t8-repair-the-t3-t4-integration-regression-6-under |
| AC-PCI-3 | 88 | Pinned 'enforce advisory' passes on 8 attested runs; output_tail shows the throwing-recorder path exercised ('audit not recorded … boom'). Also regressed and repaired by T8. | task-t8-repair-the-t3-t4-integration-regression-6-under |
| AC-PCI-4 | 90 | 'promote advisory' 6/6 pass on 8 attested runs; T1 delivered the sibling prd_sync_advisories key and shared resolvePrdSyncDomainDoc free function. | task-t1-applicability-verdict-in-the-predicate-s-own-type-both |
| AC-PCI-5 | 89 | 'claimed set' 5 pass / 24 skipped on 8 attested runs. Task spec requires deriveClaimedAcCoverage to consume computeAcCoverage output structurally; no diff to confirm no re-implementation. | task-t2-per-claimed-ac-attested-coverage-as-the-default |
| AC-PCI-6 | 88 | 'coverage conjunct' passes (1 matched test) on 8 attested runs. Single matched test is thin for the compound assertion, but it is the AC's own pinned oracle. | task-t2-per-claimed-ac-attested-coverage-as-the-default |
| AC-PCI-7 | 88 | 'ratio disabled' passes (1 matched) on 8 attested runs; T2 deleted the Zod .default(0.5) and set DEFAULT_ATTESTATION_MIN_RATIO to null per task text. Real-gate transition asserted only via test name. | task-t2-per-claimed-ac-attested-coverage-as-the-default |
| AC-PCI-8 | 87 | 'explicit ratio' passes (1 matched) on 8 attested runs. Claim that it drives CorpusService.set's real gate rather than the predicate in isolation is not independently verifiable here. | task-t2-per-claimed-ac-attested-coverage-as-the-default |
| AC-PCI-10 | 90 | 'attribution' 8 pass / 11 skipped on 8 attested runs; T3 recorded expected-fail first and its task text pins all four scenarios incl. the structural-relation negative. | task-t3-domain-doc-sync-requires-attribution-to-the-closing-plan |
| AC-PCI-11 | 90 | 'contract table' 6 pass on 8 attested runs, RED-first recorded, plus a 'caller-contract violation' run. Programmatic key-set comparison asserted in task text only. | task-t4-plan-close-predicate-contract-table-lore-gate-explain |
| AC-PCI-12 | 92 | Compiled dist/lore e2e passes on 8 attested runs; output_tail names scenario A (exit 0 with advisory 'never a silent vacuous pass'); scenario B tail truncated but suite passed. | task-t5-compiled-binary-e2e-from-a-throwaway-corpus-clean-close |
| AC-PCI-9 | 90 | 'unattested naming' 6 pass on 8 attested runs; the byte-pinned feed-attestation-reachability.test.ts is skipped under the -t filter but was covered by the full vitest suite (401 files pass). | task-t2-per-claimed-ac-attested-coverage-as-the-default |
| AC-PCI-13 | 87 | 'ratio disabled render' passes (1 matched test) on 8 attested runs. Panel-equals-gate equality is asserted only inside that single test; no diff to confirm shared computeAcCoverage input. | task-t2-per-claimed-ac-attested-coverage-as-the-default |
| AC-PCI-14 | 89 | Dashboard component test 'ratio disabled render' 2 pass / 7 skipped on 8 attested runs, covering the null and numeric-floor cases. | task-t2-per-claimed-ac-attested-coverage-as-the-default |
| AC-PCI-15 | 82 | Pinned grep -q recorded pass 8x, but every output_tail carries only EPIPE errors — the tail proves nothing. Mitigated by T5's supplementary grep -c run (matches=1, exit 0), which is the actual positive signal. | task-t5-compiled-binary-e2e-from-a-throwaway-corpus-clean-close (evidence [21] grep -c matches=1), task-t6-upstream-adr-revision-clause-decision-status-accepted |
| AC-PCI-16 | 91 | 'advisory render' 4/4 pass on 8 attested runs; tails name the stderr-not-stdout exit-0 case and the reachability-vs-prd_sync distinctness regression case. RED-first recorded on T7. | task-t7-lore-approve-renders-the-prd-sync-advisory-to-stderr |

## Gaps

- The AC's pinned oracle is `lore get … | grep -q '^## Revision 2026-07-30'`, and all eight recorded runs captured only 'ERROR EPIPE: broken pipe' as output_tail because -q closes the pipe early. The pass verdict therefore rests on an exit code with no corroborating output; the only affirmative capture is a supplementary, non-pinned `grep -c` run (matches=1) recorded on T5. The pinned oracle as specified cannot show an auditor what it measured.
- Plan exit criteria require both test runners green on the full suite from the main checkout. `bun run test:bun` was recorded as result=fail (1600 pass / 1 fail at 8227dd1). Attribution is well done — measured 1/10 failures at pre-slice baseline 17c1a44 vs 1/9 at merged 8227dd1, falsifying the T1-audit-contention hypothesis — but the criterion as written is unmet and the slice closed anyway.
- AC-PCI-2 and AC-PCI-3 held pass evidence from T1 while being measurably RED (6 failed / 13 passed) on the merged tree at 5fcb07f. T8 correctly recorded fresh evidence rather than rewriting history, but the trail shows per-worktree evidence can outlive its truth across a merge.
- The plan declares four phases over T1–T7 with T5=contract table, T6=compiled e2e, T7=ADR, and states '15 ACs'. The archived tasks are T4=contract table, T5=compiled e2e, T6=ADR, T7=approve render, plus an unplanned T8 repair, against 16 declared ACs. Nothing substantive is out of scope, but the plan text no longer describes what ran.
- Several ACs (AC-PCI-6, 7, 8, 13) resolve to exactly one matched test under their -t filter (1 passed / 12–28 skipped). Each AC statement is compound (e.g. AC-PCI-8 covers both an explicit 0.5 deny and an explicit 0 permit through the real gate); a single matched test carrying all conjuncts cannot be confirmed from the run summaries alone.

## Recommendations

- Ban `grep -q` in `--oracle other` AC commands; require `grep -c` or `cmd > out 2>&1; grep …` so the recorded output_tail contains the match count instead of an EPIPE trace.
- Make 'full suite green on the merged tree' a measured exit criterion with an explicit named-flake allowlist, so a known ~10% pre-existing flake does not silently contradict the stated criterion.
- Re-run every in-scope AC's pinned oracle on the merged tree immediately after each phase merge, before any task archive.
- Amend the plan document when tasks are added or renumbered mid-slice (T8, the T4–T7 shift, 15→16 ACs) so the phase list and AC count match the executed work.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 79625ms
- Retried: false
- Truncated sections: task:task-t2-per-claimed-ac-attested-coverage-as-the-default, task:task-t8-repair-the-t3-t4-integration-regression-6-under, task:task-t4-plan-close-predicate-contract-table-lore-gate-explain, task:task-t3-domain-doc-sync-requires-attribution-to-the-closing-plan, task:task-t1-applicability-verdict-in-the-predicate-s-own-type-both
- Overall confidence: low (degraded by truncation)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 89 | 0.78 | evidence | All 16 declared ACs carry 8 attested passes each, incl. a compiled-binary e2e and RED-first runs on T1/T3/T4/T7. Structural claims unverifiable without a diff. |
| evidence_integrity | 82 | 0.8 | evidence | Dense attested trail, honest flake attribution by measured rate, RED-first discipline. Deductions: test:bun fail vs exit criteria, EPIPE-only tail on AC-PCI-15, stale-green AC-2/3. |
| scope_fidelity | 84 | 0.72 | evidence | Work matches the spec's ACs; no exemption fields evidenced. Drift is bookkeeping: T8 added off-plan, task renumbering vs phase text, plan says 15 ACs but 16 declared. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-PCI-15 | The AC's pinned oracle is `lore get … \| grep -q '^## Revision 2026-07-30'`, and all eight recorded runs captured only 'ERROR EPIPE: broken pipe' as output_tail because -q closes the pipe early. The pass verdict therefore rests on an exit code with no corroborating output; the only affirmative capture is a supplementary, non-pinned `grep -c` run (matches=1) recorded on T5. The pinned oracle as specified cannot show an auditor what it measured. |
| evidence_integrity | major | — | Plan exit criteria require both test runners green on the full suite from the main checkout. `bun run test:bun` was recorded as result=fail (1600 pass / 1 fail at 8227dd1). Attribution is well done — measured 1/10 failures at pre-slice baseline 17c1a44 vs 1/9 at merged 8227dd1, falsifying the T1-audit-contention hypothesis — but the criterion as written is unmet and the slice closed anyway. |
| evidence_integrity | minor | AC-PCI-2 | AC-PCI-2 and AC-PCI-3 held pass evidence from T1 while being measurably RED (6 failed / 13 passed) on the merged tree at 5fcb07f. T8 correctly recorded fresh evidence rather than rewriting history, but the trail shows per-worktree evidence can outlive its truth across a merge. |
| scope_fidelity | minor | — | The plan declares four phases over T1–T7 with T5=contract table, T6=compiled e2e, T7=ADR, and states '15 ACs'. The archived tasks are T4=contract table, T5=compiled e2e, T6=ADR, T7=approve render, plus an unplanned T8 repair, against 16 declared ACs. Nothing substantive is out of scope, but the plan text no longer describes what ran. |
| outcome | minor | — | Several ACs (AC-PCI-6, 7, 8, 13) resolve to exactly one matched test under their -t filter (1 passed / 12–28 skipped). Each AC statement is compound (e.g. AC-PCI-8 covers both an explicit 0.5 deny and an explicit 0 permit through the real gate); a single matched test carrying all conjuncts cannot be confirmed from the run summaries alone. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Ban `grep -q` in `--oracle other` AC commands; require `grep -c` or `cmd > out 2>&1; grep …` so the recorded output_tail contains the match count instead of an EPIPE trace. | AC-PCI-15 passed eight times with zero interpretable output; the oracle blinded its own audit trail. |
| plan | Make 'full suite green on the merged tree' a measured exit criterion with an explicit named-flake allowlist, so a known ~10% pre-existing flake does not silently contradict the stated criterion. | test:bun recorded result=fail against an exit criterion demanding green; the deviation is justified in prose only. |
| process | Re-run every in-scope AC's pinned oracle on the merged tree immediately after each phase merge, before any task archive. | T8 found two ACs RED on the merged tree while both already carried pass evidence from their worktree. |
| plan | Amend the plan document when tasks are added or renumbered mid-slice (T8, the T4–T7 shift, 15→16 ACs) so the phase list and AC count match the executed work. | Plan text is the traceability record; drift between it and the archived tasks weakens later audits. |

## Unverifiable Materials

- Implementation diff for all touched source files: diff_available: false — no source was shown, so compile-time exhaustiveness of PREDICATE_CONTRACTS, deletion of the Zod .default(0.5), absence of `?? []`/`?? 0.5` fallbacks, and reuse of computeAcCov…
- Test bodies for the pinned AC commands: Only run summaries and truncated tails were provided; assertion strength per AC (esp. the single-matched-test ACs 6/7/8/13) could not be checked.
- Byte-identity of feed-attestation-reachability.test.ts's Recovery tail: The file is skipped under AC-PCI-9's -t filter and no diff was supplied; 'passes unchanged' rests on the full vitest run plus task text.
- Absence of exemption fields on this plan (attestation_exempt / prd_sync_exempt / assessment_freshness_exempt): Plan document extra fields were not shown; no exemption is evidenced, but absence could not be positively confirmed.

## Facts Summary

- AC coverage: 16 declared criteria
- Task evidence: 8 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 2 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.74

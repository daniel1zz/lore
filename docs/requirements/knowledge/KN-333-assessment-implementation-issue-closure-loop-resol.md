---
id: KN-333
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
| AC-ICL-1 | 88 | Vitest oracle passes, orchestrator-attested (6 passed \| 18 skipped under the -t filter). Schema + write-time VALIDATION_ERROR claimed in P1 deliverables. No diff to confirm the rejection is a named error rather than a generic throw. | task-p1-resolves-link-type-computed-resolution-foundation (evidence [1],[4]) |
| AC-ICL-2 | 88 | Attested vitest pass on the same file. Precedence chain later extended (closed/rejected) with AC-ICL-10/11 re-running this file green, which is a genuine regression check on the base semantics. | task-p1-resolves-link-type-computed-resolution-foundation (evidence [2],[5]), task-p2-computed-closed-state-for-archived-issues-without-a (evidence [3] re-runs AC-ICL-1/2 file) |
| AC-ICL-3 | 90 | Attested bun test pass; output_tail shows HAPPY + NEGATIVE cases including the plain-task path, and names the 'exits non-zero / names lore link + resolves / writes nothing' assertions. Re-run clean by AC-ICL-12's whole-file oracle. | task-p2-cli-verbs-lore-issue-resolve-lore-issues (evidence [1],[6] with tail) |
| AC-ICL-4 | 90 | Attested pass; tail shows wontfix and rejected both persisting state+reason under extra.issue_report.resolution and bumping version. Terminal-state precedence is separately asserted in the P2 closed-state precedence work. | task-p2-cli-verbs-lore-issue-resolve-lore-issues (evidence [2],[7]) |
| AC-ICL-5 | 78 | Passes, but the attested tail still shows '[KNOWN-GAP workaround]' titles — that attestation was recorded against CHECK-widened substitute state, not real resolves edges. Mitigated (not re-attested per-AC) by AC-ICL-12's whole-file run after the hack was deleted. | task-p2-cli-verbs-lore-issue-resolve-lore-issues (evidence [8] tail shows workaround markers), task-p3-retire-the-test-only-check-widening-hack-suites-must (mitigation) |
| AC-ICL-6 | 88 | Attested pass; tail shows HAPPY/HAPPY/ERROR shapes covering no-edge, archived-source-without-edge, and the flagged escalation. The byte-comparison 'mutates nothing' half is asserted in the task text but not visible in the truncated tail. | task-p2-lore-status-check-issues-detector-stale-after-days (evidence [1],[3]) |
| AC-ICL-7 | 90 | Attested pass; tail names the decisive case explicitly — resolves edge to an ARCHIVED fixing spec reports 'fixed', never the issue task's own 'draft'. Rejection-reason echo also shown. Unreachable degradation preserved per AC-072-10 (green in AC-ICL-11 run). | task-p2-consumer-report-issue-list-reports-computed-resolution (evidence [1],[4]) |
| AC-ICL-8 | 90 | Attested e2e pass; tail shows the HAPPY (computes fixed, --open omits, --resolved includes) and STATE (flags with executable remediation, quiets after archival) cases. Live-corpus closure separately evidenced as manual with before/after detector output. | task-p3-e2e-closure-proof-live-backlog-closure (evidence [1],[3],[4],[5]) |
| AC-ICL-9 | 82 | Attested Playwright pass, but exactly one test covers both halves of the AC (row-level resolution AND nav-badge count). Thin for a UI surface; serialization and throwaway-corpus seeding are asserted in constraints only, not observable in the tail. | task-p2-http-projection-dashboard-issues-page-render-computed (evidence [1],[5] — '1 passed') |
| AC-ICL-10 | 90 | Attested pass; tail shows HAPPY (archived+no edge → closed, excluded from --open, in --resolved/--all), NEGATIVE (draft+no edge), ERROR (plain archived task never leaks) and a REGRESSION count check. Precedence steps asserted per the task's explicit instruction. | task-p2-computed-closed-state-for-archived-issues-without-a (evidence [1],[5]) |
| AC-ICL-11 | 88 | Attested pass with a full tail (1 pass, 10 filtered, 0 fail, 9 expect calls) showing the rejected row computing 'rejected' with reason and the unreachable degradation intact. Expectation was changed to match corrected semantics — justified in writing, unverifiable without the diff. | task-p2-computed-closed-state-for-archived-issues-without-a (evidence [2],[6]) |
| AC-ICL-12 | 88 | Attested compound oracle (both suites pass AND grep finds no helper) run by the orchestrator. This is the strongest single piece of evidence in the bundle: it retroactively re-validates AC-ICL-3/4/5/10 on the real migration path. | task-p3-retire-the-test-only-check-widening-hack-suites-must (evidence [1],[3]) |

## Gaps

- The attested evidence for AC-ICL-5 shows test titles containing '[KNOWN-GAP workaround]', i.e. it was verified against CHECK-constraint-widened substitute state rather than genuine resolves edges. AC-ICL-12 later runs the whole file clean after deleting the helper, which mitigates but does not replace a per-AC re-attestation.
- diff_available=false and tests_touched=false. No production or test source was reviewable, so every outcome score reflects oracle exit codes plus truncated stdout only. Claims such as 'computeIssueResolution stays pure/store-free', 'VALID_LINK_TYPES derives from linkTypeSchema.options', and 'no second read path added to UpstreamPort' are unverified.
- The AC's decisive clause — a byte-comparison of every issue doc before and after the run proving zero mutation — does not appear in any captured oracle output; only HAPPY/ERROR case titles are visible in the tail.
- A single Playwright test ('1 passed') carries both halves of AC-ICL-9 — per-row computed resolution rendering and the nav badge counting computed-open reports. A one-test surface for a two-claim AC leaves either half able to regress under a still-green oracle.
- Scope expanded from 8 declared ACs to 12 during execution (AC-ICL-9/10/11/12). Each is justified by a measured finding and reconciled in the plan's post-assess section, but the expansion happened mid-flight rather than through a re-baselined plan.

## Recommendations

- When a task retires a test workaround, require re-attestation of every AC whose recorded evidence was produced under that workaround, not just the retirement AC's own oracle.
- Include the implementation diff in audit bundles for implementation plans, or mark outcome as absence-based when it is missing.
- Split AC-ICL-9 into two Playwright assertions (row resolution, badge count) and capture the AC-ICL-6 byte-comparison output in the evidence tail.
- Re-baseline the plan's AC list when mid-flight findings add ACs, so the decomposed and delivered scope agree before P3 rather than in a post-assess reconciliation.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 72868ms
- Retried: false
- Truncated sections: task:task-p2-computed-closed-state-for-archived-issues-without-a

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 88 | 0.72 | evidence | All 12 ACs pass with an independent re-run each; tails show real six-dimension cases and the decisive fixed-not-draft shape. No diff, so code quality itself is unverified. |
| evidence_integrity | 82 | 0.75 | evidence | Every AC orchestrator-attested, zero fails, and AC-ICL-12 explicitly retires substitute-state testing. Weakened by 0.31 attested ratio and AC-ICL-5's stale workaround-era tail. |
| scope_fidelity | 85 | 0.8 | evidence | Four ACs added beyond the decomposed eight, but each is documented against a measured defect, and both deviations (migration-012, orchestrator-run live closure) are declared with rationale. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-ICL-5 | The attested evidence for AC-ICL-5 shows test titles containing '[KNOWN-GAP workaround]', i.e. it was verified against CHECK-constraint-widened substitute state rather than genuine resolves edges. AC-ICL-12 later runs the whole file clean after deleting the helper, which mitigates but does not replace a per-AC re-attestation. |
| outcome | major | — | diff_available=false and tests_touched=false. No production or test source was reviewable, so every outcome score reflects oracle exit codes plus truncated stdout only. Claims such as 'computeIssueResolution stays pure/store-free', 'VALID_LINK_TYPES derives from linkTypeSchema.options', and 'no second read path added to UpstreamPort' are unverified. |
| evidence_integrity | minor | AC-ICL-6 | The AC's decisive clause — a byte-comparison of every issue doc before and after the run proving zero mutation — does not appear in any captured oracle output; only HAPPY/ERROR case titles are visible in the tail. |
| outcome | minor | AC-ICL-9 | A single Playwright test ('1 passed') carries both halves of AC-ICL-9 — per-row computed resolution rendering and the nav badge counting computed-open reports. A one-test surface for a two-claim AC leaves either half able to regress under a still-green oracle. |
| scope_fidelity | minor | — | Scope expanded from 8 declared ACs to 12 during execution (AC-ICL-9/10/11/12). Each is justified by a measured finding and reconciled in the plan's post-assess section, but the expansion happened mid-flight rather than through a re-baselined plan. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | When a task retires a test workaround, require re-attestation of every AC whose recorded evidence was produced under that workaround, not just the retirement AC's own oracle. | AC-ICL-5's stored tail still advertises substitute state; a reader of the AC row alone cannot tell it was later revalidated. |
| process | Include the implementation diff in audit bundles for implementation plans, or mark outcome as absence-based when it is missing. | Twelve green oracles cannot distinguish a correct implementation from a narrowly-fitted one without the code. |
| plan | Split AC-ICL-9 into two Playwright assertions (row resolution, badge count) and capture the AC-ICL-6 byte-comparison output in the evidence tail. | Both ACs currently rest on prose claims or a single combined test rather than observable per-claim oracle output. |
| process | Re-baseline the plan's AC list when mid-flight findings add ACs, so the decomposed and delivered scope agree before P3 rather than in a post-assess reconciliation. | Four of twelve ACs were added after decomposition; reconciliation was retrospective. |

## Unverifiable Materials

- Implementation diff (packages/core/src/schemas.ts, issue-resolution.ts, CorpusService.link, migration-012, CLI/HTTP/dashboard changes): diff_available=false; no source shown, so purity, SSOT-derivation and port-minimality claims rest on task prose alone.
- Full test-file contents for the 6 e2e/unit suites: Only truncated output tails were provided; assertion strength and six-dimension coverage inferred from test titles.
- Live corpus state after the orchestrator's manual closure: Recorded as oracle=manual with quoted counts (--open 9, --resolved 2, consistent); no reproducible artifact accompanies it.

## Facts Summary

- AC coverage: 12 declared criteria
- Task evidence: 8 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 4 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.31

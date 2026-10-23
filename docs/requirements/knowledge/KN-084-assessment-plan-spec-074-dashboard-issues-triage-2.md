---
id: KN-084
type: knowledge
role: knowledge
title: "Assessment: Plan — SPEC-074 dashboard Issues triage (2026-07-24)"
status: archived
priority: medium
created: 2026-07-24
updated: 2026-10-23
tags: []
parent: PLAN-043
links:
  - {id: PLAN-043, type: informs}
---
# Assessment: met (88/100)

Scope: plan `01KY9C7ZMXDK21RKXPBBHPB3H3`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-074-1 | 92 | Nav badge=2 and Issues list rendering 2 rows (title/reporter_project/reported_at, newest first) attested via named e2e test [9]; backed by IssuesList.tsx + shared query + route. Real report-issue CLI seeding per task packet. | 01KY9C98XV4C80Q0NRXT9N1Q1R (evidence[1],[9] autopilot pass) |
| AC-074-2 | 90 | In-place approve dropping badge to 1 + report in `lore ready --adhoc`, other untouched: attested e2e [10]. IssueDetail reuses SPEC-022 apiApproveDoc write path + shared-key invalidation. | 01KY9C98XV4C80Q0NRXT9N1Q1R (evidence[2],[10]) |
| AC-074-3 | 84 | Initially FAILED (badge stayed 1: reject never leaves draft). Fixed by audit-trail open-set derivation in issue-reports-routes.ts (wasRejectedWithoutLaterApproval); re-run [7] and autopilot [11] pass. Non-empty-reason enforced via disabled submit. Fix adds real backend logic beyond original task sc… | 01KY9C98XV4C80Q0NRXT9N1Q1R (evidence[3] fail→[7]/[11] pass) |
| AC-074-4 | 90 | Home card open-count + ≤3 recent titles linking to Issues, and explicit empty state + badge hidden at 0: both sub-cases attested e2e [12]. IssueReportsCard enforces ISSUE_CARD_LIMIT and explicit 'No open issue reports'. | 01KY9C98XV4C80Q0NRXT9N1Q1R (evidence[4],[12] two tests) |
| AC-074-5 | 90 | Auth matrix (cookie/bearer 200, no-auth 401), 8+status+open_count fields, empty-corpus open_count 0: full 15-test vitest suite green, attested [4]. Route wired in routes.ts under general /api/* (cookie\|bearer) per SPEC-062. Suite body unseen but consistently passing. | 01KY9C98GYBZCFYK74BAXY823F (evidence[1],[4] 15 pass) |

## Gaps

- Diff includes substantial SPEC-073 error-path report-issue-hint changes (report-issue-hint.ts, loader.ts, gate.ts, assets-ssot tests, corpus-workflow.md) that are unrelated to SPEC-074's declared tasks/ACs and not accounted for in the plan — likely bundled cross-spec work.
- AC-074-3 required a backend open-set fix (rejected report must leave the open projection via audit trail) not anticipated by either task's original approach; delivered by a follow-up fix agent. Final pass attested, but the invariant is the most fragile part and its dedicated unit coverage is unseen (test file truncated).
- attested_evidence_ratio is 0.31; most passes are self-reported by t74-frontend/t74-route agents. Autopilot re-runs re-attest 1 case per AC, which mitigates but does not fully independently confirm the full-suite green claim.

## Recommendations

- When a bundle carries changes from another spec (SPEC-073 hint machinery here), declare it in the plan/scope so auditors can distinguish intended cross-spec work from drift.
- Promote the reject-open-set derivation (audit-trail exclusion) to an explicit attested unit AC, since it was a live defect (AC-074-3 initial fail) fixed late.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 41380ms
- Retried: false
- Truncated sections: diff:packages/dashboard/tests/e2e/issues.spec.ts, diff:packages/lore/tests/unit/adapters/http-issue-reports.test.ts
- Reasoning clipped for: AC-074-3

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 89 | 0.82 | evidence | All 5 ACs have final attested passes; AC-074-3's badge-drop gap was diagnosed and fixed via audit-trail open-set derivation, re-verified green. |
| evidence_integrity | 82 | 0.75 | evidence | Oracle commands match spec verify strings; fail→fix→pass trail is honest and disclosed. Attested ratio 0.31 and 2 test files truncated cap confidence. |
| scope_fidelity | 84 | 0.7 | evidence | Frontend+route match plan. But diff also adds SPEC-073 report-issue-hint machinery (gate.ts/loader.ts/hint) — out of SPEC-074's stated scope, unexplained by these tasks. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| scope_fidelity | minor | AC-074-5 | Diff includes substantial SPEC-073 error-path report-issue-hint changes (report-issue-hint.ts, loader.ts, gate.ts, assets-ssot tests, corpus-workflow.md) that are unrelated to SPEC-074's declared tasks/ACs and not accounted for in the plan — likely bundled cross-spec work. |
| outcome | minor | AC-074-3 | AC-074-3 required a backend open-set fix (rejected report must leave the open projection via audit trail) not anticipated by either task's original approach; delivered by a follow-up fix agent. Final pass attested, but the invariant is the most fragile part and its dedicated unit coverage is unseen (test file truncated). |
| evidence_integrity | minor | — | attested_evidence_ratio is 0.31; most passes are self-reported by t74-frontend/t74-route agents. Autopilot re-runs re-attest 1 case per AC, which mitigates but does not fully independently confirm the full-suite green claim. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | When a bundle carries changes from another spec (SPEC-073 hint machinery here), declare it in the plan/scope so auditors can distinguish intended cross-spec work from drift. | Unexplained files lower scope-fidelity confidence even when benign. |
| process | Promote the reject-open-set derivation (audit-trail exclusion) to an explicit attested unit AC, since it was a live defect (AC-074-3 initial fail) fixed late. | The spec's subtlest invariant deserves durable, independently-attested coverage. |

## Unverifiable Materials

- packages/dashboard/tests/e2e/issues.spec.ts: Test body truncated from diff; AC-074-1..4 assertion internals judged from evidence records + named-test output only.
- packages/lore/tests/unit/adapters/http-issue-reports.test.ts: Test body truncated; 15-test green attested but rejected-report exclusion assertion not directly inspected.

## Facts Summary

- AC coverage: 5 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.31

---
id: KN-370
type: knowledge
role: knowledge
title: "Assessment: Implementation — dashboard production packaging (F5a one-command lore dashboard) (2026-07-28)"
status: approved
priority: medium
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PLAN-112
links:
  - {id: PLAN-112, type: informs}
---
# Assessment: partially_met (76/100)

Scope: plan `01KYM0RRWAXXXFBATXPKNG9YGT`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-F5A-1 | 78 | Final-verification e2e run for 'packaged serve' is attested pass, and the fix task shows the full static harness green (4 tests in that group). But every recorded output_tail stops inside build logs — no pass/fail summary or matched count is visible for the e2e oracle itself. | task-skill-review-f5a-final-verification-and-assessment (evidence [1] attested pass, tail shows only vite/build output), task-skill-implement-f5a-fix-packaged-mode-session-auth-add-api (full harness pass incl. /api/health stamp) |
| AC-F5A-2 | 80 | Nonce group attested pass at final verification, and the GAP-1 fix (ensureLocalApiKey in packaged mode) directly targets the 302/410/authenticated-read chain that previously 401'd. Same weakness: e2e tails show build output, not test counts. | task-skill-review-f5a-final-verification-and-assessment (evidence [2] attested pass), task-skill-implement-f5a-fix-packaged-mode-session-auth-add-api (session-resolution gap fixed, nonce group green) |
| AC-F5A-3 | 75 | 'secret-free' bun integration case attested pass (9 expects) across several tasks. However the AC names a grep oracle over packages/dashboard/dist plus a curl of GET /; the evidenced oracle is the fixture-manifest integration test, so the built-artifact grep half is not separately demonstrated. | task-skill-review-f5a-final-verification-and-assessment (evidence [3] 1 pass / 0 fail) |
| AC-F5A-4 | 85 | 'route priority' attested pass with 13 expect() calls at final verification and repeatedly green in earlier tasks; covers JSON 404 on unknown /api/*, index.html fallback for deep routes, immutable hashed assets. SPEC-078 /api/p/:name/* dispatch is asserted only via the same single case. | task-skill-review-f5a-final-verification-and-assessment (evidence [4] 1 pass, 13 expects) |
| AC-F5A-6 | 90 | 10 pass / 0 fail across tasks, including a run with the fresh-clone precondition explicitly verified via existsSync (no generated manifest on disk) and a main-orchestrator typecheck in a clean isolated worktree. Strongest-evidenced AC in the bundle. | task-skill-implement-f5a-build-step-embed-manifest-and (evidence [5] fresh-clone precondition verified), task-skill-review-f5a-final-verification-and-assessment (evidence [5],[9] typecheck pass) |
| AC-F5A-7 | 85 | 'auth-store degradation' attested pass (10 expects) at final verification and green from the implementing task onward: GET / keeps serving while the nonce endpoint answers 503. Injected-fault fidelity relative to a real store failure is asserted only by the test's own seam. | task-skill-review-f5a-final-verification-and-assessment (evidence [6] 1 pass, 10 expects) |
| AC-F5A-8 | 76 | 'allowlist\|freshness' attested pass at final verification and in the fix task. The stale-bundle-fails clause is the crux and its result line is not visible — the tail shows a vite build starting, i.e. the digest changed during that very run, which is exactly the state the freshness assertion arbitr… | task-skill-review-f5a-final-verification-and-assessment (evidence [7] attested pass, tail = build log) |
| AC-F5A-5 | 80 | Guard case attested pass (6 expects), asserting non-zero exit naming both 'bun run build' and '--dev', no vite mention, no residual listener; run both with the generated module absent and present. The precondition is forced by a LORE_DASHBOARD_ASSETS_FIXTURE=0 short-circuit ahead of the real loader… | task-skill-test-f5a-source-run-guard-test-must-control-its-own (both-ways run, exit 0 each), task-skill-review-f5a-final-verification-and-assessment (evidence [8] 1 pass) |

## Gaps

- Plan invariant 6 requires all existing suites green; the final two-runner run is result=fail with 7 failures (assets-ssot.test.ts x6, real-setup-ports.test.ts x1). Attribution to a concurrent session's commit 01a383a is asserted in prose only — the git log output proving those files' last touch is not included, and both files are described as uncommitted-modified in the checkout, which weakens the isolation claim.
- Every e2e evidence entry across all tasks truncates its output_tail inside globalSetup/vite build logs. No entry shows a Playwright summary, per-group counts, or exit code, so the attested 'pass' for AC-F5A-1/2/8 cannot be corroborated from the recorded output — only the fix task's prose claims 8 tests across 3 groups.
- The verification task is status=draft with no evidence for the plan's own exit criteria: no lore assess verdict, no spec code anchors declared, no lore status --check-drift result. The plan cannot be considered closed on its stated terms.
- No diff supplied, so the hard invariants (packages/dashboard/src untouched; dashboard-assets.ts git-ignored with dashboard-assets-loader.ts as sole importer; per-concern commits in the static-serving task) are unverified from the bundle.
- The guard test forces its precondition with LORE_DASHBOARD_ASSETS_FIXTURE=0, short-circuiting resolveAssets before the real loader runs. The assertion is deterministic but no longer exercises the production availability check, so a regression in the real loader's unavailable branch would not be caught here.
- AC-F5A-3 names two oracles (grep over packages/dashboard/dist and a curl of GET /). Only the bun integration test using a fixture manifest is evidenced; no run greps the actual built bundle, so 'built artifact is secret-free' rests on a fixture, not the shipped dist.

## Recommendations

- Require evidence output_tail to be captured from the END of a run (summary line, counts, exit code) rather than a head-truncated stream. For e2e specifically, reject attestation when no per-group matched count appears.
- Do not close the plan until the full two-runner suite records an exit-0 run, or the 7 foreign failures are accepted in the Decisions Log with the attribution git log pasted verbatim as evidence.
- Add an end-to-end reachability check to the Phase 2/3 exit gates (real session redeem → authenticated /api read) instead of deferring it to the Phase 4 harness.
- Split AC-F5A-3 into two oracles: the fixture-manifest response-body test and a grep over the real packages/dashboard/dist output, so the built-artifact claim has its own evidence line.
- Capture the two adjudicated root-cause findings (nonce session vs api_keys JOIN; ambient-state-dependent guard test) as knowledge docs — the bundle has zero linked docs.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 81823ms
- Retried: false
- Truncated sections: (none)
- Reasoning clipped for: AC-F5A-8, AC-F5A-5

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 82 | 0.7 | evidence | All 8 ACs have at least one attested pass at final verification, and the two late-found functional gaps were fixed. Weakened by unreadable e2e result tails and a failing full-suite run. |
| evidence_integrity | 66 | 0.72 | evidence | Attested runs exist per AC, but ratio is 0.49, e2e tails never show test counts, the suite failure is excused by self-narrated attribution, and the verification task remains draft. |
| scope_fidelity | 72 | low | absence | No diff, so invariants 1/2 and the per-concern commit rule are unverifiable. Mid-plan additions (auth fix, seam, sigterm restore) are justified but expand the declared scope. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | — | Plan invariant 6 requires all existing suites green; the final two-runner run is result=fail with 7 failures (assets-ssot.test.ts x6, real-setup-ports.test.ts x1). Attribution to a concurrent session's commit 01a383a is asserted in prose only — the git log output proving those files' last touch is not included, and both files are described as uncommitted-modified in the checkout, which weakens the isolation claim. |
| evidence_integrity | major | AC-F5A-1 | Every e2e evidence entry across all tasks truncates its output_tail inside globalSetup/vite build logs. No entry shows a Playwright summary, per-group counts, or exit code, so the attested 'pass' for AC-F5A-1/2/8 cannot be corroborated from the recorded output — only the fix task's prose claims 8 tests across 3 groups. |
| evidence_integrity | major | — | The verification task is status=draft with no evidence for the plan's own exit criteria: no lore assess verdict, no spec code anchors declared, no lore status --check-drift result. The plan cannot be considered closed on its stated terms. |
| scope_fidelity | minor | — | No diff supplied, so the hard invariants (packages/dashboard/src untouched; dashboard-assets.ts git-ignored with dashboard-assets-loader.ts as sole importer; per-concern commits in the static-serving task) are unverified from the bundle. |
| outcome | minor | AC-F5A-5 | The guard test forces its precondition with LORE_DASHBOARD_ASSETS_FIXTURE=0, short-circuiting resolveAssets before the real loader runs. The assertion is deterministic but no longer exercises the production availability check, so a regression in the real loader's unavailable branch would not be caught here. |
| outcome | minor | AC-F5A-3 | AC-F5A-3 names two oracles (grep over packages/dashboard/dist and a curl of GET /). Only the bun integration test using a fixture manifest is evidenced; no run greps the actual built bundle, so 'built artifact is secret-free' rests on a fixture, not the shipped dist. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require evidence output_tail to be captured from the END of a run (summary line, counts, exit code) rather than a head-truncated stream. For e2e specifically, reject attestation when no per-group matched count appears. | Every e2e attestation in this plan is unreadable as proof; the recorded text shows only setup logs. |
| plan | Do not close the plan until the full two-runner suite records an exit-0 run, or the 7 foreign failures are accepted in the Decisions Log with the attribution git log pasted verbatim as evidence. | Invariant 6 is currently violated in the record with only a prose excuse. |
| process | Add an end-to-end reachability check to the Phase 2/3 exit gates (real session redeem → authenticated /api read) instead of deferring it to the Phase 4 harness. | Packaged sessions could never authenticate and /api/health did not exist, yet Phases 2-3 reported all-green. |
| spec | Split AC-F5A-3 into two oracles: the fixture-manifest response-body test and a grep over the real packages/dashboard/dist output, so the built-artifact claim has its own evidence line. | The AC's dist-grep clause currently has no dedicated evidenced run. |
| process | Capture the two adjudicated root-cause findings (nonce session vs api_keys JOIN; ambient-state-dependent guard test) as knowledge docs — the bundle has zero linked docs. | Both are non-obvious and likely to recur in adjacent auth/packaging work. |

## Unverifiable Materials

- Repository diff for this plan: diff_available=false, so invariants on packages/dashboard/src, the git-ignored generated manifest and its sole importer, and per-concern commit discipline cannot be checked.
- Playwright result summaries for the static e2e config: All e2e output_tails truncate inside build/setup logs; no pass/fail counts or exit codes are present in any recorded entry.
- git log 2797126..HEAD attribution proof for the 7 suite failures: Referenced in the evidence note as proving the failures are foreign to F5a, but the command output itself is not included.
- lore assess verdict, spec code anchors, lore status --check-drift result: Named in the plan's exit criteria and the verification task approach, but no corresponding evidence entries exist; task remains status=draft.

## Rubric Warnings

- Dimension "scope_fidelity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 8 declared criteria
- Task evidence: 12 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.49

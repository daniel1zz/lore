---
id: KN-074
type: knowledge
role: knowledge
title: "Assessment: Implementation — SPEC-078 dashboard multi-project (dual-wave) (2026-07-25)"
status: archived
priority: medium
created: 2026-07-25
updated: 2026-10-23
tags: []
parent: PLAN-038
links:
  - {id: PLAN-038, type: informs}
---
# Assessment: partially_met (79/100)

Scope: plan `01KYBYZTJHQWF6SE14533XQHEZ`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-078-1 | 82 | T5 impl green after T4 RED; T12 attested re-run passes. Visible output tail names only 3 of the 5 required scenarios (2-corpus, missing-path, duplicate-name); schema-skew sha256 byte-identity and all-error-0-mount cases are authored per T4 but not visible in any tail. | 01KYBZ8FY4PAGRDZN072Q1FARN (T5 impl, 2 pass runs), 01KYBZ8JT2KD80Q50XW2SZ4T0Q (T12 attested re-run) |
| AC-078-2 | 92 | T1 landed the pragma; busy-timeout tail names all three required behaviors (pragma=2000, second writer waits and succeeds, timeout=0 regression throws SQLITE_BUSY). Attested pass repeated at T5/T7/T12; historical fails are pre-existence filter misses. | 01KYBZ81ENZ3RXH0PHPW2R71WX (T1), 01KYBZ8JT2KD80Q50XW2SZ4T0Q (T12 [2]) |
| AC-078-3 | 72 | Liveness spike passes at T2/T5/T12 with named ceiling assertions, but the record contains two observed failures of this same file (T7 evidence [6]; T8 [3] transient 2-fail then corrective re-run). Environment-dependent flake weakens the empirical pin it exists to provide. | 01KYBZ8128KE3Y1QA5K7QF3TPQ (T2 spike), 01KYBZ8H61R1WPH0S6DNKAGG07 (T7 [6] fail), 01KYBZ8GRRJFX6KCZMZQFD9ZH5 (T8 [3] transient fail) |
| AC-078-4 | 87 | T6 RED → T7 green; tails name the 0600 file-mode test and the single-store both-modes test explicitly, plus a logout case. Bearer-path-untouched scenario not visible in any tail. T12 attested re-run passes. | 01KYBZ8H61R1WPH0S6DNKAGG07 (T7), 01KYBZ8JT2KD80Q50XW2SZ4T0Q (T12 [4]) |
| AC-078-5 | 90 | T8 tail: 4 pass / 19 expect(); named test asserts one entry per registry item across 4 distinct states plus both instance identity fields, exceeding the 3-state floor. Attested at T12. Route source file itself unseen (truncated). | 01KYBZ8GRRJFX6KCZMZQFD9ZH5 (T8 [1]), 01KYBZ8JT2KD80Q50XW2SZ4T0Q (T12 [5]) |
| AC-078-9 | 92 | 6 pass / 0 fail across the whole timeline — the registry-less suite stayed green at every checkpoint, and T11 ran it twice consecutively including the route-shape pin in browse-ux.pw.ts. Strongest AC in the set; the pin assertion text itself is unseen. | 01KYBZ8JCYBZZC0CBBQQ9RYH7K (T11 [4] double run), 01KYBZ8JT2KD80Q50XW2SZ4T0Q (T12 [6]) |
| AC-078-10 | 87 | T8 runtime-isolation: 4 pass / 23 expect(); tail names the throwing-stub broken-project 5xx case. Sibling-200-plus-write-lands half is asserted per test count but not visible in the tail. Attested re-run at T12. | 01KYBZ8GRRJFX6KCZMZQFD9ZH5 (T8 [2]), 01KYBZ8JT2KD80Q50XW2SZ4T0Q (T12 [7]) |
| AC-078-6 | 84 | T11 spec runs 4 tests green under the dedicated multi-project config; tail names both-projects-one-login and unregistered-404. The AC's byte-unchanged-B and If-Match-cross-project-replay clauses fall in the truncated tail — count (4) is consistent but unconfirmed. | 01KYBZ8JCYBZZC0CBBQQ9RYH7K (T11 [1]), 01KYBZ8JT2KD80Q50XW2SZ4T0Q (T12 [8]) |
| AC-078-7 | 84 | Both e2e tests pass (gate-armed denial in A with feeding pack; success in B with http_cookie audit rows in both). Component half is evidenced only by T10's passing suite; diff confirms ProjectIdentityLabel mounted next to adjudication/save/config controls. | 01KYBZ8JCYBZZC0CBBQQ9RYH7K (T11 [2]), 01KYBZ8J0CKEZNVJC0BHDZX8M2 (T10 component tests) |
| AC-078-8 | 87 | Cache spec + lint fixture run as one chained command, attested pass; tail names the A→B switch asserting zero A-content. T9 records grep for raw /api/ literals outside the factory at 0 hits. Diff corroborates broad factory migration across ~15 components. | 01KYBZ8HKEYS6VGC9GHE3ABQS6 (T9 lint + grep), 01KYBZ8JT2KD80Q50XW2SZ4T0Q (T12 [10]) |

## Gaps

- T12 declares an AC 'Given lore status --check-tree --check-drift, Then exit 0 after anchor declarations', yet evidence [14] records `lore status --check-tree` result=fail (recorder=agent:main-orchestrator, no output_tail, no diagnosis). The task is archived as the plan's verification umbrella regardless. Either the anchor declarations did not land as the approach describes, or a tree-drift condition exists that no one triaged.
- deleted-corpus-liveness.bun.test.ts is recorded failing twice (T7 evidence [6] with an assertion-site tail at the second-consecutive-operation case; T8 evidence [3] as a 2-fail later 'corrective re-run' to 0-fail) and passing in five other runs. This test is the sole empirical basis for T8's decision on whether to wrap store dispatch in a watchdog; its instability means the H-risk 'bun:sqlite hangs' is retired on a non-deterministic oracle.
- AC-078-1 enumerates five distinct behaviors including the schema-skew sha256 byte-identity oracle (Invariant 1's only mechanical check) and the all-error-registry no-throw case. Every recorded output tail for mount-registry.bun.test.ts is clipped after the same three test names, so the byte-identity assertion — the plan's headline no-write guarantee — is never visible in any attested output.
- T10 shipped a partial /p/:name route mirror as a 'documented scope reduction', and T13 was added outside the plan's 12-task decomposition to repair it. T13 carries only tsc + vitest evidence (no attested runs, no e2e covering the four newly mirrored routes), and the plan's Estimation Summary, Critical Path, and Exit Criteria ('All 12 tasks archived') were left unamended.
- ProjectSwitcher.tsx's module-level invariant block still documents that only index/library/tree/settings/docs.$id are mirrored and that search/execution/issues/pending 'stay registry-less-only for now'. T13 mirrored all four. The navigate-to-project-home behavior justified by that stale claim is now under-motivated, and the comment misleads the next reader.
- T10 records lint as result=fail with the justification embedded in the command string ('4 pre-existing react-hooks/exhaustive-deps errors confirmed via git-stash byte-identical before this task's changes'). The stash comparison is self-reported by the implementing agent with no captured output, and T9's AC required 'with the fixture removed the repo lints clean' — which this fail leaves unmet at repo scope.

## Recommendations

- Block archival of a verification-umbrella task while any of its own ACs has a failing oracle. T12 archived with `lore status --check-tree` red; require either a green re-run or an explicit recorded waiver naming the accepted condition.
- Re-run and stabilize tests/unit/mount/deleted-corpus-liveness.bun.test.ts (N consecutive green runs) before relying on its no-hang conclusion; if it cannot be made deterministic, adopt the risk register's contingency and add the per-request timeout wrapper at the dispatch boundary.
- Preserve full oracle output (or at minimum the complete test-name list) rather than a fixed-length tail for ACs whose statement enumerates multiple required behaviors, e.g. AC-078-1's five scenarios and AC-078-6's four clauses.
- Amend the plan when a repair task is inserted mid-flight: fold T13 into the task count, estimation summary, and exit criteria, and give it attested evidence covering the four newly mirrored routes.
- Capture the T2 throw-vs-hang finding and the dual-wave contract-SSOT outcome as knowledge docs; the bundle links zero.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 109310ms
- Retried: false
- Truncated sections: diff:CLAUDE.md, diff:bun.lock, diff:packages/core/src/config-dashboard.test.ts, diff:packages/dashboard/CLAUDE.md, diff:packages/dashboard/eslint.config.js, diff:packages/dashboard/package.json, diff:packages/dashboard/src/lib/api.ts, diff:packages/dashboard/src/lib/project-api.ts, diff:packages/dashboard/src/lib/project-storage.ts, diff:packages/dashboard/src/lib/use-project-redirect.ts, diff:packages/dashboard/src/lib/use-projects-query.ts, diff:packages/dashboard/src/lib/use-route-telemetry.ts, diff:packages/dashboard/src/routes/__root.tsx, diff:packages/dashboard/src/routes/docs.$id.tsx, diff:packages/dashboard/src/routes/execution.tsx, diff:packages/dashboard/src/routes/index.tsx, diff:packages/dashboard/src/routes/library.tsx, diff:packages/dashboard/src/routes/p.$name.execution.tsx, diff:packages/dashboard/src/routes/p.$name.index.tsx, diff:packages/dashboard/src/routes/p.$name.issues.tsx, diff:packages/dashboard/src/routes/p.$name.issues_.$id.tsx, diff:packages/dashboard/src/routes/p.$name.library.tsx, diff:packages/dashboard/src/routes/p.$name.pending.tsx, diff:packages/dashboard/src/routes/p.$name.search.tsx, diff:packages/dashboard/src/routes/p.$name.settings.tsx, diff:packages/dashboard/src/routes/p.$name.tree.tsx, diff:packages/dashboard/src/routes/p.$name.tsx, diff:packages/dashboard/src/routes/search.tsx, diff:packages/dashboard/src/routes/settings.tsx, diff:packages/dashboard/src/routes/tree.tsx, diff:packages/dashboard/tests/component/ActivePlansPanel.test.tsx, diff:packages/dashboard/tests/component/AdjudicationBar.test.tsx, diff:packages/dashboard/tests/component/ConfigScopePanel.test.tsx, diff:packages/dashboard/tests/component/DocDetail.delete.test.tsx, diff:packages/dashboard/tests/component/DocDetail.write.test.tsx, diff:packages/dashboard/tests/component/EvidenceTab.test.tsx, diff:packages/dashboard/tests/component/ExecutionPage.test.tsx, diff:packages/dashboard/tests/component/HistoryTab.test.tsx, diff:packages/dashboard/tests/component/IssueDetail.test.tsx, diff:packages/dashboard/tests/component/IssuesList.test.tsx, diff:packages/dashboard/tests/component/LinksPanel.test.tsx, diff:packages/dashboard/tests/component/PendingPanel.test.tsx, diff:packages/dashboard/tests/component/ProjectSwitcher.test.tsx, diff:packages/dashboard/tests/component/SearchPageBody.test.tsx, diff:packages/dashboard/tests/component/TriageQueue.test.tsx, diff:packages/dashboard/tests/e2e/browse-ux.pw.ts, diff:packages/dashboard/tests/e2e/global-setup.ts, diff:packages/dashboard/tests/e2e/mint-machine-dashboard-key.ts, diff:packages/dashboard/tests/e2e/multi-project-cache.spec.ts, diff:packages/dashboard/tests/e2e/multi-project-fixture-data.ts, diff:packages/dashboard/tests/e2e/multi-project-global-setup.ts, diff:packages/dashboard/tests/e2e/multi-project-isolation.spec.ts, diff:packages/dashboard/tests/e2e/multi-project-server.ts, diff:packages/dashboard/tests/e2e/multi-project-writes.spec.ts, diff:packages/dashboard/tests/e2e/playwright.multi-project.config.ts, diff:packages/dashboard/tests/e2e/seed-multi-project-fixture.ts, diff:packages/dashboard/tests/fixtures/eslint/raw-api-literal.fixture.ts, diff:packages/dashboard/tests/unit/lib/api.test.ts, diff:packages/dashboard/tests/unit/lib/mutations.test.ts, diff:packages/dashboard/tests/unit/lib/project-api.test.ts, diff:packages/dashboard/tests/unit/lib/use-route-telemetry.test.ts, diff:packages/lore/src/adapters/cli/commands/dashboard.ts, diff:packages/lore/src/adapters/cli/local-key.ts, diff:packages/lore/src/adapters/http/CLAUDE.md, diff:packages/lore/src/adapters/http/index.ts, diff:packages/lore/src/adapters/http/machine-auth.ts, diff:packages/lore/src/adapters/http/projects-route.ts, diff:packages/lore/src/adapters/http/routes.ts, diff:packages/lore/src/mount/mount-registry.ts, diff:packages/lore/src/mount/types.ts, diff:packages/lore/src/store/CLAUDE.md, diff:packages/lore/src/store/sqlite-store.ts, diff:packages/lore/tests/http/evidence-panel.bun.test.ts, diff:packages/lore/tests/http/phase-status.bun.test.ts, diff:packages/lore/tests/http/telemetry-route.bun.test.ts, diff:packages/lore/tests/unit/adapters/http/auth-routes.bun.test.ts, diff:packages/lore/tests/unit/adapters/http/dashboard-calibration-capture.bun.test.ts, diff:packages/lore/tests/unit/adapters/http/feedback-loop-routes.bun.test.ts, diff:packages/lore/tests/unit/adapters/http/local-bootstrap-cookie-secure.bun.test.ts, diff:packages/lore/tests/unit/adapters/http/ready-route.bun.test.ts, diff:packages/lore/tests/unit/http/machine-auth.bun.test.ts, diff:packages/lore/tests/unit/http/projects-route.bun.test.ts, diff:packages/lore/tests/unit/mount/deleted-corpus-liveness.bun.test.ts, diff:packages/lore/tests/unit/mount/mount-registry.bun.test.ts, diff:packages/lore/tests/unit/mount/runtime-isolation.bun.test.ts, diff:packages/lore/tests/unit/store/busy-timeout.bun.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 86 | 0.7 | evidence | All 10 script ACs end green with attested T12 re-runs; diff corroborates the client factory migration and R-13 identity labels. Several AC sub-clauses sit inside truncated output tails. |
| evidence_integrity | 71 | 0.75 | evidence | 60% attested, autopilot re-runs at each checkpoint are a genuine cross-check. Undercut by an archived-with-red T12 check-tree, a twice-failing liveness test, and a self-reported lint waiver. |
| scope_fidelity | 82 | 0.65 | evidence | Work tracks the plan's tasks and invariants; deviations (T10 route deferral, added T13, lint waiver) are declared not hidden, but plan totals/exit criteria were never updated for T13. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | — | T12 declares an AC 'Given lore status --check-tree --check-drift, Then exit 0 after anchor declarations', yet evidence [14] records `lore status --check-tree` result=fail (recorder=agent:main-orchestrator, no output_tail, no diagnosis). The task is archived as the plan's verification umbrella regardless. Either the anchor declarations did not land as the approach describes, or a tree-drift condition exists that no one triaged. |
| evidence_integrity | major | AC-078-3 | deleted-corpus-liveness.bun.test.ts is recorded failing twice (T7 evidence [6] with an assertion-site tail at the second-consecutive-operation case; T8 evidence [3] as a 2-fail later 'corrective re-run' to 0-fail) and passing in five other runs. This test is the sole empirical basis for T8's decision on whether to wrap store dispatch in a watchdog; its instability means the H-risk 'bun:sqlite hangs' is retired on a non-deterministic oracle. |
| outcome | minor | AC-078-1 | AC-078-1 enumerates five distinct behaviors including the schema-skew sha256 byte-identity oracle (Invariant 1's only mechanical check) and the all-error-registry no-throw case. Every recorded output tail for mount-registry.bun.test.ts is clipped after the same three test names, so the byte-identity assertion — the plan's headline no-write guarantee — is never visible in any attested output. |
| scope_fidelity | minor | — | T10 shipped a partial /p/:name route mirror as a 'documented scope reduction', and T13 was added outside the plan's 12-task decomposition to repair it. T13 carries only tsc + vitest evidence (no attested runs, no e2e covering the four newly mirrored routes), and the plan's Estimation Summary, Critical Path, and Exit Criteria ('All 12 tasks archived') were left unamended. |
| scope_fidelity | minor | — | ProjectSwitcher.tsx's module-level invariant block still documents that only index/library/tree/settings/docs.$id are mirrored and that search/execution/issues/pending 'stay registry-less-only for now'. T13 mirrored all four. The navigate-to-project-home behavior justified by that stale claim is now under-motivated, and the comment misleads the next reader. |
| evidence_integrity | minor | — | T10 records lint as result=fail with the justification embedded in the command string ('4 pre-existing react-hooks/exhaustive-deps errors confirmed via git-stash byte-identical before this task's changes'). The stash comparison is self-reported by the implementing agent with no captured output, and T9's AC required 'with the fixture removed the repo lints clean' — which this fail leaves unmet at repo scope. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Block archival of a verification-umbrella task while any of its own ACs has a failing oracle. T12 archived with `lore status --check-tree` red; require either a green re-run or an explicit recorded waiver naming the accepted condition. | A verification task that can archive over its own red AC removes the last gate before landing. |
| plan | Re-run and stabilize tests/unit/mount/deleted-corpus-liveness.bun.test.ts (N consecutive green runs) before relying on its no-hang conclusion; if it cannot be made deterministic, adopt the risk register's contingency and add the per-request timeout wrapper at the dispatch boundary. | AC-078-3 is the empirical pin behind an H-risk and behind T8's decision to omit the watchdog. |
| process | Preserve full oracle output (or at minimum the complete test-name list) rather than a fixed-length tail for ACs whose statement enumerates multiple required behaviors, e.g. AC-078-1's five scenarios and AC-078-6's four clauses. | Clipped tails made byte-identity and cross-project If-Match assertions unverifiable despite passing runs. |
| plan | Amend the plan when a repair task is inserted mid-flight: fold T13 into the task count, estimation summary, and exit criteria, and give it attested evidence covering the four newly mirrored routes. | Exit Criteria still reads 'All 12 tasks archived' while 13 exist; T13 has zero attested evidence. |
| process | Capture the T2 throw-vs-hang finding and the dual-wave contract-SSOT outcome as knowledge docs; the bundle links zero. | Strategy B was chosen partly on a SPEC-077 shape-drift lesson; the result of testing that bet is currently unrecorded. |

## Unverifiable Materials

- packages/lore/src/mount/mount-registry.ts, machine-auth.ts, projects-route.ts, adapters/http/index.ts: Omitted from the diff by the truncation manifest; all server-wave implementation quality is judged solely from test results and task approach text.
- packages/lore/tests/unit/mount/mount-registry.bun.test.ts assertions for schema-skew sha256 byte-identity and all-error registry: Test file omitted and every recorded output tail clips after the third test name, so Invariant 1's byte-identity oracle is never observed.
- packages/dashboard/src/lib/project-api.ts and the ESLint fixture/config: Omitted; the factory seam, queryKeys.scope semantics, and the dedicated lint rule id are inferred from call sites in the visible diff plus a self-reported grep.
- Failure detail for `lore status --check-tree`: Recorded as result=fail with no output_tail and no follow-up evidence anywhere in the bundle.
- T10's git-stash lint baseline comparison: Asserted inside the command string; no captured before/after output to confirm the 4 errors are pre-existing.

## Facts Summary

- AC coverage: 10 declared criteria
- Task evidence: 13 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.60

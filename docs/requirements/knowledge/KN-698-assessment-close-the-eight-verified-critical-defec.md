---
id: KN-698
type: knowledge
role: knowledge
title: "Assessment: Close the eight verified critical defects (2026-10-16)"
status: approved
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-189
links:
  - {id: PLAN-189, type: informs}
---
# Assessment: partially_met (78/100)

Scope: plan `01M51EBWGKD3X1ZT09JKBXMVK5`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-CRIT-1 | 90 | The diff adds a Parent Truncation Notice with shown/total chars and the heading list taken from the full parent text. The notice is gated on contextSection.truncated. There is an expected-fail run, then attested passes in the worktree and on main. | task-skill-implement-f1-review-notice-and-record-every-cut (rows 1,3), task-skill-test-verify-on-main-full-suite-lore-verify-close (row 2) |
| AC-CRIT-2 | 88 | Cuts are built from real lengths and the truncation key is omitted when empty. New migration-019 columns let both fields survive SQLite and Turso round-trips, and renderTruncationBlock prints one line per cut. Red then green for both test files. The migration was not in the plan but is needed for t… | task-skill-implement-f1-review-notice-and-record-every-cut (rows 2,4,7,8,9) |
| AC-CRIT-3 | 86 | withdrawFindingsOnUnshownFiles runs before verifyFindingPaths and uses only wholly omitted files. It adds the reason enum and a separate not_shown count. Red then green. The mutation check is self-reported. checked_against_commit was made optional in the core schema. | task-skill-implement-f2-assess-findings-on-files-the-judge (rows 1-3) |
| AC-CRIT-4 | 68 | Attested red then green, and the full file passes on main. However, the F3 production change (scripts/export-spec-mirror.ts, export-spec-mirror-core.ts, export-docs-service.ts) is missing from the diff and not listed in the truncation manifest. The header-comment grep has no evidence. | task-skill-implement-f3-mirror-export-rewrites-changed-bodies (rows 1,3,7) |
| AC-CRIT-5 | 68 | There is an attested red then green for status-only --check exiting 2. The computeMirrorContentDrift change is not visible in the diff, so I could not verify the implementation itself. | task-skill-implement-f3-mirror-export-rewrites-changed-bodies (rows 2,4) |
| AC-CRIT-6 | 85 | omitted_invalid is wired through CorpusService.list, every CLI JSON and text branch, and MCP lore_list. Red then green with 5 tests. The count covers only the fetched or paged window, so it can under-report when paging is used. | task-skill-implement-f4-list-report-omitted-invalid-instead-of (rows 1,2) |
| AC-CRIT-7 | 82 | The guard is wired in loader.ts (exit 4 with VALIDATION_ERROR), createAppUnscoped, and the gate bypass path, and the 4 e2e tests pass. The red was produced by neutralizing the guard rather than from pre-fix code. The 15-site census is a self-reported manual row. Each CLI load adds up to 4 git spawn… | task-skill-implement-f5-store-a-worktree-never-migrates-the (rows 1,2,5) |
| AC-CRIT-8 | 80 | There is an attested red then green with 3 tests, including the seat-alone cap-exceeded case, and the manifest sha changed. The hook source assets/hooks/session-start-resume.mjs is omitted from the diff, so I could not review the implementation. | task-skill-implement-f6-hook-cap-the-concatenated-sessionstart (rows 1,2) |
| AC-CRIT-9 | 88 | The execution root is joined before the cd offset, and absolute roots are refused in commandRunsFileUnfiltered. findMissingOracleFiles adds the root additively. Red then green with 11 tests. One inconsistency: its JSDoc allows an absolute root while the sibling function rejects one. | task-skill-implement-f7-done-honor-the-attested-execution-root (rows 1,3,6) |
| AC-CRIT-10 | 88 | Per-row attestation.execution_root is converted to a repo-relative path and the repoRoot is threaded through app.ts. The remediation now names --capture and lore verify --execution-root, and no longer suggests --result pass without --capture. Red then green. | task-skill-implement-f7-done-honor-the-attested-execution-root (rows 2,4,7) |
| AC-CRIT-11 | 90 | computePlanNowFullyTerminal returns empty_phases, and the advisory omits the archive command and prints 'lore phase rm <slug> B'. The archive advisory is kept when every phase is populated. Red then green. | task-skill-implement-f8-done-a-plan-with-an-empty-declared (rows 1,2) |

## Gaps

- The F3 production change in scripts/export-spec-mirror.ts and packages/lore/src/service/export-docs-service.ts does not appear in the diff or the truncation manifest. The fix is evidenced only by test output.
- The plan's Exit Criteria require a green full bun run test on main, but test:vitest and test:bun both exit 1. The no-new-failure claim rests on a self-reported manual baseline comparison.
- T9's AC on closing resolved reports, the dist/lore rebuild, and the INV-1/INV-2 checks have no evidence rows.

## Recommendations

- Require the assessed diff to include every non-test production file a task's Source names, or list it in the truncation manifest.
- Update the Exit Criteria to match the corrected T9 AC, or open a follow-up plan that makes main green.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 55849ms
- Retried: false
- Truncated sections: diff:.lore/export-index.json, diff:packages/lore/tests/unit/ai/review-parent-truncation.test.ts, diff:packages/lore/tests/unit/core/issue-report.test.ts, diff:packages/lore/tests/unit/service/review-truncation-record.test.ts, diff:packages/lore/tests/unit/store/audit-chain.bun.test.ts, diff:packages/lore/tests/unit/store/judgment-truncation-roundtrip.bun.test.ts, diff:packages/lore/tests/unit/store/migration-001-idempotent.bun.test.ts, diff:packages/lore/tests/unit/store/migration-003.bun.test.ts, diff:packages/lore/tests/unit/store/migration-004.bun.test.ts, diff:packages/lore/tests/unit/store/migration-006-fk-restore.bun.test.ts, diff:packages/lore/tests/unit/store/migration-008-cjk-fts.bun.test.ts, diff:packages/lore/tests/unit/store/migration-012.bun.test.ts, diff:packages/lore/tests/unit/store/migration-013.bun.test.ts, diff:packages/lore/tests/unit/store/migration-014.bun.test.ts, diff:packages/lore/tests/unit/store/migration-016.bun.test.ts, diff:packages/lore/tests/unit/store/migration-017.bun.test.ts, diff:packages/lore/tests/unit/store/rule-registry-proposed.bun.test.ts, diff:packages/lore/tests/unit/store/trace-events.bun.test.ts, diff:packages/lore/tests/unit/store/version-slug-migration.bun.test.ts, diff:packages/lore/tests/unit/service/plan-close-empty-phases.test.ts, diff:assets/hooks/session-start-resume.mjs, diff:packages/lore/tests/e2e/session-start-worktree-cap.bun.test.ts, diff:packages/lore/tests/unit/hooks/session-bootstrap-injection.test.ts, diff:packages/lore/tests/unit/hooks/session-bootstrap-seat-injection.test.ts, diff:packages/core/tests/unit/execution-root-offset.test.ts, diff:packages/lore/tests/unit/cli/done-unfiltered-remediation.test.ts, diff:packages/lore/tests/e2e/worktree-no-foreign-migration.bun.test.ts, diff:packages/lore/tests/integration/cli/list-omitted-invalid.bun.test.ts, diff:packages/lore/tests/unit/service/assess-truncated-path-findings.bun.test.ts
- Reasoning clipped for: AC-CRIT-2, AC-CRIT-7

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 82 | 0.7 | evidence | All 11 ACs have attested red→green runs. The F3 and F6 implementations are not visible in the diff, so they could not be reviewed directly. |
| evidence_integrity | 76 | 0.65 | evidence | Every fix task has a red row. The baseline triage, F2 mutation check and F5 site census are self-reported, and the F5 red came from a neutralized guard. |
| scope_fidelity | 72 | 0.6 | evidence | The unplanned migration-019 and the core schema loosening (optional checked_against_commit) are justified but undeclared. The T9 exit criterion was narrowed (user-approved). |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-CRIT-4 | The F3 production change in scripts/export-spec-mirror.ts and packages/lore/src/service/export-docs-service.ts does not appear in the diff or the truncation manifest. The fix is evidenced only by test output. |
| outcome | major | — | The plan's Exit Criteria require a green full bun run test on main, but test:vitest and test:bun both exit 1. The no-new-failure claim rests on a self-reported manual baseline comparison. |
| evidence_integrity | minor | — | T9's AC on closing resolved reports, the dist/lore rebuild, and the INV-1/INV-2 checks have no evidence rows. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require the assessed diff to include every non-test production file a task's Source names, or list it in the truncation manifest. | F3 could not be verified from the materials. |
| plan | Update the Exit Criteria to match the corrected T9 AC, or open a follow-up plan that makes main green. | The Exit Criteria and the T9 AC now disagree. |

## Unverifiable Materials

- F3 mirror script/export-docs-service diff: Not present in the diff or the truncation manifest.
- assets/hooks/session-start-resume.mjs: Omitted from the diff for budget reasons.
- Report closures, dist/lore rebuild, INV-1/INV-2 checks: No evidence rows exist for them.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 2
- Unverifiable (confirmed absent — finding withdrawn): 2
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Withdrawn Findings (Path Verification)

2 finding(s) below were EXCLUDED from ac_scores/typed_gaps/gaps because a path they declared was never shown to the judge or does not exist at the assessed commit. overall_score above is NOT recomputed to account for their removal.

- [minor] packages/lore/src/store/migrations/migration-019.ts bumps the schema to 19, which the plan did not mention. Under F5 every linked worktree refuses main's corpus until main migrates. — "packages/lore/src/store/migrations/migration-019.ts" not found at commit ac7125b1d9a15a689914183dcc4f5880c58e5ec0
- [minor] packages/lore/src/store/foreign-schema-guard.ts spawns git twice per call, and both loader.ts and createApp call it. That is up to 4 git spawns per CLI invocation. — "packages/lore/src/store/foreign-schema-guard.ts" not found at commit ac7125b1d9a15a689914183dcc4f5880c58e5ec0

## Facts Summary

- AC coverage: 11 declared criteria
- Task evidence: 9 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.72

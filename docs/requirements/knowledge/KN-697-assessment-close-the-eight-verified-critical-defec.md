---
id: KN-697
type: knowledge
role: knowledge
title: "Assessment: Close the eight verified critical defects (2026-10-16)"
status: archived
priority: medium
created: 2026-10-16
updated: 2026-10-23
tags: []
parent: PLAN-189
links:
  - {id: PLAN-189, type: informs}
---
# Assessment: met (81/100)

Scope: plan `01M51EBWGKD3X1ZT09JKBXMVK5`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-CRIT-1 | 90 | review-template.ts adds a parent truncation notice with shown/total chars and an omitted-sections list built from the full parent. The red run (expected-fail) came before the pass, and the T9 re-run on main passed 4/4. | task-skill-implement-f1-review-notice-and-record-every-cut (ev 1 expected-fail, ev 3 pass), task-skill-test-verify-on-main-full-suite-lore-verify-close (ev 2) |
| AC-CRIT-2 | 87 | The cuts array is stored as truncation, and migration-019 persists both truncated and truncation. The SQLite round-trip test went red, then green. renderTruncationBlock prints one line per cut. Side effect: the schema version bump to 19 forces the F5 refusal on every worktree whose main db is still… | task-skill-implement-f1-review-notice-and-record-every-cut (ev 2,4,7,8), task-skill-test-verify-on-main-full-suite-lore-verify-close (ev 1,3) |
| AC-CRIT-3 | 86 | withdrawFindingsOnUnshownFiles runs before verifyFindingPaths and fills not_shown separately from unverifiable. The head-truncated file is excluded. The test went red, then green. Typecheck evidence for this task is a manual, self-reported row, and the schema now makes checked_against_commit option… | task-skill-implement-f2-assess-findings-on-files-the-judge (ev 1-3), task-skill-test-verify-on-main-full-suite-lore-verify-close (ev 4) |
| AC-CRIT-4 | 88 | runExport passes force:true only from the mirror script, so export-docs keeps A2. The body-change test went red, then green, including the export-docs-without-force case. The R2 review of the first real export diff is not evidenced. | task-skill-implement-f3-mirror-export-rewrites-changed-bodies (ev 1,3,5,7) |
| AC-CRIT-5 | 88 | computeMirrorContentDrift now counts frontmatter_repaired and frontmatter_declined as drift. The status-only test went red, then green (exit 2, names the file). | task-skill-implement-f3-mirror-export-rewrites-changed-bodies (ev 2,4) |
| AC-CRIT-6 | 74 | The CLI JSON output, text footer and --include-invalid case are evidenced red then green. The MCP lore_list half rests only on the diff: the test is CLI-only and its visible names cover only the CLI. omitted_invalid is counted over the paged window. | task-skill-implement-f4-list-report-omitted-invalid-instead-of (ev 1,2) |
| AC-CRIT-7 | 78 | foreign-schema-guard is called from the loader, createAppUnscoped and the gate bypass, and the e2e test passes 4/4. The red run came from deliberately disabling the guard, not from the code before the fix. The plan named loader sites :312 and :382, but the diff guards only one. The 15-site census i… | task-skill-implement-f5-store-a-worktree-never-migrates-the (ev 1,2,5) |
| AC-CRIT-8 | 87 | The cap check runs on the final composed string. Over the cap, the hook drops the bootstrap fence whole and records a degradation; the seat briefing is never cut. The e2e test went from 2 failing to 3 passing, and the test runs the shipped asset. | task-skill-implement-f6-hook-cap-the-concatenated-sessionstart (ev 1,2) |
| AC-CRIT-9 | 80 | commandRunsFileUnfiltered joins executionRoot before the cd offset, and the core test went red, then 11/11. The findMissingOracleFiles body that forwards executionRoot is not shown, and no production caller (e.g. lore evidence) passes the root. | task-skill-implement-f7-done-honor-the-attested-execution-root (ev 1,3,6) |
| AC-CRIT-10 | 87 | repoRoot is wired into TaskWorkflowService, and toRepoRelativeExecutionRoot refuses roots outside the repo. The remediation now names --capture and lore verify --execution-root. The test went red, then 6/6. | task-skill-implement-f7-done-honor-the-attested-execution-root (ev 2,4,7) |
| AC-CRIT-11 | 88 | computePlanNowFullyTerminal now returns the empty phases. The advisory prints 'lore phase rm <slug> B' and no archive command; the all-populated case still prints archive. The test went red, then 3/3. | task-skill-implement-f8-done-a-plan-with-an-empty-declared (ev 1,2) |

## Gaps

- The full test suites still fail on main. The exit criterion was rewritten to 'no failure absent at baseline', and the only support is a manual, self-reported baseline comparison with no attested per-file rerun.
- packages/lore/src/adapters/mcp/tools.ts passes omitted_invalid through lore_list, but the only evidenced oracle is the CLI test, so the MCP half of AC-CRIT-6 has no test behind it.
- packages/core/src/oracle-file-existence.ts accepts executionRoot, but the diff shows no caller passing it, so the oracle-file-existence precheck report may not be fixed in production.
- The F5 red run came from disabling the guard rather than from the code before the fix. The plan named two loader.ts call sites (:312, :382), and packages/lore/src/adapters/cli/loader.ts in the diff guards only one.
- packages/lore/src/store/schema-version.ts raises LATEST_SCHEMA_VERSION to 19. Combined with the F5 guard, every linked worktree on the new code refuses until main is migrated. The plan names this risk as R1, but nothing in the evidence shows how it is handled.

## Recommendations

- Add attested evidence rows to T9 for the dist build, issue closures (the lore issues --local --open output) and the gh-27 CLI repro.
- For guard-style fixes, record the red run on the code before the fix rather than by disabling the guard.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 65898ms
- Retried: false
- Truncated sections: (none)
- Reasoning clipped for: AC-CRIT-2, AC-CRIT-3, AC-CRIT-7

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 84 | 0.7 | evidence | All 11 oracles pass on main with attestation and the diff matches each fix. Minor holes: the MCP list surface and the F7 caller wiring. |
| evidence_integrity | 74 | 0.6 | evidence | Every AC has a red row before green. Weak points: F5's red came from disabling the guard, the baseline triage and site census are manual, test files are absent from the diff, and the closure steps ha… |
| scope_fidelity | 82 | 0.65 | evidence | Changes map to F1-F8. migration-019 and the schema bump go beyond the plan text but AC-CRIT-2 needs them. The suite-green AC was narrowed by a user-approved correction. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | — | The full test suites still fail on main. The exit criterion was rewritten to 'no failure absent at baseline', and the only support is a manual, self-reported baseline comparison with no attested per-file rerun. |
| outcome | minor | AC-CRIT-6 | packages/lore/src/adapters/mcp/tools.ts passes omitted_invalid through lore_list, but the only evidenced oracle is the CLI test, so the MCP half of AC-CRIT-6 has no test behind it. |
| outcome | minor | AC-CRIT-9 | packages/core/src/oracle-file-existence.ts accepts executionRoot, but the diff shows no caller passing it, so the oracle-file-existence precheck report may not be fixed in production. |
| evidence_integrity | minor | AC-CRIT-7 | The F5 red run came from disabling the guard rather than from the code before the fix. The plan named two loader.ts call sites (:312, :382), and packages/lore/src/adapters/cli/loader.ts in the diff guards only one. |
| scope_fidelity | minor | AC-CRIT-2 | packages/lore/src/store/schema-version.ts raises LATEST_SCHEMA_VERSION to 19. Combined with the F5 guard, every linked worktree on the new code refuses until main is migrated. The plan names this risk as R1, but nothing in the evidence shows how it is handled. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Add attested evidence rows to T9 for the dist build, issue closures (the lore issues --local --open output) and the gh-27 CLI repro. | The exit criteria for these steps currently have no evidence. |
| process | For guard-style fixes, record the red run on the code before the fix rather than by disabling the guard. | INV-3 is stronger when the red run reproduces the original defect. |

## Unverifiable Materials

- New test file contents (e.g. list-omitted-invalid.bun.test.ts, worktree-no-foreign-migration.bun.test.ts): Not in the diff, so INV-2 and the quality of the assertions cannot be checked.
- findMissingOracleFiles body that forwards executionRoot to computeCandidateRoots: Not shown in the diff.
- INV-1 governing-spec AC counts: No lore ac list output provided.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 0
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 4

## Facts Summary

- AC coverage: 11 declared criteria
- Task evidence: 9 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.72

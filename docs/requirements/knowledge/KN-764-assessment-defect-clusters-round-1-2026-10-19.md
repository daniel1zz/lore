---
id: KN-764
type: knowledge
role: knowledge
title: "Assessment: Defect clusters round 1 (2026-10-19)"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-23
tags: []
parent: PLAN-233
links:
  - {id: PLAN-233, type: informs}
---
# Assessment: partially_met (75/100)

Scope: plan `01M5966C211HQ2WRE6ADAZ3DJY`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-DCL-1 | 76 | Eight named expected-fail runs (a–h, one per case) precede a 9/9 attested pass, which was re-run in the verify-dcl worktree. The diff contains no DCL-1 code (task-workflow-service.ts, corpus-service.ts plan-close and set-archive sites), so the floor logic itself can't be reviewed. The last tail is … | task-skill-fix-dcl-1-done-floors-judge-real-runs-on-landed-work (ev 1-8 red per case; ev 9, 12, 24 pass) |
| AC-DCL-2 | 85 | The diff shows the shared filter-values.ts and its use in pending, list, calibration, audit, trace, status and review. The test covers 11 refusals (exit 4 plus the accepted values) and valid values on a throwaway corpus, and a scan checks each command. Red was shown by bypassing the pending --type … | task-skill-fix-dcl-2-filter-values-validated-by-one-shared (ev 1 red (bypass), ev 2 and 4 pass, 25 tests) |
| AC-DCL-3 | 68 | 36/36 tests pass with attestation, and a verify-dcl re-run also passes. The red runs show failures, but it isn't shown that the required red was made by restoring a bare store.update. None of the refactor to the nine services or the CorpusService extension is in the diff, so the static-scan claim c… | task-skill-fix-dcl-3-every-corpus-write-goes-through-one-write (ev 1 and 12 expected-fail; ev 2, 10, 13 pass) |
| AC-DCL-4 | 74 | A red run against the unfiltered matcher and cd chain is followed by 78/78 attested passes, including in verify-dcl. The parser in @lore/core and the three call sites are not in the diff. The check:hook-shell-cwd run (ev 5) is expected-fail and has no matching pass recorded. | task-skill-fix-dcl-4-one-cwd-aware-shell-command-parser-used-by (ev 1 red; ev 2, 6, 13 pass; ev 5 check expected-fail only) |

## Gaps

- The diff rewrites runner documentation in .lore/context/test-runner-split.md and CLAUDE.md (one vitest runner, test:bun retired, run-chain) and evicts text from packages/lore/src/adapters/cli/CLAUDE.md. None of these belong to any DCL task or appear in the plan's scope.
- The AC requires the test to be made red once by restoring one bare store.update. The recorded expected-fail runs show failing tests but don't name what was removed, and they look like pre-implementation reds.
- The status --check-tree --fix happy case asserts only that the refusal text is absent. It does not assert an exit code that would show the command behaves as before.
- The check:hook-shell-cwd run was recorded only as expected-fail, with no later passing run.

## Recommendations

- Each red-once evidence row should name the check that was removed (as DCL-2's '# RED: pending --type validator bypassed' does).
- Declare cross-cutting tooling and doc changes (runner unification) as their own task, or move them to a separate plan.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 35684ms
- Retried: false
- Truncated sections: (none)
- Reasoning clipped for: AC-DCL-1, AC-DCL-2, AC-DCL-3

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 74 | 0.55 | evidence | Every AC has attested passing script runs, including in a shared verify worktree. Only DCL-2 code is visible to review. |
| evidence_integrity | 80 | 0.65 | evidence | 96% of evidence is attested and red-first runs exist for every AC. Gaps: DCL-3's red isn't tied to a restored store.update, DCL-4's hook check has no pass, and some tails are truncated. |
| scope_fidelity | 65 | 0.6 | evidence | The diff edits test-runner docs, the CLAUDE.md runner policy and the CLI CLAUDE.md eviction, none of which the plan declares. Blocks ordering held: DCL-3's passes came after DCL-1's. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| scope_fidelity | major | — | The diff rewrites runner documentation in .lore/context/test-runner-split.md and CLAUDE.md (one vitest runner, test:bun retired, run-chain) and evicts text from packages/lore/src/adapters/cli/CLAUDE.md. None of these belong to any DCL task or appear in the plan's scope. |
| evidence_integrity | minor | AC-DCL-3 | The AC requires the test to be made red once by restoring one bare store.update. The recorded expected-fail runs show failing tests but don't name what was removed, and they look like pre-implementation reds. |
| outcome | minor | AC-DCL-2 | The status --check-tree --fix happy case asserts only that the refusal text is absent. It does not assert an exit code that would show the command behaves as before. |
| evidence_integrity | minor | AC-DCL-4 | The check:hook-shell-cwd run was recorded only as expected-fail, with no later passing run. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Each red-once evidence row should name the check that was removed (as DCL-2's '# RED: pending --type validator bypassed' does). | Lets an auditor confirm the 'made red once by removing its check' requirement in the AC. |
| plan | Declare cross-cutting tooling and doc changes (runner unification) as their own task, or move them to a separate plan. | Unplanned drift weakens scope fidelity. |

## Unverifiable Materials

- DCL-1/DCL-3/DCL-4 source diffs (corpus-service.ts, task-workflow-service.ts, @lore/core shell parser, hook asset): Not included in the provided diff, so only the test evidence can be judged.
- GitHub report closure via --resolves: No closure records were provided.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 4
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 4 declared criteria
- Task evidence: 4 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.96

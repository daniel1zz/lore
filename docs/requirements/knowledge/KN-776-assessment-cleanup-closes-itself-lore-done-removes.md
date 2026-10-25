---
id: KN-776
type: knowledge
role: knowledge
title: "Assessment: Cleanup closes itself: lore done removes agent worktrees; agents stop stashing and self-matching waits (2026-10-18)"
status: archived
priority: medium
created: 2026-10-18
updated: 2026-10-23
tags: []
parent: PLAN-205
links:
  - {id: PLAN-205, type: informs}
---
# Assessment: met (80/100)

Scope: plan `01M56HZ8X9TGSQ56PFAHDGBWV5`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-WS-1 | 88 | Attested run shows 27/27 passing in worktree-removal-test.test.ts. The diff leaves the pure decision untouched, apart from one optional `lookups` field on the `gone` variant. Vitest also hit a 'close timed out' hang, which is a hygiene issue and not a failure. | 01M56J00E1CHBZ31THGGMCZFY1 (evidence [7]) |
| AC-WS-2 | 82 | There is an attested e2e pass. The output tail shows only build output, not the test counts. The new branch-claim sweep test in the AC-WS-3 file also exercises `worktree sweep --apply`, which supports this AC. | 01M56J00E1CHBZ31THGGMCZFY1 (evidence [8]) |
| AC-WS-3 | 86 | Branch-claim fixtures (a) removed, (b) kept: process-inside and (c) gone naming both lookups were added, plus a sweep case. The expected-fail run (red before CL-1) is recorded and there are three attested passes. The output tails are truncated before the test counts. | 01M56J00E1CHBZ31THGGMCZFY1 (evidence [1],[5],[6],[9]) |
| AC-WS-4 | 87 | Attested pass, with the tail showing 9 tests in git-safety-worktree-check.test.ts passing. The hook is not touched by this diff, so this is a re-verification of an earlier result. | 01M56J00E1CHBZ31THGGMCZFY1 (evidence [10]) |
| AC-WS-5 | 93 | The attested grep and manifest check passed, and the output tail shows the PASS line and the fresh manifest digest. The diff adds no time window and no lsof call. | 01M56J00E1CHBZ31THGGMCZFY1 (evidence [11]) |
| AC-WS-6 | 92 | `bun run typecheck` has attested passes from both CL-1 and CL-6. | 01M56J00E1CHBZ31THGGMCZFY1 (evidence [12]), 01M56SBJD0K72H47EN9H0SQMPZ |

## Gaps

- The INV-2 exit criterion (cmp of the installed SKILL.md against assets/skills/lore-autopilot/SKILL.md after `lore setup` with a fresh HOME) is evidenced only by an uncommitted scratchpad script whose contents are not shown.
- scripts/build.ts now writes tracked .claude/rules files during every non-variant build. This risks dirtying worktrees, the very problem CL-2 targets.
- The golden fixture packages/lore/tests/fixtures/context-variables/pre-change-rules/worktree-dispatch.md was rewritten to the post-change content. A golden that moves with the change may no longer detect regressions.
- The ERROR case in scripts/tests/autopilot-cleanup-path.test.ts reads a nonexistent tmpdir file directly, not through the shipped-file reader, so it asserts nothing about the code under test.

## Recommendations

- Add the INV-2 consumer-install cmp check as a committed test and record it as attested evidence on CL-4.
- When an implementation diverges from a task's approach (as CL-6 did), update the task's approach and AC before archiving it.
- Give CL-2 a red-first test that build+tests leave git status empty, covering the new render-repo-rules step in build.ts.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 46540ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 84 | 0.7 | evidence | CL-1 resolves branch claims and reports keep/remove/gone as the exit criteria require, and CL-4 edits SKILL.md and adds the round-end sweep. INV-2 is not visible. |
| evidence_integrity | 74 | 0.6 | evidence | All ACs have attested passes and red-first runs for CL-1 and CL-4 are recorded. E2E tails are truncated before the test counts, and INV-2 rests on a scratchpad script. |
| scope_fidelity | 66 | 0.6 | evidence | CL-5, CL-6 and CL-7 were added beyond the CL-1/CL-4 table. CL-6 shipped a build-time rules rewriter, not the pre-push check its approach named. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | — | The INV-2 exit criterion (cmp of the installed SKILL.md against assets/skills/lore-autopilot/SKILL.md after `lore setup` with a fresh HOME) is evidenced only by an uncommitted scratchpad script whose contents are not shown. |
| outcome | minor | — | scripts/build.ts now writes tracked .claude/rules files during every non-variant build. This risks dirtying worktrees, the very problem CL-2 targets. |
| evidence_integrity | minor | — | The golden fixture packages/lore/tests/fixtures/context-variables/pre-change-rules/worktree-dispatch.md was rewritten to the post-change content. A golden that moves with the change may no longer detect regressions. |
| evidence_integrity | minor | — | The ERROR case in scripts/tests/autopilot-cleanup-path.test.ts reads a nonexistent tmpdir file directly, not through the shipped-file reader, so it asserts nothing about the code under test. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Add the INV-2 consumer-install cmp check as a committed test and record it as attested evidence on CL-4. | Scratchpad scripts cannot be audited or re-run. |
| process | When an implementation diverges from a task's approach (as CL-6 did), update the task's approach and AC before archiving it. | Archived tasks should describe what actually shipped. |
| plan | Give CL-2 a red-first test that build+tests leave git status empty, covering the new render-repo-rules step in build.ts. | The new build step writes tracked files. |

## Unverifiable Materials

- scratchpad/inv2.mjs (INV-2 consumer-install check): The script is not in the materials, so the byte-identical cmp cannot be checked.
- e2e test result counts for AC-WS-2/AC-WS-3: The output tails are truncated within the build log, before vitest prints the pass counts.
- CL-7 CLAUDE.md / module-index changes: No corresponding diff hunk is shown, only a lint pass.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 5
- Unverifiable (confirmed absent — finding withdrawn): 1
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Withdrawn Findings (Path Verification)

1 finding(s) below were EXCLUDED from ac_scores/typed_gaps/gaps because a path they declared was never shown to the judge or does not exist at the assessed commit. overall_score above is NOT recomputed to account for their removal.

- [major] CL-6's approach names a `lore fragments check` gate in the pre-push hooks. The diff instead adds scripts/render-repo-rules.ts, invoked from scripts/build.ts, which deletes and re-renders hand-edited rules files. No pre-push change is present. — "scripts/render-repo-rules.ts" not found at commit 95d1ab3042e4a919c1ab8db0ce6c7edc15275ad2

## Facts Summary

- AC coverage: 6 declared criteria
- Task evidence: 7 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.88

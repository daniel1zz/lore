---
id: PLAN-189
type: plan
role: plan
title: "Close the eight verified critical defects"
status: approved
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: SPEC-186
phases:
  - {name: "Phase 1: fixes", description: "F1-F8, one task per root cause, red-first inside each task; parallel except T2->T1 and T7->T8 (shared files)"}
  - {name: "Phase 2: verification", description: "full suite on main, rebuild, lore verify, close resolved reports"}
---
## Overview

Implements spec-close-the-eight-verified-critical-defects-no-judge-listing: eight fix tasks (one per root cause, F1-F8) and one verification task. Every fix is red-first inside its own task.

## Invariants

- INV-1: No fix edits an approved governing spec; new criteria live on the fix spec only (`lore ac list <governing spec>` counts are unchanged at plan close).
- INV-2: No test or smoke check opens this repo's own `.lore/`; every corpus in a new test comes from `mkdtemp` + `lore init` (grep of each new test file for `REPO_ROOT` paired with `.lore` returns nothing).
- INV-3: Each AC-CRIT-n oracle is recorded red (`--result expected-fail`) before its fix lands and green after, in the same task.
- INV-4: `bun run typecheck` exits 0 on main after every merge.
- INV-5: Fixes ship from the binary or `assets/`; F6 is verified against `assets/hooks/session-start-resume.mjs`, not `~/.claude/`.

## Risk Register

| Risk | Impact | Trigger | Mitigation | Contingency |
|---|---|---|---|---|
| R1 F5 refusal breaks legitimate worktree reads when main's db is behind the branch code | H | worktree e2e or dispatch tests fail with the new named error | T5 AC-CRIT-7 covers both paths (worktree refuses, owning checkout migrates); T9 runs the full suite on main | narrow the refusal to schema-behind only; reads of a current schema stay allowed |
| R2 F3 rewriting bodies erases a deliberate hand edit under docs/requirements/ | M | `git diff docs/requirements` after export shows non-corpus text removed | the mirror is a projection by spec; T9 reviews the first post-fix export diff in full | revert the export commit and re-file |
| R3 F6 budget arithmetic clips the bootstrap so hard it drops seat claims | M | AC-CRIT-8 passes but claims missing from additionalContext | T6 asserts the seat briefing survives intact; only bootstrap is clipped | lower seat verbosity instead |
| R4 shared files: ai-provider-service.ts (T2, T1) and task-workflow-service.ts (T7, T8) | M | anchor-overlap gate refuses a claim | blocks links T2->T1 and T7->T8 | none needed |
| R5 TDD pairing skipped (see Decisions Log) | L | a fix lands without a recorded red | INV-3 + T9 checks each task has an expected-fail row | re-open the task |

## Critical Path

T7 -> T8 -> T9 and T2 -> T1 -> T9 (two M+M chains); T3-T6 run in parallel beside them.

## Estimation Summary

T1 M, T2 M, T3 M, T4 S, T5 L, T6 M, T7 M, T8 S, T9 M. Critical path: 3 session-units.

## Exit Criteria

- `lore verify` green for AC-CRIT-1..11; full `bun run test` green on main after the last merge; `dist/lore` rebuilt.
- Every resolved report is closed with its fix commit; task-gh-1343388703-27 closed only after a CLI repro.
- `lore assess` on this plan reviewed.

## Decisions Log

- D1 (user, 2026-10-16): a new fix spec carries the criteria and links the governing specs, instead of adding criteria to seven approved specs (avoids demoting them and blocking dependent plans).
- D2 (user, 2026-10-16): same-root reports are fixed in the same task (gh-34, oracle-file-existence precheck, mirror never-rewrites, mirror skips knowledge doc).
- D3 (AI): strategy "one task per root cause, parallel" chosen over "one task per governing spec" (rejected: F5 and F7 share a spec but touch disjoint code, merging them makes an XL task) and over "interface-first" (rejected: the eight fixes share no new contract).
- D4 (AI): red-first runs inside each fix task instead of a separate paired RED task. Reason: open reports task-gh-1343388703-23 (a test task that blocks its impl task is unsatisfiable under lore done's floors) and task-gh-1343388703-26 (merging a RED test task turns main's typecheck red for every concurrent session).
- D5 (AI): falsifiers (`--falsifier-*`) are not declared at plan time because the mutated text does not exist yet; each task names its smallest red-turning mutation in its evidence instead.

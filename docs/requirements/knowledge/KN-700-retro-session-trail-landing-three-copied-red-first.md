---
id: KN-700
type: knowledge
role: knowledge
title: "Retro: session-trail landing — three copied red-first records found by assess, re-falsified; rebuild-by-script and zsh pitfalls"
status: approved
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: [session-trail, retro, red-first, evidence]
links:
  - {id: PLAN-188, type: informs}
---
## What happened

Plan `plan-session-trail-record-what-each-run-changed-judge-it-at-2` (spec `spec-session-trail-a-session-local-record-of-what-each-run-4`) landed all 12 ACs with runner-attested passes on final main (lore verify per task, 2026-10-16). `lore assess` (knowledge-assessment-session-trail-record-what-each-run-changed, partially_met 77/100) found that the expected-fail (red-first) records of three ACs carry output copied from another test file: AC-ST-5's red tail is session-trail-runs.test.ts (AC-ST-1) output; AC-ST-8's and AC-ST-10's red tails are stop-turn-review-cursor.test.ts (AC-ST-9) output. So no genuine red existed for those three oracles. The records were self-reported (`--output-tail-file`), and lore accepted them unchecked (existing issue: the red-first gate does not read capture_source).

## Falsification re-run (2026-10-16, throwaway worktree at d3b2fd84, no commit)

| AC | Test file | Mutation (implementation only, reverted) | Green | Red |
|---|---|---|---|---|
| AC-ST-5 | integration/hooks/session-trail-retention.test.ts | `RETENTION_DAYS = 14` → `15` | 10 passed | 1 failed: "a trail idle 14 days + 1 hour is replaced by removed.json" |
| AC-ST-8 | integration/cli/session-trail-review-helper-scope.test.ts | `if (uncovered.length > 0)` → `if (false && ...)` in helper-scope-review.ts | 10 passed | 1 failed: "a helper file outside its task anchors" |
| AC-ST-10 | integration/hooks/stop-turn-review-spawn-gating.test.ts | spawn condition → `if (true || ...)` | 4 passed | 3 failed (zero-spawn and judged-end cases) |

All three oracles go red on a one-line break of the behaviour they assert; the worktree was left clean.

## Other lessons from this run

- A proposed rule cannot be corrected in a draft spec (#198): the spec was rebuilt three times during review. Scripting the whole build (rules + ACs + plan + tasks) made each rebuild cheap; keep such a script for any spec with a large rule change set.
- The Bash tool runs zsh here: arrays are 1-based and unquoted variables do not word-split. Two silent mistakes came from this (mis-linked `blocks` edges, a test path list passed as one argument). Run multi-step shell logic with an explicit `bash` heredoc.
- A full suite run while other sessions merge into main can fail on a stale `dist/lore` (embedded manifest digest vs assets on disk). Rebuild and re-run the failing files before attributing a failure.
- Approving every touched baseline node in one loop approved `baseline-attribute-work-to-a-run`, which a previous session deliberately held in draft (issue #215). Check each node's status from before the session before approving it.
- Measured: Stop hook p50 467 ms (before) → 436 ms (after, trail-review spawned): seeding the temporary index from the real index saved more than the spawn costs. SubagentStop measurement p50 425 ms.

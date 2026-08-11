---
id: TASK-331
type: task
role: plan
title: "Add findDiscoveryRefusal to @lore/core with a live-runner capture oracle for all three refusal phrases"
status: archived
priority: medium
phase: "mechanism"
created: 2026-08-10
updated: 2026-08-10
tags: []
parent: PLAN-079
plan: PLAN-079
---
Add `findDiscoveryRefusal(outputTail) -> DiscoveryRefusal | null` to `packages/core/src/attestation-completeness.ts`.

⛔ The three phrases were CAPTURED from the live runners on 2026-08-10, not recalled:
- vitest: `No test files found, exiting with code 1`
- bun test: `The following filters did not match any test files in --cwd="..."` (plus `N files were searched`)
- playwright: `Error: No tests found.`

None of them carries a runner summary line, which is exactly why `parseExecutedUnits` returns `null` today and `judgeCompleteness` answers `unknown_runner`. Do NOT reuse the existing summary patterns for this — the whole point is that they do not match.

AC-OX-5 requires the phrases be re-captured by SPAWNING each runner against a nonexistent path in a `.bun.test.ts` file, never asserted against a hand-copied fixture string. That is the only form that survives a runner changing its wording.

⛔ Assert exit codes are EXACTLY the expected value, never merely non-zero.

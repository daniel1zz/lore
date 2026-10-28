---
id: TASK-2023
type: task
role: plan
title: "D7 the review's suite run matches a clean run; stale refresh decides new commands automatically and runs ACs no task declares"
status: archived
priority: medium
phase: "D"
created: 2026-10-23
updated: 2026-10-26
tags: []
parent: PLAN-211
plan: PLAN-211
---
Measured on 2026-10-23, batch 3 of `lore assess --where status=approved,open-tasks=0`, 21 plans:

1. **Regression input is wrong.** The assess suite runner's full-suite run on main at c5710d79 reported packages/lore/tests/e2e/resume-coverage-compiled.bun.test.ts and packages/lore/tests/e2e/context-provenance-compiled.bun.test.ts as failing, and blamed them on 11 plans. A clean `bun run test` in a throwaway worktree of the same commit passed both. Only ric-site-map-gone-live, github-intake-reach and issue-check failed there. Find the environment difference in assess-suite-runner.ts and remove it at the root. Candidates: dist/lore not built in the worktree, node_modules handling, env vars inherited from the agent harness (CLAUDECODE, LORE_*), or HOME. Acceptance: the runner's failing-file set equals a clean run's on the same commit.
2. **Stale-evidence refresh is skipped.**
   - "lore verify aborted at AC … command is new/changed and was not approved". The refresher must decide command approval through the existing autonomy class verify-new-command (auto), not as a human prompt.
   - "no task of plan … declares AC-… in its ac_scope, so it cannot …". The refresher must run such an AC's declared command through the trusted runner directly (attested), without needing a task.

Tests (packages/lore/tests/integration/milestone-review.test.ts, title prefix 'milestone review gates close'):
- the runner's environment matches a clean run;
- a changed AC command is decided auto and re-verified;
- an AC no task declares is still re-verified.

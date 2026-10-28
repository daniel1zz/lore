---
id: TASK-2033
type: task
role: plan
title: "P11 main suite red files after the bootstrap complete-line landings"
status: archived
priority: medium
phase: "P"
created: 2026-10-24
updated: 2026-10-26
tags: []
parent: PLAN-268
plan: PLAN-268
---
Resolves #351.

The review batch's full suite on main (2ec2b0b7) failed:
packages/lore/tests/e2e/bootstrap-injection-compiled.bun.test.ts, packages/lore/tests/e2e/bootstrap-seat-injection-compiled.bun.test.ts, packages/lore/tests/integration/cli/done-worktree-cleanup.bun.test.ts, packages/lore/tests/integration/cli/github-intake-reach.bun.test.ts, packages/lore/tests/integration/ric-site-map-gone-live.bun.test.ts.
Reproduce each, name the cause, fix at the root. Suspects: P3/P8 bootstrap output changes (complete line, plan_acceptance field); BR-1379 fixtures. github-intake-reach and ric-site-map-gone-live failed before this plan (gh auth / another session's site_map work): prove whether each is environment or real; a test that depends on the developer's gh login is itself a defect to fix (make it hermetic).

---
id: TASK-554
type: task
role: plan
title: "T2 fallout: changed-tests.ts porcelain fix + worktree-cwd-fragile test repairs"
status: archived
priority: medium
phase: "P2-fallout"
created: 2026-07-28
updated: 2026-07-29
tags: []
parent: PLAN-107
plan: PLAN-107
---
Fix the two findings in knowledge-spec-104-fallout-changed-tests-ts-porcelain-path-bug: (1) parsePorcelainPath/getChangedFiles order bug — slice the UNTRIMMED porcelain line before trimming so modified (' M') paths stop losing their first character and being silently dropped; add a regression test in the existing changed-tests suite covering ' M'-prefixed lines end-to-end (RED first: assert the corrupted-path drop before fixing). (2) Repair the 14 worktree-cwd-fragile assertions in cli-utils.test.ts + actor-session-tier.test.ts by passing an explicit main-checkout-shaped cwd (or temp-dir fixture with a .git DIRECTORY) instead of relying on ambient process.cwd() — same pattern the files already use for env injection. Do NOT change resolveActorWithSource semantics (SPEC-104 behavior is correct and spec'd).

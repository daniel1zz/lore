---
id: TASK-1994
type: task
role: plan
title: "Shipped text names the per-call run, never --harness-run"
status: approved
priority: high
phase: "P4 End to end and distribution"
created: 2026-10-26
updated: 2026-10-27
tags: []
parent: PLAN-253
plan: PLAN-253
links:
  - {id: TASK-2003, type: blocks}
---
Covers: AC-RV-4 (shipped text under packages/*/src and assets is inside its residual grep)
Approach: replace every mention of --harness-run as the identity carrier in module memory files, comments and shipped assets with the per-call run and its ancestry verification. Known hits on main 9bb6b4f9 owned here: packages/lore/src/adapters/cli/run-cli.ts:87 and :92, commands/claim.ts:121, commands/handoff.ts:199, commands/init.ts:136, plus packages/lore/src/adapters/cli/CLAUDE.md and packages/core/src/CLAUDE.md. Not owned here: the comment at packages/core/src/distribution-hooks.ts:182 belongs to the e2e task, which holds that anchor (two parallel tasks must not share it); AC-RV-4's grep still scans it and stays red until the e2e task updates it.
Oracle: grep -rn -e '--harness-run' packages/*/src assets .claude/rules returns only the retirement refusal text in run-identity-node.ts; then lore context refresh --check (bun run check:memory-files).

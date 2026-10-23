---
id: TASK-1799
type: task
role: plan
title: "claude-dir-variable golden includes the foreign-working-copy helper gate hook"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PLAN-206
plan: PLAN-206
---
Baseline-red on main (measured 2026-10-19 on a clean detached main 05b458f5): `bun run test:file packages/lore/tests/unit/setup/claude-dir-variable.test.ts` → 1 failed | 3 passed. AC-CV-7 (a) "fresh setup settings.json equals the pre-change golden after <CLAUDE_DIR> normalization" fails because the golden lacks the `pre-helper-foreign-working-copy-gate` hook entries that commit e42cea7d (BR-1092 amendment, "narrow the helper gate to foreign git working copies") added to the shipped settings. The authoring session has ended.

End state: the golden is the shipped settings.json of a fresh setup, so it includes the new hook entries; nothing else about the test changes. If the test's purpose (AC-CV-7: the claude_dir variable renders the same bytes as before) makes a hand-maintained golden of the whole settings file the wrong oracle — every hook addition breaks it — say so and narrow the comparison to what AC-CV-7 asserts (the <CLAUDE_DIR>-rendered paths), keeping a falsifier.

AC: the file passes 4/4 on main with e42cea7d's hooks; falsifier: dropping the new hook from the shipped settings (or from the golden, depending on the chosen oracle) turns it red.

---
id: TASK-658
type: task
role: plan
title: "Extract the repo-corpus pollution guard into a pure predicate that returns offending paths, widen it to docs/requirements, and wire it before and after the suite"
status: archived
priority: high
phase: "guard-widen"
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PLAN-124
plan: PLAN-124
---
AC-OX-2 / D3. spec-loop-e2e.bun.test.ts:340-343 runs execSync('git status --short .lore') and requires empty output. Because .gitignore excludes .lore/* except export-index.json and audit-anchor.json, that check can only ever see those two files, so mirror-content dirt under docs/requirements/** is invisible to it. Extract the decision into a pure predicate in packages/lore/src/repo-pollution-guard.ts (git status text in, verdict + offending paths out), widen the scope to .lore AND docs/requirements, and make the e2e file the wiring that feeds it. On rejection the predicate returns the offending paths and the guard prints them: a bare boolean reproduces the attribution cost this spec exists to remove. Assert BOTH directions in the unit test (reject a docs/requirements line, reject a .lore line, accept empty) plus the before-AND-after pairing in the wiring.

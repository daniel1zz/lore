---
id: TASK-1473
type: task
role: plan
title: "[Skill:implement] R0-2 setup records each manifest sha from the final bytes (#233)"
status: archived
priority: high
phase: "Phase 1: fixes"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-200
plan: PLAN-200
links:
  - {id: TASK-1477, type: blocks}
---
Estimate: M
Resolves: task-gh-1343388703-233
Approach: in packages/lore/src/adapters/cli/commands/setup.ts, record the manifest entry for settings.json AFTER applyLanguageProjections (setup.ts:~1000) writes the language, or recompute the sha from the final bytes; every manifest sha must equal the file's final on-disk bytes. Do not isolate XDG in the old tests to hide it; add the new AC test with a configured language.
Covers: AC-R0-3
AC:
- AC-R0-3 red first, then green; setup.test.ts AC-046-E.R1 and setup-manifest-fields AC-076-6.S1 pass on a machine whose user config sets a language

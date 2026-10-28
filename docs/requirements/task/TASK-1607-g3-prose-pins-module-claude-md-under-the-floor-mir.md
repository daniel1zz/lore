---
id: TASK-1607
type: task
role: plan
title: "G3 prose pins, module CLAUDE.md under the floor, mirror re-exported"
status: archived
priority: medium
phase: "G"
created: 2026-10-23
updated: 2026-10-26
tags: []
parent: PLAN-211
plan: PLAN-211
---
Main green, group B3, B5, B6 and the A1 part of check-prose-pins.

- B3: check:prose-pins fails on packages/lore/tests/integration/decide-from-harness.test.ts:346, a prose pin asserting "carry out the answer yourself". Assert a stable token or the BR-1375 rule id instead, not prose.
  - Also fix scripts/tests/check-prose-pins.test.ts: its HAPPY case, and the case asserting that hooks/pre-push runs prose-pins (that step was removed).
  - Also scripts/tests/test-cleanup-exit.test.ts.
- B5: claude-md-eviction-floor. packages/lore/src/service/CLAUDE.md is 17,364 bytes against a 15,893 limit, and packages/lore/src/store/CLAUDE.md is 16,110. Shrink both under the floor by evicting detail to knowledge docs. The main agent creates those knowledge docs: list in your report what you evicted and the suggested slugs. Do not write to .lore.
- B6: check:spec-mirror exit 5, with 41 drift lines and the autonomy mirror differing from the database. Run `bun run mirror:export` from your worktree, which reads the main corpus, commit the regenerated docs/requirements and .lore/autonomy-mirror.json, and confirm `bun run check:spec-mirror` exits 0.

Oracle: check:prose-pins, check:spec-mirror, claude-md-eviction-floor, check-prose-pins.test and test-cleanup-exit pass.

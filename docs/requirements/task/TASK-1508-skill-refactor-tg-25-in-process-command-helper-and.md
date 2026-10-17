---
id: TASK-1508
type: task
role: plan
title: "[Skill:refactor] TG-25 in-process command helper and first half of 67 binary-spawning tests"
status: archived
priority: high
phase: "Phase 3b: one runner"
created: 2026-10-17
updated: 2026-10-17
tags: []
parent: PLAN-201
plan: PLAN-201
links:
  - {id: TASK-1507, type: blocks}
  - {id: TASK-1496, type: blocks}
---
Estimate: L
Approach: One shared helper runs a lore command in-process (argv, cwd, env, captured stdout/stderr, exit code — the same exit-code mapping the binary uses; never a second mapping). Classification from the ADR: 84 files really start dist/lore; 17 need the real binary (compiled assets, provenance, native libsql, signals, MCP stdio, hooks as Claude Code runs them) and stay; 67 test command logic and move to the helper. The file list is /private/tmp/claude-501/-Users-apple-Projects-zz-lore/c1ffea04-89c5-46f4-8bb9-0d10906f3f65/scratchpad/tg1-research/binonly.txt and the researcher's classifier /private/tmp/claude-501/-Users-apple-Projects-zz-lore/c1ffea04-89c5-46f4-8bb9-0d10906f3f65/scratchpad/tg1-research/tools/binclass.ts. This task: the helper (with a test proving parity with the binary on exit code and output for a sample of commands) and the first half of the 67 files.
Source: spec-test-governance-guards-that-refuse-bad-tests-declared; decision: adr-tg-1-test-runner-decision-measured-comparison-of-bun-only (option b, accepted 2026-10-17)
AC: helper parity test green; the migrated files pass and no longer start dist/lore (count from the binary-start wrapper /private/tmp/claude-501/-Users-apple-Projects-zz-lore/c1ffea04-89c5-46f4-8bb9-0d10906f3f65/scratchpad/tg1-research/tools/lore-wrapper.sh or equivalent).

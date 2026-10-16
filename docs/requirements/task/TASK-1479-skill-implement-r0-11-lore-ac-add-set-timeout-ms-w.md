---
id: TASK-1479
type: task
role: plan
title: "[Skill:implement] R0-11 lore ac add/set --timeout-ms writes the AC's verify timeout"
status: archived
priority: high
phase: "Phase 2: verify on main"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-200
plan: PLAN-200
links:
  - {id: TASK-1477, type: blocks}
---
Estimate: S
Approach: the AC schema has verify.timeout_ms (packages/core/src/acceptance.ts; config.ts:1152 'the AC-level field always wins') but neither lore ac add nor lore ac set can write it, so a long oracle (bun run test:bun, ~1400s) always hits verify's default 900s cap (AC-R0-2: exit 143 TIMED OUT). Add --timeout-ms <positive integer> to ac add and ac set (script mode only), validated, stored at verify.timeout_ms; ac set --timeout-ms '' clears it. Mirror the existing --command handling in commands/ac.ts and the ac service.
Source: lore verify plan-round-0-make-main-green on 13090beb, 2026-10-16.
AC:
- lore ac add/set --timeout-ms 2000000 stores verify.timeout_ms=2000000 (read back via lore ac list --json); a non-positive or non-integer value exits 4; ac set --timeout-ms '' removes it; lore verify uses the stored value (a test with a short timeout_ms and a sleeping command times out at that value)

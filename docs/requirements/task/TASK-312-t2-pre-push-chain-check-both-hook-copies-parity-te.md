---
id: TASK-312
type: task
role: plan
title: "T2 — pre-push chain check (both hook copies) + parity test + genesis-deletion tamper pin"
status: archived
priority: medium
phase: "Wave 1"
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PLAN-075
plan: PLAN-075
---
SPEC-080 G5+G6 (AC-080-3, AC-080-4). Append lore audit --verify step to BOTH hooks/pre-push and assets/project/pre-push (byte-identical, separate exit handling + specific failure text, fail-open contract preserved, D5); parity vitest suite (D4); genesis-row deletion pin in audit-tamper.bun.test.ts (delete first audit row -> new first row prev_link_mismatch). NOTE: assets change requires scripts/embed-assets-manifest freshness — run bun run build or the --check mode to confirm the generated manifest is regenerated (SPEC-076), commit the regenerated packages/lore/src/generated/assets-manifest.ts too.

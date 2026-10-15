---
id: TASK-1291
type: task
role: plan
title: "[A2b] [Skill:implement] core: dedicated-extra-keys table, AC cites field, attestation head_sha fields"
status: archived
priority: critical
phase: "Phase A: core contracts"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-172
plan: PLAN-172
links:
  - {id: TASK-1282, type: blocks}
  - {id: TASK-1281, type: blocks}
  - {id: TASK-1284, type: blocks}
  - {id: TASK-1289, type: blocks}
  - {id: TASK-1280, type: blocks}
  - {id: TASK-1290, type: blocks}
  - {id: TASK-1283, type: blocks}
---
Estimate: S
Approach: per spec §C3 (DEDICATED_EXTRA_KEYS: Partial<Record<DocType, {key, writer}[]>>), §C4 (`cites?: string[]` unique, ≤ 10, `^BR-[1-9][0-9]*$`), §C5 (attestation gains optional `head_sha` and `worktree_dirty`, runner-issued only).
Source: Spec: `spec-baseline-slice-1-rules-with-permanent-ids-ac-citations` (read it first: `lore get spec-baseline-slice-1-rules-with-permanent-ids-ac-citations`).
Covers: AC-BLS1-9 (cites schema), enables AC-BLS1-2 and AC-BLS1-6

AC:
- `bunx vitest run packages/lore/tests/unit/core/baseline.test.ts -t "dedicated keys and cites"` exit 0 AND output contains `Tests  N passed` with N ≥ 4 and 0 failed; then the whole file `bunx vitest run packages/lore/tests/unit/core/baseline.test.ts` exit 0.
- Existing tests touching acceptance/evidence schemas stay green: `bunx vitest run packages/lore/tests/unit/core` exit 0.
- `bun run typecheck` exit 0.

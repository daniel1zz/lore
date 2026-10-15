---
id: TASK-1290
type: task
role: plan
title: "[C5] [Skill:implement] verify runner captures head_sha / worktree_dirty in attestations"
status: archived
priority: high
phase: "Phase C: services and surfaces"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-172
plan: PLAN-172
links:
  - {id: TASK-1279, type: blocks}
---
Estimate: S
Approach: per spec §C5; read `git rev-parse HEAD` and `git status --porcelain` from the execution root already tracked in the attestation; omit on failure.
Source: Spec: `spec-baseline-slice-1-rules-with-permanent-ids-ac-citations` (read it first: `lore get spec-baseline-slice-1-rules-with-permanent-ids-ac-citations`).
Covers: supports AC-BLS1-4

AC:
- `bunx vitest run packages/lore/tests/unit/service/attestation-head-sha.test.ts` exit 0.
- Existing verify suites green: `bun run test:changed` exit 0.

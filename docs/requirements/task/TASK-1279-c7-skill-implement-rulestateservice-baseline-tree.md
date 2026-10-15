---
id: TASK-1279
type: task
role: plan
title: "[C7] [Skill:implement] RuleStateService + baseline tree states + status fields + --check-baseline"
status: archived
priority: high
phase: "Phase C: services and surfaces"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-172
plan: PLAN-172
links:
  - {id: TASK-1277, type: blocks}
  - {id: TASK-1276, type: blocks}
---
Estimate: L
Approach: per spec §C6–C7; reuse the existing plan-lineage evidence resolution (AcService coverage path) keyed by (spec, ac); git behind an injected port with one batched diff per distinct sha; status `baseline` key present only when ≥ 1 baseline doc or ≥ 1 cite; `--check-baseline` exit 3 on registry/leaf mismatch, rules on non-leaf, dangling depends_on.
Source: Spec: `spec-baseline-slice-1-rules-with-permanent-ids-ac-citations` (read it first: `lore get spec-baseline-slice-1-rules-with-permanent-ids-ac-citations`).
Covers: AC-BLS1-3, AC-BLS1-4, AC-BLS1-5
Integration: `lore baseline tree --states`, `lore baseline tree --rule BR-n`, `lore status --json` `.baseline`, `lore status --check-baseline` callable from the built binary.

AC:
- `bunx vitest run packages/lore/tests/unit/service/rule-state-service.test.ts` exit 0.
- `bun run typecheck` exit 0; `bun run test:changed` green.

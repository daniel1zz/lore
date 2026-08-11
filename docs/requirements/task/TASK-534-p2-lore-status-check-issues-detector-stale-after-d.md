---
id: TASK-534
type: task
role: plan
title: "P2 — lore status --check-issues detector + stale_after_days config"
status: archived
priority: medium
phase: "P2 surfaces"
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: PLAN-103
plan: PLAN-103
links:
  - {id: TASK-532, type: blocks}
---
## Objective

Add the deterministic detector that makes an unclosed or stale issue impossible to miss.

## Deliverables

- **D5a** — `lore status --check-issues` reports two shapes, report-only, mutating nothing (SPEC-044 precedent):
  - *unclosed escalation*: a `resolves` in-edge whose source doc is terminal (`active`/`archived`) while the issue task is not `archived`
  - *stale open report*: computed resolution `open` and older than `feedback.stale_after_days`
- **D5b** — `feedback.stale_after_days` config key (default 14) in the config schema. The number lives in config, never in prose (CLAUDE.md content contract).

## Acceptance Criteria

AC-ICL-6. Oracle: `cd packages/lore && bun test tests/e2e/issue-check.bun.test.ts -t AC-ICL-6`.

The "mutates nothing" half must be proven by byte-comparing every issue doc before and after the run — not by inspection.

## Constraints

- Consumes `computeIssueResolution` from P1 — do NOT reimplement.
- Throwaway corpora only. `bun run build` before the oracle (spawns `dist/lore`).
- Six-dimension coverage. Red before green.

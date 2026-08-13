---
id: KN-078
type: knowledge
role: knowledge
title: "Handoff — agent:task-t3-execution-e2e"
status: archived
priority: medium
created: 2026-07-25
updated: 2026-08-01
tags: []
parent: PLAN-041
---
# Handoff — agent:task-t3-execution-e2e

## Plan

plan-implementation-spec-077-dashboard-execution-read-surface

## Task Refs

(none)

## Modified Files

- packages/dashboard/src/components/PhaseProgressPanel.tsx
- packages/dashboard/src/lib/api.ts
- packages/dashboard/tests/e2e/execution.pw.ts

## Key Decisions

| Judgment | Confidence |
|---|---|
| AC-077-5 e2e written correctly; it empirically confirms a live defect in merged T2 code (PhaseProgressPanel crashes /execution for any plan with phases) blocking my task's own AC @high | — |

## Failing Oracle

(none)

## Next Steps

- Dispatch a fix task: packages/dashboard/src/lib/api.ts (retype PhaseScorecard/PhaseChecklistItemView to match the real GET /api/phase-status shape: phase_title not name, checklist is a counts object not array, per-item list is checklist_items[] with field 'trust' not 'trust_label', no dropped_item_names) + PhaseProgressPanel.tsx consumer + PhaseProgressPanel.test.tsx (AC-077-3 fixtures assert the wrong shape). Then re-run tests/e2e/execution.pw.ts (currently exits 1) to close AC-077-5 — do not weaken its assertions. See packages/dashboard/CLAUDE.md 'KNOWN LIVE DEFECT' paragraph for full detail.

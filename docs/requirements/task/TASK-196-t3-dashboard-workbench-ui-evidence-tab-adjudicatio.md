---
id: TASK-196
type: task
role: plan
title: "[T3] dashboard workbench UI: Evidence tab + AdjudicationBar + keyboard triage + drilldown + route telemetry + e2e"
status: archived
priority: critical
phase: "Phase 1: Implementation"
created: 2026-07-24
updated: 2026-07-24
tags: []
parent: PLAN-042
plan: PLAN-042
---
FIRST STEP = R-8 layout spike: verify evidence summary + approve/reject can share the DocDetail screen with zero extra navigation; if infeasible, STOP and report blocked (owner sign-off required for popover fallback — never silently degrade). Then: lib/api.ts apiGetEvidencePanel (typed by @lore/core EvidencePanelProjection); mutations.ts apiPostRouteView (fire-and-forget, never throws to UI); EvidenceTab thin dispatcher + evidence/{TaskEvidencePanel,SpecAcCoveragePanel,PlanAttestationPanel} 1:1 with the union (each owns its empty state); AdjudicationBar (chips via core summarizeForAdjudicationBar + existing apiApproveDoc/apiRejectDoc + calibration note); JudgmentDrilldown (qualitative reasons[], no-judgment -> no affordance, stale badge preserved); lib/use-triage-keyboard.ts (j/k/a/x/e/o, suppression via closest('input, textarea, [contenteditable], .cm-editor'), selection = documented ephemeral local state D5); lib/use-route-telemetry.ts mounted in __root (one POST per location change); DocDetail mounts Evidence tab + AdjudicationBar. Component tests with AC-075-1/3/5/6/7/8 in titles (keyboard-only dispatch for 5/6). Playwright tests/e2e/adjudication.pw.ts (AC-075-4: same-screen adjudication + field-by-field calibration parity via API read-back). Update packages/dashboard/CLAUDE.md (incl. fixing the stale /api/ready-missing claim, F3 scope note). Scoped oracles: dashboard vitest on new test files + typecheck; e2e needs ports 8787/5173 free. Spec: SPEC-075; D5/D7 binding. Depends on T2 (routes must exist for e2e).

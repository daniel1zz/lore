---
id: TASK-960
type: task
role: plan
title: "Verify evidence labels and red proof on main"
status: archived
priority: high
phase: "verification"
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PLAN-153
plan: PLAN-153
---
Estimate: M
Approach: Run by the orchestrator on main after all implement branches (with their RED branches) are merged and `bun run build` has run. (1) `bun run typecheck`; (2) FULL suites on main, once, without cache: `bun run test:vitest` and `bun run test:bun` (the CaptureSource widening and the chokepoint reach many consumers); (3) `lore verify plan-evidence-labels-and-reds-are-honest` — AC-EH-1..11 attested pass on main; (4) invariant I4: every criterion command of this spec passes the moved `commandHasUnsafePipe` under its oracle (none piped); (5) baseline leaf prose that still cites retired rules is rewritten (corpus edit via `lore set`; re-read each leaf first): baseline-prove-a-red:45,54 (BR-53 → BR-1076, BR-195 → BR-1073; settle open question Q4 per spec D1/D11), and any line in baseline-declare-a-falsifier naming BR-53 — then the orchestrator re-reviews and re-approves the demoted leaves; (6) confirm task-gh-1343388703-48/-43/-19/-53 show their implement tasks' `resolves` edges; (7) `lore done` each implement and RED task after merge is verified; `lore assess` the plan. No source edits.
Source: plan invariants I1, I4, I6, I8; S3 review finding 5.
Dimensions: D-FUNC, D-DOC
Scope-Alt: none
Covers: AC-EH-1, AC-EH-2, AC-EH-3, AC-EH-4, AC-EH-5, AC-EH-6, AC-EH-7, AC-EH-8, AC-EH-9, AC-EH-10, AC-EH-11

AC:
- `bun run test:vitest` and `bun run test:bun` exit 0 on main.
- `lore verify <plan>` reports 11/11 script ACs pass with attestation (exit 0).
- After `bun run mirror:export`, `grep -nE 'BR-(53|195)\b' docs/requirements/baseline` finds only retirement notes, no live-rule claim.

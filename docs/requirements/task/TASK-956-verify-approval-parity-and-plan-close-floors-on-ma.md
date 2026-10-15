---
id: TASK-956
type: task
role: plan
title: "Verify approval parity and plan-close floors on main"
status: archived
priority: high
phase: "verification"
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PLAN-154
plan: PLAN-154
---
Estimate: M
Approach: Run by the orchestrator on main after every implement branch (with its RED branch) is merged and `bun run build` has run. (1) `bun run typecheck`; (2) FULL suites on main, once, without cache: `bun run test:vitest` and `bun run test:bun` (the set→approve change reaches 36 enumerated test files, so test:changed is not enough); (3) `lore verify plan-approval-and-plan-closure-go-through-the-same-checks-on` — AC-AP-1..10 attested pass on main; (4) baseline leaf prose that still cites retired rules is rewritten to the new ids (corpus edit through `lore set`, leaves are living docs): baseline-approve-a-document:28 (BR-311 → BR-1071), baseline-approve-a-spec:84 (BR-82 → BR-1071, and close its open question Q2), baseline-archive-a-task:34,50 (BR-215 → BR-1072), baseline-close-a-plan:17,32,52,65,83 (BR-215 → BR-1072; settle Q1 'undecided' per D5/D8) — re-read each leaf first, then the orchestrator re-reviews and re-approves the demoted leaves; (5) record that locked AC-097-2 of spec-lifecycle-archival-plan-close-cascade-deterministic keeps its text while its oracle file (plan-close-cascade.bun.test.ts) is re-baselined — it is now green only for attested tasks; the `relates-to` link from this spec is the record; likewise locked AC-097-3 (archive --apply archives a straggler, re-sweep exits 0) stays green only for floor-clearing tasks — superseded for floor-refused stragglers per spec D8, recorded by the same `relates-to` link; (6) confirm task-gh-1343388703-65/-50/-47/-173 show their implement tasks' `resolves` edges; (7) `lore done` each implement and RED task after merge is verified; `lore assess` the plan. No source edits.
Source: plan invariants I1, I6, I7; S3 review findings 5 and 6.
Dimensions: D-FUNC, D-DOC
Scope-Alt: none
Covers: AC-AP-1, AC-AP-2, AC-AP-3, AC-AP-4, AC-AP-5, AC-AP-6, AC-AP-7, AC-AP-8, AC-AP-9, AC-AP-10

AC:
- `bun run test:vitest` and `bun run test:bun` exit 0 on main.
- `lore verify <plan>` reports 10/10 script ACs pass with attestation (exit 0).
- `grep -nE 'BR-(311|82|215)\b' docs/requirements/baseline` after `bun run mirror:export` finds no live-rule claim for a retired id (only retirement notes).
- Residual #174 remains an open issue.

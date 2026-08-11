---
id: PLAN-106
type: plan
role: plan
title: "Implementation — workflow hardening (M1-M4 from 2026-07-27 session review)"
status: archived
priority: medium
created: 2026-07-27
updated: 2026-07-29
tags: []
parent: SPEC-099
---
## Goal
Land the four mechanizations of spec-workflow-hardening-evidence-red-vocabulary-claim-worktree (AC-WH-1..4). Origin: session review knowledge-session-process-review-2026-07-27-context-refresh (V1/V2/V4/V5).

## Approach
Four independently-shippable tasks, one per mechanization, each RED-first (failing suite before implementation) and closed with lore evidence per its AC's oracle. M1 and M3 share task-workflow-service.ts — do not claim them concurrently (anchors declared; the gate enforces on overlap).

## Risks
- M1 touches the evidence Zod enum consumed by verify/assess/coverage aggregation — non-green classification must be asserted everywhere the enum is read, not just at the write path.
- M3's lifecycle walk must reuse VALID_TRANSITIONS (no new sanctioned edge without schema change).
- M4 must not regress primary-checkout resolution (byte-identical REGRESSION pin).

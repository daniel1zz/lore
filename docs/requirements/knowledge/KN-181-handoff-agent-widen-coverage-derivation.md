---
id: KN-181
type: knowledge
role: knowledge
title: "Handoff — agent:widen-coverage-derivation"
status: approved
priority: medium
created: 2026-08-07
updated: 2026-08-07
tags: []
parent: PRD-001
---
> ⚠ INVALIDATED 2026-08-07T15:44:41.395Z — superseded by knowledge-handoff-agent-main-orchestrator-82; The gap it filed (two stale exact-toEqual assertions in ac-service.test.ts, outside its anchor set) was fixed by task-add-the-recorded-at-field-to-two-stale-exact-toequal, merged and archived. Its thread is closed; leaving it open would make latest_handoffs advertise resolved work.

# Handoff — agent:widen-coverage-derivation

SCOPE: 1 decisions + 1 next steps = 2 items to account for

## Plan

(none)

## Task Refs

(none)

## Modified Files

- packages/lore/tests/unit/service/ac-service.test.ts

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | Task DONE, AC-FALS-11..23 all green, all 21 anchors wired — but found a genuine regression OUTSIDE anchors: ac-service.test.ts:535,604 hardcode refs without recorded_at, now populated unconditionally by computeAcCoverage (M4)@high | — |

## Failing Oracle

(none)

## Next Steps

- NS1: Dispatch a fix (or widen anchors) for packages/lore/tests/unit/service/ac-service.test.ts:535 and :604 — add recorded_at to each toEqual expectation, same fix already applied in task-feed-wiring.test.ts:490-501 by this task's commit. Repro: bunx vitest run packages/lore/tests/unit/service/ac-service.test.ts (2 failed/108 passed pre-fix). Found via bun run test:changed full sweep (1729+6766 tests); only these 2 are real — 2 other bun-test failures were this worktree's own stale dist/lore binary, resolved by rebuilding.

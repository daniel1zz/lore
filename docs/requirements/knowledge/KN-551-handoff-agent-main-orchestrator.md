---
id: KN-551
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-08-24
updated: 2026-08-24
tags: []
parent: PLAN-147
---
# Handoff — agent:main-orchestrator

SCOPE: 6 decisions + 7 next steps = 13 items to account for

## Plan

plan-land-measured-blast-radius-grading-one-fan-in-definition-a

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | Two approved specs for the user's three measured problems. Entry-side grading and exit-side convergence are SEPARATE specs: opposite sides of a clean seam (gate predicates vs read projection), anchors disjoint, so they run in parallel.@0.95 | — |
| KD2 | The AI judge is ADVISORY yet found real defects in all 12 rounds, on specs whose deterministic gate said pass from round 1. Order: missing tables, undefined recognizers, observation-granularity false greens, unnamed referents. Approving on the first pass would have shipped all of them.@0.97 | — |
| KD3 | Fan-in measured BEFORE thresholds, and it refuted the design: p50=1 p75=4 p90=10 p99=85 max=670 over 502 files. Barrels top it (core/index.ts 670) while the Zod boundary schemas.ts is 8. Raw fan-in inverts blast radius, so LAYER dominates and the 4 barrels are excluded.@0.96 | — |
| KD4 | Anchor counts measured separately: p50=2 p75=3 p99=12, and 193 of 822 live tasks (24%) declare ZERO anchors. A zero-anchor task has no layer and no fan-in, so it grades R3, the heaviest — declaring nothing must not buy a lighter process.@0.94 | — |
| KD5 | noAnchorOverlap is ALREADY vacuously satisfied by an empty anchor set, so 24% of live tasks are invisible to the file mutex today. The grading spec stops inheriting that hole but does NOT fix the mutex. Unowned.@0.93 | — |
| KD6 | knowledge code_anchors was never a missing capability: accepted since 2026-08-12, scanned by DriftCheckService. Usage spec 97 : knowledge 0. The gap is the OBLIGATION — the CLAUDE.md rule and the pre-push ratchet exist on the spec side only.@0.98 | — |

## Failing Oracle

(none)

## Next Steps

- NS1: GRADING PLAN dispatch order (6 tasks ready, anchors disjoint): wave1 = P1 import-graph move + P3 class map, parallel; wave2 = P2 gradeOf (needs P1) + P4 waiver wiring (needs P3 VIOLATING_FIXTURES); wave3 = P5 arming (needs P2); wave4 = P6 gate --explain + falsifier coverage (needs all).
- NS2: CURRENCY PLAN dispatch order (4 tasks ready): P1 search projection starts immediately, parallel with the grading plan. P2 then P3 are FORCED serial — both anchor conclusion-convergence.ts so the claim gate refuses the second, which is correct since D2 is meaningless before D3. P4 last.
- NS3: BLOCKER before any dispatch: local main is 8 commits AHEAD of origin/main and the harness builds worktrees from origin/main, not local HEAD. Every task body already says 'git rebase main' first plus a git log --oneline -1 baseline confirm. Pushing instead is outward and needs the user's authorization; not done.
- NS4: CROSS-PLAN dependency, deliberate: packages/lore/tests/integration/falsifier-coverage.test.ts is OWNED by grading P6 and written PARAMETERIZED by spec slug. Currency P4 only invokes it for its own spec and must not edit or duplicate it — if P4 runs first it must STOP and report.
- NS5: FALSIFIER fields are empty on all 20 ACs because a falsifier must name an existing file and no definition site exists yet. Each task body tells the implementer to REPORT the four measured values; the orchestrator records them. AC-GRADE-9 and AC-CONV-9 are the guards, and both now demand exit code exactly 1, never 2+.
- NS6: UNDECIDED, for the user: the live corpus still lacks the supersedes edge from knowledge-lore-evidence-capture-now-clears-the-attested-floor to task-lore-done-s-attestation-refusal-calls-a-capture-source. AC-CONV-4 covers it in a throwaway corpus; editing the live corpus was not done unasked.
- NS7: SIDE FINDING, unowned: packages/core/src/schemas.ts:701 lists 8 knowledge sub_types and omits 'uat', which is legal (KNOWLEDGE_SUB_TYPES has 9; 7 uat docs exist). One-line fix, no task, and it sits in the STRUCT layer so the new grading would call it R3.

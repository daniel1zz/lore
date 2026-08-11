---
id: KN-422
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PLAN-121
---
# Handoff — agent:main-orchestrator

SCOPE: 5 decisions + 6 next steps = 11 items to account for

## Plan

plan-land-bootstrap-fixpoint-integrity-binary-provenance-the

## Task Refs

(none)

## Modified Files

- CLAUDE.md

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | Bootstrap-fixpoint slice is fully PLANNED, zero implemented: spec approved v32 (9 ACs, 0 advisories), plan approved v2 (3 phases, 6 tasks), all 6 READY and unclaimed | 95 |
| KD2 | 8bfdfe8f landed CLAUDE.md fixes: ac add does NOT demote an approved spec, ac set does; the anchor mutex AND lore ready anchor_conflicts are BOTH plan-scoped, so cross-plan collisions are ungated and invisible | 95 |
| KD3 | Full suite on the merged tree was NOT run, deliberately: it exports into the live corpus and a third session (lore-dc) was concurrently active and had just re-exported to leave the tree clean. This is the ONE unverified item | 90 |
| KD4 | T6 blocker changed twice: mirror-id-unify merged at cedb29db, but an ordinary bun run test rewrites docs/requirements and .lore/export-index.json from INSIDE the suite (45ea1381 to 4c84f428), so T6 needs isolation from spec-mirror-export.ts | 95 |
| KD5 | I refuted that suite-export claim via script-chain inspection, which has no power over it: four true facts, wrong inference. Sound oracle is fingerprint, run, fingerprint - never read the config that supposedly determines it | 100 |

## Failing Oracle

(none)

## Next Steps

- NS1: Run the merged-tree suite verdict in SEGMENTS (test:vitest, test:bun, check:spec-mirror): one bun run test exceeded the 10-min ceiling and returned 143 (SIGTERM, not a failure). Coordinate with lore-dc first; its reply had not arrived
- NS2: Re-read the spec status immediately before ANY dispatch - ac set demoted and re-approved it several times this session, and each demotion hard-blocks all 6 descendant claims
- NS3: Dispatch order is anchor-determined: T1, T2, T4 concurrent; T3 waits on T1 (both anchor commands/status.ts); T5 waits on T2 (both anchor hooks/pre-push); T6 needs exporter isolation, not just a later start
- NS4: AC-BFI-3 and AC-BFI-9 already carry runner-captured expected-fail evidence measured by segment (parity exit 0, wiring exit 1). Do not re-derive their red; the passing parity segment is what gives them discriminating power
- NS5: Cross-plan anchor collisions have no gate. An empty anchor_conflicts with more than one active plan is NOT evidence of safety - coordinate by hand
- NS6: Root CLAUDE.md is at 199/220 lines, 23257/24576 bytes after three sessions edited it today

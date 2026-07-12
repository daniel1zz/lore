---
id: KN-054
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: draft
priority: medium
created: 2026-07-11
updated: 2026-07-11
tags: []
parent: PLAN-027
---
# Handoff — agent:main-orchestrator

## Plan

plan-spec-043-implementation-bi-temporal-invalidation

## Task Refs

(none)

## Modified Files

- packages/core/src/validity.ts
- packages/lore/src/service/validity-service.ts
- packages/lore/src/service/corpus-service.ts
- packages/lore/src/service/outline-service.ts
- packages/lore/src/adapters/cli/commands/invalidate.ts
- packages/lore/src/flows/supersede-flow.ts
- packages/lore/src/adapters/mcp/tools.ts

## Key Decisions

| Judgment | Confidence |
|---|---|
| SPEC-043 (memory hygiene H1) full cycle closed: 3-lens review caught 9 HIGH design faults pre-build (set() side door, SearchHit fields, unmarked Embed/feed/MCP channels, vacuous ranking oracle, false atomicity); two serial worktree agents; 12/12 script ACs attested; assess 85/100 | 93 |
| Per D12 process rule (adopted from SPEC-042 assess), AC-MH-11 is owner-executed and NOT self-recorded — plan stays active until owner runs the embedded script and records evidence | 95 |
| Filter-vs-mark doctrine pinned: list-shaped reads filter invalidated docs, composed/direct reads (get/Embed/feed/judge/MCP) always mark, never silently either way | 90 |

## Failing Oracle

(none)

## Next Steps

- Owner records AC-MH-11 (script embedded in the AC statement) then archives plan-spec-043-implementation-bi-temporal-invalidation
- H2 staleness probes spec cycle: lore review --staleness, in-degree x age probe priority, escalation lands on lore invalidate; consider judge superseded_candidate byproduct field (review U9)
- H3 drift oracle spec cycle after H2: spec code anchors + lore status --check-drift (SPEC-042's normalizeFileAnchors is reusable)
- Dispatch-prompt template update: mandate absolute worktree paths for every oracle invocation (T2 cwd incident)

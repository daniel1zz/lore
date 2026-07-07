---
id: KN-022
type: knowledge
role: knowledge
title: "DocMan replacement assessment — Lore coverage map + two remaining gaps"
status: draft
priority: medium
created: 2026-07-06
updated: 2026-07-06
tags: [docman, positioning, roadmap-candidate]
parent: PRD-001
---
## Owner question (2026-07-06): does Lore still need DocMan?

## Verdict: project-scoped — Lore has replaced AND surpassed DocMan (empirically: this entire session ran with DocMan bootstrap degraded; 4 specs were designed, planned, implemented, evidenced, assessed and audited purely on Lore). Global-scoped — two DocMan capabilities remain unreplaced:

1. **Session workflow gates**: wf_understand/wf_decompose (hook-enforced structured understanding), session bootstrap injection, get_topic_context pull. Lore has no equivalent MCP surface.
2. **Cross-project layer**: docman-hub aggregation + cross-project telemetry. Lore is per-project.

## Lore-only capabilities DocMan lacks
AI review judgments + confidence triage, calibration data + Wilson stats, audit query/verify oracle, multi-surface parity (CLI/MCP/HTTP/dashboard with surface-neutral calibration), multi-user Turso sync, tree contract hard gates, text projections, living-PRD dashboard.

## Replacement path (spec candidates, NOT committed)
- lore_understand/lore_decompose MCP tools: understanding artifacts become corpus docs (auditable, reviewable, feed the calibration loop — stronger than DocMan's ephemeral state).
- Session bootstrap surface: lore MCP tool emitting the pointer-set (tree roots + active plans + pending) for hook injection.
- Cross-project: defer — conflicts with internal-first single-corpus positioning; revisit at OSS phase.

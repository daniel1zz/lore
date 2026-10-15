---
id: PLAN-167
type: plan
role: plan
title: "Baseline slice 3a: architecture tree, baseline-root navigation, requirements to rules, outline retirement, distribution"
status: archived
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: SPEC-160
phases:
  - {name: "3a", description: "waves 1-4"}
---
# Baseline slice 3a — architecture tree, baseline-root navigation, requirements to rules, outline retirement, distribution

governance_mode: unattended (owner: "直接继续，subagent并发"; decisions D1-D4 in the spec)

Spec: spec-baseline-slice-3a-architecture-tree-baseline-root (AC-BLS3-1..10).

## Waves (file-anchor disjoint inside a wave)
- Wave 1 (parallel): A = architecture tree type + AS/AD ids + cite pattern (core schemas/baseline, stores + migration, acceptance, ac-cite-gate); B = navigation (session-service bootstrap, corpus-service tree + strategy resolver, tree CLI, HTTP, MCP, dashboard home, project pointers); E = distribution (setup-project-flow, config template, assets/skills/lore-baseline + templates, new `lore baseline adopt`, status unaudited flag).
- Wave 2: C = requirement coverage from citations (requirement-service, corpus-service coverage) — after B (corpus-service).
- Wave 3: D = plan-close rule-state predicate + outline write retirement (gate-predicates, checkpoint-registry, prd-sync-domain-doc, prd-outline-service, outline CLI, corpus-service plan-close region) — after C.
- Wave 4 (orchestrator, corpus): architecture tree content (AC-BLS3-9), R-## migration + outline-to-branch table (AC-BLS3-10), census mapping of new sites, all-12 coverage exit 0, baseline review of touched nodes.
Each code task has a RED task by a separate tester (blocks it).

## Invariants
- No-baseline corpora: every pre-existing output byte-identical (AC-BLS2-11 stays green).
- Citation gate behaviour for BR-n unchanged; AD-n never citable.
- No silent fallback; exit codes without pipes; tests never write the repo's .lore/.
- All 12 business branches back at 0 coverage gaps at close.

## Risk register
| Risk | Impact | Mitigation |
|---|---|---|
| Registry migration collides with existing BR allocation | H | prefix column with default BR; 8-way race test in AC-BLS3-1 |
| Navigation change breaks agent bootstrap parsing | M | no-baseline byte-identity; Root line keeps its label |
| plan-close predicate change blocks plans mid-flight | M | config key kept; rule-state data exists since slice 1 (BL-13) |
| Shipped skill/templates drift from assets SSOT | M | manifest parity test in AC-BLS3-7 |

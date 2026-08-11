---
id: KN-330
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: PLAN-103
---
# Handoff — agent:main-orchestrator

## Plan

plan-implementation-issue-closure-loop-resolves-edge-computed

## Task Refs

(none)

## Modified Files

- packages/lore/src/service/issue-resolution.ts

## Key Decisions

| Judgment | Confidence |
|---|---|
| Issue-closure loop shipped, plan archived, all 12 ACs runner-attested at final integration state. The 9-day 'fixed defect still reports draft to babyai' symptom is now fixed at the mechanism level rather than patched. @high | — |

## Failing Oracle

(none)

## Next Steps

- Three in-flight findings RECORDED BUT UNFIXED — see knowledge-retro-three-mechanism-gaps-found-while-building-the: (1) lore done's evidence precondition keys on doc TYPE, blocking archival of a foreign-authored issue report whose fix evidence lives elsewhere; the lore set --status walk bypasses it, so it guards nothing. (2) 'lore create spec --help' is denied by the spec-create gate — the predicate runs before argv is checked for --help. (3) file_anchors is claim-time only, never reconciled against the actual diff: the P2 dashboard agent declared 6 anchors, edited 28 files including the store layer, and omitted them from its completion report. Also open: root CLAUDE.md carries two stale CLI subcommand counts (32/22, actual 61), untouched because a concurrent session holds that file dirty; and 9 consumer-filed issues remain open, now listable from any terminal via 'lore issues --open'.

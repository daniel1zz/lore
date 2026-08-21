---
id: KN-482
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-08-21
updated: 2026-08-21
tags: []
parent: PRD-001
---
# Handoff — agent:main-orchestrator

SCOPE: 1 decisions + 1 next steps = 2 items to account for

## Plan

(none)

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | falsifier is fully wired but INERT: 8/829 ACs declare one, 2 machine-proven, all 8 governing plans archived so none is re-runnable. Root cause is structural — declared on a long-lived spec, executable only via a short-lived plan. A gate requiring a declaration would mint DEAD declarations. @high | — |

## Failing Oracle

(none)

## Next Steps

- NS1: Open a tech spec via /lore-design for the 5 items enumerated in knowledge-the-falsifier-mechanism-is-shipped-but-inert-a (read it first — it carries every figure with its reproduce command). Order matters: a plan-independent falsifier execution path is a PREREQUISITE for the gate, not a follow-up. Two hard constraints measured this session: (a) the new coverage field MUST be orthogonal, never a widening of the 7-state enum, because AC-FALS-3 deliberately ranks attested_pass above pass_unfalsified; (b) the gate and the back-catalog sweep MUST land in the SAME slice — 821 existing criteria would violate it on day one. Prerequisite already done: dist/lore rebuilt from dde8826, provenance dev-synced exit 0.

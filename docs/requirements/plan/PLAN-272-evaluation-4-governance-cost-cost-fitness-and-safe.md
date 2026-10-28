---
id: PLAN-272
type: plan
role: plan
title: "Evaluation 4: governance cost, cost, fitness and safety metrics"
status: approved
priority: medium
created: 2026-10-25
updated: 2026-10-25
tags: [evaluation, metrics]
parent: SPEC-241
phases:
  - {name: "Overhead, fitness and safety", description: "O5-O8: false denies, tokens, health, reuse, stability, safety"}
---
## Goal

Answer questions F, G, H, I, J and K (OST O5–O8): check outcomes naming actor and subject, false-deny rate, tokens per landed task (accepted bet), corpus health read from the evaluation scenarios, knowledge reuse, spec stability and the safety ledger. Fourth of five evaluation plans; spec `spec-governance-cost-reuse-stability-and-safety-metrics`.

## Preconditions

- Plan 1's envelope task landed; the overhead/cost/reuse/safety experiment recorded its branches (O5, O6-S1, O7-S1, O8-S2).
- Plan 2's audit task landed before the check-outcome task (both add a store migration; serialised so migration numbers cannot collide).

## Tasks

| Task | Covers |
|---|---|
| Check outcomes name actor and subject; false-deny rate; retire the usage report's retry estimate | AC-GV-1, AC-GV-2 |
| Tokens per landed task from session records | AC-GV-3 |
| Corpus health, knowledge reuse and spec stability metrics | AC-GV-4, AC-GV-5, AC-GV-6 |
| Safety: reversed automatic decisions per class | AC-GV-7 |

## After landing (main agent)

`lore done`, `lore verify <plan>`, `lore rule apply spec-governance-cost-reuse-stability-and-safety-metrics`, `lore assess`.

## Decisions Log

- O6-S1 path B leaves H as no_data permanently; R-42 is assessed as a failed bet, not silently dropped.

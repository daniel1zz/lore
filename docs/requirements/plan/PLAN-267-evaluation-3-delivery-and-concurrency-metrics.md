---
id: PLAN-267
type: plan
role: plan
title: "Evaluation 3: delivery and concurrency metrics"
status: approved
priority: medium
created: 2026-10-25
updated: 2026-10-26
tags: [evaluation, metrics]
parent: SPEC-240
phases:
  - {name: "Delivery and concurrency", description: "O3, O4: DORA mapped to landings, concurrency ledger, unattended share"}
---
## Goal

Answer questions B, C, D and E (OST O3, O4): lead time, landings per day, change fail rate, rework, recovery, live runs per hour, integrate conflict and lost-race rates, and the share of autonomy decisions taken without a person. Third of five evaluation plans; spec `spec-delivery-concurrency-and-autonomy-metrics`.

## Preconditions

- Plan 1's envelope task landed; the delivery-and-concurrency experiment recorded its branches (O3-S1, O4-S1, O4-S3) in plan 1's Decisions Log.
- Not blocked by plan 2: if O2-S1's trigger fires, this plan is promoted ahead of plan 2's scoring task (OST alternative), so no hard link orders them.

## Tasks

| Task | Covers |
|---|---|
| Milestone review records main red locally | AC-DC-6 |
| Delivery measures: lead time, landings, change fail, rework, recovery | AC-DC-1, AC-DC-2, AC-DC-3 |
| Concurrency ledger and unattended autonomy share (includes the 30-day ledger retention) | AC-DC-4, AC-DC-5, AC-DC-7 |

## After landing (main agent)

`lore done`, `lore verify <plan>`, `lore rule apply spec-delivery-concurrency-and-autonomy-metrics`, `lore assess`.

## Decisions Log

- The concurrency task always changes the attempt ledger to keep every attempt younger than 30 days with start time and step exit codes (BR-1419, AC-DC-7); this is no longer a conditional branch.

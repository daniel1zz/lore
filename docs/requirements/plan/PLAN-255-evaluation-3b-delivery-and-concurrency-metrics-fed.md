---
id: PLAN-255
type: plan
role: plan
title: "Evaluation 3b: delivery and concurrency metrics fed by live recorders"
status: approved
priority: medium
created: 2026-10-26
updated: 2026-10-27
tags: [evaluation, metrics]
parent: SPEC-253
phases:
  - {name: "Recorders", description: "Recorders land before the measures that read them"}
  - {name: "Measures", description: "B, C, D, E metrics read through the envelope"}
---
## Goal

Answer questions B, C, D and E (OST O3, O4) under spec-delivery-concurrency-and-autonomy-metrics-fed-by-live, which supersedes spec-delivery-concurrency-and-autonomy-metrics after plan 1's O3-S1 stop-and-re-review. Every measure names its recorder; a measure whose recorder does not cover the window is no_data source_absent.

## Preconditions

- The successor spec approved (S4 again, after the O3-S1 revision).
- Plan 1's envelope task landed (blocks links on both measure tasks).

## Tasks

| Task | Phase | Covers |
|---|---|---|
| Archived tasks record the issues they resolve (resolves recorder) | Recorders | AC-DC-9 |
| Delivery measures: lead time, landings, change fail, rework, recovery, recorder coverage | Measures | AC-DC-1, AC-DC-2, AC-DC-3, AC-DC-8 |
| Concurrency ledger and unattended autonomy share | Measures | AC-DC-4, AC-DC-5, AC-DC-7 |
| Verify AC-DC-6 against the landed main-red ledger (code landed by task-milestone-review-records-main-red-locally in plan-evaluation-3) | Recorders | AC-DC-6 |
| Retire the superseded S-C rule proposals and close plan-evaluation-3 | Measures | — (deprecate S-C, `lore rule apply` retires its proposed ids as never landed, archive the two retracted tasks, close plan-evaluation-3) |

Order: the resolves recorder task and the landed main-red task block the delivery measures task (recorders before measures).

## After landing (main agent)

lore integrate; lore done; lore verify <plan> (includes AC-DC-6); lore rule apply spec-delivery-concurrency-and-autonomy-metrics-fed-by-live; lore assess.

## Decisions Log

- The two unclaimed tasks of plan-evaluation-3 are recreated here (no re-parent verb exists; a task's evidence binds through its plan's single parent spec) and the originals are retracted with lore invalidate --superseded-by. Their Must resolve items are carried verbatim, with the S-C rule ids mapped to their successors.
- plan-evaluation-3 keeps its archived main-red task and the two retracted (invalidated) tasks, whose blocks links were removed in S3 round 2 (plan 3). Its close is a task here (plan 12), since invalidated drafts are not archived and may stop the close.

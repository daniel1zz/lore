---
id: PLAN-262
type: plan
role: plan
title: "Evaluation 5: thresholds and trend surface"
status: approved
priority: medium
created: 2026-10-25
updated: 2026-10-26
tags: [evaluation, metrics]
parent: SPEC-242
phases:
  - {name: "Surface", description: "Baselines, colour bands, eligibility, trends, dashboard page"}
---
## Goal

Turn the metrics into readable status without a composite score: recorded baselines with 10% / 25% colour bands, gate eligibility (≥ 30 audited, kappa ≥ 0.6), per-bucket trends over the CLI and HTTP read, and the dashboard trend page; then record this repo's baselines, print red and yellow metrics at session start, and review the initiative after eight weeks. Fifth of five evaluation plans; spec `spec-evaluation-thresholds-and-trend-surface`.

## Preconditions

- Plans 2, 3 and 4 landed their metric tasks, and plan 1's telemetry and test-run tasks landed, before baselines are recorded on this repo (the recording task is blocked by each of them, so no baseline includes test runs).

## Tasks

| Task | Covers |
|---|---|
| Baseline recording, colour bands and gate eligibility | AC-TS-1, AC-TS-2, AC-TS-3 |
| Metric targets stored append-only and target attainment beside the trend vs baseline (D17; after the baseline task) | AC-TS-9, AC-TS-10 |
| Trend buckets and the HTTP metrics read | AC-TS-4 |
| Dashboard metrics trend page | AC-TS-5 |
| Red and yellow metric lines in the session-start snapshot (also not-met targets) | AC-TS-7 |
| Record this repo's metric baselines | AC-TS-6 |
| Eight-week initiative review | — (owns the kill criterion, branches O2-S3 small n, O2-S4, O4-S3 small n and D6; closed by `lore evidence --capture` of `lore metrics --json` plus a no-new-tests declaration) |

## After landing (main agent)

`lore done`, `lore verify <plan>`, `lore rule apply spec-evaluation-thresholds-and-trend-surface`, `lore assess`. The outcome measure is read from `lore metrics --json` after the recording task: answered x/11 and explicit no_data y/11, reported separately (R-29).

## Decisions Log

- Owner decision 2026-10-26: all S-E targets accepted as listed (D22). Every row of the Targets table in spec-evaluation-thresholds-and-trend-surface marked "proposed — owner decides at S4" is accepted at the listed value and direction; the target task cites this entry as the owner decision for those rows (BR-1452). Recorded by the drafting agent on the coordinator's relay of the user's S4 decision; BR-1452 also asks for a decision answered from a person's terminal, so the target task's first step obtains that record (below) before any proposed row is stored.

- D17 (2026-10-26, user decision): every metric shows trend vs baseline and target attainment separately with its raw value; the target task lands after the baseline task (shared store files) and before the recording, bootstrap and dashboard tasks.
- No metric is wired into a gate here; branch D6 in plan 1's Decisions Log opens a spec when the first metric is eligible.

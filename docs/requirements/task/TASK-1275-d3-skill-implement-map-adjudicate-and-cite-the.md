---
id: TASK-1275
type: task
role: plan
title: "[D3] [Skill:implement] map, adjudicate and cite the specification-branch ACs"
status: archived
priority: high
phase: "Phase D: specification-branch pilot"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-172
plan: PLAN-172
links:
  - {id: TASK-1274, type: blocks}
---
Estimate: M
Approach: list the ACs of the specs whose behaviour belongs to the specification branch; two independent mapper agents propose (spec, AC) → BR-n; agreements written with `lore ac cite`; disagreements decided by a third independent adjudicator agent (owner delegated) and then cited; ACs asserting other branches are recorded as out-of-branch, not cited.
Source: Spec: `spec-baseline-slice-1-rules-with-permanent-ids-ac-citations` (read it first: `lore get spec-baseline-slice-1-rules-with-permanent-ids-ac-citations`). §C8 step 3
Covers: AC-BLS1-11

AC:
- A knowledge doc records: total ACs mapped, agreements, disagreements adjudicated, ratio adjudicated/total, out-of-branch count, both mappings verbatim.
- `lore status --json` `.baseline.acs_citing` equals the number of cited ACs in that record.

## Pre-registered metric (written before any mapping, 2026-10-07)

- Population: all 85 ACs of the 10 specs used in experiment A5 (snapshot: session scratchpad d3/acs.tsv; same spec list as the Validation Ledger's A5).
- Two independent mappers assign each (spec, AC) one primary rule id from the LIVE specification branch, or OUT-OF-BRANCH (asserts another branch / architecture), or NO-RULE (in-branch behaviour no rule states).
- Adjudicated = ACs whose two primary assignments differ (including in-branch vs out-of-branch).
- Kill line: adjudicated / 85 > 30% ⇒ pilot fails on adjudication load (no re-baselining of the bar).
- A third independent agent adjudicates every disagreement (owner delegated). Only final in-branch assignments are cited with `lore ac cite`; NO-RULE items are listed as rule gaps.

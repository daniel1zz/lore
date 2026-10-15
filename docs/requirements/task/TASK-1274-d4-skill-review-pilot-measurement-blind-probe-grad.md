---
id: TASK-1274
type: task
role: plan
title: "[D4] [Skill:review] pilot measurement: blind probe, grading, kill lines"
status: archived
priority: critical
phase: "Phase D: specification-branch pilot"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-172
plan: PLAN-172
links:
  - {id: TASK-1272, type: blocks}
---
Estimate: S
Source: Spec: `spec-baseline-slice-1-rules-with-permanent-ids-ac-citations` (read it first: `lore get spec-baseline-slice-1-rules-with-permanent-ids-ac-citations`). §C8 step 4; AC-BLS1-11 rubric
Covers: AC-BLS1-11

AC:
- A blind reader with only the pilot leaves (via `lore baseline tree --rule` / `lore get`) answers the D1 probe set; an independent grader scores against D1's truth after auditing it.
- A knowledge assessment records: adjudication ratio (from D3), score x/10, confident-wrong count, probe freeze timestamp vs first leaf write timestamp, and the verdict per kill line (adjudication ≤ 30%; score ≥ 9/10 with 0 confident-wrong).
- If any kill line fires: the plan stops before slice 2 and the Ledger gets a row — no re-baselining of the bar.
- The slice-2 entry criterion (4-week re-probe) is recorded in the assessment.

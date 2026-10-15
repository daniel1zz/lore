---
id: KN-652
type: knowledge
role: knowledge
title: "Pilot v2 pre-registration addendum: probe scope error and in-branch secondary measure"
status: draft
priority: medium
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PLAN-173
---
# Pilot v2 pre-registration addendum: probe-set scope error, recorded before any reader runs

Written 2026-10-08 by agent:main-orchestrator BEFORE the blind reader of task V2b is dispatched and before any mapper output exists. Nothing here changes a bar of AC-BLS1-12.

## The error
The orchestrator's brief to the probe author defined the domain as "specification and acceptance ... evidence and `lore verify`/`lore done` floors as they relate to ACs". That is wider than the populated branch. Classified by the placement ADR's Q2 (object whose state transition the decision accepts/refuses/produces), applied now from the QUESTION TEXT only:

| Q | Object whose transition is decided | Branch |
|---|---|---|
| 1 | spec approval, deciding condition = spec's criteria vs project floors | specification |
| 2 | spec approval, deciding condition = required check kinds | specification |
| 3 | verification run for a task | execution |
| 4 | verification run result row | execution |
| 5 | task archival | execution |
| 6 | task archival | execution |
| 7 | criterion writes on an archived spec | specification |
| 8 | criterion revision (falsifier) | specification |
| 9 | task creation | execution |
| 10 | criterion citation | specification |

5 of 10 questions concern the execution branch, which this pilot does not populate. The error is the orchestrator's (bundle design), not the probe author's.

## What is measured (pre-registered now)
- **Primary (unchanged, decides AC-BLS1-12):** all 10 frozen questions, bar >= 9/10 and 0 confident-wrong. Expected to be hard to meet because half the questions are out of the populated branch; the verdict will be recorded as measured, with this addendum as its cause.
- **Secondary (reported, decides nothing):** questions 1, 2, 7, 8, 10 only — score and confident-wrong count.
- **Reader instruction (same for all 10):** answer only from the baseline documents; when the baseline does not state the answer, say NOT ANSWERABLE. Grading: NOT ANSWERABLE = not correct and not confident-wrong; confident-wrong = a wrong answer given with HIGH confidence.

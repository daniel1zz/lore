---
id: TASK-777
type: task
role: plan
title: "[Skill:test] issues --verify drift detection and filtered-total honesty — RED"
status: draft
priority: high
phase: "P5: Projection + reads"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-138
plan: PLAN-138
links:
  - {id: TASK-776, type: blocks}
---
Estimate: S
Source: AC-GI-5 and AC-GI-12 of the governing spec
TDD-Role: red | Paired-Impl: the read-side task in this phase

Scenarios:
- Given a hand-edited `resolution:*` label diverging from the corpus state, When `lore issues --verify` runs, Then it reports that divergence naming both values, and its exit code marks a divergence found
- Given no divergence anywhere, When `lore issues --verify` runs, Then it reports clean and exits 0 — so the detector is not trivially always-red
- Given `lore issues --verify` running, When it completes, Then it performed zero writes to GitHub and zero writes to the corpus
- Given 50 issues, When `lore issues` lists them, Then the number of gh invocations equals the number for 1 issue
- Given `--severity critical`, When the listing runs, Then only reports whose front matter carries that severity appear, and the printed total reflects the filtered count rather than the unfiltered one

AC:
- Every scenario exists as an executable vitest case in the anchored file
- The anchored file exits non-zero before the paired implementation lands
- The second scenario is mandatory — a detector that reports divergence unconditionally passes the first case alone
- The fifth scenario's total-count assertion is mandatory: a filter that hides rows while printing an unfiltered total is the exact census defect recorded in this repo's own North Star
- `lore evidence --result expected-fail` recorded BY THIS TASK when the red is observed

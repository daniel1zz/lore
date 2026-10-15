---
id: TASK-1294
type: task
role: plan
title: "[D1] [Skill:test] pilot probe set frozen before leaves are revised"
status: archived
priority: high
phase: "Phase D: specification-branch pilot"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-172
plan: PLAN-172
links:
  - {id: TASK-1276, type: blocks}
---
Estimate: S
Source: Spec: `spec-baseline-slice-1-rules-with-permanent-ids-ac-citations` (read it first: `lore get spec-baseline-slice-1-rules-with-permanent-ids-ac-citations`). §C8 step 1; protocol in `knowledge-baseline-product-shape-validation-ledger-a1-spec-to` (A2/A3), hardened per PRD metrics
Covers: AC-BLS1-11 (precondition)

AC:
- An independent agent that has NOT read `knowledge-specification-branch-baseline-draft-from-experiment` writes 10 boundary questions on specification & acceptance behaviour with code-verified answers (file:line or test name each), none quoting rule text.
- Persisted as a knowledge reference doc (questions and answers in separate sections) under this plan, BEFORE task D2 writes any leaf; its created_at is the freeze timestamp. Oracle: `lore get <probe-doc> --json` created_at < the created_at of every baseline doc created by [D2] (checked by [D4]).

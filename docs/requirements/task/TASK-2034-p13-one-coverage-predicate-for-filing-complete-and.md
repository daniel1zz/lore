---
id: TASK-2034
type: task
role: plan
title: "P13 one coverage predicate for filing-complete and plan close"
status: archived
priority: medium
phase: "P"
created: 2026-10-24
updated: 2026-10-26
tags: []
parent: PLAN-268
plan: PLAN-268
---
Resolves #372.

Two predicates answer one question. review-batch-service.ts (filingIncomplete, ~line 391) checks linked issue TITLES for the fingerprint tag; the plan-close gate (since P9) checks the linked issue's corpus record extra.milestone_findings {dimension, fingerprint}. Issues filed before P9 have the tag but no record, so the batch skips filing and the close is refused forever.

Fix: one shared coverage function (the one the close gate uses) decides both "filing complete" and "close allowed". Delete listLinkedOpenIssueTitles and the title check. When coverage is missing for a fingerprint whose open issue already exists, the filing step links it again, which writes the record idempotently (P9's linkToPlan third argument).

Tests (plan-progress.test.ts, AC-PCR-4 title): a failed plan whose open issue carries the fingerprint tag in its title but no milestone_findings record → the batch re-links it (record written, no new issue filed) and the plan is archived as accepted with known defects in the same batch; grep proves no title-based coverage check remains.

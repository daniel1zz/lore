---
id: TASK-2027
type: task
role: plan
title: "P5 one main-red issue per suite run; issue titles keep the original summary"
status: archived
priority: medium
phase: "P"
created: 2026-10-23
updated: 2026-10-26
tags: []
parent: PLAN-268
plan: PLAN-268
---
Resolves #345, #346.

1. #345: a failing full suite on main is ONE fingerprint for the batch: "main red: <the suite run's full sorted failing-file set>", linked to every plan any of those files is attributed to. The first batch filed #339 and #341 from one run because the fingerprint used each plan's attributed subset.
2. #346: the fingerprint uses the normalised summary; the issue title uses the finding's original summary (truncated) plus [fp:<12hex>]. #342/#343 titles lost every id ("ac-cs-", "br-").

Tests (plan-progress.test.ts, AC-PCR-4 title): two plans attributed different subsets of one failing run → exactly one issue linked to both; a finding whose summary contains "AC-CS-3 and BR-641" files a title containing those ids while two findings differing only in ids share one fingerprint.

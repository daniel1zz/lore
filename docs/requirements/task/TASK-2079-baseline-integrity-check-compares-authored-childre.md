---
id: TASK-2079
type: task
role: plan
title: "Baseline integrity check compares authored children lists with the tree"
status: deprecated
priority: medium
phase: "P3 Refusal and change batch"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-263
plan: PLAN-263
---
Covers: AC-CL-3
Approach: findBaselineIntegrityFindings gains the authored-children-list finding per the spec's comparison rules (table with >= 2 cells naming live children by title, label or slug ignoring case; number or English number word one..twenty before branches|children|leaves|sections). The literal 'if (listed.missing.length > 0 || listed.extra.length > 0 || listed.countMismatch)' appears verbatim once (falsifier). Exit 3 through the existing --check-baseline path; the JSON block and default line stay derived from the same findings (module invariant).

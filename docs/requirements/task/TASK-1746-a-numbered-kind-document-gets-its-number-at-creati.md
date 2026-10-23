---
id: TASK-1746
type: task
role: plan
title: "A numbered-kind document gets its number at creation, import and schema upgrade; export has no unnumbered branch"
status: approved
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PLAN-206
plan: PLAN-206
---
Found 2026-10-19 by the review judge on baseline-export-documents-to-files (design_necessity, class a/d): docs.ordinal is nullable (migration-010) and numbering of existing specs/ADRs is a separate one-shot `lore migrate ordinals`; BR-1332 refuses an export that meets an unnumbered numbered-kind document, which exists only to catch an unmigrated corpus. End state: every numbered-kind document is numbered when created or imported, the schema upgrade (`lore migrate schema`, the only upgrade path) numbers any that lack one and makes the column required for numbered kinds, `lore migrate ordinals` is removed, and export has no unnumbered-document branch (BR-1332 retired, BR-1284 restated). AC: red-first test that creating, importing and upgrading leave no numbered-kind document without a number and that a store write of one without a number is refused; grep proving export-docs-service has no unnumbered branch and `migrate ordinals` is gone. After landing: retire BR-1332, restate BR-1284, update baseline-export-documents-to-files and baseline-upgrade-the-corpus-in-place.

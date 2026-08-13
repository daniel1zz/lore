---
id: TASK-672
type: task
role: plan
title: "Both issue read surfaces name the corpus they read, issues reaches the configured upstream by default, and triage columns land on both"
status: archived
priority: medium
phase: "read-surfaces"
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PLAN-127
plan: PLAN-127
---
Implements M4 + M6 of the governing spec. See the spec's 'Declared render contract' for the fixed 'Corpus: ' first-line prefix. AC-DC-5/6/7.


ADDED 2026-08-11 after M1/M3 landed (reported by that implementer, whose anchors excluded the render): `rejection_reason` on `ReceiptStatusRow` is now a PARTIAL view. `superseded`/`duplicate` record a reason AND a pointer (`superseded_by`/`duplicate_of`), and `report-issue --list` echoes NEITHER, because the field is named for rejections and its render lives in `commands/report-issue.ts`. Closing it needs a state-neutral field name plus the `ReceiptStatusRow` + row-render change — both inside this task's anchors. ⛔ A non-derogatory terminal state whose pointer is invisible on the read surface is operationally indistinguishable from a rejection, which is the defect M3 exists to remove: the capability would be implemented and unreachable. The gap is grep-marked in `getResolution`'s JSDoc.

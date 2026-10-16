---
id: SPEC-191
type: spec
role: spec
title: "The shipped CLOSE guidance scopes defect reports: lore defects only, one root cause per report"
status: approved
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
---
## Overview/Goal

The shipped CLOSE guidance (`assets/context/corpus-workflow-4-close.md`) tells an agent when to file a lore defect report but not what does NOT belong there, nor that a report carries one root cause. On 2026-10-16 an agent filed #235, a bundle of six unrelated items that were mostly this repository's own upkeep, because the always-loaded guidance said only "new problem -> report-issue". This spec makes the shipped guidance state BR-1153.

## Scope

In scope:
- One edit to the CLOSE fragment's report-issue bullet: a report is filed only for a defect of lore itself; one root cause per report, reproducible and closable on its own, never bundled; the project's own upkeep (tests already red on the baseline, stale ledgers, oversized docs, missing anchors) is recorded as plan/task work.
- Regenerating the repo's compiled `.claude/rules/lore-corpus-workflow-close.md` and the embedded assets manifest so the shipped surface and this repo agree.

Out of scope:
- The user-level fragment (`~/.config/lore/context/user-09-behavior.md`): a private user rule, already updated outside the repo.
- Any gate that mechanically refuses a bundled report.

## Acceptance Criteria

Structured criterion AC-ISCOPE-1 (`lore ac add`).


## Acceptance Criteria (structured)

- [⚑] [script] AC-ISCOPE-1: assets/context/corpus-workflow-4-close.md's report-issue bullet contains 'one root cause' and names this repository's own upkeep as plan/task work, not a report; the repo's compiled .claude/rules/lore-corpus-workflow-close.md is byte-identical to a fresh render of that fragment; and 'lore fragments check' exits exactly 0
  script: test — bunx vitest run packages/lore/tests/unit/context/report-issue-scope-fragment.test.ts

## Code anchors

- assets/context/corpus-workflow-4-close.md

---
id: PLAN-179
type: plan
role: plan
title: "Completing an adopted report's own task closes its GitHub issue"
status: archived
priority: medium
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: SPEC-177
phases:
  - {name: "done-close", description: "lore done trigger + sync"}
---
# Plan — Completing an adopted report's own task closes its GitHub issue

Implements `spec-completing-an-adopted-report-s-own-task-closes-its-github` (AC-IT-1..3); change set BR-1084 lands via `lore rule apply` at plan close. User decision 2026-10-12 — S1 and S4.

## Overview

One task: reuse the closer port and failure handling of `spec-archiving-the-work-that-resolves-a-defect-report-closes`; add the `lore done` trigger for a task carrying `extra.issue_report`; extend `--sync --apply` to close done-archived reports.

## After landing

Run `lore issues --sync --json` read-only on the live corpus, show the list, then `--sync --apply` to close #177–#181 (and label the rest once the user has created the `resolution:*` labels). Update `baseline-resolve-a-defect-report` prose for BR-1084.

## Invariants

| # | Invariant | How it is checked |
|---|---|---|
| I1 | No test contacts the real GitHub repo or the live `.lore/` | fake closer; stub gh; mkdtemp |
| I2 | A completion is never undone by a GitHub failure | AC-IT-1(c) |

## Decisions Log

- 2026-10-12 — only `lore done` (runner-attested) counts as fixed for an issue task (D2).

---
id: SPEC-193
type: spec
role: spec
title: "In-repo lore defect backlog: findings from developing lore are plan work, not issues"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
---
## Overview/Goal

Own every lore defect that was found while developing lore itself and had been filed through the consumer issue channel. Decision (user, 2026-10-16; CLAUDE.md Dogfooding, BR-1153): the issue channel is for consumers of lore; an in-repo finding is fixed now when simple, else it is plan work. Each report is adopted (`lore issue resolve --state adopted`) by the backlog plan of its area and stays open on GitHub with the resolution:adopted label until its fix lands.

## Scope

Eight draft backlog plans, one per area: cli-surface, corpus-integrity, workflow-gates, judge-review, issue-loop, session-seat-worktree, install-context, baseline-mirror. Each is decomposed into tasks (lore-plan replan) when it is picked up. Reports filed by consumer projects (e.g. guyin, babyai) stay issues. Repository upkeep stays in plan-repository-upkeep-backlog.

## Acceptance Criteria

AC-BKL-1 (`lore ac add`).


## Acceptance Criteria (structured)

- [·] [human] AC-BKL-1: Every open defect report whose reporter is this repository is adopted by exactly one of the eight backlog plans; reports from consumer projects are not adopted
  human: checked with lore issues --local --open --json grouped by resolution and reporter

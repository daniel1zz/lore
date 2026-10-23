---
id: PLAN-220
type: plan
role: plan
title: "Land-recorded archival and one unlanded task per working copy"
status: archived
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: SPEC-219
phases:
  - {name: "P1"}
  - {name: "P2"}
---
## Goal

Implement `spec-a-task-is-archived-only-on-a-landing-lore-recorded-one`: archival decided by the landing lore integrate recorded; one working copy carries one unlanded task.

## Phases

- **P1 code**: T1 implements AC-LRD-1..4 in one branch (landing recorder on every claimant incl. already-integrated, not-landed floor replacing the worktree-head floor, claim refusal, deletion of the main-log fallback) and revises AC-DCL-1 (a) of `spec-defect-clusters-round-1-done-floors-judge-real-runs-on` to the not-landed behaviour.
- **P2 corpus**: after T1 lands: `lore verify` this plan, `lore rule apply` the spec, re-review and approve the archive, integrate and claim leaves; land the deprecation task's branch so `task-export-never-falls-back-to-a-title-name-for-an-unnumbered` gets its landing and closes.

## Risks

- The claim refusal applies to every session at once: an open worktree already holding two unlanded tasks (the export/deprecation worktree) keeps its claims; only new claims are refused.

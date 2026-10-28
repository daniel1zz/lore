---
id: PLAN-251
type: plan
role: plan
title: "Plan: unrecoverable pre-#356 claims classified once (#473)"
status: archived
priority: critical
created: 2026-10-26
updated: 2026-10-27
tags: [governance-mechanism-fixes, issue-473]
parent: SPEC-257
phases:
  - {name: "P1 Fix", description: "Migration 040, candidate filter, landing output listing, red-first test; verify, rule apply"}
---
# Plan — unrecoverable pre-#356 claims classified once (#473)

Implements `spec-claims-released-before-tips-were-recorded-are-classified` (AC-UC-1). Rule: BR-1423 (modified). Issue: #473 (carried by this plan's task). User decision D25: fix now, before #418.

## Why a separate plan

The approved #356 spec is locked with evidence: lore refused both an audited correction of its landed BR-1423 entry and a new criterion, and routed the behaviour change to a new spec. A task's criteria must come from its own plan's parent spec, so the fix task lives here. It blocks task-close-plan-356-verify-apply-rules-close-the-four through a task-level link.

## Phases

- **P1 Fix**: migration 040, the candidate filter, the landing output listing, red-first test (AC-UC-1); then lore verify and lore rule apply.

---
id: TASK-1626
type: task
role: plan
title: "C1 bounded handoff: 150 files one per line, rest grouped by directory, no body copy in extra"
status: archived
priority: medium
phase: "C"
created: 2026-10-23
updated: 2026-10-23
tags: []
parent: PLAN-211
plan: PLAN-211
---
Spec: spec-lean-governance-batch-verbs-judgment-only-at-milestones (read Parts and the AC statements; they are the contract). ADR: adr-ai-decision-standard-four-checks-references-from-excellent. Delete-by-default: remove code, tests and docs that only served the removed behaviour; no compat shim, no flag to bring it back. Update every comment and module CLAUDE.md line naming the old behaviour. Producer is session.ts:357 (one 'run <id>' per source) and session-service.ts writeHandoff. Existing oversized handoffs are archived in phase E, not rewritten.

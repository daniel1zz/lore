---
id: TASK-1628
type: task
role: plan
title: "C2 bounded command output: bootstrap <=3KB, help fits width, short unknown-command usage, status counts, list limit"
status: archived
priority: medium
phase: "C"
created: 2026-10-23
updated: 2026-10-23
tags: []
parent: PLAN-211
plan: PLAN-211
---
Spec: spec-lean-governance-batch-verbs-judgment-only-at-milestones (read Parts and the AC statements; they are the contract). ADR: adr-ai-decision-standard-four-checks-references-from-excellent. Delete-by-default: remove code, tests and docs that only served the removed behaviour; no compat shim, no flag to bring it back. Update every comment and module CLAUDE.md line naming the old behaviour. Help padding comes from migrate.ts:73 meta.description (~1100 chars) widening citty's column; run-cli.ts:156 prints full help on an unknown command.

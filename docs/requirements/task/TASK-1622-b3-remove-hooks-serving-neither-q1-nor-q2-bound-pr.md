---
id: TASK-1622
type: task
role: plan
title: "B3 remove hooks serving neither Q1 nor Q2; bound-prose report moves into integrate own-diff"
status: archived
priority: medium
phase: "B"
created: 2026-10-23
updated: 2026-10-23
tags: []
parent: PLAN-211
plan: PLAN-211
links:
  - {id: TASK-1616, type: blocks}
---
Spec: spec-lean-governance-batch-verbs-judgment-only-at-milestones (read Parts and the AC statements; they are the contract). ADR: adr-ai-decision-standard-four-checks-references-from-excellent. Delete-by-default: remove code, tests and docs that only served the removed behaviour; no compat shim, no flag to bring it back. Update every comment and module CLAUDE.md line naming the old behaviour. Remove stop-handoff-coverage and post-edit-bindings (files, manifest registration, setup wiring, tests); drop stop-turn-review findings (b) anchor drift and (c) CLAUDE.md budget; drop the detached lore setup --check in session-start-resume; subagent-context makes one lore call; pre-push drops --check-claude-md and prose-pins. Regenerate the assets manifest. Verify from a fresh consumer install (lore setup into a mkdtemp project) that no removed hook is registered.

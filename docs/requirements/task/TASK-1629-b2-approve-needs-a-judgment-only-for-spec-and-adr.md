---
id: TASK-1629
type: task
role: plan
title: "B2 approve needs a judgment only for spec and adr; remove the task judge and the AC-quantifiability advisory"
status: archived
priority: medium
phase: "B"
created: 2026-10-23
updated: 2026-10-23
tags: []
parent: PLAN-211
plan: PLAN-211
---
Spec: spec-lean-governance-batch-verbs-judgment-only-at-milestones (read Parts and the AC statements; they are the contract). ADR: adr-ai-decision-standard-four-checks-references-from-excellent. Delete-by-default: remove code, tests and docs that only served the removed behaviour; no compat shim, no flag to bring it back. Update every comment and module CLAUDE.md line naming the old behaviour. judgment_required_types default becomes [spec, adr]; approve for other types never consults review_judgments.

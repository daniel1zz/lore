---
id: TASK-1627
type: task
role: plan
title: "A1 lore bulk: preview/apply batch verbs, draft->deprecated, lore_bulk/lore_done/lore_reject"
status: archived
priority: medium
phase: "A"
created: 2026-10-23
updated: 2026-10-23
tags: []
parent: PLAN-211
plan: PLAN-211
---
Spec: spec-lean-governance-batch-verbs-judgment-only-at-milestones (read Parts and the AC statements; they are the contract). ADR: adr-ai-decision-standard-four-checks-references-from-excellent. Delete-by-default: remove code, tests and docs that only served the removed behaviour; no compat shim, no flag to bring it back. Update every comment and module CLAUDE.md line naming the old behaviour. Reference: Terraform plan/apply, kubectl apply resourceVersion CAS. One BulkLifecycleService in the service layer used by CLI and MCP; each row goes through the existing gated write path (CorpusService.set / done) with expectedVersion = the version read at preview; register the command in the lazy CLI registry and the service in app.ts.

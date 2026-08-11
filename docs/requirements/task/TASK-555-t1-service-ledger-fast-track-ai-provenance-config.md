---
id: TASK-555
type: task
role: plan
title: "T1 service: ledger fast-track + ai_provenance + config keys + vitest"
status: archived
priority: medium
phase: "P1-service"
created: 2026-07-28
updated: 2026-07-29
tags: []
parent: PLAN-109
plan: PLAN-109
links:
  - {id: TASK-582, type: blocks}
---
SPEC-103 M1: CorpusService.create fast-tracks knowledge sub_types assessment/retro/handoff/uat draft→approved in same write (audit details.auto=ledger-fast-track); set() on approved ledger doc applies reset→re-fast-track atomically (both audited). ai_provenance {provider,model,prompt_version} recorded at AIProviderService generation seam into extra. Config workflow.review.ledger_auto_approve (true) + judgment_required_types ([spec,adr]). Covers AC-TIER-1/2/6(provenance write half)/7. Tests red-first.

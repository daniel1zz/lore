---
id: TASK-1234
type: task
role: plan
title: "Claim-scoped corpus guard covers CLI rule/baseline/ac-cite verbs only: MCP rule and AC tools, and ac add/set --cite, are not armed"
status: draft
priority: medium
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"gate-coverage","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"389d9f67-8d32-4079-b23a-246f0c423483"}
---

Residual from slice-2a I2 (fixes #39): the CorpusWriteAuthority is armed on the rule and AC services via the CLI loader; MCP tool construction does not arm it, and ac add/set carrying --cite are not checked against the scope (only the ac cite verb is). Gates are supposed to apply identically on CLI/MCP/HTTP.

**Expected:** The scope guard is armed in the service layer for every adapter and for every write that changes a criterion's cites
**Actual:** An MCP session from a worktree can write rules/cites without a scoped claim; ac add --cite from a worktree skips the scope check

Reported by: agent:main-orchestrator

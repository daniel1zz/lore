---
id: TASK-1295
type: task
role: plan
title: "MCP lore_set and HTTP doc PATCH replace a spec's extra wholesale, so acceptance criteria can be rewritten without any AC gate, lint or version semantics"
status: draft
priority: medium
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"integrity-bypass","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"4e1e6322-a52c-427b-be71-37bbe016e160"}
---

The only service guard on structured extra (findDroppedStructuredExtraField, packages/lore/src/service/corpus-service.ts:298-321) is DROP-only and covers plan.phases, task.claim and task.verification_evidence. It does not cover spec.extra.acceptance_criteria at all, and for the covered fields it does not catch a REPLACED array. MCP lore_set replaces extra wholesale (acknowledged in packages/lore/src/adapters/mcp/tools.ts:165-175 as a pre-existing gap) and the HTTP route passes the request body straight to corpusService.set (packages/lore/src/adapters/http/routes.ts:800). Consequence: an agent on MCP or HTTP can replace or rewrite ACs (statement, verify command, falsifier) and bypass ac add/set validation (quantifiability lint, missing-path refusal, per-spec id uniqueness) and the ac set demotion rule; it can also overwrite evidence arrays with fabricated entries as long as the key stays present. Gates are meant to run in the service layer so every surface is identical; here the service layer itself has no guard. Found by a security review during the baseline slice-1 design (adr-the-product-is-a-baseline-tree-specs-are-implementations); confirmed by reading the code, not yet exploited end-to-end.

**Expected:** corpusService.set refuses (on every surface) any patch that adds, removes or changes a dedicated-writer extra key (acceptance_criteria, verification_evidence, phases, claim, requirements, outline, …) relative to the current version, pointing at the dedicated verb — a replace guard, not a drop guard.
**Actual:** Drop-only guard for 3 keys; acceptance_criteria unguarded; replacement arrays pass.
**Repro command:** `grep -n 'findDroppedStructuredExtraField' -A24 packages/lore/src/service/corpus-service.ts; sed -n 165,175p packages/lore/src/adapters/mcp/tools.ts; sed -n 795,802p packages/lore/src/adapters/http/routes.ts`

Reported by: agent:main-orchestrator

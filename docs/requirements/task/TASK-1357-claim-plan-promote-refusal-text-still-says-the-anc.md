---
id: TASK-1357
type: task
role: plan
title: "task-claim / plan-promote refusal text still says the ancestor spec must be \"approved\" after active counts"
status: draft
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"gate-message","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"e2f6591f-75cb-43f2-9078-644287a163d9"}
---

checkpoint-registry.ts:1266 and :1437 hardcode 'the ancestor spec must be "approved"' in the gate Rule text. UPSTREAM_APPROVED_STATUSES is now {approved, active}, so the message misdescribes the rule.

**Expected:** Refusal text says approved or active
**Actual:** Text says only approved

Reported by: agent:session-66711aa8

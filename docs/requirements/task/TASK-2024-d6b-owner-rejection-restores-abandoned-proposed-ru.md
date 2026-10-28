---
id: TASK-2024
type: task
role: plan
title: "D6b owner rejection restores abandoned proposed rules; MCP assess returns retired ACs"
status: archived
priority: medium
phase: "D"
created: 2026-10-23
updated: 2026-10-26
tags: []
parent: PLAN-211
plan: PLAN-211
---
Resolves #337.

1. An owner rejection of a retired-AC confirmation restores a spec deprecated during the plan exactly: its previous status AND the proposed rule ids its deprecation abandoned (BR-1307, corpus-service.ts planAbandonment). Reverse the abandonment through the same rule-change-landing port, in the same write as the status restore. Remove the "Limit" note in retired-ac-service.ts's header.
2. MCP lore_assess returns retired_acs and pending_decision exactly as the CLI does (one shared serializer, no second shape).

Tests (packages/lore/tests/integration/milestone-review.test.ts, prefix 'milestone review gates close'): a spec with a proposed rule is deprecated during the plan, the owner rejects, the spec is back to its status and the rule is proposed again; MCP lore_assess output carries both fields.

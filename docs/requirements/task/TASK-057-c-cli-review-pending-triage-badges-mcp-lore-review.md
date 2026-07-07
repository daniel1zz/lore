---
id: TASK-057
type: task
role: plan
title: "C CLI review + pending triage badges + MCP lore_review"
status: archived
priority: high
created: 2026-07-06
updated: 2026-07-06
tags: []
parent: PLAN-015
plan: PLAN-015
---
SPEC-034 §4/§6: cli commands/review.ts (single doc + --pending batch, per-doc failure collection, exit 6 only if ALL fail; AI-intent command — SPEC-026 assess precedent: agent-off default does NOT brake, --no-ai exits 2), pending.ts badges ([AI: approve 0.93]/[AI: escalate ✋2Q]/[unreviewed]/stale marker) + --escalated filter showing blocking_questions, MCP lore_review (by required) + lore_pending include_judgments (pre-declared z.object schemas — ADR-tsc-memory), telemetry ai.review event. Integration tests MUST use shared stub-claude helper (extract from assess.test.ts to tests/helpers/stub-claude.ts if not yet done). DEPENDS ON B. Anchors: adapters/cli/commands/review.ts+pending.ts, adapters/mcp/tools.ts.

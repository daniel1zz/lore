---
id: KN-023
type: knowledge
role: knowledge
title: "Assessment: SPEC-033 Implementation — dashboard projection + adjudication (2026-07-06)"
status: draft
priority: medium
created: 2026-07-06
updated: 2026-07-06
tags: []
parent: PLAN-013
links:
  - {id: PLAN-013, type: informs}
---
# Assessment: met (82/100)

Scope: plan `01KWVQG4RCCRRB0224MA1H2BRF`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-33-1 | 86 | index.tsx rewritten to render ResolvedPrdBody (typed React slots, never dangerouslySetInnerHTML) + PendingPanel/ActivePlansPanel/LoopPanel. E2e asserts ChildrenOf visible, zero raw placeholder text. Gap: ready-task panel deferred — ActivePlansPanel self-documents it uses active-plans, not `ready` d… | task-f4-playwright-e2e-acceptance-suite (home renders resolved PRD, zero raw placeholder text), task-f2-home-rewrite-resolved-living-prd-pending-ready-panels-lo |
| AC-33-2 | 72 | mutations.ts wires calibrationNote + warnings[] contract; TriageQueue toasts warnings without treating as failure. F1 claims HTTP calibration-capture e2e + forced-failure warnings; F4 e2e asserts approve creates calibration record via API. Gap: hoist itself, routes.ts, and shared-hook unit-test-fro… | task-f1-backend-calibration-hook-hoist-http-judgment-audit-calib (HTTP calibration capture + forced-failure warnings covered (claimed, not in diff)), task-f4-playwright-e2e-acceptance-suite (dashboard approve creates calibration record) |
| AC-33-3 | 83 | TriageQueue has escalatedOnly checkbox + expandable blocking_questions; JudgmentBadge mirrors CLI formatJudgmentBadge (approve/escalate +NQ/unreviewed/stale). E2e seeds escalate badge + questions + filter. Minor: escalated-only filters to fresh escalations only (excludes stale), a design choice bey… | task-f3-triage-queue-doc-detail-audit-tab-adjudication-ui, task-f4-playwright-e2e-acceptance-suite (pending shows escalate badge + blocking questions + filter) |
| AC-33-4 | 84 | AuditTab uses parseAuditActor (@lore/core) for ai: decoding, renders judge-identity badge + expandable judgment link; wired into DocDetail as new tab. LoopPanel AuditVerifyChip reflects clean/misses/unknown from /api/audit/verify. E2e asserts create→judge→adjudicate chain with ai: actor decoded. | task-f3-triage-queue-doc-detail-audit-tab-adjudication-ui, task-f4-playwright-e2e-acceptance-suite (audit tab shows chain w/ ai: actor decoded) |
| AC-33-5 | 86 | F4: playwright 16/16 passed 3x consecutive; tsc 0 err. F3: +12 vitest + 599 bun. F2: +54 dashboard vitest + 599 bun. F1: vitest + 599 bun. All oracles green per recorder claude-main. Self-reported but the stated acceptance oracle. | task-f4-playwright-e2e-acceptance-suite (16/16 3x + tsc 0 err) |

## Gaps

- ready-task panel deferred: ActivePlansPanel uses active plans, not `ready` data (spec 2.2) — no /api/ready route landed.
- F1 backend (calibration-hook hoist to src/flows, CLI import updates, routes.ts wiring, shared-hook unit test importing hoisted path) is not present in the provided diff — AC-33-2's unit-test proof is claimed but unverifiable here.
- MCP adjudication-tool wiring (spec 2.1 'IF any exist — verify') outcome not evidenced in materials.
- escalated-only filter silently excludes stale escalations, diverging from a literal 'all escalations' reading of spec 2.3.

## Recommendations

- Surface the F1 diff (hoisted flows/calibration-hook.ts, approve.ts/reject.ts import changes, routes.ts, hoisted-path unit test) to close AC-33-2's verification gap.
- Land the /api/ready HTTP route + client fetcher so ActivePlansPanel becomes genuinely ready-aware per spec 2.2.
- Document the MCP adjudication-tool check result (wired or absent) to fully close spec 2.1 scope.
- Confirm escalated-only stale-exclusion matches CLI `lore pending` filter semantics or note the intended divergence.

## Judgment

- Provider: claude-cli
- Prompt version: 2
- Duration: 66874ms
- Retried: false
- Truncated sections: diff:packages/dashboard/CLAUDE.md, diff:packages/dashboard/src/routes/library.tsx, diff:packages/dashboard/tests/component/ActivePlansPanel.test.tsx, diff:packages/dashboard/tests/component/AuditTab.test.tsx, diff:packages/dashboard/tests/component/LoopPanel.test.tsx, diff:packages/dashboard/tests/component/PendingPanel.test.tsx, diff:packages/dashboard/tests/component/ResolvedPrdBody.test.tsx, diff:packages/dashboard/tests/component/TriageQueue.test.tsx, diff:packages/dashboard/tests/component/judgment-badge.test.tsx, diff:packages/dashboard/tests/e2e/global-setup.ts, diff:packages/dashboard/tests/e2e/read-calibration.ts, diff:packages/dashboard/tests/e2e/read-flow.pw.ts, diff:packages/dashboard/tests/e2e/review-loop.pw.ts, diff:packages/dashboard/tests/e2e/seed-judgment.ts, diff:packages/dashboard/tests/e2e/write-flow.pw.ts, diff:packages/dashboard/tests/unit/lib/mutations.test.ts, diff:packages/dashboard/tests/unit/lib/resolved-content.test.ts, diff:packages/lore/src/adapters/cli/CLAUDE.md, diff:packages/lore/src/adapters/cli/commands/approve.ts, diff:packages/lore/src/adapters/cli/commands/reject.ts, diff:packages/lore/src/adapters/http/dashboard-routes.ts, diff:packages/lore/src/adapters/http/routes.ts, diff:packages/lore/src/adapters/mcp/CLAUDE.md, diff:packages/lore/src/adapters/mcp/tools.ts, diff:packages/lore/src/flows/calibration-hook.ts, diff:packages/lore/tests/unit/adapters/http/dashboard-calibration-capture.bun.test.ts, diff:packages/lore/tests/unit/adapters/http/dashboard-routes.test.ts, diff:packages/lore/tests/unit/adapters/http/feedback-loop-routes.bun.test.ts, diff:packages/lore/tests/unit/adapters/http/routes.test.ts, diff:packages/lore/tests/unit/flows/calibration-hook.test.ts
- Reasoning clipped for: AC-33-1, AC-33-2, AC-33-3

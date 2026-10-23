---
id: KN-031
type: knowledge
role: knowledge
title: "Assessment: SPEC-037 Implementation — execution-tracking surface (2026-07-07)"
status: archived
priority: medium
created: 2026-07-07
updated: 2026-10-23
tags: []
parent: PLAN-016
links:
  - {id: PLAN-016, type: informs}
---
# Assessment: met (83/100)

Scope: plan `01KWXXX82EE9C565Q18RHJZ8NQ`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-37-1 | 85 | GET /api/ready/:planIdOrSlug added: matchReadyPath regex + handleGetReady thin pipe to taskWorkflowService.ready, loreErrorResponse/jsonOk, central auth. bun ready-route.bun.test.ts: bearer 200/no-auth 401/cookie 200. No explicit 404/422 test but service maps them. | task-d1-backend-get-api-ready-route |
| AC-37-2 | 92 | ActivePlansPanel: per-plan PlanReadinessSummary own query [home,ready,planId], 'N ready / M tasks', 'no tasks' for empty, 'readiness unavailable' degrade without blanking panel, placeholder badge removed. Component tests cover all four cases. | task-d1-frontend-d2-d3-d5-frontend-execution-visibility-projecti |
| AC-37-3 | 72 | PlanExecution.tsx: rollup 'X/Y tasks done · R ready' (done=archived), phase grouping in declaration order via planExtraSchema, Unphased/Other docs, zero-task plan keeps flat list (hasTaskChildren gate). Implemented but no dedicated PlanExecution.test.tsx in diff. | task-d1-frontend-d2-d3-d5-frontend-execution-visibility-projecti |
| AC-37-4 | 72 | TaskRow reuses TYPE_ACCENT/BORDER, StatusPill, formatTypeMetaLabel, metaBadgeVariant; blocked-by <slug> +n from unmet_blockers; join by record.task.id, missing record degrades. Reuse verified by code; no direct render test for the row. | task-d1-frontend-d2-d3-d5-frontend-execution-visibility-projecti |
| AC-37-5 | 70 | TaskExecution.tsx: claim card (holder/branch/relative time, no client staleness), newest-first evidence timeline, output_tail in <details><pre>, extractClaim/extractEvidence safeParse degrade to null. Correct by inspection but no dedicated TaskExecution.test.tsx shown. | task-d1-frontend-d2-d3-d5-frontend-execution-visibility-projecti |
| AC-37-6 | 88 | metaBadgeVariant returns destructive when task evidence_fail>0, else outline; applied in DocCard, DocDetail header, TaskExecution fail badge. DocCard.test.tsx asserts destructive class present when fail>0 and absent when fail===0. | task-d1-frontend-d2-d3-d5-frontend-execution-visibility-projecti |
| AC-37-7 | 87 | DocTree split: chevron own <button aria-expanded/aria-label> toggles with stopPropagation; title span role=button navigates via onSelect; leaves keep single action; keyboard on both. DocTree.test.tsx 13/13 pass. | task-d4-doctree-toggle-navigate-gesture-split |
| AC-37-8 | 85 | SNIPPET_MARK_OPEN/CLOSE C0 sentinels in core SSOT; SQLite/Turso snippet() params + InMemoryStore fake emit them; SearchHit gains type/status via FTS join; splitSnippetIntoSegments→<mark>, badges added. types.test.ts + bun 'AC-37-8 literal-bracket cases all three stores'. No search-snippet unit test… | task-d5-backend-snippet-sentinels-searchhit-type-status |
| AC-37-9 | 88 | humanizeValidationIssue maps parent_id issue to 'Choose a parent document…' only; others verbatim; core schemas.ts unchanged. TriageQueue Adjudicate→Review, new calibration placeholder. D6 test pins non-parent_id messages pass through verbatim; tsc+vitest pass. | task-d6-copy-de-jargon-triagequeue-newdocmodal |

## Gaps

- No dedicated component test for PlanExecution.tsx (rollup counts, phase grouping/ordering, Unphased/Other-docs) — verified only by passing aggregate suite + typecheck.
- No dedicated component test for TaskExecution.tsx (claim card, newest-first timeline, malformed-extra degrades-to-null AC-37-5 wording) shown in diff.
- No unit test for splitSnippetIntoSegments (unterminated-marker/empty-string edge cases described in doc but not asserted in the provided diff).
- Ready route 404 (unknown plan) and 422 (non-plan target) status mappings are asserted only indirectly via the service; the added bun test covers auth cases (200/401), not the error-code-to-status paths.

## Recommendations

- Add PlanExecution and TaskExecution component tests covering phase ordering, done=archived rollup, blocked-by indicator, and safeParse degradation to lock the render contracts.
- Add a search-snippet unit test for the unterminated-open-marker and empty-string invariants documented in the module.
- Add ready-route tests asserting 404 for unknown plan and 422 for a non-plan target to pin the error-code→status contract from SPEC-037 §2.

## Judgment

- Provider: claude-cli
- Prompt version: 2
- Duration: 55762ms
- Retried: false
- Truncated sections: spec, diff:.lore/export-index.json, diff:docs/requirements/plan/PLAN-016-spec-037-implementation-execution-tracking-surface.md, diff:docs/requirements/prd/PRD-001-lore-positioning.md, diff:docs/requirements/task/TASK-063-d1-frontend-d2-d3-d5-frontend-execution-visibility.md, diff:docs/requirements/task/TASK-064-d4-doctree-toggle-navigate-gesture-split.md, diff:docs/requirements/task/TASK-065-d1-backend-get-api-ready-route.md, diff:docs/requirements/task/TASK-066-d5-backend-snippet-sentinels-searchhit-type-status.md, diff:packages/dashboard/tests/component/DocDetail.test.tsx, diff:packages/dashboard/tests/component/DocTree.test.tsx, diff:packages/dashboard/tests/component/NewDocModal.test.tsx, diff:packages/dashboard/tests/component/PlanExecution.test.tsx, diff:packages/dashboard/tests/component/SearchResultCard.test.tsx, diff:packages/dashboard/tests/component/TaskExecution.test.tsx, diff:packages/dashboard/tests/component/TriageQueue.test.tsx, diff:packages/dashboard/tests/e2e/review-loop.pw.ts, diff:packages/dashboard/tests/unit/lib/api.test.ts, diff:packages/dashboard/tests/unit/lib/doc-badge-variants.test.ts, diff:packages/dashboard/tests/unit/lib/format-relative-time.test.ts, diff:packages/dashboard/tests/unit/lib/search-snippet.test.ts, diff:packages/dashboard/tests/unit/lib/type-meta-label.test.ts, diff:packages/lore/tests/unit/adapters/http/ready-route.bun.test.ts, diff:packages/lore/tests/unit/adapters/http/routes.test.ts, diff:packages/lore/tests/unit/store/in-memory-store.test.ts, diff:packages/lore/tests/unit/store/sqlite-store.bun.test.ts, diff:packages/lore/tests/unit/store/turso-store.bun.test.ts
- Reasoning clipped for: AC-37-8

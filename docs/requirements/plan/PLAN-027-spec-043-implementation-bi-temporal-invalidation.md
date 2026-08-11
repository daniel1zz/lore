---
id: PLAN-027
type: plan
role: plan
title: "SPEC-043 Implementation — bi-temporal invalidation"
status: archived
priority: high
created: 2026-07-11
updated: 2026-07-12
tags: [spec-043, validity, implementation]
parent: SPEC-043
---
# PLAN — SPEC-043 implementation: bi-temporal invalidation

Two serial worktree tasks (T2 depends on T1's core/service APIs; SPEC-041/042 precedent).
11 script ACs runner-attested post-merge via lore verify; AC-MH-11 (human) owner-executed
per D12 — plan stays active until owner records it.

## T1 — core + services (AC-MH-1..6, 10, 12)
@lore/core: validity.ts (schema + isInvalidated + effectiveValidAt), knowledge/adr extra
validity key, ADR superRefine issue-forwarding fix (D10/S1), SearchHit created_at+validity
extension. Services: ValidityService (new; pinned write ordering + idempotent link repair +
undo with structured decision_status_unchanged), CorpusService (search/list filter + now
seams + include_invalid + D10 set-guard + SearchHit SQL in SQLite/Turso/InMemory stores),
OutlineService (RecentDecisions/RelatedOf filter-before-slice, Embed degrade, includeInvalid,
now seam), feed-flow banner, review-template Staleness Notice, status warning via shared
SessionService armed-gate helper, app.ts wiring.

## T2 — adapters + docs (AC-MH-7, 8, 9, 13)
CLI: invalidate command, create --supersedes orchestration (loud orphan half-failure UX),
--include-invalid flags, [invalid] badges (search/list/tree), projection banner splice at
get non-raw + export-docs. MCP: lore_invalidate, lore_get validity_state,
lore_create.supersedes, include_invalid params (tools 28→29). Docs: CLAUDE.md SPEC-043
entry. Repairs any T1-deferred adapter compile breaks.

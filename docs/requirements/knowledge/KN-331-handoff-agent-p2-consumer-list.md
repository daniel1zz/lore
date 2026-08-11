---
id: KN-331
type: knowledge
role: knowledge
title: "Handoff — agent:p2-consumer-list"
status: archived
priority: medium
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: PLAN-103
---
# Handoff — agent:p2-consumer-list

## Plan

01KYPTG5

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| Judgment | Confidence |
|---|---|
| P1 (archived 01KYPTNR) added linkTypeSchema+D1b validation for 'resolves' but never widened the SQLite links.link_type CHECK past migration-004's set — verified: CorpusService.link(...,'resolves',...) on a real SQLiteStore fails STORE_ERROR/SQLITE_CONSTRAINT_CHECK errno 275 | 100 |
| This task's D6 needs link-table + source-doc-status reads on the UPSTREAM corpus, only reachable via UpstreamPort (flows/upstream-context-flow.ts) which exposes doc-status only — D6 is not implementable inside the declared 3-file anchor set | 90 |

## Failing Oracle

(none)

## Next Steps

- New migration (mirror migration-004.ts governs pattern): widen links.link_type CHECK to include 'resolves' + bump LATEST_SCHEMA_VERSION + sqlite-store.ts runMigrations branch + TursoStore equivalent. Blocks every resolves-edge consumer plan-wide (this task's AC-ICL-7, P3's AC-ICL-8)
- Add 'resolves' to adapters/cli/commands/link.ts's hardcoded VALID_LINK_TYPES array (rejects 'lore link --type resolves' at the CLI layer, exit 2, independent of the DB gap above)
- Expand this task's file anchors to include flows/upstream-context-flow.ts (add UpstreamPort.getResolution(id): store.findLinks(id,'in') filtered to link_type=resolves + per-source-doc status + the issue doc's own extra) and service/issue-resolution.ts (export a resolution-reason reader; only the STATE is reachable today, not the REASON string)
- After D6 lands, update tests/unit/service/issue-report-cross-corpus.bun.test.ts AC-072-10 line ~687 (expect(rejectedRow?.status).toBe('draft')) — a plain 'lore reject' with no resolves edge/no explicit issue-resolve state now computes 'open', not 'draft'; intentional semantics change, assertion needs updating
- Then write tests/e2e/issue-consumer-list.bun.test.ts (AC-ICL-7) using the twin-corpus convention from tests/unit/service/issue-report-cross-corpus.bun.test.ts

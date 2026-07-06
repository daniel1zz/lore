---
id: TASK-048
type: task
role: plan
title: "T3 text-projection splice: revive resolve_mdx + renderResolvedToMarkdown + consumers"
status: archived
priority: high
phase: splice
created: 2026-07-06
updated: 2026-07-06
tags: []
parent: PLAN-012
plan: PLAN-012
---
AC-3/AC-4/AC-7 (SPEC-032 §3.3). (1) Revive CorpusService.get() dead _opts param: resolve_mdx=true → call OutlineService.resolve(), populate resolved_components. (2) OutlineService new pure export renderResolvedToMarkdown(resolved): splice by position descending (offsets stable, non-overlapping); ChildrenOf → '- [type] title (status)' list etc. (3) Consumers: cli get.ts non-raw prints spliced; export-docs-service.ts writes spliced .md body; export drift detection stays clean. MUTEX: touches corpus-service.ts (after T1 merged). Anchors: packages/lore/src/service/corpus-service.ts, outline-service.ts, export-docs-service.ts, packages/lore/src/adapters/cli/commands/get.ts. Oracle: round-trip regression (raw tag in → rendered list out); lore get <prd> shows §5 as tree; export .md shows rendered tree.

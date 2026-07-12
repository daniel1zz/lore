---
id: TASK-116
type: task
role: plan
title: "T2 adapters + docs — status.ts restructure with check-drift, anchor dispatch, code-anchor flag, drift-flow, MCP first-schema, projection, CLAUDE.md"
status: archived
priority: high
created: 2026-07-12
updated: 2026-07-12
tags: [spec-045, t2]
parent: PLAN-029
plan: PLAN-029
---
Implements SPEC-045 D5, D6 (CLI half), D7, D10, D11 → ACs AC-DR-4,5,6 (AC-DR-9 stays human/owner).

Deliverables:
- status.ts RESTRUCTURE — the --check-tree branch becomes value-returning (no early process.exit) so --check-drift composes. Exit precedence pinned: any drift found (either check) → 3; else blueprint missing/invalid → 4; else 0.
- Drift rows: `spec-slug → anchor (kind)` + literal repair hint `fix: lore anchor rm <spec> <anchor> (or update the path/export)`. Deterministic ordering (spec_slug, then anchor). symbol_missing footnote lists the documented FP forms.
- --json emits data.code_drift {armed, enabled, consistent, specs_checked, status_breakdown, drifts[]}. Plain `lore status` prints a store-only "code anchors declared: N specs" line (zero probing). Real FsProbe (node:fs sync, repo root = process.cwd()) built in the adapter.
- `lore anchor add/rm/list` resolve-then-dispatch: task → TaskWorkflowService (byte-identical REGRESSION); spec → DriftCheckService; other types → VALIDATION_ERROR exit 4 naming "task or spec".
- `lore create spec --code-anchor` repeatable (distinct flag; task --anchor rejects `#` loud).
- flows/drift-flow.ts shared payload builder (single derivation site).
- MCP: lore_status gains check_drift?: boolean — FIRST input schema for this tool; migrate registration off the argless 3-arg form; argless calls byte-identical (REGRESSION). lore_anchor_set spec target = declarative REPLACE with the divergence documented in the tool description. lore bootstrap gains store-only code_anchor_specs count (shared helper). Tool count stays 30.
- Projection: Code anchors list spliced via renderResolvedToMarkdown (SPEC-032 seam — vitest-testable; get.ts stays bun-only).
- D11: append one advisory rule line to corpus doc knowledge-write-spec-rules-gate-feeding-source via lore CLI (cwd = main repo).
- CLAUDE.md root SPEC-045 entry + cli/mcp/service module CLAUDE.md updates.

Oracles: bun test cli-drift.bun.test.ts (ONE mkdtemp corpus, PRD seeded first, sequential mutations, spawn-budget discipline) + vitest mcp-drift / spec-projection-anchors + full suites + typecheck; rebuild the worktree binary before bun suites. ABSOLUTE worktree paths; checkpoint-commit after each coherent unit.

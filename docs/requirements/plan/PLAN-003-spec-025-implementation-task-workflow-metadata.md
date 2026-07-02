---
id: PLAN-003
type: plan
role: plan
title: "SPEC-025 Implementation — Task Workflow Metadata"
status: active
priority: medium
created: 2026-07-02
updated: 2026-07-02
tags: [spec-025, workflow, bootstrap-dogfood]
parent: SPEC-025
phases:
  - {name: "implement", description: "Core module + schemas + store batch query + service + CLI + MCP per spec 8.1"}
  - {name: "tests", description: "Six-dimension coverage per spec 7"}
  - {name: "closeout", description: "Rebuild, dogfood backfill, export-docs, verification, commit"}
---
# Plan: SPEC-025 Task Workflow Metadata Implementation

Executes SPEC-025 (design ratified 2026-07-02 after 4-perspective module review). Tracked on Lore itself; per spec §9, this plan is also the first real consumer of the features it delivers — tasks get claimed/evidenced with the new commands once they land.

## Phases
1. **implement** — core pure module, schema changes (incl. task_status removal), store batch query, TaskWorkflowService, CLI commands + badges, MCP tools (spec §8 file touch list).
2. **tests** — six-dimension coverage per spec §7 (sequential-CAS recipe, TTL boundary, 51-entry boundary, legacy task_status regression).
3. **closeout** — rebuild binary, dogfood backfill (claim/evidence on this plan's own tasks), export-docs, full verification, commit.

## Acceptance
AC-WF-1..13 from SPEC-025 §4. Both runners + typecheck green.

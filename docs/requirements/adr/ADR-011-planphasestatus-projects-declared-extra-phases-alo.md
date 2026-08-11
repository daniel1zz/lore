---
id: ADR-011
type: adr
role: decision
title: "planPhaseStatus projects declared extra.phases alongside SPEC-056 phase docs"
status: approved
priority: medium
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PRD-001
links:
  - {id: TASK-315, type: informs}
  - {id: TASK-314, type: informs}
---
## Context

`GET /api/phase-status/:plan` (SPEC-077 S3) pipes `PhaseWorkflowService.planPhaseStatus`, which projects only SPEC-056 phase DOCUMENTS — a migration-created-only type. Plans authored normally declare phases as `plan.extra.phases[]` (`lore phase add`, SPEC-023) with tasks carrying `extra.phase`. For every such plan the dashboard's Phase Progress panel is permanently empty, contradicting `lore tree`, `lore phase list`, and the plan doc itself (dogfood 2026-07-26 ISSUE-007).

## Decision

`planPhaseStatus` projects BOTH phase representations, additively:

- Phase docs (SPEC-056) keep their existing scorecard shape unchanged (checklists, trust, AC rollups).
- Declared phases (`extra.phases[]`) with no corresponding phase doc are projected as declared-phase scorecards: phase title, task counts by `extra.phase` grouping, evidence pass/fail rollup, and AC-coverage rollup derived from the same core helpers the evidence panel uses — no checklist section (declared phases have none).
- The response marks each entry's provenance (`source: "phase-doc" | "declared"`) so clients render honestly. API change is additive; existing consumers of phase-doc entries see identical fields.

## Consequences

- The Execution page shows real phase progress for normally-authored plans; the empty state is reserved for plans with genuinely no phases.
- SPEC-077's S3 as-built pin must be updated alongside (spec is a living snapshot), and the e2e fixture extended with a declared-phases plan.

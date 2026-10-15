---
id: BASE-089
type: baseline
role: intent
title: "Module card: service"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: BASE-079
links:
  - {id: SPEC-001, type: supersedes}
---
# Module card: service

Source: `packages/lore/src/service/CLAUDE.md`.

- **Responsibility**: business logic — corpus CRUD, review, versions, outline, migration, tree check, task/phase workflow, AC-as-code, baseline rules, gates, audit, setup, sessions (~25 stateless services plus store-less pure modules).
- **Public surface**: service classes composed in `app.ts` (`CorpusService`, `ReviewService`, `TaskWorkflowService`, `AcService`, `RuleService`, `GateEnforcer`, ...); every public method returns `Promise<Result<T, LoreError>>`. Shared pure modules (`gate-predicates.ts`, `ac-write-chokepoint.ts`, `plan-membership.ts`) are imported, never duplicated.
- **Dependencies**: `@lore/core`, `StoreInterface` (never a concrete store). Documented exception: `TaskWorkflowService` and `SessionService` import leaf IO ports under `adapters/*-port.ts`.
- **Invariants**:
  - Stateless; all state in the store.
  - Gates run here (`GateEnforcer.enforce`) so CLI/MCP/HTTP are gated alike; `LORE_GATE_BYPASS` is never honoured on a write path.
  - Every write touching `extra.acceptance_criteria` passes `ac-write-chokepoint.ts`.
  - Editing an approved doc's content demotes it to draft (ledger knowledge sub-types re-fast-track).
  - `lore done` walks four independent fail-closed floors.

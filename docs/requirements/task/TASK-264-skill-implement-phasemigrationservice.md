---
id: TASK-264
type: task
role: plan
title: "[Skill:implement] PhaseMigrationService"
status: archived
priority: critical
phase: "Phase 3: Adapters and migration"
created: 2026-07-19
updated: 2026-07-19
tags: []
parent: PLAN-068
plan: PLAN-068
links:
  - {id: TASK-260, type: blocks}
---
Estimate: M
Approach: PhaseMigrationService per D6/D6a — raw store.insert bounded bypass + audit rows + version snapshots; markers migrated_from/migrated_to; claim precedence newest-fresh-wins with displaced holders -> track notes; evidence origin markers preserve per-source caps
Source: spec-spec-056 D6/D6a
Dimensions: D-FUNC, D-DATA
Scope-Alt: none — every edge rule is AC-bound
Covers: AC-P-5
AC:
- Given T9 RED suite, When implemented, Then AC-P-5 command exits 0

## Consumer call sites (spike output) + fixture pointer

Grep sweep run 2026-07-19 by task-skill-research-migration-shape-spike-read-only-corpus-copy
against the live repo tree (read-only; no writes). This task owns the
migration-specific subset (D6/D6a edge rules, source-task enumeration,
raw-insert precedent). The service/core-layer rename subset lives on
`task-skill-implement-phaseworkflowservice-rename-checkpoint-conf`; the
CLI/MCP-surface subset lives on `task-skill-implement-cli-mcp-surfaces-checklist-ref-evidence`.

### Fixture seed (this spike's primary deliverable for this task)
`packages/lore/tests/fixtures/phase-migration/seed.json` (+ `live-corpus-census.json`
+ `README.md` in the same directory) — a 3-plan/13-task DocRecord-shaped fixture
covering all 8 distinct `extra`-key signatures found in the live corpus PLUS the
4 synthesized edge-case scenarios AC-P-5 explicitly requires (none of which exist
in the live corpus today — see the README's comparison table): `legacy_phase`
residue, a multi-claim collapse group (older holder displaced → `track` note;
newer holder wins), merged evidence exceeding the 50-cap (20+35=55, each entry
must gain `origin` and NEVER be truncated), and two independent empty-declared-phase
instances. `seed.json`'s `scenario_index` array maps every task/plan slug to its
edge rule and expected post-migration outcome — use it directly as the RED-suite's
input fixture and assertion checklist.

### Precedent to mirror (D6a: "raw `store.insert` bypass, MigrationService precedent")
- `packages/lore/src/service/migration-service.ts` — the EXISTING v1→v2 one-shot
  migration service. `:119` — its `{type, role}` mapping table (`task: {type: "task", role: "plan"}`
  — same `DOC_TYPE_ROLE_MAP` value the new phase migration must use for `type: "phase"`).
  `:694` — `if (mapping.type === "task")` branch. Study this file's overall shape
  (dry-run flag, raw insert bypassing `CorpusService.create`'s normal validation/gate
  path, audit rows, idempotency markers) as the STRUCTURAL precedent for
  `PhaseMigrationService.migrateTasks({dryRun})` — D6a explicitly cites it as
  "bounded bypass, documented", i.e. the same deliberate un-gated path (no
  `phase-create` checkpoint exists to gate against), not a new pattern.

### Source-task enumeration (what the migration reads before it writes)
- `packages/lore/src/service/corpus-service.ts:1607,1639` — `getPlanBundle` /
  `store.findMany({parent_id: plan.id, type: "task"})` — the query shape to reuse
  for "give me every task under this plan" during a migration dry-run
- `packages/lore/src/service/session-service.ts:205-231` — SPEC-042 session
  derivation over `d.type === "task"` — study for the exact `TaskClaim` freshness
  check (`isClaimStale`) the migration's "newest fresh claim wins" rule (P7) must
  reuse, not re-derive
- `packages/lore/src/service/ac-service.ts:293` — same `findMany({parent_id, type:"task"})`
  shape, for reference

### Shape validation this task's schema work must satisfy
- `packages/core/src/schemas.ts:431,482` — `createDocInputSchema` superRefine:
  task requires `parent_id` + `extra.plan_id`. The migrated PHASE doc's schema
  (owned by the P1 core-contracts task, `phase.ts`) inherits an equivalent
  contract — this task's `PhaseMigrationService` must satisfy it via raw insert
  (bypassing the superRefine gate per D6a, but the RESULTING row must still be
  schema-VALID, i.e. `phaseExtraSchema.parse()` should succeed on migration output
  even though the write path skipped `CorpusService.create`)
- `packages/core/src/task-workflow.ts` — `evidenceEntrySchema`/`taskClaimSchema` —
  the SOURCE shapes being merged; the DESTINATION phase doc's evidence array must
  still validate against `evidenceEntrySchema` PLUS the new optional `origin` field
  (additive — confirm with the P1 core-contracts task whether `origin` is added to
  `evidenceEntrySchema` itself or lives as a migration-only sidecar; the fixture's
  `scenario_index` assumes it lands on the SAME evidence entry shape per D6's wording
  "each merged evidence entry gains `origin: taskId`")

### Config the migrated phase docs' gate checks read (informs D6a's audit/version bookkeeping)
- `packages/core/src/config.ts:420-459` — `resolveGateEnabled`/`resolveAnchorOverlapGateEnabled`
  reading `workflow.gates."task-claim"` — post-migration, the SAME phase docs are
  gated under `"phase-claim"` (D7 rename); this task does not own the alias itself
  (that's the PWS-rename task) but must be aware the migrated docs will immediately
  be subject to the renamed checkpoint on their first post-migration claim attempt

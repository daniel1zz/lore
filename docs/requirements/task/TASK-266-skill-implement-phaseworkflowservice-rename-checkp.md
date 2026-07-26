---
id: TASK-266
type: task
role: plan
title: "[Skill:implement] PhaseWorkflowService rename + checkpoint/config alias"
status: archived
priority: critical
phase: "Phase 2: Services"
created: 2026-07-19
updated: 2026-07-19
tags: []
parent: PLAN-068
plan: PLAN-068
links:
  - {id: TASK-261, type: blocks}
  - {id: TASK-262, type: blocks}
---
Estimate: L
Approach: rename TaskWorkflowService -> PhaseWorkflowService scoped to claim/release/evidence/ready; checkpoint registry key rename + read-side config alias (ONE dual-read site); thread consumer renames per the T3 grep list (getPlanBundle field, assessPlan, resolveTargetTask)
Source: spec-spec-056 D2/D7 + PRD §18 P1 consumer list
Dimensions: D-FUNC, D-CODE
Scope-Alt: legacy READ tolerance may render minimal badge text if full parity is costly
Covers: AC-P-3, AC-P-6
AC:
- Given T4 RED suites, When implemented, Then AC-P-3 command exits 0
- Given task-era suites, When run, Then green under legacy READ tolerance with zero write-path changes
Integration:
- lore claim/release/evidence/ready function end-to-end against a phase doc in a throwaway corpus (manual smoke command in evidence)

## Consumer call sites (spike output)

Grep sweep run 2026-07-19 by task-skill-research-migration-shape-spike-read-only-corpus-copy
against the live repo tree (read-only; no writes). This task owns the
service/core-layer + gate/config rename scope (claim/release/evidence/ready
mechanics + checkpoint/config alias); the CLI/MCP-surface subset lives on
`task-skill-implement-cli-mcp-surfaces-checklist-ref-evidence`; the
migration-specific subset lives on `task-skill-implement-phasemigrationservice`.

### `TaskWorkflowService` symbol + its DI wiring (rename target)
- `packages/lore/src/service/task-workflow-service.ts` — the file/class itself. Rename to `PhaseWorkflowService`; scope stays claim/release/evidence/ready ONLY per D2 (checklist/track split to `PhaseChecklistService`, a separate new file).
- `packages/lore/src/app.ts:56` — `import { TaskWorkflowService } ...`
- `packages/lore/src/app.ts:113-117` — `App.taskWorkflowService: TaskWorkflowService` field (rename to `phaseWorkflowService`, likely keep as the field name consumers bind to — confirm naming with `AcService`/`PhaseChecklistService` precedent)
- `packages/lore/src/app.ts:338-450` (`buildAppFromSqlite`) and `:534-638` (Turso variant) — BOTH composition constructors instantiate `new TaskWorkflowService(...)` and bind `taskWorkflowService.recordVerifiedEvidence`; the rename touches both paths identically
- `packages/lore/src/adapters/mcp/tools.ts` — imports/uses `app.taskWorkflowService`
- `packages/lore/src/adapters/cli/commands/evidence.ts`, `claim.ts`, `ready.ts`, `anchor.ts` — `app.taskWorkflowService.*` calls (CLI surface — cross-ref the CLI/MCP task for the exact call sites, this task only needs to keep the service's public method names stable through the rename)
- `packages/lore/src/adapters/http/routes.ts` — dashboard write routes bound to `taskWorkflowService`
- `packages/lore/src/service/gate-enforcer.ts`, `verify-runner-service.ts`, `audit-service.ts`, `drift-check-service.ts`, `validity-service.ts`, `review-service.ts`, `corpus-service.ts` — all reference `TaskWorkflowService` in JSDoc/type positions (DI shape precedent comments); update doc comments, not necessarily runtime code
- `packages/core/src/task-workflow.ts`, `schemas.ts`, `file-anchors.ts`, `acceptance.ts`, `telemetry.ts`, `config.ts` — `@lore/core` side: schemas/types this service consumes (`TaskClaim`, `EvidenceEntry`, `ORACLE_KINDS`, etc. — SCHEMA SHAPES CARRY OVER UNCHANGED per D1/P1, only the service class + doc type move)

### `doc.type === "task"` literal checks (core query/validation semantics — will become `"phase"` post-migration, with legacy READ tolerance kept per D2)
- `packages/lore/src/service/corpus-service.ts:499` — `_createImpl`: `data.type === "task" && resolvedParentId !== null` (parent-type + `plan_id` validation gate)
- `packages/lore/src/service/corpus-service.ts:587` — create-time `extra` shaping branch
- `packages/lore/src/service/corpus-service.ts:1076` — `set()`: `existing.type === "task" && parsedPatch.data.extra !== undefined` (SPEC-042 cross-validation on phase/anchors patch — must extend to `"phase"` docs)
- `packages/lore/src/service/corpus-service.ts:1639` — `getPlanBundle`: `store.findMany({parent_id: plan.id, type: "task"})` — THE core query bundling reads (see `getPlanBundle().tasks` section below)
- `packages/core/src/schemas.ts:431` — `createDocInputSchema` superRefine: `(type === "spec" || type === "task") && !parent_id` → parent required (phase inherits: parent plan, required)
- `packages/core/src/schemas.ts:482` — `type === "task"` → `extra.plan_id` required
- `packages/core/src/assessment.ts:174` — `planBundleSchema`: `type: z.enum(["plan", "task"])` structural check — needs a `"phase"` member (additive, keep `"task"` for legacy-read fixtures per AC-P-6)
- `packages/lore/src/service/session-service.ts:205,231,662` — SPEC-042 session derivation: `d.type === "task" && d.parent_id === plan.id` (plan-scoped) and corpus-wide active-sessions variant + `store.findMany({type: "task", parent_id: planDoc.id})`
- `packages/lore/src/service/ac-service.ts:293` — `computeAcCoverage` input: `store.findMany({parent_id: plan.id, type: "task"})`
- `packages/lore/src/service/outline-service.ts:789,816` — MDX placeholder resolution: `store.findMany({type: "task", parent_id: plan.id})`
- `packages/lore/src/service/export-docs-service.ts:926` — `doc.type === "task" && typeof doc.extra["plan_id"] === "string"` (reverse-sync frontmatter mapping)
- `packages/lore/src/service/gate-predicates.ts:84` — `parentLegal({ type: "task" })` JSDoc example
- **NAMING COLLISION WARNING**: `packages/lore/src/service/phase-service.ts` ALREADY EXISTS (SPEC-023, `lore phase add/list/rm/rename` — plan.extra.phases CRUD, a completely different concept from the new phase DOC TYPE). Its `:366` also does `store.findMany({parent_id: planId, type: "task"})`. This file is NOT a rename target, but the new `phase-workflow-service.ts` filename sitting next to `phase-service.ts` needs a clear naming distinction for the next reader — flag this in the PR/review, do not silently ship two near-identically-named files with unrelated responsibilities.
- `packages/lore/src/service/migration-service.ts:119,694` — the EXISTING v1→v2 `MigrationService`'s own `{type:"task", role:"plan"}` mapping — distinct system (v1 markdown import), same doc-type literal; also the "raw `store.insert` bypass" pattern precedent D6a cites for `PhaseMigrationService`.
- `packages/lore/src/eval/scenarios/type-distribution.ts:89` — `{type: "task", min: 0}` eval scenario assertion

### `getPlanBundle().tasks` consumers
- `packages/lore/src/service/corpus-service.ts:1607` — `getPlanBundle` itself (owns `.tasks` field population)
- `packages/lore/src/service/ai-provider-service.ts:619,625` — `assessPlan(bundle, ...)` reads `bundle.tasks` for AC-coverage/evidence rendering
- `packages/lore/src/ai/assess-template.ts:346,581` — `buildAssessPromptV6` renders `bundle.tasks[]` into the judge prompt (`{plan, spec?, tasks[]}`)
- `packages/lore/src/service/verify-runner-service.ts:144-168,219` — injected `getPlanBundle` port → `bundle.tasks` → feeds `resolveTargetTask`
- `packages/lore/src/service/gate-enforcer.ts:93-97` — `GateDependencies.getPlanBundle` port signature (constructor-injected into TaskWorkflowService/ReviewService)
- `packages/lore/src/service/checkpoint-registry.ts:660-702` — `tasks[]` from `getPlanBundle` consumed by `feedTaskClaim`/the anchor-overlap predicate (sibling task enumeration)
- `packages/lore/src/service/task-workflow-service.ts:993,1020,1034` — `this.gate.getPlanBundle(task.parent_id)` → sibling-claims anchor-overlap check (the `task-claim` gate's core read)
- `packages/lore/src/service/review-service.ts:84-143` — `this.gate.getPlanBundle(doc.id)` (`plan-promote` checkpoint: spec approval + AC status via sibling tasks)
- `packages/lore/src/app.ts:171,331-370,441-449,532-637` — BOTH constructors wire `{enforcer, getPlanBundle}` into `GateEnforcer`'s bundle AND `VerifyRunnerService`'s 3rd port — 4 distinct bind sites × 2 constructors = 8 total

### `resolveTargetTask`
- `packages/core/src/task-workflow.ts` — pure fn definition (explicit `--task` override > unique fresh claim > loud ambiguity error); composes `extractClaim`/`isClaimStale`
- `packages/lore/src/service/verify-runner-service.ts` — calls it to pick the AC-verification target when `--task`/`--ac` disambiguation is needed
- (CLI `verify.ts` / MCP `lore_verify` threading of the `--task` override lives on the CLI/MCP task)

### `workflow.gates."task-claim"` config key + checkpoint registry (D7 rename + alias)
- `packages/core/src/config.ts:180,420-459` — `resolveGateEnabled`/`resolveAnchorOverlapGateEnabled` read the literal `"task-claim"` key. D7: canonical key becomes `"phase-claim"`; `"task-claim"` becomes a READ-SIDE ALIAS with exactly ONE deprecation warning logged per process — **this is the one dual-read site**, do not scatter alias logic across callers.
- `packages/lore/src/service/checkpoint-registry.ts:109,752,764` — `checkpointRegistry` map key `"task-claim"` + the `CHECKPOINT_IDS` tuple type
- `packages/lore/src/adapters/cli/commands/gate.ts:333-366,564-646` — CLI `lore gate task-claim` subcommand registration + its `getPlanBundle`-based sibling-task read
- `packages/lore/src/service/task-workflow-service.ts:1025,1040` — `this.gate.enforcer.isEnabled("task-claim")` / `.enforce("task-claim", {...})` — the actual gate invocation inside `claim()`
- `packages/lore/src/service/task-workflow-service.ts:220,689,732` — `rejectHashInTaskAnchors` (SPEC-045 anchor-grammar split: task/phase anchors reject `#Symbol`, spec anchors allow it) — rename/generalize alongside the service, semantics unchanged

### Anti-goal reminder for this task
Per D1/P1: Zod SCHEMA SHAPES for claim/evidence/anchors carry over UNCHANGED (SPEC-025/042 semantics, one level up) — only the SERVICE SURFACE and the doc-type literal move. Do not re-derive `TaskClaim`/`EvidenceEntry`/`ORACLE_KINDS` shapes; import them from `@lore/core` as-is.

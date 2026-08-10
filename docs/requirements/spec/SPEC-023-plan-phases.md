---
id: SPEC-23
type: spec
role: spec
title: "plan.phases as a first-class grouping layer"
status: approved
priority: medium
created: 2026-06-30
updated: 2026-07-14
tags: [plan, task, schema, tree, phase, ux, phase-10, stub]
parent: PRD-001
---
# SPEC-023: `plan.phases` as a first-class grouping layer

> **Status: stub.** Born from a dogfood session on 2026-06-30 where building a 12-task plan revealed lore intentionally dropped the docman phase layer, leaving only `plan.extra.phase: string` as a soft tag with no tooling support.

## 1. Purpose

lore v2 deliberately flattened the docman `plan → phase → task` hierarchy to `plan → task` (`doc-type-rules.ts:18` → `task: ["plan"]`). The `plan.extra.phase` field exists in `planExtraSchema` (`schemas.ts:94-98`) but is just an optional string with no schema-enforced semantics.

When a plan grows beyond ~5 tasks, the absence of native grouping bites:

- `lore tree <plan>` is a flat list — no visual "Track A" / "Track B" separation.
- `lore list --plan-id <plan>` cannot filter by phase.
- Authors fall back to title prefixes (`"A1: ..."`, `"Track B · "`) — string-stringly typed and invisible to tooling.

Two design directions exist:

1. **Extra-only**: keep current `plan.extra.phase: string` but add tooling (`lore tree --group-by-phase`, `lore list --phase <name>`). Zero schema changes.
2. **Phase as entity**: add a new doc type `phase` between plan and task. `doc-type-rules.ts` becomes `task: ["phase", "plan"]` (or `task: ["phase"]` with strict enforcement). Heavier but native.

This SPEC stub picks the direction (recommendation below) and lists the design decisions.

## 2. Goals & Non-Goals

### 2.1 Goals (assuming Option A — extra-only enrichment)

- `planExtraSchema` extended: `phases?: Array<{ name: string, description?: string }>` — declared explicitly on plan.
- `taskExtraSchema` extended: `phase?: string` — optional, must match one of plan's `phases[].name`.
- `lore tree <plan>` groups tasks under phase headers when plan has phases declared; falls back to flat list otherwise.
- `lore list --type task --phase <name> --plan-id <plan>` filters by phase.
- `lore create task --phase <name>` writes `extra.phase`.
- `CorpusService` validates `task.extra.phase` against parent plan's `extra.phases[].name` — task with unknown phase rejected with VALIDATION_ERROR.
- Backwards compat: plans without `extra.phases` continue to work unchanged; tasks without `extra.phase` accepted on any plan.
- Six-dimension test coverage.

### 2.2 Non-Goals

- ❌ **New `phase` doc type** (Option B). The cost-benefit of a full entity (its own ID, audit trail, versioning) does not pay off for what is essentially a label on tasks.
- ❌ **Phase as a parent in `doc-type-rules`** — tasks remain `["plan"]` children. Phase is a soft grouping, not a parent edge.
- ❌ **Cross-plan phase reuse** — `extra.phases` is local to one plan. "Phase library" is out of scope.
- ❌ **Phase status / lifecycle** — phase is not a doc, has no status, no history.
- ❌ **Auto-create phases from task `extra.phase` writes** — phases must be explicitly declared on the plan first; out-of-band `extra.phase` is rejected. Loud failure.
- ❌ **MCP / HTTP changes** — CLI-only for v1; subsequent SPEC adds adapter surface.

## 3. Open Design Questions

### Q1 — Option A (extra-only) vs Option B (new entity)?

Option A pros: tiny diff, no doc-type-rules ripple, no migration.
Option A cons: phase has no ID; can't be linked to from outside; no version history.

Option B pros: phase is a real doc, can be tagged/linked/versioned.
Option B cons: requires migration (every existing plan needs its phases extracted as new docs); doubles the schema mass; doc-type-rules cycle risk (plan → phase → task; future "phase blocks phase"?).

**Recommendation**: Option A. The cost of B is large and the value is small — phases are organisational glue, not domain entities. The few places that genuinely need a stronger entity (cross-plan dependencies?) are vanishingly rare; reach for `links` on tasks instead.

### Q2 — Where does `plan.extra.phases` schema live?

Today `planExtraSchema` is `{ phase: string? }`. New shape `{ phase?: string, phases?: Array<{name, description?}> }` collides on the singular `phase`. Migration needed.

**Recommendation**: dedicated `lore migrate phases` command that performs a **proactive one-shot sweep** over every existing plan row: renames `extra.phase` → `extra.legacy_phase` and clears the singular field in a single transaction. Does NOT rely on lazy per-row migration — lazy leaves rows in mixed-schema state indefinitely, breaks any code that switches on field presence. The migration command is idempotent (skips already-migrated rows) and must be run once per corpus before SPEC-023's runtime code lands.

### Q3 — Validation enforcement strength

Should `task.extra.phase` be:

- (a) Free string, no validation (loose)
- (b) Validated against parent plan's `extra.phases[].name` at write time (strict)
- (c) Validated at write AND drift-checked at `lore tree` render time

**Recommendation**: (b). Drift-checking adds confusing UX (task appears under different headings on different days as plan phases change).

### Q4 — UI for declaring phases

`lore create plan --phase "A:Status Alignment" --phase "B:New SPECs"` (repeated flag)?
`lore set <plan> --phases-json '[{name:"A"},{name:"B"}]'`?
$EDITOR-driven YAML block?

**Recommendation**: dedicated subcommand `lore phase add <plan> <name> [--description]` + `lore phase list <plan>` + `lore phase rm <plan> <name>`. Mirrors existing `lore link / unlink` surface.

### Q5 — Backwards compat with title-prefix convention

Plans I authored today use `"A1: ..."` / `"Track A · ..."` prefixes. Should the migration tool detect prefixes and lift them into `extra.phases`?

**Recommendation**: out of scope. Manual `lore phase add` + `lore set <task> --phase A` is fine for the first user (me).

### Q6 — Empty-phase rendering

`lore tree <plan>` when plan has 3 phases declared but only 2 have any tasks — show 3 headers (one empty) or 2?

**Recommendation**: show all declared phases, including empty ones. Empty phases hint at "work to do".

## 4. Acceptance Criteria (early draft)

**AC-PHASE-1** `planExtraSchema.phases` accepts `Array<{name: string, description?: string}>`. Uniqueness of `name` within the array is enforced via Zod `superRefine` (no built-in array-uniqueness validator exists) — duplicates raise a custom `phases[].name must be unique` issue at the colliding index.

**AC-PHASE-2** `taskExtraSchema.phase` accepts an optional string.

**AC-PHASE-3** Creating a task with `extra.phase: "X"` requires `CorpusService.create` to fetch the parent plan and inspect `parent.extra.phases[]` — a cross-entity validation not expressible in pure Zod (lives in service layer, not `createDocInputSchema`). Three sub-cases:

- `parent.extra.phases` absent / empty → VALIDATION_ERROR (loud refusal — phase referenced but plan declares none)
- `parent.extra.phases` present, `name: "X"` not found → VALIDATION_ERROR (unknown phase)
- `parent.extra.phases` present, `name: "X"` matches → task created

**AC-PHASE-4** Creating a task with no `extra.phase` succeeds regardless of plan having phases declared (backward compat). No cross-entity check needed in this path.

**AC-PHASE-5** `lore tree <plan>` renders tasks grouped by phase when plan has phases; flat otherwise.

**AC-PHASE-6** `lore tree <plan>` shows all declared phases including ones with zero tasks (under a `(0)` count).

**AC-PHASE-7** `lore list --type task --plan-id <plan> --phase <name>` returns only tasks with matching `extra.phase`.

**AC-PHASE-8** `lore phase add <plan> A --description "Status alignment"` appends to `plan.extra.phases[]`; duplicate name → exit 4.

**AC-PHASE-9** `lore phase rm <plan> A` fails if any task has `extra.phase: "A"`; user must clear/move first.

**AC-PHASE-10** `lore migrate phases` command performs a proactive sweep: every plan row with `extra.phase: <string>` gets `extra.legacy_phase` set to that value and the singular `extra.phase` removed, in a single SQLite transaction. Idempotent — rerunning is a no-op on already-migrated rows. After the sweep, no row contains the singular `phase` field; subsequent code can treat its presence as a bug, not a backward-compat case.

**AC-PHASE-DOC-1** Updating `CLAUDE.md` and module CLAUDE.md (`packages/core/src/CLAUDE.md`) to document the new pattern.

## 5. Out-of-scope rejections

- "Phase dependencies (phase B blocks phase A)" — tasks already have `links: blocks`; reuse that.
- "Auto-progress tracking (phase X done when all tasks done)" — derivable in the dashboard; no schema field needed.
- "Phase templates" — not enough repeated structure to warrant.
- "Sub-phases (`A.1`, `A.2`)" — flat phase list only.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Doubles the migration work for existing plans (zero today, but future plans authored before this SPEC ships) | Migration window is small: I authored exactly 1 plan with title-prefix grouping. Will hand-fix. |
| `lore tree` rendering with 20+ phases gets ugly | Phase count cap (soft 10, hard 30) via Zod `.max(30)`. |
| Users rely on `extra.phase` (legacy) and never migrate | Telemetry tracks `extra.legacy_phase` reads; deprecate after 2 minor versions. |
| Phase rename breaks task references | `lore phase rename <plan> <old> <new>` is a single transaction updating plan + all child tasks. Add to v1 if time permits. |

## 7. Outstanding Decisions (block implementation)

~~Resolved — see §8 below.~~

## 8. Resolved Decisions (ratified 2026-06-30)

| Question | Ratified Answer |
|---|---|
| Q1 Option A vs B | **A: extra-only**. No new `phase` doc type. `planExtraSchema.phases` + `taskExtraSchema.phase` are the entire surface. |
| Q2 Migration shape | **Proactive sweep via `lore migrate phases` command.** Renames `extra.phase` → `extra.legacy_phase` in a single SQLite transaction. Idempotent. Must run once before §9 runtime code activates the new validation path (a corpus-version gate guards this). |
| Q3 Validation strength | **(b) Strict at write time.** Service layer fetches parent plan and inspects `extra.phases[]` before accepting task with `extra.phase`. No drift-check on read. |
| Q4 CLI UI shape | **Dedicated subcommand `lore phase`** with `add` / `list` / `rm` / `rename` actions. Mirrors `lore link / unlink`. |
| Q5 Title-prefix back-compat | **Out of scope.** No auto-detection of `"A1: ..."` prefixes. Manual `lore phase add` + `lore set <task> --phase A` for the few existing plans. |
| Q6 Empty-phase rendering | **Show all declared phases**, including zero-task ones. Empty phase header rendered as `Phase A: <name> (0 tasks)`. |
| Q-extra (case sensitivity) | **`phases[].name` is case-sensitive, exact-match.** Whitespace trimmed at write. |

## 9. Architecture Notes (implementation-ready)

### 9.1 File touch list

| File | Change |
|---|---|
| `packages/core/src/schemas.ts` | Extend `planExtraSchema` with optional `phases: Array<{name, description?}>` (Zod `superRefine` for unique `name`). Extend `taskExtraSchema` with optional `phase: string`. |
| `packages/core/src/types.ts` | Derived TS types via `z.infer` — no hand-written interfaces. |
| `packages/lore/src/service/corpus-service.ts` | In `create()` and `update()`, when `type === "task"` and `extra.phase` present, fetch parent plan via `store.getDoc(parent_id)`, inspect `parent.extra.phases[]`, return `VALIDATION_ERROR` per AC-PHASE-3 sub-cases. |
| `packages/lore/src/service/phase-service.ts` | **NEW** — thin service: `addPhase`, `listPhases`, `removePhase`, `renamePhase`. All return `Promise<Result<T, LoreError>>`. Composed via `app.ts`. |
| `packages/lore/src/adapters/cli/commands/phase.ts` | **NEW** — 4 subcommands. Routes args → `PhaseService` → format output. `--json` flag per SPEC-003 convention. |
| `packages/lore/src/adapters/cli/commands/tree.ts` | When rendering a plan with `extra.phases`, group child tasks under phase headers (including empty phases per Q6). |
| `packages/lore/src/adapters/cli/commands/list.ts` | New `--phase <name>` filter (combined with `--plan-id` to scope). |
| `packages/lore/src/adapters/cli/commands/migrate.ts` | Existing `lore migrate v1` command — add `phases` subaction: `lore migrate phases [--dry-run]`. |
| `packages/lore/src/adapters/cli/commands/create.ts` | Add `--phase <name>` flag for `create task` path. |
| `packages/lore/src/app.ts` | Wire `PhaseService` into the `App` composition root. |
| `packages/lore/tests/unit/service/corpus-service.test.ts` | Cross-entity validation tests (AC-PHASE-3 three sub-cases). |
| `packages/lore/tests/unit/service/phase-service.test.ts` | **NEW** — service-layer tests for 4 actions. |
| `packages/lore/tests/integration/cli/phase.test.ts` | **NEW** — end-to-end subprocess tests. |
| `packages/lore/tests/integration/cli/migrate-phases.test.ts` | **NEW** — migration sweep + idempotency tests. |
| `packages/core/tests/unit/schemas.test.ts` | New tests for `planExtraSchema.phases` uniqueness `superRefine`. |

### 9.2 Backwards compat & migration ordering

1. Land schema + service code with `phases` validation **conditional on absence of `extra.phase` (legacy single-string)** in the parent plan. Existing plans without phases continue working untouched.
2. Ship `lore migrate phases` as a separate landed command.
3. Document in CHANGELOG that operators must run `lore migrate phases` once after upgrade. The migration is loud (prints a count of touched rows) and idempotent.

### 9.3 Test layout (per CLAUDE.md "complexity ≥ medium → 测试由独立 subagent 编写")

- Unit (vitest, fast): schemas validation, service-layer logic, phase formatter
- Integration (vitest, subprocess): full CLI invocations against a temp SQLite DB
- Bun-only (`.bun.test.ts`): any test that touches `bun:sqlite` directly (likely none for this SPEC — service layer is store-agnostic)

### 9.4 Telemetry

No new events. `doc.updated` events already cover phase mutations on plans.

### 9.5 Out of §9 scope (still SPEC-023)

- MCP / HTTP surface exposure of `lore phase` — handled by a follow-up SPEC after CLI stabilises.
- Dashboard rendering of phases — handled by SPEC-022 (Dashboard write UI) when it lands.


## Code anchors

- packages/lore/src/service/phase-service.ts

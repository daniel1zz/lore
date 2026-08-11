---
id: SPEC-025
type: spec
role: spec
title: "Task execution workflow metadata (evidence / claim / ready)"
status: approved
priority: high
created: 2026-07-02
updated: 2026-07-14
tags: [task, workflow, claim, evidence, ready, coordination]
parent: PRD-001
---
# SPEC-025: Task execution workflow metadata

> **Status: design ratified 2026-07-02** after a 4-perspective module review (coupling / cohesion / reuse-extension / testability) — see §6. Upstream driver: KN-001 retro ("SPEC-022 already implemented yet re-dispatched" = claim-absence incident) and the cold-start context-sufficiency analysis recorded in the SPEC-022 dogfood iteration.

## 1. Purpose

Plans and tasks in Lore are plain corpus documents — a structured task ledger with no execution-coordination semantics. A fresh session (human or agent) picking up a plan's remaining tasks cannot answer, from the corpus alone:

1. **Was completed work actually verified?** Task `archived` status carries no oracle evidence; verification output lives only in the ephemeral conversation that ran it.
2. **Which tasks are ready?** The `blocks` link type exists in the schema but has zero scheduling semantics; ordering is inferred from prose.
3. **Is someone already working on this?** Nothing marks a task as being executed. Two concurrent sessions will duplicate work (observed live: the SPEC-022 re-dispatch incident, KN-001).
4. **Did an attempt fail?** No representation for a failed/blocked attempt other than free text.

SPEC-025 closes these four gaps with the *minimum* workflow layer that keeps Lore a knowledge platform, not a project-management tool: two Zod-constrained `extra` fields on task docs (evidence, claim), computed readiness over existing `blocks` links, and CLI + MCP surfaces.

## 2. Goals & Non-Goals

### 2.1 Goals

- `task.extra.verification_evidence` — append-only, schema-validated oracle evidence entries; written via `lore evidence`, versioned like every doc write.
- `task.extra.claim` — advisory execution lease `{by, at, branch?}`; acquired/released via `lore claim` / `lore release`; expiry computed read-side against a config TTL (no daemon, no heartbeat).
- `lore ready <plan>` — computed readiness report over `blocks` links + doc statuses, with claim annotations. Never stored.
- CLI badges: `lore tree` / `lore list` show claim state and evidence count on tasks.
- MCP tools: `lore_claim`, `lore_release`, `lore_evidence_add`, `lore_ready` (agents are the primary consumers).
- Telemetry: `task.claimed` / `task.released` / `task.evidence_added` events.

### 2.2 Non-Goals

- ❌ **HTTP / dashboard surface** — CLI + MCP only in v1 (mirrors SPEC-022's layering; `packages/core/src/task-workflow.ts` is browser-safe so the dashboard can render badges later without a breaking change).
- ❌ **DocStatus enum changes** — no new lifecycle states. *failed* = latest evidence entry with `result: "fail"`; *blocked* = the negative side of the computed readiness report. Blast radius of touching `VALID_TRANSITIONS` + 13 error-code consumers + dashboard StatusPill is not justified.
- ❌ **Heartbeat daemon / lease renewal** — Lore is a short-lived CLI process; there is no resident process to renew a lease. Staleness is computed by readers (`isClaimStale`), which requires zero background machinery.
- ❌ **Hard mutual exclusion** — claim is advisory coordination. The write itself is serialized by the existing version optimistic lock (and, under Turso sync, by write-forwarding to the primary); we do not build a distributed lock.
- ❌ **Worktree paths in the corpus** — local filesystem paths are ephemeral and environment-specific. `claim.branch` covers "where is the work happening" at the durable (git) level.
- ❌ **Task dependency editing UX** — `blocks` links are created with the existing `lore link A B --type=blocks`; no new dependency-graph editor.

## 3. Design Decisions (each weighed against alternatives; ratified)

| # | Decision | Alternatives rejected | Rationale |
|---|---|---|---|
| D1 | Evidence lives in `task.extra.verification_evidence` (Zod array, max 50, `output_tail` ≤ 4000 chars) | (b) separate store table — breaks "everything is a doc" (sync/export/version/MCP all need special-casing); (c) version-history-only — not structurally queryable, cold-start would parse prose | The SPEC-023 `extra.phases` precedent proves the whole toolchain (export-docs, sync, versioning, MCP) already supports Zod-constrained `extra` payloads. Cap + tail limit bound document growth; `list` uses DocSummary (no `extra`) so list performance is unaffected. |
| D2 | Claim = `extra.claim {by, at, branch?}` lease; expiry **computed read-side** vs `workflow.claim_ttl_minutes` (config, default 120) | (b) claims table + heartbeat rows — second source of truth, needs a resident heartbeater Lore doesn't have; (c) "active status means claimed" convention — no owner, no expiry: the current gap itself | Lease-plus-computed-expiry is the only model that fits a short-lived CLI. Concurrent claims are decided by the existing version CAS: the second writer gets `STALE_VERSION`, fail-loud. Under Turso sync, writes forward to the primary and serialize there — semantics preserved. |
| D3 | Readiness is **computed**, never stored. `blocks` link direction: `from` = blocker, `to` = blocked; a blocker is satisfied iff its status is `archived` | Stored `ready` flag — every blocker transition would need cascading updates: the same consistency debt TreeCheckService already services for `parent_id` ↔ links | Stateless, drift-free, and cheap at real plan sizes (tens of tasks). Batch link lookup (D7) removes the N+1. |
| D4 | No status-enum growth; failure/blockage are derived signals | Adding `failed`/`blocked` DocStatus values | See Non-Goals. Derived signals cannot drift from their sources. |
| D5 | New seventh domain service `TaskWorkflowService` (stateless, `StoreInterface` DI) owning claim/release/evidence/ready; pure logic in browser-safe `packages/core/src/task-workflow.ts` | (b) extend CorpusService (already ~850 lines, god-service trend); (c) split an eighth service for `ready()` alone (cohesion reviewer's option) | Matches the PhaseService precedent (verb-grouped operations on an `extra` field as own service). Keeping `ready()` in the same service keeps the workflow vocabulary in one place; the tension is logged in §6 with the split criterion that would trigger it later. |
| D6 | **Remove dormant `task_status`** from `taskExtraSchema` | (b) keep and integrate (claim ⇒ `in-progress` dual-write); (c) keep as manual override consulted by `ready()` | Verified: `task_status` (`todo\|in-progress\|done\|blocked`, schemas.ts:90) has zero business-logic consumers — one schema passthrough test only. Keeping it creates a second, parallel state signal that will drift (cohesion review issue #3). Legacy docs carrying the key must still parse (see AC-WF-12). |
| D7 | Add one batch query to `StoreInterface`: links by `to_ids` + `type` (exact name follows the store's existing naming conventions) | Per-task `getLinks` loop — N+1 coupling readiness cost to link-table shape (coupling review issue #3) | Three stores implement it with a single `WHERE to_id IN (…) AND type = ?`. Do it right now rather than documenting a perf caveat. |
| D8 | `TaskWorkflowService` writes `extra.claim` / `extra.verification_evidence` **directly via the store**, with its own telemetry wiring | Routing writes through `CorpusService.update` | Two constraints collide: `service/CLAUDE.md` forbids cross-service calls, and CorpusService owns the "content/title edit demotes approved→draft" invariant. TaskWorkflowService never touches `content`/`title`/`status` — the demotion invariant is unreachable from its writes by construction. Telemetry parity is restored by wiring the same `Telemetry` DI into TaskWorkflowService (AC-WF-11). This is a *documented, bounded* bypass, not an accidental one. |
| D9 | `ReadyReport` is a **flat array** of per-task records (each carries `phase?`); grouping is CLI presentation only | Phase-grouped report shape | Reuse reviewer: a grouped shape optimizes one consumer (tree display) and forces future consumers (`lore next`, HTTP) to un-flatten — a breaking reshape. Flat + presentation-layer grouping is SSOT-safe. |
| D10 | Time seam: `claim()` / `release()` / `addEvidence()` accept optional `now?: () => string` (defaults to `new Date().toISOString()`) | Inline `new Date()` (codebase norm); fake timers | Testability review: the codebase has no clock-injection precedent and no fake-timer usage; an opt-in default-argument seam is non-breaking, idiomatic, and makes `claim.at` / staleness end-to-end testable. |

## 4. Acceptance Criteria

**AC-WF-1** `lore evidence <task> --oracle <tsc|test|lint|build|e2e|manual|other> --command "<cmd>" --result <pass|fail> [--output-tail <text>|--output-tail-file <path>] [--by <name>]` appends a `verification_evidence` entry `{oracle, command, result, output_tail?, recorded_at, recorded_by}`, bumps the doc version, and is visible in `lore log`.

**AC-WF-2** Appending the 51st evidence entry fails loud with `VALIDATION_ERROR`; the document is unchanged. (BOUNDARY)

**AC-WF-3** `lore claim <task> [--by <name>] [--branch <branch>]` on an unclaimed task writes `extra.claim {by, at, branch?}`. Claiming a task with a **fresh** claim (age ≤ TTL) by a different actor fails with the new error code `CLAIM_CONFLICT` (CLI exit code follows the existing conflict mapping), reporting current holder and age.

**AC-WF-4** A **stale** claim (age > `workflow.claim_ttl_minutes`, default 120) is claimable without any flag; `--steal` overrides even a fresh claim. Both paths record the previous holder in the version history.

**AC-WF-5** Two claim attempts racing on the same read version: the first write succeeds, the second receives `STALE_VERSION` (never a silent overwrite). Deterministic test uses the sequential-CAS recipe from §7.

**AC-WF-6** `lore release <task> [--by <name>] [--reason <text>]` by the claim holder clears `extra.claim`; the reason (e.g. a failure summary) lands in the version history. Release by a non-holder without `--force` → `CLAIM_CONFLICT`.

**AC-WF-7** `lore ready <plan>` returns per-task records: a task is **ready** iff its status ∉ {`archived`, `deprecated`} AND every blocker (docs on the `from` side of `blocks` links targeting it) has status `archived`. Blocked records list unmet blocker ids/slugs. Docs of other types under the plan (e.g. knowledge) are excluded.

**AC-WF-8** Ready output annotates claim state per task (`claimed_by`, `claim_age_minutes`, `stale` flag) and supports `--json` with the flat D9 shape; the human rendering groups by phase when the plan declares phases.

**AC-WF-9** `lore tree` and `lore list` render a claim badge (holder, staleness) and evidence count (`✔n` / `✘` when latest is fail) for task rows.

**AC-WF-10** MCP tools `lore_claim`, `lore_release`, `lore_evidence_add`, `lore_ready` expose the same operations with pre-declared `z.object` schemas (ADR-tsc-memory constraint) and return the same envelopes as the service layer.

**AC-WF-11** Each successful claim / release / evidence write emits exactly one telemetry event (`task.claimed` / `task.released` / `task.evidence_added`) carrying the caller-surface source discriminator.

**AC-WF-12** `task_status` is removed from `taskExtraSchema`; the one referencing test is updated; a legacy doc whose `extra` still contains `task_status` continues to validate (unknown-key tolerance verified by test). (REGRESSION)

**AC-WF-13** All existing suites stay green; `bun run typecheck` exit 0; both runners pass.

## 5. Risks

| Risk | Mitigation |
|---|---|
| Evidence array bloats task docs | max 50 entries + `output_tail` ≤ 4000 chars; `list` reads DocSummary (no `extra`). Intended use is *final* oracle runs, not per-keystroke CI logs — documented in CLI `--help`. |
| Two sessions claim within the same TTL window on different Turso replicas | Writes forward to the primary; version CAS decides; loser gets `STALE_VERSION` and re-reads. |
| `blocks` cycles make tasks permanently unready | Cycle detection already exists at link-creation time (`detectParentCycle` path); `ready` additionally reports tasks that are blocked-by-non-archived-blocker so a cycle is visible, not silent. |
| Clock skew between machines mis-judges staleness | TTL default is 120 min — an order of magnitude above realistic skew; staleness is advisory (steal path exists). |
| `steal` misuse duplicates work anyway | Steal records the previous holder in version history; social/audit deterrent is the appropriate strength for an advisory lease. |

## 6. Perspective Tensions Resolved (module review, 4 parallel reviewers)

| Tension | Perspectives | Resolution | Why |
|---|---|---|---|
| Write path: through CorpusService vs direct store | Coupling ↔ Cohesion | Direct store writes, bounded + documented (D8), telemetry parity via DI | Cross-service calls are forbidden by service-layer rules; the demotion invariant is untouchable from claim/evidence writes by construction |
| One service vs mutation/read split | Cohesion ↔ Reuse | Single `TaskWorkflowService` (D5) | Split criterion recorded: if `ready()` grows plan-mutation side effects or a second aggregate consumer appears, extract a read-side service then |
| `evaluateReadiness` location (graph-utils vs task-workflow) | Cohesion | Stays in `task-workflow.ts` | Domain cohesion (workflow vocabulary in one file) outweighs mechanism grouping; documented deviation from the `graph-utils` precedent |
| Report shape: grouped vs flat | Reuse ↔ CLI ergonomics | Flat records + CLI-layer grouping (D9) | Future consumers must not pay an un-flatten tax |
| Evidence cap semantics | Reuse ↔ Testability | Hard cap 50, fail-loud reject, explicit boundary AC (AC-WF-2) | Config knob deferred until pruning is a demonstrated need |
| Time control | Testability ↔ codebase norms | Opt-in `now?` default argument (D10) | Non-breaking; avoids introducing fake timers the codebase has never used |

## 7. Test Guidance (for the tester agent)

- **Sequential-CAS recipe** (ERROR dimension for `STALE_VERSION` / `CLAIM_CONFLICT`): `InMemoryStore.update()` has no `await` before its CAS check, so `Promise.all` "races" resolve in call order and never interleave. Deterministic pattern: read the doc version once, then issue two *sequential* `update()` calls both using the captured `expected_version` — first succeeds, second deterministically returns `STALE_VERSION`. Same technique for claim collisions.
- Six-dimension mapping: HAPPY (claim→evidence→release→ready round-trip), NEGATIVE (claim conflict, non-holder release, unknown oracle value), BOUNDARY (51st evidence entry, empty plan ready report, TTL boundary at exactly 120 min), ERROR (STALE_VERSION, store failures propagate), STATE (claim → stale transition via injected `now`; ready flips when blocker archives), REGRESSION (legacy `task_status` doc still validates; existing task creation/phase validation untouched).
- Runner split: pure functions + service with InMemoryStore → vitest; anything touching `SQLiteStore` → `.bun.test.ts`.
- CLI/MCP layers: translation-only tests (args → service call → exit code / JSON shape) against an InMemoryStore-backed app; do not re-test business rules at three layers.

## 8. Architecture (implementation-ready)

### 8.1 File touch list

| File | Change |
|---|---|
| `packages/core/src/task-workflow.ts` | **NEW** (browser-safe, pure): `evidenceEntrySchema`, `taskClaimSchema`, `EvidenceEntry`, `TaskClaim`, `isClaimStale(claim, nowIso, ttlMinutes)`, `evaluateReadiness(tasks, blocksLinks)`, `ReadyRecord` type |
| `packages/core/src/schemas.ts` | MOD: `taskExtraSchema` gains `verification_evidence` (import schema from task-workflow.ts) + `claim`; **remove `task_status`** |
| `packages/core/src/errors.ts` | MOD: add `CLAIM_CONFLICT` to the LoreError union + exit-code mapping |
| `packages/core/src/config.ts` | MOD: config schema gains `workflow: { claim_ttl_minutes: number (default 120) }` (pure schema side; loading stays in config-node.ts) |
| `packages/core/src/telemetry.ts` | MOD: event-name union gains `task.claimed` / `task.released` / `task.evidence_added` |
| `packages/lore/src/store/store-interface.ts` + 3 stores | MOD: batch link query by `to_ids` + `type` (D7; name per existing conventions) |
| `packages/lore/src/service/task-workflow-service.ts` | **NEW**: `TaskWorkflowService` (StoreInterface + Telemetry + config DI; methods per §8.2) |
| `packages/lore/src/app.ts` | MOD: construct + expose the service |
| `packages/lore/src/adapters/cli/commands/{claim,release,evidence,ready}.ts` | **NEW** commands; register in CLI index; exit-code mapping for `CLAIM_CONFLICT` |
| `packages/lore/src/adapters/cli/commands/{tree,list}.ts` | MOD: claim badge + evidence count on task rows |
| `packages/lore/src/adapters/mcp/tools.ts` | MOD: 4 new tools, pre-declared `z.object` consts |

### 8.2 Public interface (TypeScript)

```ts
// packages/core/src/task-workflow.ts (browser-safe, pure)
export interface EvidenceEntry {
  oracle: "tsc" | "test" | "lint" | "build" | "e2e" | "manual" | "other";
  command: string;
  result: "pass" | "fail";
  output_tail?: string;        // ≤ 4000 chars
  recorded_at: string;         // ISO
  recorded_by: string;
}
export interface TaskClaim { by: string; at: string; branch?: string }
export function isClaimStale(claim: TaskClaim, nowIso: string, ttlMinutes: number): boolean;
export interface ReadyRecord {
  task: DocSummary;
  phase?: string;
  ready: boolean;
  unmet_blockers: Array<{ id: DocId; slug: string; status: DocStatus }>;
  claim?: TaskClaim & { stale: boolean; age_minutes: number };
  latest_evidence?: { result: "pass" | "fail"; recorded_at: string };
  evidence_count: number;
}
export function evaluateReadiness(
  tasks: DocRecord[],
  blocksLinks: LinkRecord[],
  blockerStatuses: ReadonlyMap<DocId, DocStatus>,
  nowIso: string,
  ttlMinutes: number,
): ReadyRecord[];

// packages/lore/src/service/task-workflow-service.ts
export class TaskWorkflowService {
  constructor(store: StoreInterface, telemetry: Telemetry, config: { claimTtlMinutes: number });
  addEvidence(idOrSlug: string, entry: Omit<EvidenceEntry, "recorded_at">, now?: () => string): Promise<Result<DocRecord, LoreError>>;
  claim(idOrSlug: string, opts: { by: string; branch?: string; steal?: boolean }, now?: () => string): Promise<Result<DocRecord, LoreError>>;
  release(idOrSlug: string, opts: { by: string; reason?: string; force?: boolean }, now?: () => string): Promise<Result<DocRecord, LoreError>>;
  ready(planIdOrSlug: string, now?: () => string): Promise<Result<ReadyRecord[], LoreError>>;
}
```

### 8.3 Semantics detail

- **Claim acquisition** — read doc → if `extra.claim` exists and `!isClaimStale(...)` and `claim.by !== opts.by` and `!steal` → `CLAIM_CONFLICT`. Otherwise write `{...extra, claim}` via store update carrying the read version (CAS). Self-re-claim (same `by`) refreshes `at`.
- **Release** — holder-or-`--force` gate; clears the key (`claim: undefined`), never rewrites history.
- **Ready** — one `findMany({parent_id: plan, type: task})` + one batch link query (D7) + one `findMany` for blocker statuses → pure `evaluateReadiness`. Zero writes.
- **Actor identity** — `--by` defaults to `$LORE_ACTOR` env var, then OS username (explicit resolution order documented in `--help`; MCP callers pass `by` explicitly).
- **Evidence `recorded_by`** — same actor resolution as claim.

## 9. Dogfood validation (part of this iteration's DoD)

After implementation, this very iteration's lore tasks are the first real users: each implementation task gets `lore claim` before dispatch, `lore evidence` with actual oracle tails on completion, and `lore ready` drives dispatch order. The closeout task verifies the corpus contains non-empty evidence for every archived task of this plan.


## Code anchors

- packages/lore/src/service/task-workflow-service.ts

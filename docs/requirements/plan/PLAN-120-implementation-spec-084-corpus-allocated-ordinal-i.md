---
id: PLAN-120
type: plan
role: plan
title: "Implementation — SPEC-084 corpus-allocated ordinal identity (interface-first)"
status: archived
priority: medium
created: 2026-07-26
updated: 2026-07-27
tags: []
parent: SPEC-084
phases:
  - {name: "Phase 1: Contract", description: "Serial T1(RED shared-case-table + 3 suites) -> T3(core types/registry/formatters/schema-guard) -> T2(schema migration + store methods x3 impls). Artifact-ordered: core types precede store impls."}
  - {name: "Phase 2: Consumers (parallel)", description: "Three disjoint-anchor consumers of the frozen contract: T4 service wiring + set guard + kind-flip + resolveDoc; T5 export read-switch + SPEC-021 A1 retirement; T6 lore migrate ordinals repair verb. All blocked by T2 only."}
  - {name: "Phase 3: Verification + live repair", description: "T7 compiled-binary e2e (migrate dry-run/apply/idempotency/resolution), then T8 attested sweep + THE live-corpus repair (dry-run report surfaced to user before --apply) + docs closure."}
links:
  - {id: SPEC-084, type: implements}
---
## Overview

Implementation plan for approved `spec-084-corpus-allocated-ordinal-identity-store-atomic-spec` (SPEC-084). Strategy: **Interface-First** (user-selected 2026-07-26) — P1 pins the contract layer (RED shared-case-table suites → core types/registry/formatters → schema migration + store methods ×3 impls), P2 runs three disjoint-anchor consumers in parallel (service wiring / export read-switch / repair verb), P3 verifies via compiled e2e then executes the live-corpus repair.

## Governance Mode

unattended — phase gates auto-proceed; Invariant violations hard-block regardless.

## Invariants

1. Ordinal uniqueness is enforced by the DB partial index `(type, ordinal) WHERE ordinal IS NOT NULL` (soft-deleted rows INCLUDED — never reuse); no application-layer uniqueness check may substitute for it.
2. Exactly TWO allocation sites, both store-atomic: `insertWithAllocatedOrdinal` (create) and `allocateOrdinalForExisting` (kind-flip UPDATE, CAS-guarded, refuses rows already carrying an ordinal). No MAX+1 arithmetic anywhere else (grep oracle over packages/). **Restated post-D7 (2026-07-27, see the spec's own "Invariant restatement" note): the shipped contract has a THIRD sanctioned ordinal-write site, `assignOrdinalForRepair` (D7's targeted-assignment repair path, non-allocating) — "exactly two" describes the two MAX+1 ALLOCATION sites only. The grep oracle (`bun run check:ordinal-sites`) allowlists all three.**
3. Retry exhaustion is LOUD: `err(STORE_ERROR)` with literal `ORDINAL_ALLOCATION_EXHAUSTED` token; never a silent NULL ordinal on a numbered-type doc.
4. Title purity on BOTH write paths: create (createDocInputSchema superRefine) AND `CorpusService.set` title patch — `^(SPEC|ADR)-\d+\b` → VALIDATION_ERROR.
5. Display composition only via core `formatDocDisplayId`/`composeDocDisplayTitle` (import-graph/grep pin); the composed string is never stored.
6. `bootstrapReportSchema`-class strip hazard: `ordinal` added to docSummary/DocRecord zod schemas wherever the field must survive `.parse()` — round-trip pinned.
7. Repair migration: dry-run default; every reassignment in the loud old→new mapping report; second run = literally zero writes; NEVER run against the live corpus before the copy dry-run AC passes.
8. Zero new runtime dependencies.

## Risk Register

| ID | Cat | Impact | Trigger | Mitigation | Contingency |
|---|---|---|---|---|---|
| R1 | Technical | H | migration chain conflict — another session lands migration-N concurrently | T2 claims the next migration number at claim time; check `git log`/migrations dir at worktree start; anchor on store/ dir serializes | renumber our migration, re-run T2 oracles |
| R2 | Technical | M | InMemoryStore parity drift vs SQLite partial-index semantics | shared case table consumed by BOTH runners (AC-084-1/2), count-equality assertion | contract suite failure blocks merge |
| R3 | Scope | M | export-index reconcile collides with the outline-migration's fresh export state | T6 fixture reproduces the CURRENT live divergence (2×080 titles + drifted 072/073/083 entries); T8 dry-run mapping report reviewed before --apply | abort --apply, re-derive assignment |
| R4 | Quality | M | e2e false oracle (stale dist, zero-match self-skip) | T7 builds first + asserts executed-test count > 0 | rebuild, rerun |
| R5 | Dependency | L | another live session writes docs between T8's dry-run and --apply | run both in one sitting; mapping report re-printed by --apply and diffed against dry-run | rerun dry-run, re-review |

## Estimation Summary

S=1, M=2. T1=2, T3=2, T2=2, T4=2, T5=2, T6=2, T7=2, T8=2 → **Total: 16 units** (large-plan warning acknowledged: the surface spans schema/store/core/service/export/CLI/migration — splitting further would break contract atomicity). Phase 1: 6 | Phase 2: 6 | Phase 3: 4.

## Critical Path

T1 → T3 → T2 → T6 → T7 → T8 = **12 units** (slack: T4, T5). Long critical path accepted: each edge is a real artifact dependency (types → store impls → repair verb → e2e → live run).

## Exit Criteria

- All 8 tasks archived with pass evidence; `lore verify <plan>` attests AC-084-1..6, zero inconclusive.
- Both runners + typecheck green on main post-merge.
- **Live repair executed**: `lore migrate ordinals` dry-run mapping report reviewed → `--apply` on THIS corpus; post-conditions: zero duplicate ordinals, titles prose-pure, export-index converged, `lore get SPEC-80` resolves to bootstrap-injection.
- `lore assess <plan>`; handoff; CLAUDE.md SPEC-084 entry; collision knowledge doc's manual-resolution section invalidated (superseded by the executed migration).

## Decisions Log

- 2026-07-26 Strategy: Interface-First (user-selected). Deviation from the presented preview: P1 is SERIAL T1→T3→T2 (not T2∥T3) — `DocRecord.ordinal` type + zod field live in core (T3) and every store impl compiles against them; artifact dependency wins over the sketched parallelism.
- 2026-07-26 TDD: T1 is the RED pair for T3+T2 jointly (shared case table spans core fns and store methods). T4/T5/T6 oracles land inside their own tasks + T7 e2e (same rationale as SPEC-080's plan: compiled-binary red-first would force per-cycle rebuilds).
- 2026-07-26 Clarification coverage: all HOW dimensions pinned by the user-approved SPEC-084 (4-perspective review + review-fix round); governance mode asked → unattended.
- 2026-07-26 T8 runs on main by the orchestrator (verification task, no code anchors; live-repair --apply requires the dry-run mapping report surfaced to the user first — that surfacing is an explicit T8 AC, not a courtesy).

---
id: TASK-808
type: task
role: plan
title: "skill-implement: three-way split, runMemoryFileChecks composition entry, both call sites wired, renderer extracted, reference_missing migrated to advisory"
status: archived
priority: medium
phase: "P1-split-and-wire"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-139
plan: PLAN-139
---
## Objective

Split `claude-md-check.ts` three ways, introduce the sole composition entry, wire both production call sites, extract rendering, and migrate `reference_missing` to advisory. ⛔ NO new metric in this task — Phase 2 adds those.

## What to build

1. **`service/claude-md-findings.ts`** (new) — the shared finding types. ⛔ Extract and re-export `MemoryFileFinding`; NEVER fork it. A pinned RED test depends on its flat, unnarrowed shape (see the `@remark` at the current file's lines 177-186).
2. **`service/claude-md-budget.ts`** — rename of the current file, keeping ONLY `lintMemoryFiles`, `computeHeadroom`, `computeHeadroomWarnings` and the three-band ceiling machinery.
3. **`service/claude-md-admission.ts`** (new) — absorbs `checkReferenceExistence` and `detectNarrativeSmells` verbatim.
4. **`runMemoryFileChecks(files, budgets, deps)`** — the SOLE composition entry, returning `{ deterministic, advisory }`. `deps: { fileExists, docExists }`. Both `status.ts` and `context-flow.ts` call ONLY this. ⛔ Neither may reference an individual metric function — two independent call sites is what produced the drift this whole spec repairs.
5. **`adapters/cli/claude-md-render.ts`** (new) — all human + JSON rendering moves here. `status.ts` is already 1820 lines; follow the existing `*-render.ts` convention.
6. **N13 type migration** — move `reference_missing` from `MemoryFileFindingKind` to `AdvisoryFindingKind`. It was typed deterministic and never called; this retracts a false claim rather than removing enforcement. Deterministic arming is gated on N3's two-repo condition, out of scope here.

## Constraints

- ⛔ Both service modules stay PURE: no `node:fs`, no `node:path`, no store import. Every IO capability enters as an injected predicate. `docExists` is owned by the CLI/flow layer, which already holds the corpus handle.
- ⛔ `context-flow.ts`'s AC-CTX-8 pre-write admission must go through the SAME composition entry as `status.ts`. SSOT is a pinned invariant.
- Update every import site of the old module path.
- ⛔ Run the Phase 1 suites BY HAND: `bun run test:changed` is structurally blind to `claude-md-admission.test.ts` (dynamic `import()` defeats static selection).

## Definition of done

The four Phase 1 oracles authored by the test task go green, each verified with its declared `--falsifier-*` mutation producing the declared exact exit code. Record evidence with `lore evidence`, then `lore release`. ⛔ Do NOT run `lore done` — the main agent does that after merge verification.

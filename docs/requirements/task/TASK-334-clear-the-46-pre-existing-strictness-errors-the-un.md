---
id: TASK-334
type: task
role: plan
title: "Clear the 46 pre-existing strictness errors the un-excluded dashboard test tree surfaces and wire that project into bun run typecheck"
status: archived
priority: medium
phase: "typecheck-sweep"
created: 2026-08-07
updated: 2026-08-07
tags: []
parent: PLAN-080
plan: PLAN-080
---
# Objective

Clear the 46 pre-existing strictness errors that un-excluding the `packages/dashboard` test tree
surfaces, then wire that project into the repo-wide `bun run typecheck` so the guard rail is
actually enforced.

⛔ Runs STRICTLY AFTER phase `derivation` is merged. That phase fixes
`packages/dashboard/tsconfig.tests.json`'s inherited `exclude` and the 4 `falsified` errors; both
tasks anchor that config, so the claim gate will refuse an overlapping concurrent claim — that is
intended, not an obstacle to route around.

# Why these errors exist and were never seen

`tsconfig.tests.json` declares `include: ["src/**/*", "tests/**/*"]` but `extends`
`./tsconfig.json`, and **`extends` does not reset `exclude`**. The base's
`exclude: ["node_modules","dist","tests"]` was inherited and `exclude` filters `include`, so the
purpose-built tests project resolved 648 files and **zero** under `packages/dashboard/tests/`. It
exited 0 because it checked nothing — the canonical false oracle, exit-code-true ≠
measured-the-right-thing. Nothing was ever wrong with the errors; they were simply never looked
at.

# Measured baseline — 2026-08-07 on `main` @ `1b90fabe`, via a discarded probe config

With `exclude` corrected, the project resolves 63 test files and reports **50 errors across 20
files**. Phase `derivation` owns 4 of them (the `falsified` ones in `SpecAcCoveragePanel.test.tsx`
and `PhaseProgressPanel.test.tsx`). **This task owns the remaining 46 across 18 files**, anchored
below.

| Code | Count | Shape |
|---|---|---|
| TS18048 | 19 | `'x' is possibly 'undefined'` — unchecked index/lookup results in assertions |
| TS2322 | 13 | assigning `null` (or a wider type) where the fixture's field is narrower |
| TS2375 | 8 | `exactOptionalPropertyTypes` — passing `undefined` to an optional property |
| TS2741 / TS2739 | 7 | required properties missing from a hand-built fixture (4 are `falsified`, NOT yours) |
| TS2783 / TS2578 / TS2339 | 3 | one each |

## ⛔ SUPERSEDED — re-measured on merged `main` @ `8f341abe` after phase `derivation` landed

The table above is retained as the audit trail; ⛔ do not work from it. Phase 1's `exclude`
override differed from the pre-merge probe's — it does NOT exclude `tests/e2e` — which changes
the numbers materially:

| Project shape | files resolved under `dashboard/tests/` | errors |
|---|---|---|
| as landed by phase 1 | 91 | **166** across 49 files |
| same, plus `exclude: [… , "tests/e2e"]` | — | **47** across 18 files, ALL inside `packages/dashboard/tests/` |

The 119-error difference is entirely config noise, not fixture debt: `tests/e2e/`'s two `.ts`
helpers (`mint-machine-dashboard-key.ts`, `multi-project-server.ts`) import from
`packages/lore/src/**`, which lies outside this project's `rootDir: "."`, so tsc drags 100+
cross-package files into the program and reports every one as **TS6059 "not under rootDir"** (102
of them), plus 7 TS2307 and 8 TS2868. ⛔ None of that is a dashboard fixture problem and ⛔ none of
it is fixable by editing test fixtures.

**So the first required change is a config decision, and it is already made:** add `tests/e2e` to
this project's `exclude`. Rationale — Playwright specs are `.pw.ts` and run under Playwright's own
pipeline; the two helpers legitimately import across packages, which `rootDir` forbids by design.

⛔ **Named residual, must NOT be silent:** with `tests/e2e` excluded, those two helper `.ts` files
are typechecked by nothing in `bun run typecheck`. That is not a regression — before phase 1 the
whole `tests` tree was excluded, so they were never checked either — but it IS a remaining blind
spot, and it must be stated in the config comment next to the `exclude` entry so the next reader
finds it. Closing it needs a separate e2e project without `rootDir`; ⛔ do not attempt that here.

**Corrected scope for this task:** the **47** errors across **18** files, all under
`packages/dashboard/tests/`:

| Code | Count | Shape |
|---|---|---|
| TS18048 | 19 | `'x' is possibly 'undefined'` — unchecked index/lookup results in assertions |
| TS2322 | 12 | assigning `null` (or a wider type) where the fixture's field is narrower |
| TS2375 | 8 | `exactOptionalPropertyTypes` — passing `undefined` to an optional property |
| TS2739 / TS2741 | 5 | required properties missing from a hand-built fixture |
| TS2783 / TS2578 / TS2339 | 3 | one each |

⛔ Zero remain that mention `falsified` — phase 1 fixed all four. ⛔ Re-measure yourself before
starting anyway; these numbers are a scope statement, not an oracle.

# Required changes

1. Fix all remaining errors so the tests project reports zero. ⛔ Fix them at the fixture, never
   by widening a production type, adding `as any` / `as unknown as`, `@ts-expect-error`, or
   loosening a compiler option. Each of those converts a found defect into a hidden one, which is
   the exact failure this whole slice exists to close.
   - TS18048 in particular: the honest fix asserts the value is defined (so the test fails loudly
     when it is not), never `!` non-null assertion, which restores the silence.
2. Add the dashboard tests project to the `typecheck` chain in root `package.json` so
   `bun run typecheck` covers it.
3. AC-FALS-24's test (`packages/dashboard/tests/unit/typecheck-scope.test.ts`, created by phase
   `derivation`) gains the `typecheck-chain-covers-tests` case: assert in ONE test both that the
   chain declared in `package.json` invokes the project whose resolved file list contains
   `packages/dashboard/tests/` files, and that the project reports zero errors. ⛔ Asserting
   only "`bun run typecheck` exits 0" is not acceptable — that already passes today with the tree
   unchecked, and an oracle that is green before the change measures nothing.

# Oracles

- **AC-FALS-24** — the discriminating one; see the criterion on the governing spec.
- **AC-FALS-11** (`bun run typecheck`, exit exactly 0) — REGRESSION. It must still be 0 after the
  chain widens, which is the whole point.

⛔ Red-first, recorded by you at the moment it goes red, from inside your worktree:
`lore evidence <task> --oracle <kind> --command "<cmd>" --result expected-fail --ac <AC-ID>`.
AC-FALS-24 is red today for a reason you can state precisely (the chain does not invoke the
project) — capture that.

⛔ Exit codes measured WITHOUT a pipe: `cmd > out 2>&1; echo $?`. `set -e` is inert here; chain
with `&&`. Evidence `output_tail` MUST be non-empty and carry the runner's summary line.

# Out of scope

- The seven-value derivation, its consumers, and the 4 `falsified` fixture errors — phase
  `derivation` owns all of it.
- Any behavioural change to a dashboard component. This task edits test fixtures and build
  configuration only; a production `.tsx` diff here is a signal you took a shortcut.

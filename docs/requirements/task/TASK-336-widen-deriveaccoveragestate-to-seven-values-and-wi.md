---
id: TASK-336
type: task
role: plan
title: "Widen deriveAcCoverageState to seven values and wire every consumer and stale assertion in the same unit"
status: archived
priority: medium
phase: "derivation"
created: 2026-08-07
updated: 2026-08-07
tags: []
parent: PLAN-080
plan: PLAN-080
links:
  - {id: TASK-338, type: supersedes}
  - {id: TASK-337, type: supersedes}
---
# Objective

Widen `deriveAcCoverageState` from five return values to seven — adding `fail_superseded` (M4)
and `not_measured` (M5) — thread an OPTIONAL `recorded_at` onto `EvidenceRefLite`, and wire
every consumer and every stale assertion in the SAME unit.

⛔ The binding precedence table, the three fail-closed supersession tie-breaks, and the
complete-return-set rule are in the governing spec's Design section, §"The seven-value
precedence, after M4 and M5". **Read it first — it is the contract, and this task does not
restate it.** `lore get spec-oracle-tier-falsifiability-a-criterion-never-observed-red`

# What "done" means here, stated as the trap to avoid

Four false greens were measured in the immediately preceding slice, all the same shape:
capability implemented, production call site never wired, AC green anyway. This task's anchor
set was drawn to make that impossible — but only if you treat the WIRING as the deliverable and
the function as an implementation detail of it.

The specific hazard here, already measured: `commands/ac.ts::coverageBadge` (≈:573) selects on
state with an **if-chain, not an exhaustive `switch`**. When the union widens, `tsc` says
nothing and a `fail_superseded` fact falls through to the `⚑?` / `⚑R` / `·` residual markers —
a green typecheck over a silently wrong badge. Two of the six consumers ARE caught by `tsc`;
the rest are not. The table in the plan doc says which is which.

# Required changes

1. **`packages/core/src/acceptance.ts`**
   - `EvidenceRefLite` gains `recorded_at?: string` (⛔ OPTIONAL — plan D4). `computeAcCoverage`
     populates it from the evidence entry's `recorded_at` in the SAME single pass; do not add a
     traversal.
   - `deriveAcCoverageState` implements the spec's seven-row table verbatim, including the three
     fail-closed tie-breaks.
   - ⛔ `falsified` counting is UNTOUCHED. Its historical semantics are correct and deliberate;
     only `state` changes time semantics. AC-FALS-15 asserts the counts did not move.
   - Update the JSDoc at ≈:263-268 (the Silence note whose completeness claim M5 disproves) and
     ≈:365-401 (the precedence prose and all three `@example`s).
2. **`packages/core/src/evidence-panel.ts` ≈:826** — the comment "mirrors
   `acceptance.ts::deriveAcCoverageState`'s 'a fail always wins' rule" becomes false. Correct it
   in a form that names the divergence; ⛔ `deriveEvidenceTallyStatus` itself is a DIFFERENT
   function over a DIFFERENT input (a tally, not a fact) and its behaviour does NOT change.
3. **`commands/ac.ts::coverageBadge`** — explicit, distinct markers for both new states. ⛔ Do
   not let either reach the residual-marker tail. ⛔ Do not convert the if-chain silently: if you
   restructure it, `cli-ac-coverage-badge.bun.test.ts`'s existing expectations must still pass
   unchanged, and any that change are a finding to report, not to absorb.
4. **`commands/status.ts` ≈:524** — the corpus-wide `pass_unfalsified` count must not move.
   Verify by running it, not by reasoning about it.
5. **`task-feed-flow.ts:142` and `SpecAcCoveragePanel.tsx:40`** — both re-declare the state union
   by hand. ⛔ Replace each with a type derived from the derivation
   (`ReturnType<typeof deriveAcCoverageState>`), not a hand-widened copy: the copies ARE the SSOT
   defect, and hand-widening them preserves it in a form that will drift again.
6. **`SpecAcCoveragePanel.tsx::stateVariant`** — a badge variant for each new state.
   `fail_superseded` must be visually distinct from both `fail` and `attested_pass`;
   `not_measured` must not read as more confident than `pass`. State your colour reasoning in the
   JSDoc the way the existing `pass_unfalsified` note does.
7. **`packages/dashboard/tsconfig.tests.json`** — ⛔ the diagnosis in the original defect report
   is WRONG; do not act on it. Measured 2026-08-07 from the repo root:
   `bunx tsc -p packages/dashboard/tsconfig.tests.json --noEmit --listFilesOnly` resolves 648
   files of which **ZERO** are under `packages/dashboard/tests/`. The config declares
   `include: ["src/**/*","tests/**/*"]` but `extends: "./tsconfig.json"`, and **`extends` does
   not reset `exclude`** — the base's `exclude: [...,"tests"]` is inherited and `exclude` filters
   `include`. Its exit 0 is the exit code of checking nothing. Fix: give
   `tsconfig.tests.json` its own `exclude` that does not swallow `tests`.
   ⛔ Do NOT wire this project into `bun run typecheck` in this task — un-excluding the tree
   surfaces 50 errors, 46 of them pre-existing and unrelated, which would break AC-FALS-11 on
   this commit. Phase `typecheck-sweep` owns those; AC-FALS-24 is not in your scope.
   ⛔ `packages/dashboard/tsconfig.json` needs no change; it is anchored only so you can read it.
8. **The two hand-built fact helpers** — `makeFact()` in `SpecAcCoveragePanel.test.tsx` AND the
   inline facts in `packages/dashboard/tests/component/PhaseProgressPanel.test.tsx:129-130` (the
   sibling helper the defect report predicted but did not name; it is 2 of the 4 `falsified`
   errors). Give each a `falsified` value and restate every expectation that was green only
   because the field was absent. ⛔ Those expectations are currently passing for the WRONG reason.
   ⛔ Exactly these 4 `falsified` errors are yours; the other 46 are not.
9. **`packages/core/src/CLAUDE.md:13`** — states the five-value ladder verbatim. ⚠ 14863/16384
   bytes, 1521 free. ⛔ If the edit crosses the ceiling, evict a block to the corpus and leave a
   one-line pointer; ⛔ never raise the ceiling, ⛔ never reflow long lines (the budget is BYTES,
   not lines). Re-run `lore status --check-claude-md` after editing.
10. **`packages/lore/src/adapters/cli/CLAUDE.md:36`** — verify the `pass_unfalsified_count` prose
    is still true after the change rather than assuming it; correct it if not.

# Oracles

Every criterion in `ac_scope` is declared on the governing spec with its exact command —
`lore ac list spec-oracle-tier-falsifiability-a-criterion-never-observed-red`. AC-FALS-14
through AC-FALS-23 are new for this task; AC-FALS-11 / 12 / 13 are pre-existing and are in scope
as REGRESSION (typecheck, vitest consumers, bun consumers).

⛔ **AC-FALS-23 is the wiring oracle and it cannot be satisfied by the function alone.** It runs
the real `lore ac list` read path from source against the live corpus and requires AC-FALS-11 and
AC-FALS-13 to read `fail_superseded` while AC-FALS-3 still reads `attested_pass`. It is READ-ONLY
on the corpus. Measured red before dispatch (exit 1, reading `fail fail attested_pass`) —
that expected-fail row is already recorded against this task, so ⛔ do not re-record it; record
the PASS when you have one.

⛔ **Red-first is per-criterion and yours to record at the moment it goes red.** For each new
criterion, run the oracle BEFORE the implementation exists (or with the assertion inverted) and
record `lore evidence <task> --oracle <kind> --command "<cmd>" --result expected-fail --ac-ref
<AC-ID>` from inside your worktree, at that moment. Transcribing it afterwards does not count.

⛔ Exit codes are measured WITHOUT a pipe: `cmd > out 2>&1; echo $?`. `set -e` is inert in this
shell — chain with `&&`.

⛔ Evidence `output_tail` MUST be non-empty and contain the runner's summary line
(`N passed` / `Done`). An empty tail is a self-report and does not count toward AC coverage.

# Scoped verification

Use `bun run test:changed <base>` — the repo's deterministic cross-runner selection oracle. ⛔ Do
not run the full suite in the worktree; the main orchestrator runs it once on the merged tree.
`bun run typecheck` IS in scope (it is AC-FALS-11) and must exit exactly 0.

⛔ `packages/core` is a workspace sub-package: after changing its exports, BUILD it before
typechecking a dependant, or the dependant sees a stale surface and reports a false red.

# Out of scope

- Blocking or gating on any of the seven states. This whole mechanism is report-only by the
  governing ADR; nothing here changes exit codes.
- Rewriting or deleting historical evidence rows. The log is append-only by design — a log that
  can be edited to improve a derived label is worthless as evidence.
- Recording `expected-fail` in place of a genuinely-still-red `fail`. If your final in-worktree
  state is red for a criterion, record `fail` and say so; the supersession rule exists so that an
  honest red no longer pins the state forever.

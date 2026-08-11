---
id: TASK-382
type: task
role: plan
title: "Three of five static checkers are INERT: no exported main and/or no real-tree assertion, so nothing ever runs them against this checkout"
status: archived
priority: critical
created: 2026-08-03
updated: 2026-08-03
tags: []
parent: PRD-001
links:
  - {id: ADR-029, type: relates-to}
---
# Defect — three of five static checkers are INERT: nothing ever runs them against this tree

Measured 2026-08-03 on `main @ 23bb6bf`, clean tree, full suite green
(`TEST_EXIT=0`, `TYPECHECK_EXIT=0`, vitest 451 files / 7948 passed, bun 1767 pass / 0 fail).

`scripts/check-*` is the repo's static-invariant layer. There is **no CI** (`.github/` does
not exist) and `hooks/pre-push` runs four `lore` checks and **zero** `check-*` scripts, so the
ONLY way one of these guards ever executes against this checkout is a test that calls its
`main()` with no injected root. Measured per checker:

| checker | has a test | runs against the REAL tree | armed by `bun run test` |
|---|---|---|---|
| `check-no-nul-bytes.ts` | yes | yes — `describe("check-no-nul-bytes: real repo tree (task oracle)")`, `expect(main()).toBe(0)` | **ARMED** |
| `check-test-budgets.ts` | yes | yes — `describe("check-test-budgets ledger: main() — real repo tree, task Acceptance Criterion #1")` | **ARMED** |
| `check-no-timer-retry.ts` | yes | **no** — exercises extraction/scan pure functions only, never calls `main()` | INERT |
| `check-ac-ref-integrity.ts` | yes | **no** — end-to-end suite is `mkdtemp` + `lore init` throwaway only | INERT |
| `check-ordinal-write-sites.mjs` | **none** | **no** | INERT |

`package.json` registers all five as `check:*` scripts. Nothing invokes those scripts —
verified by grepping `packages/`, `scripts/`, `hooks/`, `assets/`, `.claude/` for every script
name and every `check:*` task name; the only hits are the scripts' own definitions and their
fixture tests.

# Mechanism root — the arming step is convention, carried by no mechanism

Two checkers are armed and three are not, and the difference is invisible from the outside:
all five are registered identically in `package.json`, all five have module headers describing
their invariant, and `bun run test` is green either way. A guard that is never executed is
indistinguishable from a guard that passes — the sixth false-oracle vector this corpus
catalogues, applied to the guard layer itself.

The two armed checkers share an exact convention the three inert ones do not:

    export function main(repoRoot: string = REPO_ROOT): number   // RETURNS, never exits
    if (import.meta.main) { process.exit(main()); }               // exit only at the entry

`check-ordinal-write-sites.mjs` violates it structurally — `function main()` at line 207 is
**not exported** and calls `process.exit()` directly at lines 232 / 239 / 246, so it cannot be
imported and asserted on at all. `check-no-timer-retry.ts` and `check-ac-ref-integrity.ts`
have the `import.meta.main` guard but export no `main`.

# Required fix

1. Bring all three inert checkers onto the armed convention: `export function main(repoRoot =
   REPO_ROOT): number` that RETURNS its exit code, with `process.exit` moved into the
   `import.meta.main` entry block. Preserve every existing exit-code meaning verbatim (the
   ordinal script's `0 / 3 / 4` contract is documented in its own header — do not renumber).
2. Add a real-tree arming assertion for each, copying the shape of
   `scripts/tests/check-no-nul-bytes.test.ts`'s `describe("... real repo tree (task oracle)")`:
   call `main()` with NO injected root and assert the exit code.
   - `check-ordinal-write-sites` has NO test file at all — create
     `scripts/tests/check-ordinal-write-sites.test.ts` with the real-tree arming assertion
     plus fixture-level coverage of its two rules (allocation arithmetic, direct SQL write).
   - `check-no-timer-retry` / `check-ac-ref-integrity`: ADD the real-tree describe to the
     existing suites; change no existing assertion.
3. ⛔ `check-ac-ref-integrity`'s real-run must be **READ-ONLY against this repo's own
   `.lore/`**. It must not create, edit, or delete a single corpus doc. If its `main()` cannot
   run read-only, say so and STOP — do not point it at the live corpus with any write path
   reachable, and do not substitute a throwaway corpus and call that "the real tree" (that is
   the assertion that already exists and is exactly what makes it inert).

# ⛔ The one outcome that must NOT be engineered away

A checker that has never run against this tree may go **RED immediately**. That is the
finding, not a failure: it is pre-existing debt that no mechanism has ever been able to see.

- ⛔ Do NOT weaken a rule, narrow a scan scope, or add an allowlist/exemption entry to make a
  newly-armed checker green. An allowlist entry authored to silence a first run is the
  silent-fallback pathology this whole task exists to remove.
- ⛔ Do NOT ship a skipped/`.todo` arming test, and do NOT ship a knowingly-failing one.
- If any checker reports violations against the real tree: keep the arming code, record the
  COMPLETE violation list verbatim in your completion report (file:line + rule per row), and
  STOP that checker's arming assertion at the point of reporting. The adjudication of
  pre-existing debt is the orchestrator's + user's decision, not this task's.

# Oracle

- RED first, per checker: the arming assertion must FAIL before the `main()` export exists
  (an unexported `main` is a compile/import error — demonstrate it, do not assume it).
- For each of the three: `bun run test` executes the checker against the real tree, and
  temporarily introducing a real violation of that checker's rule makes the suite go RED,
  then removing it restores green. Assert the DEMONSTRATED failure, not only the green —
  otherwise "armed" is itself unproven (a `main()` that returns 0 unconditionally would pass).
- CONTROL: the two already-armed checkers' suites are byte-unchanged and still pass.
- CONTROL: each checker's CLI behaviour is unchanged — `bun run check:<name>` still exits with
  the same code it did before (measure it WITHOUT a pipe: `bun run check:x > out 2>&1; echo $?`).
- CONTROL: `bun run typecheck` stays at 0.

Distribution surface: this repo's own `scripts/` + test tree. These guards are dev-repo
oracles, not shipped consumer surface — they do not belong in `assets/`.

---
id: SPEC-101
type: spec
role: spec
title: "Two-runner changed-test selection — deterministic test:changed replaces vitest-only regression sweep"
status: approved
priority: medium
created: 2026-07-28
updated: 2026-08-20
tags: []
parent: PRD-001
links:
  - {id: SPEC-094, type: implements}
---
# Two-runner changed-test selection — deterministic `test:changed` replaces the vitest-only regression sweep

## Overview/Goal

This repo runs two test runners with a hard convention split: `.bun.test.ts` under `bun test` (bun:sqlite), everything else under vitest. The de-facto worktree regression sweep — `bunx vitest run --changed <base>` — is **structurally blind to every `.bun.test.ts` file**: vitest's dependency graph never loads them, so a change whose consumers live bun-side sweeps green while broken. This is not hypothetical: during spec-verify-reachability, T1's M3 change (`attestation_exempt_kind` required) broke `plan-close-cascade.bun.test.ts` fixtures; the implementer's `vitest --changed` regression (268 files, 4504 tests) showed green, and the break surfaced only in the main-checkout full-suite run (retro `knowledge-full-system-spec-compliance-audit-2026-07-27-85-11-1`, follow-up lesson 2). The existing guidance ("anchor-matched bun test") is fuzzy prompt discipline — exactly the class this repo mechanizes.

Goal: one deterministic command — `bun run test:changed [<base>]` — that selects and runs affected tests across BOTH runners via transitive reverse-dependency analysis, with loud selection accounting (counts + per-file reasons), so a worktree implementer's scoped regression can no longer silently skip bun-side consumers.

## Scope

**In scope:**
- `scripts/changed-tests.ts` — the selector + runner:
  1. Changed set: `git diff --name-only <base>...HEAD` plus uncommitted changes (`git status --porcelain`), default base `main` (worktrees: `git merge-base main HEAD`).
  2. Import graph: regex-scan static `import`/`export ... from` specifiers across `packages/*/src/**/*.ts` and `packages/*/tests/**/*.ts` (no new dependencies, no ts-morph); resolve relative specifiers and the workspace aliases `@lore/core` / `@lore/core/node` to their entry files. Dynamic imports and non-literal specifiers are ignored by design (documented limitation).
  3. Selection = union of: (a) changed test files themselves; (b) test files transitively reaching ≥1 changed source file over the reverse-dependency BFS; (c) **binary-consumers** — `.bun.test.ts` files matching `dist/lore`-spawn markers (regex on `dist/lore` / `LORE_BIN`), included whenever ANY `packages/lore/src/**` or `packages/core/src/**` file changed (they exercise the compiled whole; import tracing cannot see through a spawn).
  4. Execution: selected vitest files via `bunx vitest run <files>`; selected bun files via `cd packages/lore && bun test <files>`; when ≥1 binary-consumer is selected, `bun run build` runs FIRST (stale-`dist/lore` false-oracle lesson, mechanized at the selection layer).
  5. Accounting is mandatory output: per-runner selected counts + per-file reason tag (`changed-test` | `transitive` | `binary-consumer`); `--list` prints the selection without running; source files changed but zero tests selected → a loud `0 selected` warning line (never silent).
  6. Exit code: non-zero iff any executed runner fails (or git/graph resolution errors — fail loud, no partial-silent fallback).
- `package.json` script `test:changed`.
- Delivery surfaces (distribution-first): root `CLAUDE.md` §Commands gains the command with its one-line contract; the worktree-oracle guidance line replaces "anchor-matched bun test" ad-hoc wording with `bun run test:changed <base>`.

**Out of scope:**
- Watch mode, coverage, CI wiring, cross-repo distribution via assets/ (repo-local tooling this slice).
- Replacing the post-merge full-suite run on main — `test:changed` is the worktree scoped oracle, the full two-runner suite on main remains the merge gate.
- Dynamic-import / spawn-target tracing beyond the binary-consumer marker heuristic.

## Design Decisions

- **D1 — transitive BFS, not directory heuristics.** First-order import checks miss the actual incident shape (schemas.ts → corpus-service.ts → cascade test). The reverse-dependency closure over a regex import graph is deterministic, dependency-free, and fast (few hundred files).
- **D2 — binary-consumers are dependency-closure escapes, named as such.** A test that spawns `dist/lore` depends on everything; pretending import tracing covers it would rebuild the very blind spot one layer down.
- **D3 — accounting over trust.** Counts + reasons are printed unconditionally (contiguous-substring/under-match standing lessons: a filter's silent no-match is indistinguishable from green).

## Acceptance Criteria

Structured via `lore ac add` (script-mode). Sketch: (1) selector unit suite over a synthetic fixture graph — transitive bun-side selection incl. the incident shape, non-selection of unrelated tests, changed-test direct inclusion, binary-consumer inclusion on src change, alias resolution, zero-selection warning (≥6 cases); (2) real-repo e2e — `bun run test:changed --list <base>` prints both per-runner count lines and per-file reasons with exit 0; (3) `bun run typecheck` exit 0.

### Added 2026-08-19/20, after the original three landed

The selector's coverage is itself a corpus-integrity surface, so the criteria that widen it
belong here rather than in a separate spec:

- **AC-TC-4** — a change set touching `hooks/**` or `assets/**` must select both pre-push
  guards. A hook-ONLY set was already refused with loud-zero, but hook + any matched file —
  and editing `assets/` forces regenerating the assets manifest, which IS a matched file —
  selected non-empty, silenced loud-zero, and still omitted both guards. The oracle drives
  `bun scripts/changed-tests.ts --list`, the shipping entry, never `selectAffectedTests`.
- **AC-TC-5 / AC-TC-6** — AC-TC-4's fix introduced a regression and these close it. Its new
  scope check returned on FIRST match, stripping every other scope from any test that also
  qualified: two tree-scanning oracles lost `repo-tracked-text-source` (the broadest scope)
  and four lost `packages-test-tree`. AC-TC-5 requires classification to return a SET;
  AC-TC-6 requires the marker to be pinned against the two REAL guard files rather than only
  fixture stand-ins, since a fixture-only assertion cannot see a reformat of the real file.

⛔ Both were split by RUNNER, not by preference: `lore verify` credits only one runner
invocation per chained command, so a single criterion spanning a vitest file and a
`.bun.test.ts` file can never be attested. Recorded in
`knowledge-four-governance-gaps-measured-while-resuming-handoff`.

⛔ Standing lesson from this sequence: AC-TC-4 closed one under-selection hole and opened a
wider one, and `lore assess` found it only AFTER AC-TC-4 was attested and its task archived.
A selector fix must state which scopes it ADDS and prove it removes none.


## Acceptance Criteria (structured)

- [⚑] [script] AC-TC-1: Selector unit suite over a synthetic fixture graph passes with >=6 cases: transitive bun-side selection (incident shape core->service->bun-test), unrelated test non-selection, changed-test direct inclusion, binary-consumer inclusion on src change, @lore/core alias resolution, zero-selection loud warning; exit 0
  script: test — bunx vitest run packages/lore/tests/unit/scripts/changed-tests-selector.test.ts
- [⚑] [script] AC-TC-2: Real-repo e2e: bun run test:changed --list HEAD prints one selected-count line per runner (vitest + bun) and a reason tag per selected file, exit 0; suite exits 0
  script: e2e — cd packages/lore && bun test tests/unit/scripts/changed-tests-cli.bun.test.ts
- [⚑] [script] AC-TC-3: bun run typecheck exits 0 across all packages including scripts/
  script: tsc — bun run typecheck
- [⚑] [script] AC-TC-4: A HOOKS-ONLY OR ASSETS-ONLY CHANGE SET MUST SELECT BOTH PRE-PUSH GUARDS: hooks/** and assets/** are outside the selector's universe today. A hook-ONLY change set is correctly refused with loud-zero exit 1, but hook + ANY matched file — the assets manifest that editing assets/ forces you to regenerate is the everyday case — selects non-empty, SILENCES loud-zero, and still omits both hook guards, so the two tests proving pre-push is wired never run. The selector MUST select packages/lore/tests/unit/assets/pre-push-parity.test.ts and packages/lore/tests/integration/pre-push-trip.bun.test.ts (its post-AC-BFI-11 name) for a change set touching hooks/**, and likewise assets/**, in BOTH the pure and the mixed-with-other-files cases. TWO code sites must change, neither alone sufficient: membership requires a bare main() so an extensionless hook script is never a candidate, and the tree-scan scope predicate rejects extensionless paths. Do NOT retry the literal-path-marker approach — implemented and MEASURED INERT for exactly those two reasons (knowledge-bun-run-test-changed-full-selection-contract-and-its). The oracle MUST drive the SHIPPING surface, bun scripts/changed-tests.ts --list, never selectAffectedTests directly: a selector that selects correctly while the CLI still omits the guards is the false green this criterion excludes. Covered by the describe block titled 'AC-TC-4: hooks-only and assets-only change sets select both pre-push guards' in packages/lore/tests/unit/scripts/changed-tests-cli.bun.test.ts. RED: revert either code site alone and the mixed case must fail NAMING the omitted guard, never by a bare non-zero exit. Falsifier is PROSE not structured — --falsifier-find requires the literal already on disk and every discriminating mutation lives in code this task has not written yet (the red-first/falsifier deadlock, reproduced a third time).
  script: test — bun test packages/lore/tests/unit/scripts/changed-tests-cli.bun.test.ts 2>&1 && echo 'AC-TC-4 PASS: bun scripts/changed-tests.ts --list selects both pre-push guards for hooks-only and assets-only change sets, pure and mixed'
- [⚑] [script] AC-TC-5: TREE-SCAN SCOPES MUST BE ADDITIVE, NOT PRE-EMPTIVE (vitest half): classifyTreeScanningOracle returned on the FIRST matching scope, so the hook/asset check — added last and tested first — stripped every other scope from any test that also qualified. Measured on six real files. TWO lost repo-tracked-text-source, the BROADEST scope: pre-push-parity.test.ts and scripts/tests/check-no-nul-bytes.test.ts stopped being selected for ANY repo-tracked text change at all (README.md, packages/core/src/errors.ts, or any test file). FOUR lost packages-test-tree: check-ac-ref-integrity, check-gap-namespace, check-no-timer-retry and check-ordinal-write-sites stopped being selected for changes inside packages/*/tests/**. ⛔ The two losses are NOT equivalent, and an earlier revision of this criterion blurred them by quoting one sample path for all six: the four were never in scope for a README.md change, so that framing understated the first pair's loss and overstated the second group's. Verified 2026-08-20 with a direct probe of isChangedFileInTreeScanScope per scope. REQUIRED: classification returns a SET of every matching scope and selection fires if ANY member matches; each of the six retains its prior scope AND gains hooks-and-assets-pair. RED: restore the early return and the scope-retention cases must fail, naming the narrowed files with expected-vs-got sets. RE-BASELINED 2026-08-20: the original command chained 'bunx vitest run <selector> && bun test <cli>'; lore verify returned 'AC-TC-5 inconclusive (ran 1 of 2 declared paths)', exit 3, because countExplicitPathArgs credits only ONE runner invocation per chain — the same shape that forced AC-BFI-12's split. This AC keeps the vitest file; AC-TC-6 carries the bun file. A CORRECTION, NOT A WEAKENING: both files stay asserted, by two attestable oracles instead of one unattestable one.
  script: test — bunx vitest run packages/lore/tests/unit/scripts/changed-tests-selector.test.ts 2>&1 && echo 'AC-TC-5 PASS: classification returns a set and all six real multi-scope oracles retain their prior scope while gaining the hook/asset one'
- [⚑] [script] AC-TC-6: THE MARKER MUST BE PINNED IN THE REAL GUARD FILES, NOT ONLY IN FIXTURES (bun half, split out of AC-TC-5): AC-TC-4's suite writes its own stand-in contents at the guard paths inside a temp repo, so it proves only that the selector recognises the marker in FIXTURE text. Nothing asserted that the two REAL guard files contain the literals HOOK_OR_ASSET_PAIR_MARKER_RE matches. Reformat either one and production selection silently reverts to exactly the false green AC-TC-4 exists to exclude, while every fixture case stays green — a whole-class blind spot, not an edge case, because the fixtures are written by the same test that reads them. REQUIRED: read packages/lore/tests/unit/assets/pre-push-parity.test.ts and packages/lore/tests/integration/pre-push-trip.bun.test.ts from disk and pin BOTH the regex match AND classifyTreeScanningOracle's output against their actual content. The regex is exported for exactly this purpose; asserting through it rather than re-spelling the literals keeps the test and the selector on one source of truth. RED (the declared structured falsifier): neutralise the regex to hooks/NEVERMATCH|assets/project/NEVERMATCH and the pinning cases must fail. Measured 2026-08-20: that mutation reddened 1 selector test and 4 CLI tests. NOTE ON THIS AC'S EXISTENCE: it is the bun-runner half of a criterion that had to be split because lore verify credits only ONE runner invocation per chained command, so a two-runner oracle can never be attested. That is a tooling constraint, not a design preference — see knowledge-four-governance-gaps-measured-while-resuming-handoff.
  script: test — bun test packages/lore/tests/unit/scripts/changed-tests-cli.bun.test.ts 2>&1 && echo 'AC-TC-6 PASS: the two real guard files are read from disk and pinned against the exported marker regex and the classifier output'

## Code anchors

- scripts/changed-tests.ts#selectAffectedTests
- packages/lore/tests/unit/scripts/changed-tests-selector.test.ts
- packages/lore/tests/unit/scripts/changed-tests-cli.bun.test.ts

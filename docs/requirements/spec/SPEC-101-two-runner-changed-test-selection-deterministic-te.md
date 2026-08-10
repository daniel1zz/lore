---
id: SPEC-101
type: spec
role: spec
title: "Two-runner changed-test selection — deterministic test:changed replaces vitest-only regression sweep"
status: approved
priority: medium
created: 2026-07-28
updated: 2026-07-28
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


## Acceptance Criteria (structured)

- [✔] [script] AC-TC-1: Selector unit suite over a synthetic fixture graph passes with >=6 cases: transitive bun-side selection (incident shape core->service->bun-test), unrelated test non-selection, changed-test direct inclusion, binary-consumer inclusion on src change, @lore/core alias resolution, zero-selection loud warning; exit 0
  script: test — bunx vitest run packages/lore/tests/unit/scripts/changed-tests-selector.test.ts
- [✔] [script] AC-TC-2: Real-repo e2e: bun run test:changed --list HEAD prints one selected-count line per runner (vitest + bun) and a reason tag per selected file, exit 0; suite exits 0
  script: e2e — cd packages/lore && bun test tests/unit/scripts/changed-tests-cli.bun.test.ts
- [✔] [script] AC-TC-3: bun run typecheck exits 0 across all packages including scripts/
  script: tsc — bun run typecheck

## Code anchors

- scripts/changed-tests.ts#selectAffectedTests
- packages/lore/tests/unit/scripts/changed-tests-selector.test.ts
- packages/lore/tests/unit/scripts/changed-tests-cli.bun.test.ts

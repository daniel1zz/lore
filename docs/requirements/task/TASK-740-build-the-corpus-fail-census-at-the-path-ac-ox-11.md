---
id: TASK-740
type: task
role: plan
title: "Build the corpus fail census at the path AC-OX-11 already names, and record its first red"
status: deprecated
priority: high
phase: "corpus-cleanup"
created: 2026-08-21
updated: 2026-10-10
tags: []
parent: PLAN-079
plan: PLAN-079
---
# Task Objective

Build the corpus-wide FAIL CENSUS that `AC-OX-11` declares, at the exact path its oracle
already names: `packages/lore/tests/unit/service/corpus-fail-census.test.ts`. Measured
2026-08-21: that file DOES NOT EXIST, so AC-OX-11's declared command cannot run at all —
it is a criterion with a dangling oracle, which is why it carries zero evidence.

# Spec Reference

`spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a`, `AC-OX-11`
(the half split out of AC-OX-6 on 2026-08-10, purely additive).

Declared command (do NOT restate it from memory — read it with `lore ac list`):

    bunx vitest run packages/lore/tests/unit/service/corpus-fail-census.test.ts -t no-discovery-refusal-fails

# Acceptance Criteria

`AC-OX-11` — a corpus-wide census reports ZERO acceptance criteria in state `fail`,
enumerated FROM THE STORE rather than counted per-spec by hand, and the census NAMES each
offender when non-zero.

Its declared RED: re-point one criterion's command at a nonexistent path, re-run, and the
census must report 1 naming that criterion. ⛔ Run that red. A green-only run does not
count as verification.

# Context Digest

- ⛔ AC-OX-11 carries a DEPENDENCY clause: "not verifiable until AC-FR-5 of
  spec-falsifiability-reachability ships the count enumerator". That dependency is now
  SATISFIED — measured 2026-08-21, `lore status --enumerate pass_unfalsified_count` exits 0
  and returns 29 named members. The enumerator seam is
  `packages/lore/src/adapters/cli/commands/status.ts` (the `--enumerate` field registry
  around line 750, and `passUnfalsifiedMembers` around line 601). Read it before writing a
  second enumeration path — `deriveAcCoverageState` is the single source of the verdict and
  the census MUST call it, never re-derive precedence.
- The census is the FAIL direction of the same shape. Baseline measured 2026-08-21, four
  offenders, unchanged from the 2026-08-10 baseline in AC-OX-11's own statement:
  `AC-061-7` (1/3, 3 attested), `AC-062-3` (1/1, 1 attested), `AC-062-5` (1/1, 1 attested),
  `AC-064-7` (0/1, not attested).
- ⛔ So on the day this test lands the census will report 4, not 0. That is CORRECT
  behaviour and it means AC-OX-11 goes RED first. Record that red at the moment it is red,
  with `lore evidence --result expected-fail`, from inside the worktree that measured it.
  A red transcribed later by the orchestrator is not evidence. The sibling task
  `task-correct-the-three-mistyped-ac-oracle-commands-and-drive` is what drives the count
  to 0; this task's job is the instrument, not the number.
- ⛔ `fail` and `fail_superseded` are DIFFERENT states and must not both count as `fail`.
  `deriveAcCoverageState` already separates them (`packages/core/src/acceptance.ts`). The
  census counts `fail` only — a criterion whose fail was superseded by a newer attested
  pass is not an offender, and collapsing the two would make the census lie in the
  direction that looks worse, which is still a lie.
- ⛔ The census must not read this repo's `.lore/` for its assertions where a fixture will
  do. Seed an InMemoryStore for the RED case; the live-corpus read is the separate
  observation. `packages/dashboard/tests/e2e/global-setup.ts` holds the throwaway-corpus
  pattern if a real corpus is unavoidable.
- Runner: this file ends in `.test.ts`, so it runs under vitest. ⛔ Do not use `bun:sqlite`
  in it — that would force the bun runner and break the declared command.

# File Anchors

- `packages/lore/tests/unit/service/corpus-fail-census.test.ts` (to create)

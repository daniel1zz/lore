---
id: PLAN-084
type: plan
role: plan
title: "Implementation — resume-coverage floor satisfaction boundaries: non-empty deferral reason and sidechain non-discharge"
status: archived
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: SPEC-126
phases:
  - {name: "Boundaries"}
---
# Implementation — resume-coverage floor satisfaction boundaries

Implements `spec-resume-coverage-floor-the-satisfaction-boundaries-a`
(AC-RCS-1..3). Two tightenings to the coverage-check verb's satisfaction side,
both in `packages/lore/src/adapters/cli/commands/handoff.ts`, plus their oracles
in the existing unit suite.

## Goal

A deferral without a reason stops closing an item, and a disposition emitted on
a sidechain (subagent) chain stops discharging an obligation the operator never
reads — while arming stays reachable from any chain and every one of the eight
pre-existing `AC-RCH-*` oracles stays green.

## Phases

- **Boundaries** — one task carrying both predicate tightenings and their
  fixtures. Deliberately NOT split per rule: both land in the same two functions
  of the same file, so two tasks would collide on the identical file anchor and
  serialize anyway, paying merge overhead for a diff of a handful of lines.

## Verification

- **Red-first is required, not suggested.** The implementer records a
  `--result fail` evidence row from running the two new AC commands BEFORE
  touching `handoff.ts`, then the matching `--result pass` rows after. A pass row
  with no preceding fail row means the test could never have detected the defect
  it claims to pin.
- **Worktree oracle scope**: `bun install` first in the fresh worktree, then
  `bun run test:changed <base>` — never the full suite. NOTE the catalogued
  blind spot that applies to this exact file: `handoff-coverage-check.test.ts`
  SPAWNS the CLI instead of importing it, so the import-graph selector reports
  `selected 0` for a change to `commands/handoff.ts`
  (`knowledge-two-gaps-t1-surfaced-a-change-selector-blind-to-spawn` §1). The
  three AC commands must therefore ALSO be run explicitly by path; a green
  `test:changed` alone measures nothing here.
- **Independent merge-time oracle, authored before the implementation.** The
  orchestrator holds a probe script written and run BEFORE dispatch, which
  measured the empty-reason defect present with a live control arm. After merge
  it is re-run from the main checkout: the same case must flip to blocked while
  its controls stay unblocked. This is an external oracle the implementer neither
  wrote nor saw.
- **Main-checkout re-verification bypasses cache** (`--force`): a non-forced
  turbo run reads the cache the agent's own worktree populated, which is
  self-report dressed as an independent pass.
- **Full suite once, on `main`, at a clean tree** (`git status --porcelain`
  empty) — a dirty concurrent checkout turns another session's in-flight edits
  into phantom regressions.

## Rollout

Binary-side only. No `assets/` edit, no manifest regeneration, no `lore setup`.
Consumers get both tightenings by upgrading the `lore` binary.

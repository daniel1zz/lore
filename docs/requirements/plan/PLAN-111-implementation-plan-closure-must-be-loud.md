---
id: PLAN-111
type: plan
role: plan
title: "Implementation — plan closure must be loud"
status: archived
priority: medium
created: 2026-07-28
updated: 2026-07-28
tags: [governance, plan-close]
parent: SPEC-107
phases:
  - {name: "Phase 1: Terminality detector", description: "TreeCheckService gains DriftKind 'plan-terminality' (plan non-terminal + >=1 child task + ALL terminal); rendered by lore status --check-tree with nonzero exit; explicitly EXCLUDED from --fix. Boundary: 0-task plan and any-non-terminal-task plan report nothing."}
  - {name: "Phase 2: Loud side effects", description: "lore done: service result carries plan_now_fully_terminal, CLI prints stderr advisory naming plan slug + literal close command, no plan write. lore set: CorpusService.set carries auto_demoted_from_approved on the result; standard patch path prints the same advisory text the AI branch already prints."}
  - {name: "Phase 3: Absence-as-assertion + verification", description: "verifyReachability gains an explicit unknown outcome; describeReachabilityWhy never asserts 'no spec-tier ancestor' from a missing field; plan-close threads hasSpecParent/parentSpecScriptAcCount from the already-resolved plan bundle. Then main-orchestrator verification and gate-passing plan closure."}
---
# Plan: Implementation — plan closure must be loud (terminality / demotion / absence-as-assertion)

Governing spec: spec-plan-closure-must-be-loud-terminality-divergence-silent (approved, AC-CLOSURE-1..6).

## Overview

Land the three root-cause fixes from the 2026-07-28 session review. Each is independently valuable and independently testable; they share only a theme, not code. Deliberately NO auto-magic: the fix for silence is speech.

## Governance Mode

unattended (autopilot). Invariant violations hard-block regardless of mode.

## Invariants

1. No auto-closing of plans anywhere — `lore done` and `lore status --fix` MUST NOT write a plan status. Oracle: AC-CLOSURE-2 and AC-CLOSURE-3 assert absence of the write.
2. `VALID_TRANSITIONS` and the attestation ratio default are untouched (`git diff` on `packages/core/src/schemas.ts` transitions + DEFAULT_ATTESTATION_MIN_RATIO shows no change).
3. No dashboard (`packages/dashboard/**`) changes.
4. The reachability fix removes the CLASS, not just the call site: `verifyReachability` must have an explicit unknown outcome (AC-CLOSURE-5), not merely a populated caller (AC-CLOSURE-6). Both ACs must pass; passing only AC-CLOSURE-6 is a rejected partial fix.
5. Existing suites stay green; full-suite verdict taken on a CLEAN tree at a named commit (repo standing lesson).

## Risk Register

- [M] `DriftKind` is a shared union consumed by CLI rendering, `--fix`, and possibly the dashboard read path — adding a member can silently fall through a non-exhaustive switch. Mitigation: T1's AC requires the new kind to be rendered by `lore status --check-tree` (AC-CLOSURE-2), which exercises the render path end-to-end, and typecheck must stay green (exhaustive-switch errors surface there).
- [M] `hooks/pre-push` runs `--check-tree`; a new drift kind means any repo whose corpus currently has a fully-terminal-but-open plan will start failing pre-push. This is INTENDED (it is the detector working) but must be called out at landing so it is not mistaken for a regression. Mitigation: T1 evidence must record how many such plans exist in this corpus at landing time.
- [L] The demotion advisory could become noisy on high-frequency `lore set` usage. Mitigation: it fires only on an actual approved→draft transition, which is rare and always material.

## Estimation Summary

Phase 1: 4 (2 RED + 2 impl) | Phase 2: 4 | Phase 3: 1. Total ≈ 9 S-units.

## Critical Path

RED tasks are parallel roots; the three impl tasks are mutually independent (disjoint files) and all block final verification.

## Exit Criteria

- All 6 spec ACs carry attested pass evidence (`lore verify`).
- Full two-runner suite exit 0 on a clean tree at a named commit, OR any failure attributed with a reproducible command and accepted in this log.
- ⛔ This plan MUST be closed via `lore set <plan> --status archived` (exit 0 through the plan-close gate) — closing this particular plan by any other means would be self-refuting.

## Phase Descriptions

- Phase 1: Terminality detector — TreeCheckService drift kind + `lore status --check-tree` rendering + `--fix` exclusion (AC-CLOSURE-1, AC-CLOSURE-2).
- Phase 2: Loud side effects — `lore done` last-task advisory + service result fact (AC-CLOSURE-3); `lore set` demotion fact + standard-path advisory (AC-CLOSURE-4).
- Phase 3: Absence-as-assertion — `verifyReachability` unknown outcome + `describeReachabilityWhy` + plan-close ctx threading (AC-CLOSURE-5, AC-CLOSURE-6). Verification phase folded in: main-orchestrator runs `lore verify`, typecheck, full suite on a clean worktree, then closes the plan through the gate.

## Decisions Log

- Detector reuses `--check-tree` rather than a new `--check-*` flag so `hooks/pre-push` arms it for every consumer with zero hook edits (distribution-first). A new flag would ship dark.
- `lore done` announces rather than closes: a gate may legitimately deny, and `done` must never fail for reasons unrelated to its own task.

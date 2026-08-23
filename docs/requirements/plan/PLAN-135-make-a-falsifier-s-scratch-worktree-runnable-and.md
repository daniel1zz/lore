---
id: PLAN-135
type: plan
role: plan
title: "Make a falsifier's scratch worktree runnable and observable: hybrid dependency materialization, wired and falsified end to end"
status: approved
priority: high
created: 2026-08-23
updated: 2026-08-23
tags: [falsifier, scratch-worktree, node-modules]
parent: SPEC-144
phases:
  - {name: "P1-materialization-core"}
  - {name: "P2-runner-coverage-and-cleanup"}
  - {name: "P3-production-wiring"}
  - {name: "P4-declare-falsifiers"}
---
Implements `spec-a-falsifier-s-scratch-worktree-must-be-runnable-and` (approved
v17, 8 criteria AC-SD-1..8), under
`adr-a-falsifier-s-scratch-worktree-gets-dependencies-by-hybrid`.

## Why this plan exists

`lore verify --falsify` currently records `inconclusive` for every `oracle: test`
criterion in this repo, because a scratch worktree built from `git stash create`
never has `node_modules`. AC-FR-11's green control made that honest; it did not
make the falsifier work. This plan makes the scratch worktree runnable AND
observable, so a falsifier can produce a genuine attested red again.

⛔ The one thing this plan must not do is "make the green control pass". Measured
2026-08-23: a plain `ln -s` of the main `node_modules` achieves exactly that while
making every cross-package mutation invisible (exit 0, 77 passed on a deliberately
broken `packages/core`). Runnability and mutation observability are separate
properties and are separately asserted — AC-SD-3 is the load-bearing criterion,
not AC-SD-1.

## Phase structure

**P1 — materialization core.** The new module plus its unit oracles: layout
(AC-SD-1), derivation (AC-SD-2), mutation observability with its green control
(AC-SD-3), and isolation non-regression (AC-SD-4). AC-SD-3 is what separates this
implementation from the rejected one, so it lands with the module, never after.

**P2 — runner coverage and safe cleanup.** Both runners from one materialized tree
(AC-SD-5) and the symlink-escape guard on cleanup (AC-SD-8). AC-SD-8 covers the
most destructive failure mode the layout introduces — cleanup walks a tree holding
400+ symlinks into the developer's real `node_modules` — so it is a first-class
task, not a footnote on P1.

**P3 — production wiring and the guard's non-regression.** Wire materialization
into the live `_runFalsifier` path and prove it from the CLI against a throwaway
corpus (AC-SD-6), and prove the green control still fires for the causes
materialization does not address (AC-SD-7). ⛔ Capability implemented is not
production wiring; these are the same acceptance unit as the P1 module, split into
its own phase only because the surface oracle is an integration test.

**P4 — declare falsifiers and close the record.** The 8 criteria were authored
before their implementation existed, so no `--falsifier-*` could be declared at
`ac add` time (the falsifier path did not exist). Once P1-P3 land, declare a
falsifier per criterion and drive `lore verify --falsify` over them — which is
also the first end-to-end use of the very mechanism this plan repairs, and
therefore its own best test. Also re-syncs the anchor ledger and the spec's
`code_anchors`.

## Explicit risks

- **The rejected layout is the attractive one.** An implementer who reaches for
  `ln -s node_modules` will see a passing green control and reasonably conclude
  success. AC-SD-3 exists to refuse exactly that, and its RED (i) names the
  measured outcome (exit 0, 77 passed) so the failure is recognisable.
- **Cleanup can destroy the developer's `node_modules`.** A recursive delete that
  follows symlinks walks out of the scratch tree into the real dependency tree.
  AC-SD-8 pins a sentinel; treat any cleanup change as touching AC-SD-8.
- **The workspace set rots.** A package added later without the derivation seeing
  it silently reverts to the rejected layout for that package. AC-SD-2 pins
  derivation; ⛔ no literal package count belongs anywhere in this plan's code.
- **Third-party packages are SHARED** with the main checkout (ADR-accepted,
  unmitigated). A test writing inside `node_modules` escapes isolation, and
  AC-SD-4's digest covers `git ls-files` output, which does not include
  `node_modules`. Recorded, not solved.
- **P4 validates the falsifier using the falsifier — a circularity.** "All eight
  criteria produced an attested red" is consistent with two different worlds: the
  mechanism works, or the mechanism now says yes to everything. An affirmative
  run cannot distinguish them, which is the same structure as the exit-code
  defect this plan repairs, one level up. ⛔ P4 therefore MUST include a
  NEGATIVE control: declare one throwaway criterion whose falsifier mutation is
  deliberately inert (a find-text replaced with itself, or a mutation in a file
  the command never imports) and show that `lore verify --falsify` refuses it —
  reports the mutation did not produce the declared failure — rather than
  recording a red. Eight greens without that control prove nothing about
  discriminating power.

---
id: KN-486
type: knowledge
role: knowledge
title: "lore verify --falsify compares only the exit code, so an uninstalled scratch worktree mints a proven red out of a module-not-found error"
status: approved
priority: critical
created: 2026-08-21
updated: 2026-08-21
tags: []
parent: PRD-001
links:
  - {id: KN-483, type: relates-to}
  - {id: SPEC-134, type: relates-to}
  - {id: SPEC-133, type: relates-to}
---
Measured 2026-08-21. The corpus's ONLY mechanism for machine-proving that an acceptance
criterion's oracle can actually fail is `lore verify --falsify`. It compares the observed exit
code against the declared one and records nothing about the output. In this repo that makes it
vacuous for essentially every criterion, and it fails in the direction that MANUFACTURES the
strongest-looking evidence the corpus has.

## What happened

Two falsifiers were declared post-fix by the orchestrator on
`spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor`, exactly as the plan required,
and run while the plan was live:

    lore verify plan-close-the-two-bootstrap-fixpoint-follow-ups-one-anchored --falsify AC-BFI-14 --task task-collapse-the-two-production-copies-of-the-anchored
    → Attested red recorded for AC-BFI-14: exit 1 (declared 1) — result:expected-fail, capture_source:runner.

    lore verify plan-close-the-two-bootstrap-fixpoint-follow-ups-one-anchored --falsify AC-BFI-15 --task task-force-ac-bfi-13-s-red-inside-a-throwaway-corpus-that-owns
    → Attested red recorded for AC-BFI-15: exit 1 (declared 1) — result:expected-fail, capture_source:runner.

Both were reported as machine-proven discriminating power. Both are worthless. The recorded
output tails say why:

`AC-BFI-14`'s row:

    Could not resolve 'vitest/config' in vitest.config.ts
    failed to load config from /private/var/.../lore-attested-red-dfxdLW/wt/vitest.config.ts
    Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'vitest' imported from …/wt/vitest.config.ts

`AC-BFI-15`'s row:

    error: Cannot find module '@lore/core' from …/lore-attested-red-ozmK1k/wt/packages/lore/src/app.ts
    0 pass / 1 fail / 1 error

`--falsify` creates a SCRATCH git worktree (`/tmp/lore-attested-red-*/wt/`), applies the
mutation there, and runs the command. That worktree has **no `node_modules`** — nobody runs
`bun install` in it. So the command dies at module resolution before a single assertion
executes. It exits 1. The declared falsifier exit code was 1. The runner compared 1 to 1 and
recorded a proven red.

⛔ The mutation was never exercised. The oracle was never run. The row has ZERO discriminating
power and is indistinguishable, afterwards, from a genuine one.

## Why choosing a better exit code cannot fix it

Both of this repo's runners exit 1 for a startup failure AND for an assertion failure — vitest
and `bun test` alike. So no declared exit code can separate "the mutation reddened the oracle"
from "the tree cannot run the oracle". The distinguishing signal is only ever in the OUTPUT,
and `--falsify` does not look at it.

This is vector one of the false-oracle family, verbatim from the root CLAUDE.md: *a
reverse-control probe placed outside the tree being linted, where the tool exits fatal and the
rule never runs, has zero discriminating power for "is the rule live" — the fix is to assert the
exit code is EXACTLY the expected value **AND** that the output contains the rule's own name.*
`--falsify` implements the first half and not the second, so the mechanism built to enforce
that lesson violates it.

## The inversion this produced

For these two criteria the evidence hierarchy is upside down:

| row | label | actual worth |
|---|---|---|
| implementer's in-worktree red | `expected-fail`, SELF-REPORT | **genuine** — real assertion failures, e.g. `expected [ …(2) ] to deeply equal [ Array(1) ]` naming the injected second copy, and `case "code_anchors: a non-empty array, AND deleted_at set": witness classified anchored=false but the shared isSpecAnchored classified anchored=true` |
| orchestrator's `--falsify` row | `expected-fail`, `capture_source: runner` | **noise** — module-not-found in an uninstalled worktree |

So the self-reported rows are the evidence and the runner-attested rows are the artifact. That is
the exact opposite of the standing rule that attested beats self-reported, and it is the reason
this doc exists rather than a one-line note.

## How it was caught, and what that says

Not by the run. `lore verify --falsify` printed a success line and exited 0. It was caught by
`lore assess`, which read the evidence tails and reported: *"Those rows show a broken
environment, not an oracle discriminating a mutation, so they add no discriminating power beyond
the implementer-run reds."* The judge was right and the orchestrator's own report of "machine-proven"
was wrong. ⛔ Third recorded instance of the advisory layer catching what the deterministic layer
certified — `lore assess` is load-bearing, not advisory-in-practice.

## Required fix, at the mechanism

1. `--falsify` MUST compare more than the exit code. The minimum honest contract: the declared
   falsifier gains an expected-output predicate (a literal the mutated run's output must
   contain), and a run whose output does not match records `inconclusive`, never
   `expected-fail`. `inconclusive` already exists for exactly this "we do not know whether this
   measured the thing" meaning.
2. The scratch worktree must be able to run the command at all — install dependencies, or reuse
   the invoking tree's `node_modules`, or refuse loudly when the command's runner is
   unresolvable. ⛔ Refusing loudly is acceptable; recording a red is not.
3. A green control is required before the red counts: run the UNMUTATED command in the same
   scratch worktree first. If that does not pass, the environment is broken and no verdict about
   the mutation is available. This single step would have caught both rows above, and it needs no
   new declaration syntax.

## Standing consequence until it is fixed

⛔ Do not read `result: "expected-fail"` + `capture_source: "runner"` as proof of discriminating
power. Read the row's output tail and confirm it contains the assertion the mutation was supposed
to trigger. The two rows named at the top of this doc are known-vacuous; they are append-only and
cannot be removed, so they are named here instead.

⛔ `plan-close-the-two-bootstrap-fixpoint-follow-ups-one-anchored` is deliberately being LEFT
OPEN rather than archived, even though both its tasks are archived and its work is complete: a
falsifier is only re-runnable while its governing plan is live
(`knowledge-the-falsifier-mechanism-is-shipped-but-inert-a` F2). Archiving it now would make
AC-BFI-14 and AC-BFI-15 permanently unprovable the moment the runner is fixed.

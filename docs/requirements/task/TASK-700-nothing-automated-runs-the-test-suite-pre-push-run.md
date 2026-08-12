---
id: TASK-700
type: task
role: plan
title: "Nothing automated runs the test suite: pre-push runs four corpus checks and zero tests, there is no CI at all, and this repo has no remote so pre-push never even fires — a sound oracle that nothing invokes is not a gate, and two defects already walked through"
status: archived
priority: low
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PRD-001
links:
  - {id: KN-440, type: relates-to}
  - {id: ADR-032, type: relates-to}
---
> ⛔ **CANCELLED 2026-08-12 — do not implement.** The user ruled that CI/CD is the consuming
> team's own infrastructure and will not be built into lore; pre-push stays corpus-only and does not
> grow a test step. The decision and its rationale are in
> `adr-ci-cd-is-the-consuming-team-s-own-infrastructure-not-a-lore`.
>
> The MEASUREMENTS below remain accurate and are the reason this document is kept rather than
> deleted — they will be rediscovered by a future session, and the ADR is the answer to them.
> ⛔ Do not re-file this task; supersede the ADR instead if the boundary is ever revisited.

Nothing automated runs this repo's test suite. Not on commit, not on push, not in CI — because
there is no CI. The only thing between a RED test and `main` is an agent voluntarily choosing to run
one, and two defects have already walked through that gap.

## Measured 2026-08-12 by the orchestrator

    hooks/pre-push                     -> 4 commands, ZERO tests:
                                          lore status --check-tree --check-drift
                                          lore audit --verify
                                          lore status --check-prd-budget
                                          lore status --check-claude-md
    cmp hooks/pre-push assets/project/pre-push   -> IDENTICAL (byte-for-byte)
    assets manifest                    -> project/pre-push, kind "project", ownership "managed"
                                          => it SHIPS to every consumer via `lore setup --project`
    ls .github .gitlab-ci.yml …        -> NONE. No CI configuration of any kind, anywhere.
    git remote -v                      -> EMPTY
    git config core.hooksPath          -> /Users/apple/Projects/zz/lore/hooks  (installed, active)

## Two DIFFERENT holes, and conflating them will produce a wrong fix

1. **In THIS repo, `pre-push` is structurally unreachable.** There is no remote, so `git push` never
   happens, so the hook never fires — not even its four corpus checks. `core.hooksPath` is correctly
   set; the hook is correctly installed; it simply has no trigger. Every "the pre-push gate protects
   us" statement in this repo's own docs is, here, vacuous.
2. **For CONSUMERS, `pre-push` fires but runs no tests.** They get the four corpus checks and nothing
   else, so any test-shaped oracle is push-invisible for them too — but for a different reason.

⛔ A fix that only adds tests to `assets/project/pre-push` closes hole 2 and leaves hole 1 fully
open, which is the hole that actually bit this repo twice.

## The evidence that this is not theoretical

- **Stale assets manifest reached main (`c3803eb2`).** `packages/lore/tests/unit/build/embed-assets-manifest.test.ts`
  DOES pin the checked-in manifest against a fresh recomputation over `assets/`. The oracle was sound
  and present. Nothing invoked it. ⛔ **An existing sound oracle is not a gate until something runs it.**
- **Two RED e2e cases are sitting on main right now** (`task-main-carries-two-red-e2e-cases-migrate-ordinals-compiled`)
  — deterministic, not flaky, and unmentioned by any handoff. They were found only as collateral of an
  unrelated `test:changed` run.

Both are the same failure: coverage existed, invocation did not.

## Why the obvious fix is wrong

⛔ Do NOT simply put `bun run test` in `pre-push`. Measured on this machine: the bun phase alone is
**476s**, plus ~95s for vitest. A gate with a ~10-minute latency does not get obeyed — it gets
`--no-verify`, and `--no-verify` disables the FOUR corpus checks that currently work. A slow gate is
strictly worse than the status quo because it takes the working checks down with it.

⛔ Do NOT reach for `bun run test:changed` without reading its contract first. It is the right shape
(deterministic cross-runner selection, loud-zero on a non-empty changed set) but its module header
documents TWO residuals that matter for a gate: selection reads CONTENT MARKERS, so a subprocess/scan
test naming none is invisible; and reverse-dep resolution walks STATIC imports only, so a test
reaching its target through `await import()` in a function body is never selected. A gate built on it
inherits both blind spots — that may be acceptable, but it must be stated, not discovered later.

## Required — decide the LAYER before writing any script

Enumerate and justify; ⛔ do not silently pick one:

1. **CI (none exists today)** — the only layer that can run the full suite without blocking a human
   or agent. Requires a remote, which this repo does not have. Answers hole 1 and hole 2 for anyone
   who pushes; answers neither for a local-only checkout.
2. **`pre-push` with a SELECTED subset** (`test:changed` against the push range) — bounded latency,
   ships to consumers already. Inherits the two selector residuals above. Does nothing in this repo
   while there is no remote.
3. **A post-merge / pre-`lore done` check** — this repo's real integration point is `git merge` into
   main followed by `lore done`, not `git push`. `lore done` ALREADY requires a runner-attested pass
   and already has an audited `--override-attestation` hatch. This is the layer that actually fires
   on the path this repo uses. Weigh whether the gate belongs there instead of at push time.
4. **A periodic/background full-suite run** — catches what selection misses, at the cost of not being
   a gate at all (it reports after the fact).

State explicitly which hole each option closes, and which it leaves open.

## Constraints on any answer

- ⛔ Whatever is chosen must not make `--no-verify` the path of least resistance. If total latency
  exceeds a stated budget, say what the budget is and how the design stays under it.
- ⛔ `hooks/pre-push` and `assets/project/pre-push` are parity-pinned and byte-identical today. Any
  edit must keep them so and regenerate the assets manifest — and, per the very lesson this task is
  about, must RUN `embed-assets-manifest.test.ts` rather than trusting that it exists.
- ⛔ Distribution-first: the consumer-facing half must land in `assets/`, never only in this repo's
  own `hooks/` (`adr-distribution-first-every-improvement-names-its-consumer`).

## Oracle

- **NEGATIVE (load-bearing)**: introduce a deliberately failing test on a scratch branch and show the
  chosen gate REFUSES the operation it is supposed to guard (push / merge / `lore done`). Today
  nothing refuses it — demonstrate that first, then demonstrate the refusal.
- **NEGATIVE (the historical case)**: reproduce the `c3803eb2` shape — hand-edit a file under
  `assets/` without regenerating the manifest — and show the gate catches it. This is the exact
  defect that already shipped.
- **REGRESSION**: the four existing corpus checks still run, still fail-open when `lore`/`.lore/` is
  absent, and their messages are unchanged.
- **REGRESSION (latency budget)**: measure the added wall-clock on a representative change and assert
  it against the stated budget. Measure exit codes as TWO SEPARATE statements — `cmd > out 2>&1` then
  `echo $?`; chained on one line you measure `echo`'s own 0.
- **CONTROL (anti-false-oracle)**: disable the new check and confirm the NEGATIVE case passes again,
  proving the green is attributable to the gate and not to the fixture. A gate that silently stopped
  matching is indistinguishable from one that never fires — which is precisely the failure mode being
  fixed here.
- **BOUNDARY**: a push/merge with an EMPTY changed-file set must not fail; a non-empty set selecting
  zero tests must be LOUD (`test:changed` already contracts this — assert the gate preserves it).
- ⛔ Never write to this repo's own `.lore/`: use `mkdtemp` + `lore init` per
  `packages/dashboard/tests/e2e/global-setup.ts`.

## Provenance

Filed 2026-08-12 at the user's request, as the shared root cause named in
`knowledge-handoff-agent-main-orchestrator-97` NS5. The measurements above were taken in that same
session while merge-verifying the git-safety-gate fix; the no-remote and no-CI findings were made
while filing this task and are what distinguish hole 1 from hole 2.

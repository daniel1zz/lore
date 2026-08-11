---
id: TASK-393
type: task
role: plan
title: "AC-ETI-7 proves the tail-window helper but not its invocation: the three-hop acRef forwarding is typecheck-only, so a regression that stopped forwarding would leave every AC-ETI-7 row green"
status: archived
priority: medium
created: 2026-08-01
updated: 2026-08-03
tags: []
parent: PRD-001
---
## The gap

`selectOutputTailWindow` (`packages/lore/src/service/verify-spawn.ts`) is covered by
AC-ETI-7/8 in the vitest tier — deliberately, because `verify-executor.ts` is bun-only and
the ACs could not otherwise live there. The consequence, found by
`lore assess plan-implementation-evidence-output-tail-integrity-self-report` (second run,
2026-08-01, `knowledge-assessment-implementation-evidence-output-tail-2`):

> AC-ETI-7 says 'the stored output_tail contains that AC id', but every recorded run tests
> `selectOutputTailWindow` in isolation. The three-hop wiring (VerifyRunnerService
> `recordAcRef` gate → `buildVerifySpawnSpec` `acRef` → `executeVerifySpawnSpec`) is verified
> by typecheck only; a regression that stopped forwarding `acRef` would leave all AC-ETI-7
> rows green.

That is correct and it is the classic extracted-helper seam: the helper is proven, its
invocation is not. Typecheck proves the field EXISTS, never that it is passed a real value.

## This was already measured green end-to-end — but outside the repo

An orchestrator probe drove the real CLI in a throwaway corpus and read the STORED tail back
out of the evidence row, which exercises all three hops:

    plan + spec with two script-mode ACs; AC-PW-1's command prints its own id FIRST then
    floods ~22.7 KB; AC-PW-2's never prints its id.
    lore verify <plan> --task <task> --allow-new-commands
    -> stored row AC-PW-1: tail=4000, contains "AC-PW-1" = True
    -> stored row AC-PW-2: tail=4000, contains "AC-PW-1" = False   (control)

Non-vacuity was proven directly rather than argued: the marker sits at stream index 0 of
22738 chars, so the pre-change last-4000-char window provably cannot contain it (measured,
not reasoned).

That probe lives in an orchestrator scratchpad and is therefore not a regression test. It
proves the wiring works TODAY; it cannot stop it breaking tomorrow. Porting it is the task.

## Required

Add a seam test that fails if the caller stops forwarding `acRef`. Either:

- **(a) an integration test** in the tier that spawns the CLI (mirroring the probe above:
  run `lore verify` against a fixture plan, read the stored `output_tail`, assert it contains
  the AC id) — closest to the probe, and asserts the property the AC actually states; or
- **(b) a narrow unit seam test** asserting `buildVerifySpawnSpec` populates `acRef` from
  `criterion.id` exactly when `recordAcRef` is true, plus that `executeVerifySpawnSpec` passes
  `spec.acRef` into the window selection.

(a) is preferred: it asserts the AC's own words ("the STORED output_tail"), which is what the
first version of this AC could not.

⛔ Whichever is chosen, the test must FAIL when the forwarding is removed. Prove that by
deleting the forwarding and observing the red — a test that passes both with and without the
wiring is the exact defect this task exists to close.

## Oracle

- RED first: with `acRef` forwarding removed at the `buildVerifySpawnSpec` call site, the new
  test fails. Restore it and the test passes.
- CONTROL: AC-ETI-7 and AC-ETI-8's existing vitest coverage stays green, byte-identical.
- CONTROL: the no-ac_ref path still stores the plain stream tail (the AC-ETI-8 property) when
  driven through the CLI, not only through the helper.
- If (a): the fixture corpus is a throwaway (`mkdtemp` + `lore init`), never the repo's own
  `.lore/`.


## Proxy / Silence / Opt-in — ADR three-question review (2026-08-01, agent:main-orchestrator)

Answered per `adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the` BEFORE
implementation.

**Q1 Proxy — option (a) closes the gap; option (b) is a narrower proxy and is REJECTED as the
primary.**
A unit test over `selectOutputTailWindow` is a proxy for "the wiring forwards `acRef`", and
typecheck proves only that the FIELD EXISTS, never that a real value flows through it. Driving
the real CLI and reading the STORED tail back out is the property itself — and it is the AC's own
wording ("the STORED output_tail contains that AC id"). Option (b) asserts two seams in
isolation, so a break in the third hop still leaves it green: it reproduces this task's own
defect at a smaller scale.

**Q2 Silence — the non-vacuity control is MANDATORY, not decoration.**
A tail-window test passes vacuously whenever the marker happens to fall inside the last-4000-char
window anyway. The orchestrator probe's design already removes that: the marker sits at stream
index 0 of 22738 chars, so the pre-change window PROVABLY cannot contain it, and `AC-PW-2` (never
prints its id) is the negative control. Port BOTH halves — a port that keeps only the positive
case is a vacuous test wearing a probe's name.
Second silence face, per the contiguous-substring standing lesson: a fixture whose `-t` filter
matches ZERO tests must fail loud. "No match + exit 0" is indistinguishable from "passed", and
this test's whole subject is an id-matching filter.

**Q3 Opt-in — n/a for the test itself, but NOT for its selection.**
`test:changed` selects by CONTENT MARKERS, and its documented residual is that a subprocess test
naming none of them is invisible. A CLI-spawning integration test is exactly that shape. So this
test can land, be correct, and never run on the change that breaks it — an opt-in by accident.
Required: assert that a change to `verify-spawn.ts` SELECTS the new file (run
`bun run test:changed --list` and check), or name the marker explicitly in the test. Do not
assume inclusion.

**⛔ Concurrency note — RE-MEASURE before dispatch; do not trust this paragraph.**
Between 21:19 and 21:41 on 2026-08-01 a CONCURRENT orchestrator session — resolving to the SAME
`agent:main-orchestrator` actor as this review's author, so invisible in `active_sessions` — ran
four agents in `.claude/worktrees/agent-{a0bd2615…, a313f70c…, a63979673…, adcccee23…}` and merged
two of them into `main` mid-review: `main` moved `63c3537` → `955c26d` in four minutes.
The file this task's Q3 assertion depends on was inside that window's write set:
- `scripts/changed-tests.ts` (the selection-marker contract)

⛔ Whether it is STILL contended is not knowable from this document; `--porcelain` and ahead-counts
are not durable facts. Before dispatching, re-measure:

    git worktree list && git log --oneline -3
    for w in $(git worktree list --porcelain | awk '/^worktree/{print $2}'); do \
      printf '%s: %s dirty, %s ahead\n' "$w" \
        "$(git -C "$w" status --porcelain | wc -l)" \
        "$(git -C "$w" log --oneline main..HEAD 2>/dev/null | wc -l)"; done

⛔ Write this task's Q3 selection assertion against the MERGED `changed-tests.ts` behaviour, never
against the version read while the concurrent change was in flight. See
`task-lore-handoff-reports-modified-files-none-while-four`.

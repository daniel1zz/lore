---
id: KN-497
type: knowledge
role: knowledge
title: "The green-control pattern, and its cost: a falsifier that can never go red replaces one that always could"
status: approved
priority: medium
created: 2026-08-21
updated: 2026-08-21
tags: []
parent: PRD-001
links:
  - {id: KN-483, type: relates-to}
  - {id: SPEC-133, type: relates-to}
  - {id: KN-345, type: relates-to}
---
Measured 2026-08-21 while landing `plan-close-the-falsify-green-control-gap-an-unrunnable-scratch`
(AC-FR-11) on `dist/lore` built from `1db5c443`. Successor to
`knowledge-the-falsifier-mechanism-is-shipped-but-inert-a`, which measured the
symptom; this one records the fix pattern, the cost the fix exposes, and two
tooling defects found by using it.

## F1 — the green-control pattern, and when any oracle needs it

The defect: `lore verify --falsify` compared ONLY the mutated command's exit code
against the falsifier's declared value. 11 of 11 invocations recorded a
runner-attested `expected-fail` without ever executing their mutation, because a
scratch worktree missing `node_modules` exits 1 on its own and `1` is the natural
declared value for "this mutation should make the test fail".

⛔ The generalizable rule is NOT about falsifiers. It is:

> **An oracle that compares only an exit code has zero power to distinguish "the
> thing under test failed" from "the harness never ran". Whenever the same exit
> code can mean both, the oracle MUST first establish that the environment
> produces the EXPECTED-GREEN result, and treat a failing control as
> `inconclusive` — never as a measurement.**

vitest and bun test both exit 1 for a startup failure and an assertion failure,
so no choice of `expected_exit_code` can separate them. The distinguishing signal
exists only in the OUTPUT, which the runner never reads. That is why the fix is a
control run, not better exit-code handling.

Landed shape (`_runFalsifier`, `packages/lore/src/service/verify-runner-service.ts`):
run the AC's own command UNMUTATED in the SAME scratch worktree BEFORE applying
anything. Exit 0 → proceed unchanged. Nonzero or timed out → record
`result: "inconclusive"` with NO `attestation`, apply nothing, and say why.

This is a candidate SEVENTH entry in the false-oracle vector catalog
(`knowledge-retro-a-silently-inert-cli-flag-is-the-fifth-false`), distinct from
the existing ones: V5 was a flag silently inert; under-match was a runner
executing fewer files than declared. This one is a harness that never started at
all while the exit code looked like a verdict.

## F2 — the fix's cost: a falsifier that can never go red is not better than one that always does

⛔ Measured immediately after landing, by running the new code against its own
criterion: `lore verify <plan> --task <task> --falsify AC-FR-11` recorded
`inconclusive` — the green control correctly refused. `lore assess` scored this a
MAJOR on `evidence_integrity`, and it is right to:

> attested_fail=0 for AC-FR-11: its own falsifier run recorded result=inconclusive
> (vitest/config unresolvable in the scratch worktree), so the criterion has no
> machine-proven red. Correct behavior of the new guard, but the discriminating
> power of AC-FR-11's oracle remains unattested by the runner.

The scratch worktree is built from `git stash create`, so `node_modules` — being
gitignored, not merely untracked — is NEVER present. Therefore:

> **Every falsifier whose command needs `node_modules` (i.e. every `oracle: test`
> criterion in this repo) now resolves to `inconclusive` in a standard scratch
> worktree. The mechanism moved from producing FALSE reds to producing NO reds.**

Both states leave discriminating power unproven. The green control is still
strictly correct — a false red actively misleads while an inconclusive is honest —
but ⛔ do not read the landing of AC-FR-11 as "falsifiers work now".

Unresolved, and the next real decision (worth an ADR, options measured but not
chosen): symlink or hardlink `node_modules` into the scratch worktree; teach the
worktree builder `--include-untracked` (necessary for new test files, NOT
sufficient for gitignored `node_modules`); run the install inside the scratch
worktree (⛔ already observed to fail — one pre-fix evidence tail shows a
`bun install` having run and the command STILL failing); or abandon worktree
isolation for a different isolation primitive (⛔ conflicts with D3, which the
crash-isolation test AC-FR-3 pins).

## F3 — `lore done`'s refusal says "attested" but accepts an unattested row

Refusal text, verbatim:

> Task "…" declares test-file anchor(s) with **no attested UNFILTERED result:pass
> run**: … `lore done` requires, for EACH declared test-file anchor, at least one
> oracle:test result:pass evidence row whose command runs that file with no -t …
> case filter (record one via `lore evidence … --result pass`)

Two things in one message contradict each other: it demands an ATTESTED row, then
prescribes `lore evidence`, which has NO flag that can produce an `attestation`
block (`--capture` stamps `capture_source: runner` and nothing more). An agent
reading it literally concludes the only attested path is `lore verify` — which
runs only the AC's DECLARED command, and every declared command on this spec
carries a `-t` filter. That reads as a deadlock.

Measured resolution: it is NOT a deadlock. A `lore evidence --capture` row with
an unfiltered command satisfied the gate and `lore done` succeeded. So the
predicate checks `unfiltered + result:pass` and does NOT check attestation; the
word "attested" in the refusal is false.

⇒ Filed as a defect. The refusal must either drop "attested" or name a command
that can actually produce attestation. ⛔ This is the AC-FR-9 shape (a message
promising more than the implementation delivers) recurring in a THIRD place,
which is itself the signal: one instance is a typo, three is a missing check.

## F4 — an `--allow-missing-path` declaration is good design worth copying

`lore ac add` refused a command naming a not-yet-written test file, and the
refusal named the exact escape plus what it costs: pass a non-empty
`--allow-missing-path "<reason>"` and the declaration is tracked as UNREDEEMED in
`lore status --json` until the file exists. Red-first AC authoring stays possible,
the debt is counted, and it self-clears. Recorded here as the positive control:
this is what F3's refusal should look like.

---
id: KN-515
type: knowledge
role: knowledge
title: "A falsifier declaration is an unverified causal assertion — lore ac add checks staleness, never aim"
status: approved
priority: medium
created: 2026-08-23
updated: 2026-08-23
tags: [governance, ac-as-code, falsifiability, tooling-gap]
parent: SPEC-146
---
## What was measured

Authoring one tech spec with 13 script-mode ACs surfaced three tooling gaps and three authoring failures of my own. The authoring failures matter because all three are the same shape, and only one of the three was caught by a mechanism.

## Gap 1 — `--falsifier-*` validates staleness, never aim

`lore ac add` accepts a falsifier whose `--falsifier-path` does not exist and whose `--falsifier-find` names a symbol that does not exist. Measured directly: a throwaway AC declaring `packages/lore/src/service/claude-md-admission.ts` (absent) with find `checkSlugPointers` (absent) was accepted without comment.

That leniency is correct on its own — a red-first AC must be able to aim at a file its own slice will create, and the help text says the find string is validated at attested-red run time.

The gap is the interaction. I first declared, for an AC asserting `reference_missing` reaches the CLI:

```
--falsifier-path packages/lore/src/adapters/cli/commands/status.ts
--falsifier-find  "lintMemoryFiles(files, budgets)"
--falsifier-replace "lintMemoryFiles(files, budgets).filter(() => false)"
```

Every field resolved. The path exists, the substring is present, the mutation is syntactically valid, and the tool accepted it silently. But that mutation disables the **capacity** findings while the AC asserts a **reference** finding — so with the wiring correct, the mutation leaves the AC green. Zero discriminating power, full surface compliance.

⛔ The tool can detect a STALE falsifier (find string absent) and cannot detect a MIS-AIMED one (find string present, wrong target). A mis-aimed falsifier is strictly worse than none, because `--falsifier-*` is what makes "what is the smallest mutation that turns this oracle red" machine-checkable — a wrong answer there launders an undiscriminating AC as a falsifiable one.

The only thing that catches it is running the mutation and observing green. Nothing in the authoring path requires that.

## Gap 2 — an unresolved file anchor declares a mutual exclusion it cannot enforce

`lore ready` reports this itself, plainly, and deserves credit for it:

> an anchor that does not resolve can intersect nothing, so the mutual exclusion it declares is absent for it

Seven of the plan's anchors were `file_missing` — all legitimately, since the tasks create those files. But the anchor-overlap gate protects nothing for exactly the files two concurrent tasks are most likely to race on: the new ones. The protection arrives only after the first task creates the file, which is after the window where it was needed.

## Gap 3 — `lore ac set` re-validates command paths on ANY field edit

Editing only `--falsifier-*` fields on an existing AC was refused with a `verify.command` validation error, because the command still names a not-yet-written test. `--allow-missing-path` had to be re-supplied with a fresh reason. Already recorded in the root CLAUDE.md for `--statement` edits; it holds for falsifier-only edits too.

## The three authoring failures, all one shape

1. A falsifier that mutates the wrong mechanism (Gap 1).
2. `AC-WIRE-1` asserted exit code exactly 3 while three separate places in the same spec placed that finding as advisory. I wrote the AC from the "wire the dead function" framing, then changed the design to advisory after measuring an 89% false-positive rate, and never revisited the AC.
3. `AC-CONTRACT-1` named a `.bun.test.ts` file inside a `bunx vitest run` invocation — two runners the project forbids mixing. vitest cannot execute it, so the byte-parity half of that AC had no oracle at all.

All three are the same failure: **writing an AC without re-reading the constraint it must satisfy** — the mutation's target, the design decision, the runner split.

Failure 2 was caught by `lore review` (decision: escalate, with the contradiction named across all four sites and a blocking question demanding which one changes). Failures 1 and 3 were caught by me re-reading, and only because I happened to re-read. Nothing would have caught either one.

## Lesson

⛔ A falsifier declaration is an ASSERTION about causality, not a form field, and it is the one assertion in the AC that nothing verifies at authoring time. Declaring one and never running it produces an AC that reads as falsifiable and is not.

The cheap discipline: for every script-mode AC with a falsifier, state in one line **which mechanism the mutation disables** and **why disabling that mechanism must turn THIS AC's oracle red**. Writing that sentence is what exposed failure 1 — the sentence could not be completed.

The mechanism this still needs: nothing today ties a declared falsifier to an observed red run, so the arrow from "declared" to "demonstrated" is drawn by agent diligence alone. Naming it here does not enforce it.

## Counter-evidence worth recording

`lore review` was not advisory-in-practice on this spec. It caught a real cross-section contradiction that four independent design-review subagents did not, flagged a missing acceptance criterion for an in-scope deliverable (the template pointer line — the same capability-without-wiring shape the spec itself is about), and refused to approve until both were resolved. Two rounds, both findings correct, no false positives. `lore approve` requires a review judgment matching the current version, so the escalation genuinely blocked.

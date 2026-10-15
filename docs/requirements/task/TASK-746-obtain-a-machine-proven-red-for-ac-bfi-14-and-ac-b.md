---
id: TASK-746
type: task
role: plan
title: "Obtain a machine-proven red for AC-BFI-14 and AC-BFI-15, blocked on --falsify comparing more than the exit code"
status: deprecated
priority: high
phase: "two-follow-ups"
created: 2026-08-21
updated: 2026-10-10
tags: []
parent: PLAN-133
plan: PLAN-133
---
# Task Objective

Obtain a MACHINE-PROVEN red for `AC-BFI-14` and `AC-BFI-15`. Both criteria are green and
attested; neither has had its declared falsifier actually exercised. This is the plan's real
remaining work, and it is the reason this plan is still open.

# Why this task exists rather than the plan being archived

Two mechanisms in this repo are in DIRECT structural conflict, measured 2026-08-21:

- `lore status --check-tree` raises `plan-terminality` when a plan's child tasks are all
  terminal but the plan is still `approved`, and `hooks/pre-push` exits 3 until it is archived.
- `lore verify --falsify` requires the PLAN positional and a live claim, so a falsifier declared
  on a spec is re-runnable ONLY while its governing plan is live
  (`knowledge-the-falsifier-mechanism-is-shipped-but-inert-a` F2 — all 8 pre-existing
  declarations in this corpus are already dead for exactly this reason).

So a completed plan cannot simultaneously satisfy the drift check and keep its falsifiers
runnable. Archiving to make pre-push green would make `AC-BFI-14` and `AC-BFI-15` permanently
unprovable. This task holds the plan open by recording the work that is genuinely unfinished,
which is the honest resolution rather than choosing which mechanism to violate silently.

# Blocker — not this task's own defect

`lore verify --falsify` currently cannot exercise ANY falsifier whose command needs
`node_modules`. It builds a scratch worktree (`/tmp/lore-attested-red-*/wt/`), applies the
mutation, and compares ONLY the exit code. The worktree is never installed into, so the command
dies at module resolution and exits 1 — which matched both declared falsifier exit codes, so two
vacuous rows were recorded as proven reds on 2026-08-21. Full mechanism and the required fix:
`knowledge-lore-verify-falsify-compares-only-the-exit-code-so-an`.

⛔ No exit code can fix this: vitest and `bun test` both exit 1 for a startup failure AND an
assertion failure, so the distinguishing signal is only ever in the OUTPUT.

# Acceptance Criteria

`AC-BFI-14` and `AC-BFI-15`, both already declared on
`spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor` with `--falsifier-*` sets that
are CORRECT IN CONTENT. Nothing about the declarations needs changing.

Done means, for each: a `result: "expected-fail"` row whose output tail contains the ASSERTION
the mutation was designed to trigger — not a module-resolution error, not a bare exit code.
Specifically:

- `AC-BFI-14`'s mutation weakens `isSpecAnchored` to `raw !== undefined`. A genuine red shows
  the differential table failing with a named case, e.g. `case "code_anchors: an empty array":
  witness classified anchored=false but the shared isSpecAnchored classified anchored=true`.
- `AC-BFI-15`'s mutation repoints the fixture spec to `ANCHOR_FILE_A`. A genuine red shows the
  RED-direction `expect(...).toThrow()` failing because nothing threw.

⛔ Both existing `capture_source: "runner"` rows for these ACs are known-vacuous and are named
in the spec's own correction section. Do not treat them as satisfying this task.

# Two acceptable routes — pick and record which

1. **Fix the runner** (the mechanism root, and what the knowledge doc argues for): make
   `--falsify` run an UNMUTATED control in the same scratch worktree first and refuse to record
   any verdict when that control does not pass, plus install/reuse dependencies so the control
   can pass. ⛔ This is a change to `lore` itself and belongs under
   `spec-falsifiability-reachability-a-feedable-checkpoint-an`, not here — if you take this
   route, open the work there and let this task consume it.
2. **Prove it without the runner**: mutate, run the real command in a tree that CAN run it,
   capture the output, and record `--result expected-fail` with `--capture` so the tail is
   machine-captured rather than hand-authored. ⛔ This is weaker than a fixed runner (no
   attestation block) but it is honest, and it beats a runner row whose tail proves nothing.
   Say plainly in the record which route was taken.

# File Anchors

None declared. Route 2 touches no tracked file (mutate, measure, revert). Route 1's edits live
under `packages/lore/src/service/` and belong to a different spec, so they must be anchored by
the task opened there, not by this one.

# ⛔ CORRECTION to this task's own premise, same day

The section above says archiving the plan "would make AC-BFI-14 and AC-BFI-15 permanently
unprovable". **That is an overstatement and it is corrected here rather than left standing.**

What `knowledge-the-falsifier-mechanism-is-shipped-but-inert-a` §F2 actually measured is that
the 8 pre-existing falsifier declarations "cannot be re-verified TODAY", because no LIVE plan
carries them — not that they are unprovable forever. `lore verify --falsify` needs a plan
positional and a task in that plan whose `ac_scope` includes the criterion. Nothing prevents a
FUTURE plan from carrying a task with `--ac-scope AC-BFI-14 --ac-scope AC-BFI-15` and running
the falsifiers there. That is ordinary work, not an impossibility.

So the accurate statement of the cost: archiving ends the CURRENT window and moves the re-proof
into a future slice. Keeping this plan open is a convenience, not a rescue.

This task therefore remains the tracking item for the gap, and its scope is unchanged — but
⛔ nobody should quote the "permanently unprovable" claim, including from this document's own
earlier section or from the commit message that introduced it
(`98702546 docs(mirror): hold the plan open with the work that is actually unfinished`).

Session-wide measurement that supersedes the two-row figure above: **every `lore verify
--falsify` invocation of 2026-08-21 was vacuous — 11 rows across 10 criteria on 3 specs, a 100%
false-match rate**, with three distinct causes (no usable `node_modules`; untracked files absent
because the scratch worktree comes from `git stash create` without `--include-untracked`;
`dist/lore` gitignored so a compiled-binary oracle has no binary). All three exit 1.

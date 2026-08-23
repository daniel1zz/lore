---
id: TASK-749
type: task
role: plan
title: "Wire the discovery-refusal guard into the evidence capture path, with a control that keeps genuine reds recordable"
status: archived
priority: high
phase: "mechanism"
created: 2026-08-21
updated: 2026-08-23
tags: []
parent: PLAN-079
plan: PLAN-079
---
# Task Objective

Wire the discovery-refusal guard into the SECOND write path that mints reds. The primitive
exists and is correct; it is consumed by one call site out of two.

# Spec Reference

`spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a` §M6.1 (the primitive), §M6.2
(the attested call site), and `AC-OX-12`. Read the AC statement with `lore ac list` — it carries
the measurement.

# What was measured, 2026-08-21

`grep -rn findDiscoveryRefusal packages/lore/src` returns hits in exactly ONE production file:
`packages/lore/src/service/verify-runner-service.ts` (the guard at ~line 1065). No other
consumer exists.

Meanwhile `lore evidence --capture` spawns `--command` itself, observes its exit code, and
records a `pass` / `fail` / `expected-fail` row stamped `capture_source: "runner"`. It never asks
whether the output was a discovery refusal.

Demonstrated accidentally that day: a `cd` in an earlier compound shell command persisted, so
`bunx vitest run packages/lore/tests/unit/adapters/evidence-completeness-guard.test.ts` resolved
relative to `packages/lore/` and printed

    No test files found, exiting with code 1

— vitest's own refusal phrase, one of the three this spec captures — and `--capture` observed
exit 1. It refused ONLY because the declared `--result` was `pass` and pass requires exit 0. With
`--result expected-fail` the same refusal would have been recorded as a genuine red under the
corpus's runner-produced label.

⛔ Read that consequence precisely: the red-first discipline asks agents to record
`expected-fail` rows, and this is the path they use. A refusal recorded there is a false red that
looks machine-produced.

# Acceptance Criteria

`AC-OX-12`. Its two reds are both required and the CONTROL is the load-bearing half:

- (a) drive the evidence path with a captured discovery-refusal output and `--result
  expected-fail` → no fail-family row is produced.
- (b) CONTROL: drive it with a GENUINE assertion failure → `expected-fail` is still recorded.
  Without (b) the fix could simply close the path, which would break the red-first discipline it
  is meant to protect.

Your describe block name must contain `refusal-blocks-evidence-red` — the declared command
filters on it.

# Context Digest

- This is the capability-versus-wiring split the root CLAUDE.md names: `AC-OX-2` pins
  `verifyPlan`'s call site and nothing pins the evidence path, so the primitive is implemented
  and half wired. ⛔ The spec's `code_anchors` must end up covering BOTH consumers, not just the
  implementation.
- ⛔ Consume the SAME shared decision function, not a second call to the primitive with its own
  surrounding logic. `AC-061-14`'s precedent is exactly this: a source scan proves the guard
  imports filter detection and summary parsing from `@lore/core` and declares no local copy.
  A second hand-rolled refusal check would be a second definition of "what counts as a refusal".
- The three captured phrases and their runners live in `packages/core/src/attestation-completeness.ts`
  (`findDiscoveryRefusal`). ⛔ Do not re-type the phrases anywhere.
- `verify-runner-service.ts` records `inconclusive` on a refusal. Decide, and record the choice,
  whether the evidence path should also record `inconclusive` or refuse loudly with exit 4 — the
  AC accepts either, but it must NOT be a fail-family row and the message must name the runner.
- ⛔ Do NOT use `lore verify --falsify`: measured 2026-08-21, 11 of 11 invocations were vacuous
  (`knowledge-lore-verify-falsify-compares-only-the-exit-code-so-an`).
- ⛔ There is NO build step for `@lore/core` or `@lore/lore` in this repo — no build script, and
  `exports` resolve straight to `./src/*.ts`, consumed as-is by tsc and Bun. A new `@lore/core`
  export is visible to `packages/lore` immediately. `dist/lore` is the only stale-able artifact.
  (This corrects an instruction that went into five dispatch bundles the same day:
  `knowledge-a-repo-wide-oracle-cannot-have-hand-enumerated-file` F3.)

# File Anchors

- `packages/lore/src/adapters/cli/commands/evidence.ts` (verify the real path with grep before
  claiming — the capture logic may live in a shared helper rather than the command module)
- `packages/lore/tests/unit/adapters/evidence-precheck.test.ts`

---
id: TASK-375
type: task
role: plan
title: "lore evidence --capture has a hard-coded 600s window that a legitimately-scoped oracle already exceeds, so the disciplined path terminates in a self-report row"
status: archived
priority: high
created: 2026-08-03
updated: 2026-08-03
tags: []
parent: PRD-001
---
# Defect

`lore evidence --capture` is the ONLY path that produces a `capture_source: runner` row, and
since the attested-pass floor landed (`82157f3`) a runner-attested row is what `lore done`
requires. But the capture window is a hard-coded constant:

    packages/lore/src/adapters/cli/commands/evidence.ts:221
    const CAPTURE_TIMEOUT_MS = 10 * 60 * 1000;

Measured 2026-08-03 by `agent:fix-ninth-plan-member` on
`task-a-ninth-plan-member-query-hides-in-the-one-shot-task-phase`:

- the oracle was `bun run test:changed 5b38008` — **this repo's own mandated worktree oracle**
- a comment-only edit to `packages/core/src/archive-candidates.ts` (the browser-safe core
  barrel) made transitive reverse-dep selection pull in **482 files** (326 vitest + 156 bun)
- total runtime **~624s** (103.6s vitest + 520.1s bun) against a 600s window

So `--capture` is **structurally impossible** for a legitimately-scoped run, and the only
honest fallback is `--output-tail-file` with the real log — which records
`capture_source: self-report`. The row is truthful and its tail is genuine, yet `lore done`
must then be forced with `--override-attestation`.

⛔ The harm is not the timeout. It is that **the correct, disciplined path terminates in a
degraded record**, and the pressure it creates points at exactly the shortcuts this repo has
already had to mechanize against: narrow the selection until it fits, or reach for
`--oracle manual`.

# Mechanism root

One magic number couples two unrelated facts: *how long a hung child should be tolerated*
and *how long a legitimate oracle may honestly take*. The second is a property of the
project's test suite and grows with it; the first is a hang detector. Binding them to one
constant means the suite outgrows the attestation mechanism silently — no signal fires when
the margin closes, and the failure surfaces as an unrelated-looking capture failure inside
whichever task happens to cross the line first.

Second-order: this repo's own `test:changed` contract *encourages* wide selection when a
change touches `@lore/core` (transitive reverse-dep is the correct semantics — a core edit
really can break anything). So the mandated oracle and the attestation window are on a
collision course by design, and core will keep growing.

# Required fix

1. The capture window MUST be configurable, not a source constant. Per this repo's
   distribution rule, numbers ship via **config schema**
   (`adr-distribution-first-every-improvement-names-its-consumer`) — add it to the config
   surface with the current 600s as the default, so no consumer behaviour changes on upgrade.
2. A capture that hits the window MUST be reported as a **distinct, unambiguous outcome** —
   not folded into the generic no-exit-code branch. Today `evidence.ts:355` emits
   `"(no exit code observed — possibly the 600s capture timeout)"`: the word **"possibly"**
   is the defect. The runner knows whether it timed out; it must say so, and never present a
   guess as a measurement.
3. A timeout MUST NOT silently become a recorded row of any kind. Refuse, name the configured
   window and the elapsed time, and name the knob to raise it.
4. ⛔ Do NOT "fix" this by raising the constant. A larger magic number has the identical
   failure mode one suite-growth later. (If the reviewer judges a raise as an interim step,
   it may accompany item 1 but never replace it.)

Distribution surface: binary-side (`packages/lore/**`) plus the config schema in
`@lore/core`. No consumer config edit required for the default.

# Acceptance criteria

- **AC-1** — the window is read from config, not a module constant. Setting it to a small
  value (e.g. 2s) and capturing a deliberately slower command produces the timeout outcome;
  setting it high lets the same command through. Assert BOTH directions — a knob verified in
  one direction only is indistinguishable from an inert flag
  (`knowledge-retro-a-silently-inert-cli-flag-is-the-fifth-false`).
- **AC-2** — the timeout message contains no hedging ("possibly", "maybe", "perhaps") and
  states the configured window AND the observed elapsed time. Assert by string absence AND
  by the presence of both numbers.
- **AC-3** — a timed-out capture writes NO evidence row. Assert the task's
  `extra.verification_evidence` length is unchanged after the attempt.
- **AC-4** — CONTROL: a command that exits non-zero *within* the window is still recorded as
  a genuine failure, distinct from a timeout. The two outcomes must not collapse.
- **AC-5** — default preserved: with no config key set, the effective window is 600s.
- **AC-6** — `bun run typecheck` clean; `bun run test:changed <base>` passes with a NON-ZERO
  selection count (loud-zero rule).
- Six-dimension coverage (HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION).

# Proxy / Silence / Opt-in (binding — adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the)

**Proxy.** The timeout is a proxy for "this child has hung". Input that satisfies the proxy
while violating the property: a healthy, legitimately-scoped 624s oracle — the MEASURED case
above. Not accepted; that is this task. The fix does not make the proxy exact (no timeout
can), it makes the threshold owned by the operator and makes crossing it LOUD rather than
degrading.

**Silence.** Two silences, both real. (a) The current message *guesses* ("possibly") instead
of reporting a fact the runner holds — item 2. (b) The margin closing is invisible: nothing
warns as suite runtime approaches the window. Item 2's elapsed-time reporting makes the
margin observable on every capture; a proactive warning threshold is deliberately NOT
required here — state that decision rather than leaving it unasked.

**Opt-in.** Today: none, and that IS the defect (an unconfigurable constant). After the fix
the knob is opt-in with the current value as default, so nothing changes for a consumer who
sets nothing.

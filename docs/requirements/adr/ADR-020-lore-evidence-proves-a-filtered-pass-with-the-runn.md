---
id: ADR-020
type: adr
role: decision
title: "lore evidence proves a filtered pass with the runner's own summary line, never a --matched integer"
status: draft
priority: critical
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: SPEC-061
---
## Context

`lore evidence --result pass` stores what the caller asserts. When `--command`
carries a `-t` / `--testNamePattern` case filter, a filter that matches ZERO
tests still exits 0 with every case reported `skipped` — so a drifted or
mistyped test title produces a corpus row byte-indistinguishable from a real
pass (`knowledge-a-zero-match-vitest-t-title-filter-exits-0-the-sixth`,
false-oracle vector #1).

`lore verify`'s trusted runner already refuses this: SPEC-061's
`commandHasCaseFilter` + `judgeCompleteness` downgrade a `zero_match` /
`under_match` run to `inconclusive`. That guard is a pure module in
`@lore/core` (`packages/core/src/attestation-completeness.ts`) — NOT, as
`task-lore-evidence-must-refuse-a-t-filtered-pass-with-no` states, buried
inside the runner. The extraction step that task requests is already done.

The guard therefore sits on the path nobody takes: every dispatched
implementer subagent reports through `lore evidence`. Measured 2026-07-31:
21 of 21 script ACs across four plans were recorded that way, with
`attested_evidence_ratio 0.00` on every plan.

The open question the task deliberately left to this decision: **how does the
matched count reach the CLI?**

## Options

**A. Required `--output-tail` carrying the runner's own summary line**, parsed
by the existing `@lore/core` classifier. A filtered `--result pass` with no
output tail, or with a tail whose summary line parses to zero matched cases,
is refused.

**B. A new `--matched <n>` integer flag** the caller supplies.

**C. Both, cross-checked** — `--matched` must equal the count parsed from
`--output-tail`.

## Decision

**Option A.** A filtered `--result pass` MUST supply `--output-tail` (or
`--output-tail-file`) containing a runner-summary line the shared classifier
can parse; a missing tail, an unparseable tail, or a parsed count of zero is
refused with `VALIDATION_ERROR` (exit 4) naming the missing proof.

## Rationale

1. **B is satisfiable without reading any output.** The failure mode this
   guard exists to stop is an agent self-reporting a pass it did not measure.
   A bare integer is exactly as easy to emit as the false `--result pass` it
   is supposed to gate — it adds a field, not a control. A verbatim runner
   summary line is not producible without having the runner's output in hand.
2. **The proof lands in the SSOT.** `output_tail` is already an evidence
   field (≤4000 chars). Storing the summary line means a later auditor — human
   or the next session's AI — re-reads the count from the corpus row itself
   instead of trusting a number with no provenance. `--matched` stores an
   assertion; `--output-tail` stores the artifact.
3. **One rule, two consumers.** Option A reuses `commandHasCaseFilter` and the
   runner-summary parse already shipping in `@lore/core`. Option B would
   introduce a second, flag-shaped definition of "how many cases ran" that can
   drift from the runner's own. SSOT.
4. **C buys little over A.** Requiring the number twice, once in a form that is
   free to fabricate, does not strengthen A; the binding constraint in C is
   still the output tail. It only adds a mandatory field to every filtered
   evidence call.

## Consequences

- Every dispatched implementer reporting a `-t`-filtered pass must pipe its
  runner output into `--output-tail` / `--output-tail-file`. This is new
  friction, and it is the point — it is not satisfiable from memory.
- **Unfiltered commands are unaffected.** Whole-file runs already fail loud on
  a zero-match path filter (exit 1), so no new requirement applies to them.
- Fail-CLOSED on an unparseable tail for a filtered pass. This differs from
  `judgeCompleteness`'s fail-OPEN posture inside `lore verify`, and the
  difference is deliberate: the runner has independently observed the exit
  code, so it can afford to be generous about an unrecognised summary format.
  `lore evidence` has observed nothing — the tail is its only evidence, so an
  unreadable tail is no evidence.
- Recording a genuinely-zero-match run stays possible via
  `--result expected-fail` / `--result fail`; only `pass` is gated.

## References

- `task-lore-evidence-must-refuse-a-t-filtered-pass-with-no` (the defect;
  note its stale "lives inside the runner" premise, corrected above)
- `spec-spec-061-attestation-completeness-guard-detect-zero-match-u`
  (AC-061-11 … AC-061-16 mechanize this decision)
- `knowledge-a-zero-match-vitest-t-title-filter-exits-0-the-sixth`
- `knowledge-session-process-review-2026-07-31-ten-agent-two-wave`

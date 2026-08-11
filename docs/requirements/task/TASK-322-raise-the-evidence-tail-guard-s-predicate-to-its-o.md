---
id: TASK-322
type: task
role: plan
title: "Raise the evidence tail guard's predicate to its own message, and make capture_source plus every corpus-wide count enumerable"
status: archived
priority: medium
phase: "evidence-integrity"
created: 2026-08-10
updated: 2026-08-10
tags: []
parent: PLAN-076
plan: PLAN-076
---
Raise the evidence tail guard's PREDICATE to match the invariant its own error message already
states, and make `capture_source` and every corpus-wide count enumerable.

⛔ Read this before touching anything: `lore evidence` ALREADY refuses a self-reported `pass` with an
EMPTY tail, and its message already says "a hand-authored summary is not proof the command actually
ran". The predicate behind that message is only `tail.length > 0`. Measured 2026-08-10: of three
implementer agents given the rule "the tail must be non-empty and contain the runner's summary line",
TWO satisfied it by WRITING the summary themselves — e.g. `'Test Files 1 passed (1); Tests 6 passed
(6); Duration 4.24s'`, semicolon-joined onto one line that vitest never prints. Both rows PASSED the
guard. A guard whose message states a stronger invariant than its predicate enforces is worse than no
guard: the pass reads as an endorsement of the stronger property.

Deliver:

1. **Predicate raised to the message** (AC-FR-4). A self-reported `pass` with a NON-EMPTY but
   hand-authored tail is refused at the SAME exit code the empty-tail case already returns, and the
   refusal names `--capture`. `--capture` still succeeds. ⛔ Do not weaken the message to match the
   predicate — that is the inverse fix and it is wrong.
2. **`capture_source` visibility** (AC-FR-5). A distribution (runner vs self-report) in
   `lore status --json`, and the same ratio in `lore assess` alongside the attested ratio it already
   prints.
3. **Every corpus-wide count gets an enumerator** (AC-FR-5). Each `*_count` field `lore status --json`
   reports must have a sibling that lists its MEMBERS — at minimum `pass_unfalsified_count`,
   `unredeemed_allow_missing_path_count`, and the new capture_source buckets. Measured: producing the
   member list behind `pass_unfalsified_count = 29` required a throwaway script iterating all 138
   specs. ⛔ The AC requires this to bind FUTURE counts too — a new count field with no enumerator
   must fail the test.

⛔ **Budget the back-catalogue in THIS task.** Raising the predicate retroactively makes every
historical self-report `pass` row non-conforming. A newly armed gate that invalidates the
back-catalogue without a written exemption has already cost this repo a full round. Decide and
implement one of: exempt rows recorded before a cutover timestamp, or sweep them. Either way the
exemption MUST be explicit, greppable, and stated in the code — not assumed.

⛔ Your own evidence for this task must be `--capture`. Recording a hand-written tail while
implementing the guard against hand-written tails would be its own kind of proof.

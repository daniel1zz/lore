---
id: TASK-472
type: task
role: plan
title: "The ad-hoc task channel has no attested-evidence path: lore verify requires a plan, so every --adhoc task is self-report-only by construction"
status: archived
priority: critical
created: 2026-07-31
updated: 2026-08-01
tags: []
parent: PRD-001
---
## Task

The ad-hoc task channel (SPEC-069 D2, `lore create task --adhoc`) and the trusted
runner's attested-evidence path (SPEC-039) are **mutually exclusive by
construction**. An ad-hoc task can never carry attested evidence — its only
channel is self-reported `lore evidence`, the exact surface the
2026-07-31 review found produced `attested_evidence_ratio 0.00` across four plans.

## Measured, on this repo, 2026-07-31

`lore verify` is the ONLY writer of attested evidence. Its CLI signature takes a
required PLAN positional:

```
USAGE `lore verify [OPTIONS] <PLAN>`
```

`commands/verify.ts:373` calls `verifyPlan(args.plan)`; `--task` only *overrides
claim-based resolution* WITHIN a plan, it does not substitute for one.
`VerifyRunnerService.verifyPlan` resolves through `corpusService.getPlanBundle`,
which hard-refuses any non-plan document (`corpus-service.ts:3295`):

```
if (plan.type !== "plan") {
  code: "VALIDATION_ERROR",
  message: `Expected a plan document; got type '${plan.type}'`,
```

An ad-hoc task has `extra.adhoc = true`, no `extra.plan_id`, and is parented to
the corpus root PRD. There is no plan to pass. Neither `verify.ts` nor
`verify-runner-service.ts` contains the token `adhoc` at all — the channel was
never considered by the runner.

`lore set` has no `--plan-id`, so an existing ad-hoc task cannot be re-homed into
a plan through any supported verb either. The only workaround is to fabricate a
plan and re-create the task under it — which is precisely the "doc authored to
clear a gate" anti-pattern (`knowledge-retro-a-newly-built-gate-leaves-every-
pre-existing`), and afterwards indistinguishable from a real plan.

## The gap is WIDER than the runner (measured 2026-07-31, twice, independently)

`lore evidence --ac <AC-ID>` is refused on an ad-hoc task too — so the channel
cannot even *reference* a governing spec's acceptance criterion, let alone
attest one. Measured by the implementer of
`task-lore-evidence-must-refuse-a-t-filtered-pass-with-no`, then reproduced
independently by the orchestrator on the real corpus:

```
$ lore evidence <adhoc-task> --ac AC-061-15 --oracle test --result pass --output-tail-file …
Error: Validation failed on field 'type': Expected a plan document; got type 'prd'
exit 4   # and zero rows written
```

Cross-entity `--ac` validation resolves the task's plan in order to reach that
plan's parent spec. An ad-hoc task's `extra.plan_id` is absent and its
`parent_id` is the corpus root PRD, so the resolution lands on the PRD and the
same `getPlanBundle` type guard refuses.

Three consequences follow, and they compound:

1. Evidence on an ad-hoc task can never carry an `ac_ref`, no matter how
   precisely the task declares `extra.ac_scope`.
2. Therefore the governing spec's AC coverage reads as **uncovered** for work
   that was in fact done and verified — `lore ac list` badges and any
   coverage-derived fact see nothing.
3. Therefore `deriveClaimedAcCoverage` / the plan-close coverage conjunct can
   never observe ad-hoc work at all. The very predicate this session is
   repairing is structurally blind to the channel this session's own
   remediation tasks live in.

Note also that the refusal message is itself a diagnosis defect: `Expected a
plan document; got type 'prd'` leaks an internal resolution step. An author
reading it cannot tell that the real cause is "this task is ad-hoc, so there is
no plan to resolve an AC against". Whichever option below is chosen, this
message must name the ad-hoc cause.

## Why this is load-bearing right now

The remediation tasks filed by the 2026-07-31 session process review — including
the two CRITICAL ones closing the plan-close vacuity hole and the `lore evidence`
completeness hole — were themselves filed as ad-hoc tasks. So the work fixing the
0.00-attestation defect is routed through the one channel that structurally
cannot produce attestation. The defect reproduces itself one level up.

## Mechanism required

Pick ONE and make it the declared contract; do not leave both half-true:

1. **Give the ad-hoc channel a runner path.** `lore verify --task <adhoc-task>`
   with no PLAN positional: resolve the governing spec from the task's declared
   `extra.ac_scope` ids (they already name a spec's ACs), run those ACs, write
   attested evidence. This keeps ad-hoc tasks first-class.
2. **Declare ad-hoc tasks attestation-exempt by construction** and make that
   visible: a typed, auditable exemption emitted at `lore evidence` time on any
   `extra.adhoc` task, so nobody later reads a self-reported row as if the
   attested path had been available and skipped.

⛔ Do NOT resolve this by telling authors "use a plan instead". `--adhoc` is a
shipped verb with a spec behind it; a channel that cannot be verified is either a
channel that must be verifiable or a channel that must say it is not.

## Oracle

Failure-first:
- `lore verify --task <an-adhoc-task>` today: assert the CURRENT refusal verbatim
  (`Expected a plan document`) as a RED pin, so the fix has a measured starting
  point rather than a remembered one;
- after option 1: the same invocation writes an attested evidence row whose
  `attested` marker is set by the runner, asserted from the stored corpus row —
  not from the command's exit code;
- after either option: an ad-hoc task with self-reported evidence and no attested
  row is DISTINGUISHABLE on a read surface from a plan task in the same state
  (assert the distinguishing string);
- CONTROL: a plan task's existing `lore verify <plan>` path is byte-identical —
  `verify-runner-service.test.ts` passes unmodified.

## Source

Discovered 2026-07-31 while dispatching the remediation for
`knowledge-session-process-review-2026-07-31-ten-agent-two-wave`: the two CRITICAL
tasks could not be routed to `lore verify` because they are ad-hoc, so their
evidence must be re-run by the orchestrator from a clean main checkout as a
manual substitute for attestation — a control the review already established does
not survive across sessions.

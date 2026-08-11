---
id: PLAN-092
type: plan
role: plan
title: "escalate gates every doc type + the denial names the questions"
status: archived
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: SPEC-121
phases:
  - {name: "Fix"}
---
# Plan — escalate gates every doc type + the denial names the questions

## Goal
Implement `spec-an-escalate-blocks-approval-for-every-doc-type-and-the` (approved): only the `escalate` verdict universalises; `reject` keeps its `judgment_required_types` scoping; the `[]` kill switch survives; the denial renders `blocking_questions`.

## Oracle
`lore verify` over AC-ESC-1 … AC-ESC-8. External oracles only. Enumerated here so coverage is reviewable without executing `lore verify` — a review of this plan could not otherwise tell which decision each AC pins:

| AC | pins | kind |
|---|---|---|
| AC-ESC-1 | D1 — escalate blocks an ungated type | the behaviour change |
| AC-ESC-2 | D1 negative — `reject` on an ungated type still approves | NEGATIVE guard |
| AC-ESC-3 | D3 — empty `judgment_required_types` still approves an escalate | INVARIANT guard |
| AC-ESC-4 | **D4** — denial renders every `blocking_questions` entry verbatim, and states so explicitly when the array is empty | second headline deliverable |
| AC-ESC-5 | D1 — gated types unchanged in both directions | regression floor |
| AC-ESC-6 | in-scope `@invariant` edit compiles | tsc |
| AC-ESC-7 | D1 precondition half — ungated + NO judgment (or a provenance collision) still approves | over-widening guard |
| AC-ESC-8 | the `@invariant` PROSE no longer claims universal M2 gating | doc-contract oracle typecheck cannot give |

## Phases
Single phase (`Fix`) — one task. The caller-side split, the feed message and the config `@invariant` prose are one contract; splitting them would ship a gate whose documentation contradicts it.

## Risks
- **Over-widening.** Propagating `NO_JUDGMENT` for ungated types would require a judgment before any knowledge doc could be approved. AC-ESC-7 is the guard.
- **Silently universalising `reject`.** AC-ESC-2 is the negative guard.
- **Breaking the documented `[]` kill switch** (`config.ts` `@invariant`). **AC-ESC-3 is the ONLY guard for the case this change can break.** Measured: AC-TIER-7's existing kill-switch test (`tiered-review.test.ts:598`) asserts that an empty list lets a spec approve with NO judgment present — it never constructs an escalate judgment, so it cannot detect an escalate leaking past an empty list. An earlier revision of this plan cited AC-TIER-7 alongside AC-ESC-3 as if it shared the load; it does not.

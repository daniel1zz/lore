---
id: PLAN-146
type: plan
role: plan
title: "Land conclusion currency: a dated retrieval projection, an anchored falsifier for knowledge, and a convergence obligation"
status: approved
priority: medium
created: 2026-08-24
updated: 2026-08-24
tags: []
parent: SPEC-152
phases:
  - {name: "P1 the currency projection"}
  - {name: "P2 the knowledge anchor ratchet"}
  - {name: "P3 the convergence obligation"}
  - {name: "P4 M2 regression and falsifier completeness"}
---
## Objective

Land `spec-a-conclusion-with-no-currency-signal-and-no-falsifier` — the retrieval
currency projection, the convergence obligation, and the knowledge anchor ratchet —
without backfilling anchors onto the 154 existing retros.

## Phase order and why it is this order

D1 and D3 are independent; D2 depends on BOTH. D2 alone deadlocks: it asks an author to
declare what a new conclusion supersedes while the author cannot find the old one (D1)
and no mechanical signal says the old one is even about the same code (D3).

## Shared cutoff, owned elsewhere

`arming_rev` is INTRODUCED by the sibling grading spec and only CONSUMED here
(AC-CONV-8 names `packages/lore/src/service/conclusion-convergence.ts` as the consumer).
⛔ No task in this plan may define a second cutoff — both specs assert the
exactly-one-definition invariant over the same tree, so a second one reddens both.

## Out of scope

⛔ No task here may touch `gate-predicates.ts`, `checkpoint-registry.ts`,
`predicate-contracts.ts`, or the grade derivation — those belong to the sibling plan.
Anchor intersection between the two plans is expected to be EMPTY; if a task needs a
file the sibling owns, stop and report rather than widening the anchor.

## RED-first

⛔ Every task records `lore evidence --result expected-fail` AT THE MOMENT OF RED, by the
agent that produced the red. Transcription afterwards does not count. For P3 (the
ratchet, whose oracle is itself a governance verdict) the suite is authored by a
DIFFERENT agent than the implementation and the implementing task may not edit it.

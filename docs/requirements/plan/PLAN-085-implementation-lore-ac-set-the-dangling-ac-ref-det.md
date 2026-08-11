---
id: PLAN-085
type: plan
role: plan
title: "Implementation — lore ac set + the dangling-ac_ref detector"
status: archived
priority: medium
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: SPEC-125
---
# Implementation — `lore ac set` + the dangling-`ac_ref` detector

Implements `spec-lore-ac-set-in-place-edit-of-a-declared-acceptance`. The spec holds
the contract, the exit-code boundary (D5a) and the retroactive policy (D7); this plan
holds only the execution split.

## Why three tasks and not one

The three deliverables have disjoint file anchors and different oracles, and one of
them (the diagnosis) can produce a finding that changes what the others assert:

- **T1** is the writer verb — service + CLI + the six-dimension suite.
- **T2** is the detector plus its seeded-dangling fixture. Independent of T1: it reads
  the corpus, it does not write it.
- **T3** is the diagnosis + disposition of the three measured dangling refs, and it
  CONSUMES both — it needs T1's verb to re-declare a lost criterion (option 1) and
  T2's exemption channel to record a retirement (option 2). It runs last.

## Sequencing

T1 and T2 are anchor-disjoint and run in parallel. T3 starts only after both merge —
it is the slice's end-to-end proof, and AC-ACS-7's positive half (`exit 0` on the repo
corpus) cannot be true until T3 dispositions all three refs.

## Non-negotiables carried from the spec

- `extra.verification_evidence` is append-only: T3 may never rewrite or delete an
  `ac_ref`.
- T3's disposition must cite the spec version in which each id disappeared. Guessing
  between "lost" and "retired" is forbidden.
- Neither T2's fixture nor any test may write the repo's own `.lore/` corpus —
  `mkdtemp` + `lore init`, per the CLAUDE.md prohibition.

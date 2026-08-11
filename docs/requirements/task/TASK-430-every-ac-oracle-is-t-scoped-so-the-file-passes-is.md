---
id: TASK-430
type: task
role: plan
title: "Every AC oracle is -t-scoped, so 'the file passes' is attested nowhere — require an attested unfiltered run per touched test file"
status: archived
priority: medium
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
---
## Origin

`knowledge-assessment-implementation-lore-ac-set-the-dangling-ac`, typed recommendation (process):

> Add an attested unfiltered run of each touched test file alongside the -t-scoped AC oracles.
> Every T1 row shows '5 tests | 4 skipped'; nothing proves the six tests pass together.

## The gap

An AC binds to a `-t`-filtered oracle so that the row proves THAT assertion. Thirteen such rows
each ran one test and skipped the rest of the file. Every individual assertion is attested; the
proposition "the file passes" is attested nowhere. Those are different claims, and only the second
one catches an interaction between two tests in the same file (shared fixture mutation, ordering
dependence, a `beforeEach` one test relies on and another breaks).

This is adjacent to, but NOT the same as, false-oracle vector 2 already mechanized at the
`lore verify` layer (assert the matched count after a filtered run). Vector 2 catches a filter
that matched the WRONG set. This catches a filter that matched the RIGHT set and still leaves the
file's collective behaviour unmeasured.

## Requirement

For each test file a task touches, one attested unfiltered run of that file, recorded alongside
the `-t`-scoped AC rows. Attested, not self-reported — the exit code decides.

Open design question the implementation must settle: whether this is a `lore verify` addition (it
already owns attested runs and already knows each AC's bound command, so it could derive the file
set from the bound commands and run each once unfiltered), or a plan-close conjunct over the union
of touched files. Prefer the former if the file set is derivable — a conjunct that requires the
author to declare the file set is a second place for the truth to live.

## Oracle

- A task whose ACs are all `-t`-scoped, with no unfiltered run of the touched files, is REFUSED /
  reported at the chosen enforcement point, and the message names the files lacking one.
- CONTROL proving the check is live rather than vacuous: the same task WITH the unfiltered runs
  passes, and a task that touches no test files is unaffected.
- The check must catch the interaction it exists for: a fixture whose two tests pass individually
  under `-t` and fail when run together must be REFUSED by the unfiltered run. Without this case
  the mechanism is only paperwork — build the fixture.

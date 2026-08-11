---
id: ADR-024
type: adr
role: decision
title: "A CLAUDE.md standing lesson is evicted when a deterministic mechanism enforces it, never by age or by arrival order"
status: approved
priority: medium
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
---
## Context

The root `CLAUDE.md` standing-lessons layer is full: 24571 of 24576 bytes, 5 remaining, measured
2026-08-01. It has been effectively closed for some time without anyone noticing, because
`lore status --check-claude-md` reported a saturated file as `within budget (0 findings)` — a
defect fixed the same day (headroom is now reported on every run, with a config-driven
near-ceiling advisory). The check now says out loud what was previously silent, which converts a
hidden problem into a decision that must be made: **what leaves, when a new lesson arrives?**

Three lessons discovered in the 2026-08-01 session live only as corpus knowledge docs because
there was no room. Without a rule they will keep accumulating there, and the file will keep
being the wrong shape: full of lessons chosen by *arrival order* rather than by *value*.

Raising the ceiling was considered and rejected as the primary answer: the ceiling exists because
every byte is re-read on every session start by every agent. An unbounded discipline file is a
context tax paid forever, and the growth pattern already observed (26.7KB → 52.8KB in four days,
via close-out clauses) shows the file grows without limit whenever nothing evicts.

## Decision

**A standing lesson is EVICTED from `CLAUDE.md` when, and only when, a deterministic mechanism
enforces it.** The corpus knowledge doc stays forever; the prose line goes.

The test is a single question with a checkable answer: *can an agent violate this lesson and have
something other than prose stop it?* A gate predicate, an oracle exit code, a hook, a schema
refusal, a CI check — any of these is a mechanism. A reviewer noticing, an instruction to be
careful, or another prose line pointing at the first one are not.

This follows directly from the repo's existing and repeatedly-proven position that **prose is the
wrong layer**: a defect already covered by prose is proof the prose layer failed. If that is true
when a defect recurs, it is equally true in reverse — once a mechanism enforces the invariant, the
prose is no longer load-bearing and is paying rent in every future context window.

Eviction is not deletion. The lesson's full narrative, measurement, and root cause remain in its
corpus knowledge doc, which is where anyone asking *why* is already directed.

## Consequences

**A new lesson does not automatically get a line.** When the layer is full, the arriving lesson
competes: either an existing line is mechanized and evicted, or the new lesson goes to the corpus
only. Arrival order stops deciding what an agent reads at session start.

**Mechanization is now rewarded twice** — it prevents the defect, and it buys back the space its
prose occupied. This is the incentive the current file lacks.

**A mechanized lesson may still leave a pointer** where the mechanism's *existence* is not
self-evident from its failure message. The pointer must be a fragment, not a restatement — if the
gate already explains itself when it fires, even the fragment is redundant.

**Nothing is evicted on suspicion.** "This is probably enforced somewhere" is not the test. The
evicting change must name the enforcing mechanism, and a reader must be able to run it.

**The audit is a separate slice.** This ADR sets the rule; sweeping the existing layer against it
is its own piece of work and will need its own budget, because each candidate requires verifying
the mechanism actually exists and actually fires (the standing "escalation ≠ build" rule applies:
check whether the tool already enforces it before assuming either way).

## Alternatives Considered

**Raise `max_bytes`.** Rejected as primary: it defers rather than decides, and the growth evidence
above shows the file expands to whatever ceiling it is given. Remains available as a deliberate,
separately-justified change if the mechanized-eviction sweep proves the *residual* set of
unmechanizable lessons genuinely exceeds the current budget — that would be evidence the ceiling
is wrong, rather than an excuse not to choose.

**Evict by age.** Rejected: age is uncorrelated with value. The oldest lessons here are among the
most load-bearing precisely because they have survived being re-learned.

**Evict by "seems obvious now".** Rejected: it is indistinguishable from having internalized a
lesson that a *fresh* session has not. The reader who finds a lesson obvious is not the reader the
lesson is written for.

**Compress prose instead of evicting.** Rejected as a policy, though fine as housekeeping:
compression buys a diminishing constant while the arrival rate is unbounded, and past compression
rounds are what produced the current dense, hard-to-scan layer.

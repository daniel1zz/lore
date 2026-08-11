---
id: TASK-447
type: task
role: plan
title: "Sweep the CLAUDE.md standing-lessons layer against the mechanized-eviction rule, naming the enforcing mechanism for every line removed"
status: archived
priority: medium
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
---
Follow-up slice mandated by `adr-a-claude-md-standing-lesson-is-evicted-when-a-deterministic` (accepted 2026-08-01). The ADR sets the rule; this task applies it once.

## Why it is separate

The ADR is deliberately a policy, not a sweep. Each candidate line needs its enforcing mechanism
VERIFIED to exist and to actually fire — the standing "escalation != build" rule applies in both
directions: do not assume a mechanism exists, and do not assume it does not.

## Required

For every line in the root CLAUDE.md standing-lessons layer, decide and record one of:
- **EVICT** — name the deterministic mechanism (gate predicate / oracle exit code / hook / schema
  refusal / CI check) AND demonstrate it fires. A mechanism that cannot be made to fail on demand
  has not been demonstrated.
- **KEEP** — no mechanism enforces it; it is still load-bearing prose.
- **POINTER** — mechanized, but the mechanism`s existence is not self-evident from its own failure
  message; leave a FRAGMENT, never a restatement.

⛔ Nothing is evicted on suspicion. ⛔ The corpus knowledge doc for an evicted lesson stays forever
— eviction removes the prose line only.

## Known starting candidates (verify, do not trust this list)

- The saturation lesson itself: `lore status --check-claude-md` now reports headroom and warns near
  the ceiling (landed 2026-08-01), so the prose about watching byte counts may be evictable.
- False-oracle vectors 1-4 are described in CLAUDE.md as "mechanized at the lore verify layer
  (SPEC-061 AC-061-9/10; SPEC-063)" — if that is accurate and demonstrable, they are prime
  candidates. Vector 5 is explicitly stated as NOT mechanizable and should KEEP.
- The `-t` zero-match vector (knowledge-vitest-t-with-a-non-matching-pattern-exits-0-having) is
  currently NOT mechanized and has no CLAUDE.md line — if a line is ever added, it should be
  evicted only once the verify-layer executed-count assertion lands.

## Oracle

`lore status --check-claude-md` reports strictly more headroom afterwards than before, AND every
evicted line is traceable in the commit to a named mechanism plus a demonstration that it fires.
The byte reduction alone is NOT sufficient evidence — a sweep that merely deletes text passes that
check while destroying discipline.

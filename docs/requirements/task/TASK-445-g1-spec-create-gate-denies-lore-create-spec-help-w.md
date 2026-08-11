---
id: TASK-445
type: task
role: plan
title: "g1 spec-create gate denies 'lore create spec --help' with PARENT_REQUIRED — a read-only introspection command cannot violate a create predicate"
status: archived
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
---
## Defect

`lore create spec --help` is DENIED by the g1 spec-create gate, with a deny reason
that is actively misleading:

```
⛔ CHAINED COMMAND BLOCKED — matched segment: `lore create spec --help 2>&1`
Missing:
- PARENT_REQUIRED
- MISSING_SKELETON
```

`--help` creates no document. There is no parent to require and no skeleton to
miss. Measured 2026-08-01 while trying to look up the flag set for a legitimate
spec creation.

## Mechanism root

`assets/hooks/lore-gate-g1-spec-create.sh` matches on **command position** only —
`is_command_position_match` tests that a segment starts with `lore create spec`
(SPEC-050 D4), then evaluates the create predicates against the remaining argv.
Nothing in the hook, and nothing in `assets/hooks/lib`, tests for `--help` / `-h`.
Verified: `grep -- '--help' assets/hooks/lore-gate-g1-spec-create.sh` → 0 hits.

The same shape applies to g2 / g3 / g4 (`lore-gate-g2-spec-promote.sh`,
`lore-gate-g3-plan-promote.sh`, `lore-gate-g4-task-claim.sh`) — they share the
matcher, so each presumably denies its own `--help`. That must be measured, not
assumed, before fixing: fix the matcher once if all four share it.

## Why it matters beyond the annoyance

A gate that denies a read-only introspection command teaches its operator that the
gate's denials are noise to route around. The documented failure mode of this repo
is the opposite reflex — CLAUDE.md forbids `LORE_GATE_BYPASS=1` without explicit
consent — and every false deny spends credibility that the true denies need. This
is the over-application counterpart of I7b's vacuity: a gate firing where it cannot
possibly be measuring anything.

It also has a concrete cost already paid: the operator could not read the flag list
from the tool and had to recover it by grepping `commands/create.ts`.

## Oracle

- `lore create spec --help` exits 0 and prints the usage block (the CURRENT
  behaviour is a non-zero deny — assert the transition, and keep a control that a
  real `lore create spec` with no parent is STILL denied, so the fix cannot silently
  disarm the gate).
- The same pair for whichever of g2 / g3 / g4 the measurement shows to be affected.
- The fix lands on `assets/hooks/*` (the shipped SSOT) with the manifest regenerated
  — not on this repo's `hooks/` copy alone; the pair is parity-pinned.

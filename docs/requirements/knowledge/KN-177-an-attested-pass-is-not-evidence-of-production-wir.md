---
id: KN-177
type: knowledge
role: knowledge
title: "An attested pass is not evidence of production wiring: three instances of the same AC-design defect in one session, all found after attestation"
status: approved
priority: medium
created: 2026-08-10
updated: 2026-08-10
tags: []
parent: PRD-001
---
# The finding is the pattern, not any one instance

One session produced THREE instances of the identical defect — "capability implemented ≠ wired into
production" — and **all three earned an `attested pass` before the gap was noticed**. The existing
standing rule already covers the defect. What it does NOT say, and what this session measured, is
the part that makes the rule insufficient on its own:

> ⛔ An attested pass is not evidence of production wiring. `lore verify` proves the AC's declared
> command exited 0. If that command exercises the implementation layer while the AC's PROSE promises
> a user-facing surface, the attestation certifies a capability that production cannot reach — and it
> does so with the strongest evidence tier the corpus has.

## The three instances

| # | AC | What the oracle actually ran | What the AC's prose promised | Found by |
|---|---|---|---|---|
| 1 | `AC-TC-1` | `tsc -p tsconfig.e2e.json --listFilesOnly`, grep ≥27 | that the project is IN `bun run typecheck`'s chain | `lore assess` (major) |
| 2 | `AC-GV-1` | `checkPlanClose`'s returned objects + `JSON.stringify` of those same objects | the discriminator visible in BOTH human render and `--json` | `lore assess` (major) |
| 3 | `AC-OX-9` | `ac-service.test.ts -t allow-missing-path-unredeemed` | `lore status --json` reports the count | the IMPLEMENTER, self-reported |

Instance 1: deleting `typecheck:dashboard-e2e` from `package.json` leaves the oracle fully green.
Instance 2: no renderer or CLI file is touched by the diff at all.
Instance 3: the implementer's own report states `commands/ac.ts` and `commands/status.ts` were never
touched, so `lore ac add --allow-missing-path` and `lore status --json` cannot reach the mechanism —
yet AC-OX-9 recorded `attested pass, exit 0, 1037ms`.

## Root cause, stated precisely

⛔ In all three the fault is the AC's own design — its PROSE spans two layers while its COMMAND and
its ANCHOR SET cover only the lower one. Not one is an implementer failure; instance 3's implementer
in fact caught and flagged it unprompted, which is the behaviour the discipline wants. Attributing
this class to the execution layer would fix nothing.

The generative test that would have caught all three at authoring time:

> For this AC's exact command, what is the simplest world where the command exits 0 and the AC's
> prose is still FALSE? If that world is reachable by deleting one line of config or one call site,
> the AC is measuring the wrong layer.

## Mechanization

1. **Split any AC whose prose names two layers.** One AC = one layer = one oracle. Applied three
   times this session (`AC-TC-1`, `AC-GV-1`→`AC-GV-6`, `AC-OX-9`→`AC-OX-10`), each with its
   re-baseline record written in place.
2. **A surface-layer AC's oracle MUST drive the surface.** Re-serialising the objects the lower layer
   returns, or asserting a service method exists, is the exact shortcut that produces the false green.
   Say so IN the AC, because the next author will otherwise take it.
3. **The anchor set is where this is won or lost.** An AC promising CLI behaviour whose anchors name
   no CLI file is unsatisfiable-as-written; the gate cannot see the omission, so it must be caught at
   authoring.
4. ⛔ **`lore assess` caught 2 of 3 — so it is load-bearing, not advisory-in-practice.** Both were
   rated `major` on `outcome`. A plan whose tasks are all archived is NOT verified until assess has
   run and its majors are dispositioned. Two plans in this session looked complete by every counter
   (`lore ready`: all archived, every AC attested) and were not.

## A second, smaller lesson from the same session

`lore verify <plan>` with no `--ac` filter runs EVERY declared script-mode AC on the plan, including
those whose tasks have not been implemented yet. On a partially-complete plan that manufactures fresh
`fail` rows for unwritten oracles — the very defect
`spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a` exists to fix. ⛔ Always pass
`--ac` (or `--task`) when attesting a partially-complete plan; the unfiltered form is only safe once
every AC has an implementation.

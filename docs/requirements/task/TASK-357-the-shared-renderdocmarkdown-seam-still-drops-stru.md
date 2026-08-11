---
id: TASK-357
type: task
role: plan
title: "The shared renderDocMarkdown seam still drops structured extra silently, so a feeding pack and a gate DENIAL pack both hide the evidence"
status: archived
priority: high
created: 2026-08-06
updated: 2026-08-07
tags: [defect, feeding-pack, gate, silent-omission, ssot]
parent: PRD-001
links:
  - {id: TASK-366, type: relates-to}
  - {id: KN-203, type: relates-to}
---
# Defect — the shared `renderDocMarkdown` seam still drops structured `extra` silently, so a feeding pack and a GATE DENIAL pack both hide the evidence a reader needs

`task-lore-get-s-default-render-silently-omits-structured-extra` was fixed at ONE consumer
(`lore get`, merged 2026-08-06). The loss lives in the SHARED seam it reuses:
`renderDocMarkdown` (`packages/lore/src/flows/feed-flow.ts`), which carries only the
invalidation banner and never announces structured `extra`.

Measured 2026-08-06 on `main @ 8012f57` (the merge commit of the `get` fix), by grep over the
non-test source: `renderDocMarkdown` has **three** production consumers, not one.

| consumer | what its output is for | structured `extra` announced? |
|---|---|---|
| `adapters/cli/commands/get.ts` | direct human read | **YES** — fixed, Option B loss notice |
| `adapters/cli/commands/feed.ts` | `lore feed <checkpoint>` pack — the PULL an agent makes before producing | NO |
| `adapters/cli/commands/gate.ts` | the feeding pack emitted with a gate DENIAL, plus the "active feeding rule source" for a violation | NO |

⛔ The `get` fix therefore did NOT fix this. It fixed the surface that happened to expose it —
the mechanism root (a lossy projection with no loss marker) is still shipping on two surfaces,
and on the two whose reader is a MACHINE that cannot compensate by running a second command.

# Why the gate surface is the sharp end

A gate denial's feeding pack exists to tell an agent exactly how to fix its rejected write. That
is the moment a structured `extra` is most load-bearing and least substitutable: the agent is
mid-write, acting on the pack alone. A pack that silently omits `issue_report`,
`verification_evidence`, `claim`, or `ac_scope` hands the agent an incomplete remediation and
gives it no signal that anything was withheld.

The original incident this family comes from is exactly this shape: an orchestrator authored a
5.6 KB spec on a wrong mechanism assumption because `extra.issue_report.actual` was invisible to
the read command it did run. Reproducing that failure inside a *gate remediation* pack is worse,
because the gate is the mechanism the corpus relies on to be authoritative.

# Mechanism root — the fix landed on a consumer, not on the seam

`get.ts` wraps `renderDocMarkdown`'s output and appends its own notice. Every other consumer of
the same function gets the unannotated projection. This is the repo's own named anti-pattern:
a defect fixed on whichever surface exposed it, rather than at its mechanism root. The
distribution question ("would a fresh consumer still hit this?") answers YES for `feed` and
`gate`.

# Required fix

1. The loss notice must be produced **at or below the shared seam**, so every consumer of
   `renderDocMarkdown` inherits it and a FUTURE fourth consumer inherits it with no edit.
   Reuse the already-shipped key-agnostic notice logic (`adapters/cli/get-render.ts`) rather
   than writing a second one — two implementations of one invariant is the SSOT violation that
   makes the next divergence invisible.
2. ⛔ `get.ts`'s current behaviour is the CONTRACT, not a starting point: key-agnostic, announces
   key + shape + child key NAMES, never values, and derives its exclusions from render facts
   (the banner already rendered `validity`; a spec's own block already rendered
   `acceptance_criteria` / `code_anchors`) rather than from a static list that would either
   claim loss where none happened or silence real loss under `--raw`.
3. **SWEEP — the sweep result IS part of scope.** `flows/` contains sibling pack builders that
   do NOT necessarily route through `renderDocMarkdown`: `task-feed-flow.ts` (backs
   `lore feed task-start` — it demonstrably DOES surface `file_anchors` as a "Boundaries"
   section) and `phase-feed-flow.ts`. Determine per pack whether it announces, renders, or
   drops each structured key, and report the matrix. ⛔ Do not assume the three
   `renderDocMarkdown` consumers are the only affected packs — an assumption of exactly this
   shape is what left this defect open after the `get` fix.

# Oracle

- `lore feed <checkpoint>` on a doc carrying structured `extra` announces it; assert two
  independent lone tokens, never one remembered sentence.
- **CONTROL**: a doc with NO structured `extra` produces NO notice in the same pack — an
  implementation that always appends something passes the positive case vacuously.
- A gate DENIAL's feeding pack announces it. Drive this through a real refused write with a
  VALID payload: an invalid payload is stopped by schema validation BEFORE the gate is reached,
  which reads as a pass while proving nothing. Pair it with the HAPPY control on the same
  payload shape.
- **REGRESSION**: `lore get`'s notice is byte-identical to today (the seam fix must not
  double-announce once `get` stops appending its own), and every `--json` surface is unchanged.
- `bun run typecheck` clean; `bun run test:changed <base>` passes with a NON-ZERO selection
  (loud-zero rule).
- Six-dimension coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.

# Proxy / Silence / Opt-in (binding — `adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the`)

**Proxy.** "The `get` fix is merged, so the loss-marker invariant holds" is a proxy for "no
surface drops structured `extra` silently". Concrete input satisfying the proxy while violating
the property: any `lore feed` pack, today, on `main @ 8012f57`. The fix removes the proxy by
moving the invariant to the seam every surface shares.

**Silence.** Total on both remaining surfaces, and worse than the `get` case: the reader is a
machine mid-write acting on the pack alone, with no habit of running a second command.

**Opt-in.** None, and none may be added. ⛔ Do not put the seam notice behind a flag or a
per-consumer opt-in — a consumer that must remember to ask is the same prose layer that let the
`get` fix ship as "done" while two surfaces stayed broken.

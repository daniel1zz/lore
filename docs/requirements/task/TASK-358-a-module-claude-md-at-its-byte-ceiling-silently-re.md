---
id: TASK-358
type: task
role: plan
title: "A module CLAUDE.md at its byte ceiling silently relocates that module's facts into other modules' docs — realized on service/, and three more docs are next"
status: archived
priority: high
created: 2026-08-06
updated: 2026-08-07
tags: [defect, claude-md, budget, ssot, eviction, governance]
parent: PRD-001
---
# Defect — a module CLAUDE.md at its byte ceiling silently relocates that module's facts into OTHER modules' docs, and four docs are already there

Measured on `main @ f5e551d`, 2026-08-06, by `lore status --check-claude-md`:

| module doc | bytes | remaining |
|---|---|---|
| `packages/lore/src/service/CLAUDE.md` | 16351/16384 | **33** |
| `packages/lore/src/store/CLAUDE.md` | 16255/16384 | **129** |
| `packages/lore/src/ai/CLAUDE.md` | 15826/16384 | **558** |
| `packages/lore/src/adapters/http/CLAUDE.md` | 14906/16384 | 1478 |

## The harm is already realized, not hypothetical

The `file_anchors` resolution advisory (merged `f5e551d`) added a new SERVICE-layer module,
`packages/lore/src/service/anchor-resolution.ts`. Its implementer tried twice to record it in
`packages/lore/src/service/CLAUDE.md` and was blocked by the ceiling guard both times. Verified
on the merged tree:

- `grep -c anchor-resolution packages/lore/src/service/CLAUDE.md` → **0**
- the same module IS documented in `packages/core/src/CLAUDE.md`,
  `packages/lore/src/adapters/cli/CLAUDE.md`, and
  `packages/lore/src/adapters/mcp/CLAUDE.md`

So a service-layer fact now lives in three non-service module docs and nowhere in the service
module doc. The next AI session reading `service/CLAUDE.md` to learn what the service layer
contains will not find this module at all. That is an SSOT violation produced by the budget
mechanism, and it recurs for **every** future service module while the doc stays at 16351.

⛔ The implementer behaved correctly — it respected the guard, put the content where there was
headroom, and disclosed the displacement. A mechanism that makes correct behaviour produce a
wrong outcome is the mechanism's defect, not the actor's.

## The binding constraint is BYTES, and only bytes

`service/CLAUDE.md` is at 72/200 lines and 16351/16384 bytes. Line headroom is irrelevant
everywhere in the table; every approaching doc is approaching on bytes alone. Any remediation
that trades lines for bytes (splitting long lines) makes the measured problem WORSE, and any
"just be terser" instruction is prose aimed at the constraint that is not binding.

# Required fix — eviction, applied, with the surviving content re-addressable

1. **Evict, do not compress.** Per this repo's own content contract (`lore governance claude-md`),
   what belongs in a CLAUDE.md is permanent static discipline; narrative, history, and
   mechanism detail belong in the corpus. Move the evictable content of the four docs above into
   corpus docs (`lore create knowledge --sub-type reference` for mechanism detail), leaving a
   one-line pointer per evicted block — the same shape the root CLAUDE.md already uses for its
   retired sections.
2. **`service/CLAUDE.md` must end the slice with enough headroom to absorb the module entry it is
   currently missing**, and `anchor-resolution.ts` must actually be recorded there. Fixing the
   budget without landing the displaced entry leaves the realized harm in place.
3. **Decide and record the recurrence rule.** A per-module doc that fills up will fill up again.
   State — in the contract, not in prose scattered across docs — what the eviction trigger is
   (a remaining-bytes threshold), and who performs it. ⛔ An advisory warning that nobody is
   obligated to act on is what produced this state: the checker has been emitting
   "approaching its max_bytes ceiling" for four docs and the count went UP, not down.
4. **SWEEP — part of scope**: check whether facts have ALREADY been displaced out of the other
   three near-ceiling docs the way `anchor-resolution.ts` was displaced out of service's.
   Report the matrix. ⛔ Do not assume service is the only doc that has already lost content —
   an assumption of exactly this shape is why this defect was found by accident rather than by
   the checker.

# Oracle

- `lore status --check-claude-md` reports every doc within budget AND every previously
  approaching doc below the eviction threshold; assert the per-doc byte numbers, not the
  "0 findings" summary line — the summary is already green today while the defect is live, so a
  summary-only assertion proves nothing.
- `grep -c anchor-resolution packages/lore/src/service/CLAUDE.md` → non-zero (the displaced entry
  landed).
- CONTROL: every evicted block is reachable by its pointer — for each pointer added, the named
  corpus slug resolves via `lore get`. A pointer to a nonexistent doc is the file_missing shape
  this repo already polices elsewhere.
- REGRESSION: no content is DELETED without a corpus home. Diff the evicted text against the
  created corpus docs and assert every evicted block is present somewhere addressable.
- `bun run typecheck` clean; `bun run test:changed <base>` with a NON-ZERO selection.

# Proxy / Silence / Opt-in (binding — `adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the`)

**Proxy.** "`lore status --check-claude-md` reports 0 findings" is a proxy for "every module's
facts are recorded in that module's doc". Concrete input satisfying the proxy while violating the
property: `main @ f5e551d`, where the check is green and a merged service module is absent from
the service doc. The check measures the CEILING, never the DISPLACEMENT — that gap is the defect,
and closing the byte budget alone does not close it.

**Silence.** The displacement is invisible to every existing mechanism. The guard says "you may
not add"; nothing anywhere says "content that belonged here went somewhere else". It surfaced
only because the implementer volunteered it in a report.

**Opt-in.** The advisory warning is effectively opt-in — four docs have been warning for an
unknown number of sessions with no action. ⛔ Do not resolve this by raising `max_bytes`: the
ceiling exists because an unbounded CLAUDE.md is itself the failure mode, and raising it converts
a loud block into a slow silent regression.

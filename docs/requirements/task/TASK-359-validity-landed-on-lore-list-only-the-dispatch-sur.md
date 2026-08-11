---
id: TASK-359
type: task
role: plan
title: "Validity landed on lore list only — the DISPATCH surface (feed task-start) still hands out retracted work with no signal, and status counts include retracted docs"
status: archived
priority: critical
created: 2026-08-06
updated: 2026-08-07
tags: [defect, validity, dispatch, feeding-pack, silent-omission]
parent: PRD-001
links:
  - {id: TASK-364, type: relates-to}
  - {id: KN-197, type: relates-to}
---
# Defect — validity landed on `lore list` only; the DISPATCH surface still hands out retracted work with no signal at all

`task-an-invalidated-doc-is-indistinguishable-from-a-live-one-in` shipped (merged `156c055`):
`lore list` now hides invalidated docs by default, restores them under `--include-invalid` with an
`[invalid]` badge, and every `--json` record carries `validity_status`. The four pure helpers are
exported from `packages/lore/src/service/validity-service.ts` and are ready to be adopted
verbatim: `projectValidityStatus`, `selectLiveDocs`, `withValidityStatus`,
`withPreGatedLiveStatus`.

Its AC-7 sweep (measured pre/post on a throwaway corpus, keyed on ID) reported the surfaces it
deliberately scoped OUT. They are recorded here so the sweep result does not die in a task
report.

| surface | filters retracted? | carries validity in payload? |
|---|---|---|
| `lore list` (all types, all branches except `--governed-by`) | YES — fixed | YES — fixed |
| `lore search` | YES — was already correct (reference implementation) | — |
| **`lore feed task-start <retracted task>`** | **NO SIGNAL WHATSOEVER** | no |
| `lore status` counts | **NO — counts include retracted docs** | no |
| `lore tree --json` | no | no top-level validity key |
| `lore get --json` | (direct address SHOWS by design) | **no top-level validity key** |
| `lore pending` | filters correctly | data partial |
| `lore ready` | filters correctly | no data |
| `lore list --governed-by` | **NO** — `listGovernedBy` returns summaries, not full records | no |

# Why `feed task-start` is the sharp end, not `status` or `tree`

`lore feed task-start <task>` is the pack an orchestrator or implementer reads immediately before
committing work to a task. It is the surface that DISPATCHES. A retracted task fed through it
returns a complete, confident, entirely normal-looking work order.

This is not hypothetical. The incident that produced the parent task is exactly this: an
orchestrator enumerated open tasks, sequenced a retracted one into a wave, and the error was
caught only because an unrelated human-readable `lore get` happened to show the `RETRACTED`
heading. Fixing `lore list` removes the enumeration half. **The dispatch half is still open** —
and a `feed` pack is consumed by an agent that has no habit of cross-checking, because the pack
is precisely the artifact that exists so it does not have to.

⛔ Do not treat this as a lower priority than the parent task was. The parent's measured cost
came from a *listing*; this one's would come from an agent implementing work that was explicitly
retracted.

# `lore status` counts are the second real one

A count that silently includes retracted docs is a corpus-health number that overstates live
work, and health numbers are what the team reads to decide whether the corpus is in good order.
Same shape as the `lore ready` readiness inflation this repo has already measured once.

# Required fix

1. **Adopt the shipped helpers; do not write a second predicate.** `validity-service.ts` is the
   SSOT for the read-surface projection. ⛔ A surface that re-derives "is this invalidated" from
   `extra` on its own is the divergence that makes the next inconsistency invisible.
2. `feed task-start` (and any sibling pack builder in `flows/` that resolves a target doc) must
   emit a LOUD retraction signal — the pack is for a machine, so the signal must survive a
   machine read, not only a human skim. Decide whether it refuses outright or announces; state
   the choice and its reasoning in the JSDoc. Refusing is defensible here in a way it was not for
   file anchors, because a retracted task has no legitimate "not yet" reading.
3. `lore status` counts exclude retracted docs by default, and report the retracted count
   separately rather than dropping it silently — an omitted count is the same silence class this
   whole family is about.
4. `tree --json` and `get --json` carry the same top-level validity key `list --json` now carries.
   ⛔ `get`'s DEFAULT human behaviour must not change: SPEC-043's asymmetry (list hides, direct
   address shows) is deliberate. This is about the machine payload only.
5. `pending`'s partial data and `ready`'s absent data get the same field.
6. `--governed-by`: `CorpusService.listGovernedBy` must return full records (or carry validity)
   so the same gate applies. This is the one item requiring a service-layer signature change.

# Oracle

- For EACH surface in the table: a retracted doc is signalled/excluded, and a live doc is not —
  both directions, per surface. A one-directional assertion passes against a blanket
  implementation.
- `feed task-start <retracted task>`: assert two independent lone tokens (or a non-zero exit if
  refusal is chosen), and pair it with the HAPPY control — the same command against a LIVE task
  must be unchanged byte-for-byte. Without that control, a pack that broke for everyone would
  pass.
- `status`: assert the NUMBER changes by exactly the retracted count, not merely that a new field
  appeared — the parent task's `--include-invalid` was inert precisely because nobody asserted a
  difference.
- REGRESSION: `lore list` and `lore search` behaviour byte-identical to `156c055`; `lore get`'s
  default human render unchanged.
- `bun run typecheck` clean; `bun run test:changed <base>` with a NON-ZERO selection.
- Six-dimension coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.

# Proxy / Silence / Opt-in (binding — `adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the`)

**Proxy.** "`lore list` hides retracted docs now" is a proxy for "a retracted doc cannot reach a
worker". Concrete input satisfying the proxy while violating the property: `lore feed task-start`
on the retracted task, today, on `main @ 156c055` — a full work order with no retraction signal.

**Silence.** Total on the dispatch surface, and its reader is a machine acting on the pack alone.

**Opt-in.** ⛔ None may be added. A validity signal a caller must ask for is the inert
`--include-invalid` flag all over again.

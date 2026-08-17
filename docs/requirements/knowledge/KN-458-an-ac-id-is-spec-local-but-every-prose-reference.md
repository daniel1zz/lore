---
id: KN-458
type: knowledge
role: knowledge
title: "An AC id is spec-local but every prose reference treats it as global: 51 exact ids are claimed by more than one live spec"
status: draft
priority: medium
created: 2026-08-17
updated: 2026-08-17
tags: []
parent: PRD-001
---
An AC id is a SPEC-LOCAL name, but every reference to one outside a plan context is
written as if it were global. Measured 2026-08-17 on the live corpus: **51 exact AC ids
are claimed by more than one live spec**, across 10 shared prefixes. The tooling is not
wrong — the REFERENCE convention is missing, and it has already produced a real
misreading inside a governance artifact.

## Measurement (reproducible, read-only)

```
sqlite3 "file:.lore/lore.db?mode=ro" \
  "SELECT id, slug, extra FROM docs WHERE type='spec' AND deleted_at IS NULL;"
```
parsed for `extra.acceptance_criteria[].id`, grouped by id and by `AC-<PREFIX>` stem.

Population: 151 live specs, 117 of which carry at least one AC.

| finding | count |
|---|---|
| exact AC ids claimed by >1 live spec | **51** |
| AC prefixes shared by >1 live spec | **10** |
| worst prefix: `AC-DOV` | **11** specs |
| `AC-080` | 3 specs |
| `AC-OX`, `AC-SL`, `AC-069`, `AC-072`, `AC-073`, `AC-TC`, `AC-CP`, `AC-ACS` | 2 specs each |

`AC-DOV-1` alone resolves to eleven different criteria depending on which spec you meant.

## Why this is NOT a tooling bug

`lore verify <plan> --ac <id>` is plan-scoped: the plan names its spec, so the id
resolves uniquely inside that call. Every deterministic consumer of an AC id reaches it
through a plan or a task's `ac_scope`, both of which carry the spec. Nothing in the
gate/oracle path is ambiguous, and no oracle has ever verified the wrong criterion
because of this.

The gap is in the layer with no resolver at all: **prose that names an AC id without its
spec** — handoff tickets, CLAUDE.md standing lessons, task bodies, assess/review
findings, and cross-session conversation. There the reader (human or the next session's
AI) has no way to disambiguate, and no tool will tell them they guessed wrong.

## The measured misreading

This session's own resume ticket, `knowledge-handoff-agent-main-orchestrator-104`, uses
the bare string `AC-OX-6` for two different criteria in two different decisions:

- **KD5** — "AC-OX-6 is the ONLY red left: one orphan, KN-025" → this is
  `spec-oracle-exclusivity-in-a-shared-checkout-a-mirror-check` AC-OX-6, the mirror
  status-parity back-catalogue sweep.
- **KD11** — "AC-OX-6/7/11 at zero evidence" → this is
  `spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a` AC-OX-6, which is
  about clearing the `pass_unfalsified` backlog and has nothing to do with the mirror.

Both specs are `approved`. Both use the `AC-OX` prefix. A reader resuming from that
ticket who follows KD11's pointer while holding KD5's meaning will conclude the mirror
oracle has zero evidence — which is false, it holds a fail row. The ticket is not
defective prose; the convention it was written under permits the collision.

This is the same shape as the other silent-census defects in this corpus: an artifact the
tool renders identically whether or not it is sound.

## Mechanization directions (not yet a spec)

Prose telling authors to "always qualify AC ids" is the wrong layer — a defect already
covered by prose is proof of that. Candidates that could actually trip:

1. **Allocate globally-unique AC ids at creation.** `lore ac add` would refuse a prefix
   already owned by another spec, the way ordinals are corpus-allocated (SPEC-084).
   Retroactively invalidates the 51 existing duplicates, so it needs a back-catalogue
   sweep budgeted in the SAME slice — the standing lesson about newly-built gates.
2. **Render AC ids spec-qualified wherever the spec is known.** `lore handoff`,
   `lore assess`, and `lore ready` all know the plan, hence the spec; they could emit
   `spec-oracle-exclusivity#AC-OX-6` instead of a bare id, making unqualified references
   in hand-written prose visibly the odd ones out.
3. **A corpus check** (`lore status --check-ac-ids`) that reports duplicate-claimed ids
   with their member specs — a count with a member list, never a bare count.

Option 2 is the cheapest and the only one that needs no back-catalogue sweep, because it
changes output rather than stored state. Option 1 is the only one that makes a collision
impossible rather than merely visible.

⛔ Do not "fix" this by renaming one of the two `AC-OX` specs' criteria by hand. That
repairs one collision out of 51 and leaves the mechanism untouched, and `lore ac set`
would drop both approved specs to `draft` and hard-block every descendant claim.

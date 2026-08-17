---
id: ADR-034
type: adr
role: decision
title: "A record with no state stamp is acceptable but never green: a third class, not a pass and not a refusal"
status: approved
priority: high
created: 2026-08-17
updated: 2026-08-17
tags: []
parent: PRD-001
---
**ADR decision status**: proposed. (Distinct from this document's corpus lifecycle `status`, which is `draft` until reviewed and approved — the two fields track different things and neither is wrong when they differ.)
**Date**: 2026-08-17

## Context

`lore`'s north star is unattended, multi-session, AI-executed development. In that regime the corpus is the only source of truth, so the question "may a record that cannot name the state it was measured against still satisfy a gate?" decides whether state-binding is a governance mechanism or a decorative metadata field.

Two answers were argued from opposing directions, and each is correct about the failure it fears:

- **Vacuous pass on missing data.** The existing precedent: `gate-predicates.ts::assessmentFreshness` (SPEC-106 D5/AC-FRESH-2) returns `{ok: true}` when either timestamp is absent, so missing data is never invented into a denial. A blanket refusal instead would retro-invalidate every pre-existing evidence row in one commit and wedge every open plan simultaneously, with no human awake to clear any of them.
- **Refusal on missing data.** In an unattended loop, absent data is a state an agent can *cause for free*. If missing → pass, the cheapest path to green stops being "make the test pass" and becomes "produce a record with no stamp". The precedent above guards a *human-triggered* `plan-close` where an absent assessment would be noticed; here there is no observer.

**A first draft of this ADR claimed a "third class" resolved this and it did not.** The `spec-promote` review judge escalated it with a blocking question that was correct: if `unbound` satisfies no floor, and every legacy row reads `unbound` after arming, then any plan whose closure consumes a legacy attestation is refused on the arming commit — exactly the retro-invalidation used to reject hard refusal. The judge further observed that "writable, readable, counted" are display-and-persistence properties, not gate properties, so the claimed availability advantage over a grandfathered refusal had no behavioural content. This version answers that instead of restating it.

## Decision

A record with no `StateStamp` is classified by **where it sits relative to an immutable arming cutoff**, giving two distinct classes with *different gate behaviour*:

| Class | Condition | `attestationFloor` | Visibility |
|---|---|---|---|
| `legacy_unbound` | the row's `audit.id` ≤ `arming_rev` | **Accepted** — the floor treats it exactly as it does today, so nothing retro-fails | Counted separately in the `capture_source` distribution; surfaced by `lore status` as outstanding debt |
| `unbound` | the row's `audit.id` > `arming_rev`, i.e. written after the mechanism shipped and still carrying no stamp | **Refused** | Same |

`arming_rev` is the value of `MAX(audit.id)` captured **once**, in the commit that arms the mechanism, and stored as a constant.

**Why this cutoff cannot be gamed** — the property that makes this different from a timestamp-keyed grandfather clause, and the reason the earlier "third class" framing was insufficient:

- `audit.id` is `INTEGER PRIMARY KEY AUTOINCREMENT` on an **append-only** table which `lore audit --verify` already walks as a **tamper-evident hash chain** with an optional `.lore/audit-anchor.json` external anchor.
- An agent therefore cannot place a *new* row below the cutoff. It cannot renumber, it cannot backdate, and it cannot rewrite history without breaking a chain that an existing independent oracle checks.
- Contrast a timestamp cutoff, which an agent influences by choosing when to write, and which the security review specifically flagged as mintable.

So `stampCurrency` returns one of `bound | stale | unbound | legacy_unbound`, never a boolean. Precedent for a multi-valued verdict rather than a pass/fail pair already exists: `deriveAcCoverageState` returns `not_measured` precisely to separate "measured and fine" from "never measured".

## Quality Attributes Affected

| Attribute | Impact | Scenario |
|---|---|---|
| Integrity | + | QA-6 — a row written after arming can never be counted as attested without a stamp, and the cutoff separating it from legacy is not forgeable |
| Availability (of the unattended loop) | + | No plan retro-fails on the arming commit, because `legacy_unbound` is accepted by the floor |
| Modifiability | − | Floors learn four cases instead of a boolean, and `arming_rev` becomes a constant that must survive migrations |
| Observability | + | Legacy debt is counted rather than invisible, so the population that still needs re-attestation is queryable |

## Alternatives Considered

| Option | Pros | Cons | Why rejected |
|---|---|---|---|
| Vacuous pass on missing data | Zero migration cost; one precedent to cite | Producing a stamp-less record becomes the cheapest path to green, and an autonomous agent finds it faster than any reviewer notices | Defeats the mechanism's purpose |
| Blanket refusal, no grandfather | Strongest guarantee, simplest to state | Wedges every open plan on the arming commit with no operator to clear it | Availability unacceptable for an unattended loop |
| Refusal grandfathered by **timestamp** cutoff | Bounded blast radius | The cutoff is influenced by *when* an agent writes; the grandfather class is mintable | Same exploit as vacuous pass, one indirection away |
| A single undifferentiated "third class", writable and counted but refused by floors | Simple vocabulary | **No behavioural difference from blanket refusal at the gate boundary** — this was the escalated defect | Superseded by the two-class form above |

## Consequences

**Easier**: arming costs no back-catalogue sweep and no plan retro-fails, while a row written *after* arming cannot buy a green by omitting its stamp. The distinction "verified" / "unknown" / "known-legacy" becomes expressible, which the corpus currently cannot state at all.

**Harder**: four-valued logic propagates into every consumer of attestation trust. `arming_rev` is a new constant with migration semantics. And the design is only sound *if the classes are load-bearing on day one* — written but unconsumed, they reproduce the exact defect that motivated this work (`capture_source: "runner"` with no attestation block, a trust label with nothing behind it). Routing all four classes into `attestationFloor` and the `capture_source` distributions is therefore scoped into the same phase, never deferred.

**Debt this creates deliberately**: every `legacy_unbound` row is an assertion the corpus cannot fully vouch for. That population is finite, countable, and shrinks only by re-attestation. It must be reported, not hidden — otherwise "accepted by the floor" silently becomes "believed".

## Validation Plan

`AC-CT-3` on `spec-corpus-truthfulness-a-verdict-must-carry-the-state-it` asserts all three halves separately, on a throwaway corpus:

1. a row with `audit.id > arming_rev` and no stamp is refused by `attestationFloor`;
2. a row with `audit.id ≤ arming_rev` and no stamp is **accepted** by the same floor;
3. both appear, distinctly labelled, in the `capture_source` distribution.

Half 2 is the control that distinguishes this decision from blanket refusal; without it the criterion cannot tell the two designs apart.

The declared falsifier, and the exact command it is measured against:

```
bunx vitest run packages/lore/tests/unit/service/stamp-currency-floor.test.ts
```

Mutation: make `stampCurrency` return `bound` for an undefined recorded stamp. That command must then exit **exactly 1**. A second, independent falsifier covers the cutoff itself: set `arming_rev` to `0` so every legacy row reclassifies as `unbound`, and the same command must exit **exactly 1** on half 2.

---
id: ADR-038
type: adr
role: decision
title: "Phase writes log a version row and do NOT demote the plan — SPEC-023's 'history is dispensable' clause is overturned, its soft-grouping model is not"
status: approved
priority: medium
created: 2026-08-24
updated: 2026-08-24
tags: []
parent: PRD-001
---
## Context

SPEC-023 made `plan.extra.phases[]` a **soft grouping**: no doc id, no lifecycle, and
explicitly **no version history**. The rationale is written at both write sites —
`packages/lore/src/service/phase-service.ts:5` states it, and
`packages/lore/src/service/ac-service.ts:8` names the contrast on purpose ("unlike
PhaseService's version-less writes — AC declarations are judge-consumed data, so history
matters more here"). That asymmetry was reasoned, recorded, and traceable to a spec.

`spec-lore-phase-add-and-phase-rm-mutate-a-plan-s-declared` (SPEC-148) established two
things and deliberately refused to decide a third:

- **S1** — the root `CLAUDE.md` Document Lifecycle paragraph asserted a universal ("editing
  an approved doc resets it to draft — content/title AND `extra`") that three writers already
  break. That was a DOCUMENTATION falsehood, not a code defect, and it is fixed
  (`CLAUDE.md:120`, commit `063f113f`).
- **S2** — SPEC-023's premise has visibly MOVED. When phases were justified as "soft
  groupings", nothing depended on the phase set. Today `extra.phases[]` is load-bearing for
  governance: `taskExtraSchema.phase` validates cross-entity against the MEMBER plan's
  `phases[].name`, `lore ready` groups by it, and the plan-close family reasons over "every
  child task archived" — where an EMPTY phase is exactly the vacuous-truth case the North Star
  names.
- SPEC-148 D2 refused to answer S2, on the ground that an agent picking it inside a defect
  spec would re-litigate SPEC-023 without its authors' inputs.

This ADR is that answer.

## Decision

**Phase writes SHALL log a version row. They SHALL NOT demote the plan.**

`addPhase`, `removePhase`, and `renamePhase` each write `insertVersion` alongside their
`store.update`, so a phase-set mutation is visible in `lore log` and `lore diff`. The plan's
status is left untouched: adding a phase to an `approved` plan keeps it `approved`.

⛔ The demotion half is explicitly **out**. `resolveStatusAfterContractEdit`
(`packages/core/src/schemas.ts`) MUST NOT be called from `PhaseService` under this decision.
A future reader who notices phase writes now log a version but do not demote is looking at
the decided behaviour, not an unfinished migration.

This is the shape `lore ac add` already has, and that precedent is why it is the chosen one:
the middle position between "invisible" and "re-approval churn" is already implemented,
already documented, and already lived with in this codebase.

### Decision provenance

⛔ Recorded because SPEC-148 D2 made provenance part of the requirement: this choice was made
by the **human project owner on 2026-08-24**, presented with four options and their costs. It
was NOT derived by an agent. D2's objection — that an agent would be re-litigating SPEC-023
without its authors' inputs — is discharged by the owner making the call, not by an agent
arguing the point more carefully.

## What was measured

Measured 2026-08-24 in a throwaway corpus (`mktemp -d` + `lore init`, deleted after — never
this repo's live `.lore/`), against an `approved` plan, using the binary built at HEAD:

| Action | exit | status | version | `lore log` rows | `phases[]` |
|---|---|---|---|---|---|
| baseline | — | approved | v2 | 2 | empty |
| `lore phase add <plan> P1` | 0 | approved | **v2** | **2** | P1 |
| `lore phase rename <plan> P1 P1x` | 0 | approved | **v2** | **2** | P1x |
| `lore phase rm <plan> P1x` | 0 | approved | **v2** | **2** | empty |
| **control** `lore set <plan> --content ...` | 0 | **draft** | **v3** | **3** | empty |

The control row is load-bearing, not decoration: without a writer that DOES demote and DOES
log in the same apparatus, "no version row appeared" is indistinguishable from "the counter
was broken". It demoted and incremented, so the instrument discriminates.

**`renamePhase` is now MEASURED.** SPEC-148 listed it as `Out: UNMEASURED — presumed
version-less, but presuming a neighbour's behaviour is the exact error this spec already
made once` (its D4). It is not a presumption any more: rename behaves exactly like add and
rm — version-less and non-demoting. That closes D4 by measurement rather than by inference.

## Alternatives rejected

| Option | Why rejected |
|---|---|
| Keep version-less, add a `phases_fingerprint` compared at `plan-close` / `task-claim` | Solves the governance-dependency half while leaving the history half silent. Strictly more new surface (a new field plus two consumer sites) than the accepted option's three `insertVersion` calls, for a narrower result. |
| Version AND demote (restore the old universal) | Most internally consistent, but adding a phase to an `approved` plan would force re-approval. SPEC-148's Risks names this as a real behaviour change, and under many-concurrent-sessions it is a coordination cost paid on every phase edit. |
| Record "the premise still holds, change nothing" | Satisfies AC-PHASEVER-2(b) as cheaply as possible — the spec accepts either answer. Rejected because it leaves a governance-load-bearing field mutable after review with nothing in `lore log` to show it, which is the North Star's "must not go silent" property failing by construction. |

## Consequences

- **`AC-PHASEVER-1(b)` MUST be re-baselined.** It currently asserts CURRENT behaviour — that
  `phase add` against an approved plan leaves the version-row count unchanged — and says so
  deliberately, because D2 had not been decided. D2 is decided now, so that half inverts: it
  must assert a version row DOES appear and the status does NOT change. SPEC-148 pre-authorised
  exactly this ("If S2 later resolves toward versioning, this AC is re-baselined then, with
  the reason recorded"); this ADR is that reason.
- **SPEC-148's Scope must widen.** It currently reads `Out: ⛔ changing PhaseService's write
  path as a foregone conclusion ... Any such change must first record why SPEC-023's rationale
  no longer holds.` That condition is now met, so `phase-service.ts` moves from read-only to
  in-scope for the implementation task.
- **The back-catalogue is unrecoverable.** Every phase mutation already applied left no row,
  and no migration can reconstruct them. Anywhere plan version history is presented as
  complete, that limit MUST be stated — this is carried over verbatim from SPEC-148's Risks,
  not softened by the decision.
- **SPEC-023 is not superseded.** Its phase-as-soft-grouping model stands: phases remain
  id-less, lifecycle-less, and not a doc type. Only the "history is dispensable" clause is
  overturned, and only because the dependency set underneath it changed after SPEC-023 was
  written. ⛔ Do not read this ADR as licence to promote phases to a doc type — `DocType`
  already contains a separate `"phase"` entry (`packages/core/src/types.ts:19`, SPEC-056) and
  conflating the two is a documented prior misreading.

---
id: ADR-017
type: adr
role: decision
title: "plan-close predicates must measure invariants, not proxies: default to per-claimed-AC attested coverage instead of an evidence ratio, and qualify the domain-doc window with relatedness"
status: approved
priority: medium
created: 2026-07-30
updated: 2026-07-30
tags: []
parent: PRD-001
links:
  - {id: PLAN-101, type: informs}
  - {id: KN-327, type: relates-to}
---
## Context

Closing `plan-implementation-context-provenance-scope-declaring` — a plan whose seven live ACs are each attested green on a clean tree at a named commit (`17c1a44`), and whose five tasks each carry runner-attested evidence — was blocked by two `plan-close` predicates. Neither block indicated a defect in the plan. Both indicated that the predicate measures a proxy rather than the invariant it exists to protect.

An exemption was available for each. Using either would have suppressed the signal, so this ADR records the design analysis instead. Exemptions are for genuine exceptions; a predicate that a correctly-executed plan cannot satisfy is not an exception, it is a specification defect.

## Decision

Replace both proxies with the invariants they approximate. Keep every existing guarantee; drop only the parts that are gameable, that punish the discipline the rest of the workflow enforces, or that pass on evidence unrelated to the plan.

### 1. `attestationFloor` — drop the plan-wide ratio, add per-AC attested coverage

`attestationFloor` (`gate-predicates.ts`) blocks on either of two conditions:

1. every task carrying `verification_evidence` must carry ≥1 runner-attested entry;
2. the plan-wide ratio (total attested / total evidence) must be ≥ `workflow.attestation.min_ratio` (default 0.5).

Condition 1's own doc comment states why it exists: *"a task with N self-reported entries and ZERO attested ones is undetectable fabrication risk, even if some OTHER task in the plan is fully attested and keeps the plan-wide ratio above the floor."* That is an explicit acknowledgement that the ratio can be satisfied while the guarantee is violated — condition 1 was added to patch condition 2.

What condition 2 adds beyond condition 1, examined:

- **It does not strengthen verification.** Attesting the same command ten times proves exactly what attesting it once proves. Verification strength is a property of *which* commands ran under a trusted runner, not of how many rows resulted.
- **It is gameable in the cheapest possible direction.** Re-running an already-green oracle monotonically raises the ratio with zero new information. A plan can be made closable by burning CPU.
- **It penalises evidence discipline.** The denominator counts every self-reported entry, including the red-to-green development records the workflow explicitly asks implementers to write. Measured on this plan: seven ACs attested, five tasks each attested, one full clean-tree integration run — ratio 0.36, because 35 honest development-time records sit in the denominator. An implementer who recorded nothing but a single terminal run would have scored 1.0 with strictly less information available to an auditor. **The metric rewards the less transparent agent.**

The invariant actually wanted is coverage, not proportion, and at a finer grain than condition 1 uses:

> **For every AC this plan CLAIMS — i.e. every `ac_ref` appearing in any of its tasks' evidence — at least one runner-attested entry exists for that AC's registered command.**

Scoped to claimed ACs, deliberately, not to every script-mode AC on the governing spec: a phased or partial-delivery plan legitimately implements a subset, and blocking it for ACs it never claimed would be a false block. Spec-level completeness (every declared AC covered across ALL child plans) is a different question at a different tier — it belongs to spec close-out as an ADVISORY, never to one plan's close gate.

Properties: not gameable (one attested run per claimed AC suffices; further runs add nothing) and indifferent to how much development-time evidence accompanies it.

**The two predicates are incomparable, not ordered.** An earlier draft of this ADR claimed per-AC coverage was "strictly stronger" than the ratio. This document's own worked example falsifies that: the motivating plan has ratio 0.36 (fails the floor) and 7/7 claimed-AC coverage (passes the new check), so for that plan the new predicate is strictly WEAKER. The supporting argument — that the ratio can be met while a claimed AC has no attested run — establishes only that the ratio does not imply coverage; it says nothing about whether coverage implies the ratio, and it does not. Each predicate catches a failure the other misses: coverage catches *"this claimed AC was never attested by a runner"*, the ratio catches *"self-reported entries dominate the trail"*.

The case for making coverage the DEFAULT is therefore not dominance. It is that coverage is un-gameable and record-neutral, whereas the ratio is satisfiable by re-running an already-green oracle and actively penalises the evidence discipline the rest of the workflow mandates. A team that wants both guarantees AND-s them.

**The boundary case, stated rather than glossed:** a plan whose tasks claim NO ACs (a governing spec with no script-mode ACs at all) gets a vacuous pass from this check, leaving condition 1 as the only constraint. That is a real narrowing versus the ratio, and it is accepted for two reasons. First, the ratio's contribution in that case is still only proportional — gameable by re-running whatever oracle exists — so what is lost is a weak check, not a guarantee. Second, and decisively, that case is ALREADY caught upstream: `plan-promote` carries the verify-reachability early warning (`spec-verify-reachability-plan-promote-early-warning`), which fires when a plan has no runnable AC. A plan with nothing to attest should be flagged when it is promoted, not discovered at close time — moving the signal earlier is the correct fix, not compensating for it at the wrong end.

`workflow.attestation.min_ratio` is retained as an OPT-IN knob, default disabled. When enabled it is AND-ed with per-AC coverage (never a substitute for it). Migration: a config that already sets `min_ratio` EXPLICITLY keeps enforcing it across the default flip — the flip changes the default only, never an expressed preference. Silent relaxation of a team's stated threshold would be exactly the class of change this repo's no-silent-fallback rule forbids.

### 2. `prdOutlineSynced` — measure relatedness, not activity in a time window

`prdOutlineSynced` receives a single pre-computed boolean whose caller-side definition is: ≥1 version of the ancestor spec's linked domain doc has content differing from its predecessor within the plan's execution window (earliest task claim → close), or a valid exemption exists.

That is a proxy for "the domain doc reflects what this plan landed", and it fails in both directions:

- **False pass.** ANY content change inside the window satisfies it, including one made for an unrelated reason — and, in a repo with concurrent sessions (lore's own dispatch model), including a change made by a DIFFERENT session that happens to touch the same domain doc. The predicate then reports this plan as synced on the strength of another plan's work.
- **False block.** A plan that legitimately introduces no domain-level capability — a mechanism fix, a defect repair, a governance-prose correction — has nothing to write. The predicate demands a content change anyway, so the honest options are to author domain-doc noise or to file an exemption. Neither is verification, and the first actively degrades the domain doc, which this repo has already measured as a bloat attractor in the CLAUDE.md context.

The invariant wanted is relatedness:

> **When a plan's landed work changes what the domain doc asserts, the domain doc changed accordingly.**

**Adopted: qualify the window with a relatedness conjunct.** The window stays; a second requirement is AND-ed onto it — the domain-doc version written during the window must REFERENCE this plan or its governing spec (a `relates-to`/`informs` edge, or the plan slug in the version's own change record). This kills the concurrent-session false pass at its root, since another session's edit does not name this plan, and it needs no new declaration from the author — only that the sync actually be attributable.

**Alternative considered and rejected: drop the window entirely**, checking only that the domain doc has ever referenced the plan. Rejected because a reference written long after close would satisfy it, and because the window is exactly what ties the sync to the work — the window was never the defect, the missing attribution was.

The adopted conjunct does NOT resolve the false block: a mechanism-fix plan with no domain-level capability still has nothing to reference, so it continues to need an exemption — the outcome this ADR objects to. Closing that hole requires knowing whether a plan is domain-affecting AT ALL, and the only non-gameable place to establish that is before the work starts:

> **Deferred, not adopted here:** having a plan declare at `plan-promote` whether it introduces domain-level capability, so that non-domain plans are out of the predicate's scope entirely rather than exempted from it. This is a separate change with its own cost (one declaration per plan) and its own failure mode (an author under-declaring to dodge the gate — mitigated by the declaration being recorded before the work, when it cannot yet be motivated by wanting a gate to open). It is recorded here as the known follow-up and is explicitly NOT part of this decision.

Until that follow-up lands, mechanism-fix plans remain the one case where a `prd_sync_exempt` is the correct instrument rather than a workaround — and the exemption's reason text should cite this ADR so the class is auditable rather than looking like a series of unrelated one-offs.

## Consequences

- The blocked plan closes on its own merits once (1) lands: it already satisfies per-AC attested coverage 7/7. No exemption is written, so no audit record claims an exception that was not one.
- Until then the plan stays OPEN deliberately, as live evidence for this ADR. A correctly-executed plan that cannot close is the strongest possible argument for the predicate change, and writing an exemption would have destroyed that evidence.
- Teams on the DEFAULT 0.5 ratio get a real relaxation in TWO classes, both stated plainly because the flip under-reports its impact otherwise: **(i)** plans whose development-time self-reported evidence dominates the denominator now close where they previously blocked — this is the motivating case of this very ADR, so the relaxation is intended, not incidental; **(ii)** plans claiming no ACs at all, where coverage passes vacuously and only condition 1 remains (flagged earlier by `plan-promote`'s verify-reachability warning). In exchange they gain a per-claimed-AC guarantee the ratio never provided. Teams who set `min_ratio` EXPLICITLY keep it, AND-ed with the new check, so no expressed threshold is silently relaxed.
- Item 2 lands as (a) only. The false-block class (mechanism-fix plans with no domain capability) is NOT fixed by this ADR: those plans still need `prd_sync_exempt`, now with a reason citing this ADR so the class stays visible as a known gap rather than dissolving into unrelated exceptions. The plan-promote declaration that would close it is deferred, with its cost and its own failure mode recorded above.

## Standing lesson

When a gate blocks correctly-executed work, the first question is whether the predicate measures the invariant or a proxy for it. A ratio, a timestamp window, or a count is almost always a proxy — cheap to compute, and satisfiable by behaviour nobody wanted. Reach for the exemption only after establishing that the predicate is right and the case is genuinely exceptional; reaching for it first converts a design defect into a permanent stream of audited exceptions, and the stream is then read as evidence that the design is fine.


## Revision 2026-07-30

This decision was implemented by `spec-plan-close-predicates-measure-invariants-an-applicability`. Implementing it produced one measured correction to this document, recorded here rather than left standing.

### Correction: the observed `prdOutlineSynced` block was domain-doc ABSENCE, not the window proxy

§Decision item 2 attributes the block on `plan-implementation-context-provenance-scope-declaring` to the window proxy ("a plan that legitimately introduces no domain-level capability has nothing to write"). Measured 2026-07-30: that plan's ancestor spec has `parent_id` = the root PRD (type `prd`) and declares no `implements` edge to a spec, so `resolvePrdSyncDomainDoc` returned `ok(null)` — a fact its own JSDoc calls "a FACT, never an error" — and `CorpusService.set`'s `let synced = false; if (domainDoc !== null) {…}` then routed that fact into the violating verdict. The proximate cause was an ABSENT REFERENT rendered as a violation, in the same function that treats the sibling absence case (no ancestor spec at all) as a vacuous pass.

The window critique in item 2 stands on its own as design analysis. It was simply not what fired here.

### Consequence: this ADR's exemption claim is narrowed

§Consequences said mechanism-fix plans "still need `prd_sync_exempt`". That is now true only when a domain doc EXISTS and the plan has nothing to write into it. When no domain doc resolves at all, **domain-doc absence is not-applicable, never a violation**: the close-time verdict is a `PredicateNotApplicable` that never denies, and the signal moves earlier to a `plan-promote` advisory naming the spec and the wiring command — the same "flag it when the plan is promoted, not at close" reasoning this ADR already applies to attestation reachability. No exemption is written, so no audit record claims an exception that was not one.

### What is unchanged

Item 1 ships as decided: per-claimed-AC attested coverage is the default conjunct, scoped to claimed ACs, with `workflow.attestation.min_ratio` retained as an opt-in AND-ed conjunct whose explicitly-set values survive the default flip. Item 2(a) ships as decided: the relatedness conjunct is AND-ed onto the window, with structural `parent_id`/`implements` relations excluded as attributors (they are how the domain doc is resolved, so accepting them would make the conjunct vacuous) and the spec-level-attribution residual documented rather than silently narrowed. The deferred `plan-promote` domain-affecting declaration stays deferred, with its cost and failure mode as recorded above.

### As-built additions this ADR did not anticipate

- **The applicability verdict became a type.** `PredicateNotApplicable` carries no `ok` field, so reading `.ok` off a possibly-inapplicable predicate is a compile error and every consumer must narrow. This is what makes "absent referent" unrepresentable as a violation, rather than a convention that a future caller can forget. A three-valued `ok` was rejected: `"not-applicable"` is truthy, so every existing `if (!result.ok)` would have routed it into the PASS path — a silent vacuous pass, the very defect class this ADR names.
- **The delta became machine-readable.** `PREDICATE_CONTRACTS` records each plan-close predicate's invariant, its actual measurement, and its known false-pass / false-block cases, rendered by `lore gate plan-close --explain` and quoted into the feeding pack. This ADR's standing lesson said a proxy's counter-examples get read as violations of the invariant; the contract table is where that delta now lives instead of a doc comment no downstream reader opens.
- **Two silent fallbacks found while implementing, both closed:** an optional `acCoverage` parameter defaulting to `[]` (any caller forgetting it would have skipped the new conjunct), and `checkPlanClose`'s `ctx.planClaimedAcCoverage ?? []` fabricating "this plan declared no criteria" out of "the caller never populated the field".

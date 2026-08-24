---
id: KN-518
type: knowledge
role: knowledge
title: "A declared sole entry enforced by a hand-written subset: the AC listed five names, the surface had seven, and the pass was vacuous for a whole phase"
status: approved
priority: medium
created: 2026-08-23
updated: 2026-08-24
tags: [ac-as-code, module-boundary, vacuous-pass, assess]
parent: SPEC-146
links:
  - {id: KN-515, type: relates-to}
---
## What happened

A spec declared a module boundary: `runMemoryFileChecks` is the SOLE composition entry for the memory-file check mechanism. An acceptance criterion was written to enforce it: neither production call site may name an individual metric function. The criterion listed five names.

The module's public surface had seven.

Phase 1 shipped with `status.ts` calling `computeHeadroom` and `computeHeadroomWarnings` directly, outside the declared sole entry. `scripts/check-claude-md-composition.ts` reported PASS on every run, because those two names were not on its list. The boundary statement and the criterion meant to enforce it were **jointly false and mutually self-consistent** — each could be read without contradicting the other, and neither could detect the gap.

Measured 2026-08-23. `lore assess` scored it `evidence_integrity: major`.

## The root cause is authorship order, not carelessness

The boundary was written in the Module Boundary section. The banned-name list was written later, in an AC, by hand, from memory of what the boundary said. Nothing tied one to the other. A hand-picked subset of a public surface will drift from that surface the moment the surface grows — and this one grew inside the same spec that declared it.

⛔ Generalised: **whenever a spec states a universal ("the sole X", "no caller may Y", "every Z must W") and an AC enforces it by enumeration, the enumeration is a second, independent statement of the same fact.** That is a dual-write. It reads as enforcement and behaves as a snapshot.

## Why the existing safeguards did not catch it

- `lore review` **did** catch it, two phases later, and is the only reason it was fixed. It flagged that AC-RULES-1's oracle read `role: rules` headroom entries the declared return type did not expose, and refused to approve until the contradiction was resolved. That escalation is what produced N15.
- ⛔ **I saw it first and misfiled it.** During the Phase 1 merge review I noticed `computeHeadroom` bypassing the entry, wrote "known, will patch later" into the session report, and moved on. It was not a small deferral: it meant AC-COMPOSE-1 was a vacuous pass for the whole of Phase 1, and the spec's central claim was false while its enforcing oracle stayed green. "Known and deferred" and "undetected" are indistinguishable in the corpus — both leave a green AC over a violated boundary.
- The falsifier did not help either. AC-COMPOSE-1's declared mutation inserted a direct `lintMemoryFiles` call, which the five-name list DID cover — so the falsifier turned the oracle red exactly as declared, certifying discriminating power the oracle only had for part of its own claim.

## Mechanism fixes

1. **Derive the list, do not write it.** An AC-enforcing lint script's banned-name list should be generated from the module's exported surface (or from the spec text) and FAIL when its list is narrower than the surface it claims to cover. A checker that cannot notice it is checking a subset is not a checker.
2. **A universal AC must enumerate the whole surface.** When a spec says "sole entry", the enforcing criterion enumerates every function in that module's public surface, not a hand-picked subset. `lore assess` recommended exactly this, unprompted.
3. **A falsifier proves discriminating power for the mutation it names, and nothing else.** Passing a falsifier on one clause of a multi-clause AC says nothing about the other clauses. This is the same failure class as `knowledge-a-falsifier-declaration-is-an-unverified-causal` §1 (a mis-aimed falsifier), one level up: here the falsifier was correctly aimed at a clause that was correctly enforced, while a sibling clause was not enforced at all.

## The transferable rule

⛔ A green AC over a violated invariant is worse than no AC, because it converts "nobody checked" into "someone checked and it was fine". When you notice a gap between what a spec claims and what its oracle can see, that gap is the finding — recording it as "known, to be patched" leaves the corpus asserting something false in the meantime, with your own note as the only thing that knows better.

## A rebuttal to one of assess's own recommendations

`lore assess` scored this plan 84/100 and recommended:

> Treat a failing broad oracle (`bun run typecheck`) as blocking rather than substitutable by narrower per-package variants.

⛔ **That recommendation is unsatisfiable in this repo, and the reason is structural.** Measured immediately after the assess run: `bun run typecheck` exits 2 with 7 errors, all of them in three files:

```
18:43:59  resolution-projector.test.ts       ← predates this plan
18:44:38  transport-config-compat.test.ts    ← predates this plan
20:03:52  resolution-label-port.test.ts      ← a CONCURRENT plan, mid-flight
19:00:03  ← this plan's first commit, for comparison
```

Zero of the seven touch `claude-md-*`. All three files are **another plan's red-first tests** — they are supposed to be red; that is what red-first means.

So in a repository running concurrent plans with red-first discipline, a repo-wide type oracle is red **by design**, continuously, as a function of somebody else's work in progress. Requiring it to be green before release is requiring every plan to wait for every other plan's implementation phase. The narrower per-package variant is not a substitution for rigour here — it is the only oracle whose scope matches the change.

**What the recommendation is right about**, and what should replace it: a narrower oracle must not be chosen *after* seeing the broad one fail, and the substitution must be justified by a mechanical scope argument, not by assertion. The check that actually discriminates is: *does the broad oracle's failure set intersect this change's files?* Here it was measurably empty — 0 of 7 — and that is the sentence that belongs in the evidence record, not "narrower variants pass".

⛔ Generalised: an assess recommendation is written from a single plan's viewpoint. Under concurrency, "make the global oracle green" can be an instruction to serialise the whole repository. Read every such recommendation against the target state of MANY CONCURRENT SESSIONS before adopting it.

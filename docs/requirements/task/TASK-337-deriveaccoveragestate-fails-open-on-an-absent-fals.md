---
id: TASK-337
type: task
role: plan
title: "deriveAcCoverageState fails open on an absent falsified, so not-measured and observed-red read identically — and the required-field type that was trusted is unenforced in test fixtures"
status: draft
priority: high
created: 2026-08-07
updated: 2026-08-07
tags: []
parent: PRD-001
---
> ⚠ INVALIDATED 2026-08-07T13:07:41.213Z — superseded by task-widen-deriveaccoveragestate-to-seven-values-and-wire-every; Absorbed into the merged phase-derivation task per plan D3. NOTE its tsconfig diagnosis was measured WRONG: tsconfig.tests.json is inert because extends does not reset the inherited exclude, so it resolves ZERO dashboard test files — not because tsconfig.json excludes tests. Its exit 0 was the exit code of checking nothing.

# Defect

`deriveAcCoverageState` FAILS OPEN on an absent `falsified`: a fact with no `falsified` field
derives the SAME state as one that was observed red. So "not measured" and "measured, has
gone red" are indistinguishable at the read surface — the exact conflation the function's own
Silence note claims it avoids.

Measured 2026-08-07 on `main` (identical fact, only `falsified` varied):

    falsified: 0          -> "pass_unfalsified"   correct
    falsified: 1          -> "pass"               correct
    falsified: undefined  -> "pass"               WRONG — reads as if observed red

The module's own JSDoc (`packages/core/src/acceptance.ts:263-268`) asserts:

> **Silence**: `falsified === 0` is a real, computed zero — never conflated with … two
> different, distinguishable readings.

That answer covers `0` vs nonzero. It does NOT cover **absent** vs nonzero, which is the case
that fails open — and failing OPEN means the optimistic direction: the criterion is reported
as better-evidenced than it is.

## Why it is reachable, and why typecheck does not catch it

`falsified` is a REQUIRED field on `AcCoverageFact`, so in production
`computeAcCoverage` always sets it and the absent case cannot arise from that path. It is
reachable two other ways, both live today:

1. **Hand-built facts.** `packages/dashboard/tests/component/SpecAcCoveragePanel.test.tsx`'s
   shared `makeFact()` helper never sets `falsified`, so every fact it builds without an
   explicit override violates the required-field contract at runtime. Confirmed by the
   implementer who added the `pass_unfalsified` cases: it deliberately passed
   `falsified: 0` per-call rather than defaulting the helper, because defaulting it would have
   flipped a pre-existing green `"pass"` test into the `pass_unfalsified` branch.
2. **`packages/dashboard/tsconfig.json` excludes `tests`**, so that required-field violation is
   invisible to `bun run typecheck` — verified: the config's `exclude` is
   `["node_modules", "dist", "tests"]`, and typecheck exits 0 with the violation present.

⛔ So the guard rail everyone assumes is holding this invariant (a required TS field) is
structurally absent for the one file family that actually constructs these facts by hand.

# Mechanism root — a required field is a compile-time claim, and the derivation trusted it

The derivation was written as if `falsified` could only ever be a number, because the type says
so. Root `CLAUDE.md` states the opposing rule for this exact situation: **every floor FAILS
CLOSED on an unrecognised input.** A `=== 0` test silently routes every non-`0` value —
including `undefined`, `null`, and `NaN` — into the "was falsified" branch.

⛔ Transferable: a required-field type annotation is not a runtime guarantee anywhere the values
are hand-built, and test fixtures are exactly that place. When a derivation's correctness
depends on a field being present, the derivation must say so itself.

# Required fix

1. `deriveAcCoverageState` must treat a non-numeric `falsified` as NOT MEASURED, and
   not-measured must not resolve to `pass`. Choose and state which: refuse loudly (the fact is
   malformed), or derive a distinct not-measured reading. ⛔ Silently picking `pass` or silently
   picking `pass_unfalsified` are both wrong — the two are different claims and the caller must
   be able to tell which it got.
2. Give `makeFact()` (and any sibling hand-built fact helper) a `falsified` value, adjusting the
   pre-existing `"pass"` expectations that were only green because the field was missing. ⛔ Those
   expectations are currently passing for the WRONG reason; leaving them is preserving a false
   green.
3. Make the violation visible: either stop excluding `tests` from
   `packages/dashboard/tsconfig.json`, or route that directory through the tests-tsconfig the
   repo already has (`tsconfig.tests.json` typechecks it cleanly today — the implementer ran it
   directly and got exit 0 only because it does not see the untyped helper the same way; confirm
   which before choosing).
4. Update `acceptance.ts:263-268`'s Silence note to state the absent case explicitly. ⛔ It
   currently reads as a completeness claim that the measured behaviour contradicts — a fixed gap
   whose own record still asserts the old answer.

# Proxy / Silence / Opt-in (binding — adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the)

**Proxy.** `falsified === 0` is a proxy for "measured, and never observed red". Concrete input
satisfying the proxy's negation while violating the property: `falsified: undefined` — not
measured at all, yet routed to the observed-red branch. NOT accepted; that is this task.

**Silence.** This is the defect: absent and nonzero produce one value. The fix must make them
two, and ⛔ the not-measured value must not be the more favourable of the pair.

**Opt-in.** None — the derivation binds every consumer (`commands/ac.ts::coverageBadge`,
`task-feed-wiring.ts`, `SpecAcCoveragePanel.tsx`).

# Oracle

- `deriveAcCoverageState` over a fact with `falsified: undefined` yields a reading DISTINCT from
  both the `falsified: 0` and the `falsified: 1` readings; CONTROL — the `0` and `1` readings
  themselves are unchanged (`pass_unfalsified` / `pass`). All three in ONE test, so a matcher
  that always returns the new value cannot pass.
- Same for `null` and `NaN` — enumerate them; a `=== 0` replacement that only special-cases
  `undefined` leaves two of the three open.
- `makeFact()` with no override produces a numeric `falsified`, asserted by type AND at runtime.
- REGRESSION: the 11 criteria on `spec-oracle-tier-falsifiability-a-criterion-never-observed-red`
  reading `attested_pass` today still read `attested_pass`, and the corpus-wide
  `pass_unfalsified` count moves by 0.

---
id: TASK-338
type: task
role: plan
title: "One honest historical fail row pins a criterion to state fail forever, because fail-first precedence over an append-only log has no recency notion"
status: draft
priority: high
created: 2026-08-07
updated: 2026-08-07
tags: []
parent: PRD-001
---
> ⚠ INVALIDATED 2026-08-07T13:07:31.796Z — superseded by task-widen-deriveaccoveragestate-to-seven-values-and-wire-every; Absorbed into the merged phase-derivation task per plan D3: both defects change the same function's state cardinality, and executing them separately pays the consumer ripple twice. Semantics decision resolved as Candidate C (fail_superseded); candidates A and B were excluded by this task's own binding constraint, not merely rated lower.

# Defect

`deriveAcCoverageState` is fail-first with NO recency notion, and the evidence log is
append-only, so ONE honest historical `result: "fail"` row pins a criterion to state `fail`
**permanently** — even after a later runner-ATTESTED pass supersedes it. The state can never
recover, so `fail` decays into an uninformative label over time.

Surfaced by the first self-application of the mechanism this task's own plan just landed
(`spec-oracle-tier-falsifiability-a-criterion-never-observed-red`), measured 2026-08-07 on
`main` @ `85930c88`:

    lore ac list spec-oracle-tier-falsifiability-a-criterion-never-observed-red --json

| AC | pass | fail | falsified | attested_pass | state |
|---|---|---|---|---|---|
| AC-FALS-1 … AC-FALS-10, AC-FALS-12 (11 criteria) | 2-3 | 0 | 1 | 1 | `attested_pass` |
| **AC-FALS-11** | 4 | 1 | 3 | 2 | **`fail`** |
| **AC-FALS-13** | 4 | 1 | 3 | 2 | **`fail`** |

Both `fail` readings are stale-pessimistic. `lore verify` ran those two criteria on merged
`main` and both passed with genuine runner attestation:

    ✔ AC-FALS-11 pass (18533ms, exit 0)
    ✔ AC-FALS-13 pass (26836ms, exit 0)

The `fail` rows are honest history: the ripple-absorption task's final in-worktree state was
still red for those two criteria (they could only go green once the sibling surfacing task
landed), and its implementer correctly recorded `--result fail` rather than overstating. The
DEFECT is that recording the truth then permanently poisons the derived state.

# Mechanism root — fail-first is a precedence over a SET, applied to a LOG

`deriveAcCoverageState` reduces `computeAcCoverage`'s counts through
`"fail" > "attested_pass" > "pass_unfalsified" > "pass" > "none"`. That precedence is correct
for a SET of simultaneous observations — if one of several concurrent oracles fails, the
criterion fails. It is wrong for an append-only LOG spanning time, where a later attested pass
is strictly better evidence than an earlier fail, and no row ever ages out.

⛔ Note the symmetry with this mechanism's own newly-shipped `falsified` dimension:
`falsified` counting `fail` rows forever is CORRECT (the question it answers is "was this ever
observed able to go red", which is inherently historical). `state` reading `fail` forever is
WRONG (the question it answers is "what is this criterion's condition NOW"). The two
dimensions legitimately want opposite time semantics over the identical rows — that is the
precise thing the current single-pass reduction cannot express.

# Required fix — decide the time semantics explicitly, do not silently pick one

⛔ This is a semantics decision, not a bug to patch. State the chosen rule and its residual
before implementing:

- **Candidate A — latest-wins per criterion.** `state` derives from the most recent row's
  result (with the existing precedence used only to break ties WITHIN one timestamp).
  `falsified` keeps counting the whole history. Residual to name: a flaky criterion
  alternating pass/fail reads green whenever the last run happened to pass, which is exactly
  the reading a flake should NOT get.
- **Candidate B — attested-supersedes-unattested.** An ATTESTED pass newer than every `fail`
  row clears `fail`; a self-reported pass never does. Residual: a genuine regression recorded
  only as a self-report cannot re-raise `fail`, so the fix trades one staleness direction for
  the other.
- **Candidate C — a distinct fourth state.** Keep `fail` history visible but add e.g.
  `recovered` / `fail_superseded` so the reader sees BOTH facts. Residual: state cardinality
  grows, and every consumer's switch needs a new branch (this plan just measured that ripple —
  12 files for one added value).

⛔ Whichever is chosen, the empty-vs-not-measured discipline applies: a criterion whose
history holds a `fail` and a newer attested pass must NOT read identically to one that never
failed. That is the whole reason C exists as a candidate.

⛔ Do NOT fix this by deleting or rewriting the historical `fail` rows. The evidence log is
append-only by design, and a log that can be edited to improve a derived label is worthless
as evidence.

⛔ Do NOT fix it by instructing implementers to record `expected-fail` instead of `fail` for a
genuinely-still-red final state. That would be asking authors to mislabel reality to flatter a
derivation — the same class as synthesizing red runs to clear a gate, which this plan's
governing ADR explicitly refuses.

# Proxy / Silence / Opt-in (binding — adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the)

**Proxy.** The derived `state` is a proxy for "this criterion's current condition". Concrete
input satisfying the proxy while violating the property: AC-FALS-11 as of `85930c88` — reads
`fail`, actually passes attested. NOT accepted; that is this task.

**Silence.** This failure is LOUD in the wrong direction (a false `fail` rather than a false
green), which is the safer half of the failure space and is why it is filed rather than
hot-fixed. But it is still indistinguishable-by-inspection: nothing in the reading says
"this `fail` is historical". Whatever rule is chosen must make the distinction legible at the
read surface, not only in the underlying rows.

**Opt-in.** None — the derivation binds every consumer of `deriveAcCoverageState`
(`commands/ac.ts::coverageBadge`, `task-feed-wiring.ts`, `SpecAcCoveragePanel.tsx`).

# Oracle

- A criterion whose rows are `[fail@t1, attested pass@t2]` derives a state DISTINCT from
  `fail`; CONTROL — a criterion whose rows are `[attested pass@t1, fail@t2]` still derives
  `fail`. Both assertions in ONE test, so a matcher that always returns the new value cannot
  pass.
- `falsified` is UNCHANGED for both fixtures above (the historical count must not be
  collateral damage of the state fix) — assert the number, not merely that it is nonzero.
- REGRESSION: the 11 criteria on this spec that read `attested_pass` today still read
  `attested_pass`, and the corpus-wide `pass_unfalsified` count moves by 0.
- The chosen rule's own named residual gets a test that DEMONSTRATES it (e.g. for Candidate A,
  a flake fixture reading green) — a residual with no test is a claim, not a bounded gap.

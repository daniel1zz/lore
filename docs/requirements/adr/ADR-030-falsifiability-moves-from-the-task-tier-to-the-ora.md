---
id: ADR-030
type: adr
role: decision
title: "Falsifiability moves from the task tier to the oracle tier: a criterion never observed red is a distinct computed state, reported not gated"
status: draft
priority: high
created: 2026-08-07
updated: 2026-08-07
tags: []
parent: PRD-001
links:
  - {id: SPEC-129, type: governs}
---
# Context

Seven distinct failures in one session (2026-08-02 → 2026-08-07) reduce to one sentence:
**the oracle was never shown to be able to fail.**

| failure | why it could not go red |
|---|---|
| `AC-ACQ-7` (pre-fix) | statement scoped to `script`-mode ACs, the exact population the lint is specified to SKIP |
| `AC-ACQ-6` | same shape — all seven dogfood fixtures declared `script(...)` |
| exit code via `\| tail -100` | `$?` is `tail`'s, structurally 0 (THIRD recurrence: handoff-71 KD2 twice, then again here) |
| `-t` filter matching zero tests | **already mechanized** — the precedent proving this class is detectable |
| the withdrawn false-positive bound | no AC binds the test any more, so no criterion can fail |
| a transcribed "Verbatim from" fixture | drifted from its source with nothing comparing them |
| MCP `supersedes` precheck | the CLI's guard could not fail on the MCP path — it wasn't on it |

`adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the` already named this family
and answered it with three questions (Proxy / Silence / Opt-in) applied as a **review lens**.

**That answer is now measured insufficient.** Every task authored in this session carried the
three questions in its own doc, every implementer answered them — and `AC-ACQ-6`'s identical
vacuity still shipped past all of it, surfacing only when a verification pass ran a control
by hand afterwards. That ADR's own words explain why: *"prose that should have been followed
is not a mechanism"*, and *"a defect already covered by existing prose is proof that the prose
layer is the wrong layer."*

# Decision

**Falsifiability moves from the TASK tier to the ORACLE tier, and becomes a computed corpus
fact rather than a discipline.**

"Failure-first verification" is already mandatory here, but it is enforced only as
`extra.red_first` — ONE boolean plus one `expected-fail` evidence row **for a whole task**.
A task with eight declared criteria satisfies that floor when ONE of them was seen red; the
other seven are indistinguishable from criteria that could never go red at all. Vacuity lives
per-criterion, so the floor has to be per-criterion.

Three mechanisms, all deterministic, all zero-LLM, all computable from data the corpus
ALREADY stores:

**M1 — `falsified` becomes a fourth coverage dimension.** `computeAcCoverage` gains a
`falsified` count per criterion (`ac_ref` rows whose `result` is `expected-fail` or `fail`),
and `deriveAcCoverageState` gains a `pass_unfalsified` state: green, never observed red.
`expected-fail` refs are TODAY counted in neither bucket (`acceptance.ts:209`) — the raw
material is already there; only the derivation and the surfacing are missing.

**M2 — a self-reported evidence command containing a shell pipe is refused.** `$?` after a
pipe belongs to the last stage, so the recorded `result` cannot have been measured. This is a
one-predicate sibling of the four self-report guards `evidence-precheck.ts` already hosts, and
it does not touch the `--capture` path (there, lore spawns the command itself).

**M3 — an unclaimed oracle is reported.** A `-t` / `--testNamePattern` name present in a test
file that NO declared AC binds is surfaced. This is how a withdrawn claim becomes visible:
the test keeps passing, and nothing else says the criterion that used to own it is gone.

## Report-only first, with a written retroactive exemption — NOT a blocking gate

Measured 2026-08-07 over the whole corpus (137 specs, 700 criteria carrying coverage):

| criteria | count | share |
|---|---|---|
| observed red at least once | 88 | 12.6% |
| **green but never observed red** | **574** | **82.0%** |
| zero evidence | 38 | 5.4% |

`refs` results corpus-wide: `pass` 2155, `fail` 124, `expected-fail` **30**, `inconclusive` 6.
Only 32 of 137 specs contain even one falsified criterion.

Arming M1 as a blocking gate therefore puts **82% of the corpus in violation on the commit
that lands it**. This is the exact failure mode
`knowledge-retro-a-newly-built-gate-leaves-every-pre-existing` records, so its remedy is
adopted verbatim: the back-catalogue gets a **written, auditable exemption**, never 574
synthesized red runs. A red run authored to clear a predicate is afterwards indistinguishable
from a real one, which would destroy the very signal this ADR exists to create.

M1 ships **report-only**: a computed, distinctly-valued fact surfaced by `lore ac list` and
`lore status`. Nothing blocks. Whether and when a blocking form arms is a separate decision
that needs this report's first readings as input — ⛔ and it must never arm retroactively.

# Consequences

- The three questions stay as a review lens; they are not replaced. M1-M3 mechanize the
  narrow, computable slice of Q2 (Silence) — "an empty result and a clean result must not be
  the same value" — for one specific pair: *never measured* vs *measured and green*.
- ⛔ **Named residual, load-bearing**: M1 proves an oracle CAN fail, never that it fails on
  the RIGHT input. An author can satisfy it with a trivial inversion. Accepted deliberately —
  it converts "never measured" into "measured at least once", which is precisely the whole
  difference between the old `AC-ACQ-7` and a real criterion. Mutation-based discrimination
  proof was considered and rejected for this slice (new infrastructure, and it needs a
  definition of which mutations count as relevant).
- ⛔ **Named non-goal**: per-criterion edit provenance does not exist in the schema, so this
  slice cannot expire a criterion's falsified basis when `lore ac set` restates it. The
  coarse substitute (compare evidence `at` against the spec's `updated_at`) was rejected —
  ANY spec edit would mark EVERY criterion stale, which is a false signal, and a false signal
  is worse than an absent one. Closing it properly needs per-criterion edit timestamps and is
  its own slice.
- This ADR's own acceptance criteria are subject to M1. If they land `pass_unfalsified`, the
  mechanism is reporting truthfully about itself and that reading is the dogfood proof.
- Expect the first report to be dominated by the 574 grandfathered criteria. The useful
  signal is the DELTA on criteria authored after arming, not the absolute count.

# Alternatives considered

- **Keep the three questions as prose and try harder.** Rejected on this session's own
  evidence: they were carried, answered, and still missed the sibling vacuity.
- **Arm M1 as a blocking `plan-close` predicate immediately.** Rejected: 82% instant
  violation, and the pressure to clear it would produce synthesized red runs — manufacturing
  exactly the indistinguishable-from-real artifacts the standing lesson warns about.
- **Mutation testing per AC (the strong form).** Deferred, not rejected on merit: it proves
  discrimination rather than mere falsifiability. Cost is disproportionate to "first use the
  data already in the corpus".

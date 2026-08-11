---
id: TASK-346
type: task
role: plan
title: "AC-ACQ-7 is vacuous by construction and its oracle never reads the corpus, hiding a 5-of-5 false-positive rate in the shipped quantifiability lint's hyphen-boundary matching"
status: archived
priority: medium
created: 2026-08-02
updated: 2026-08-07
tags: []
parent: PRD-001
---
# Defect — two independent faults in the shipped AC-quantifiability lint

Measured 2026-08-02 over the whole corpus (137 specs, 720 declared criteria, dumped via
`lore ac list --json`; full analysis in
`knowledge-a-conjunction-detector-over-acceptance-criteria-is`).

## (a) `AC-ACQ-7` is vacuous by construction, and its oracle does not read the corpus

Declared statement on `spec-spec-ac-quantifiability-gate-design-time-standardization-en`:

> lintAcQuantifiability over every existing corpus spec's declared **script-mode** ACs
> yields 0 block findings

`packages/core/src/ac-quality.ts`'s own documented invariant:

> `verify.mode === "script"` criteria are NEVER blocked by this lint

The AC scopes itself to precisely the population the lint is specified to skip, so its green
is guaranteed by the skip rule and measures nothing.

- measured: 696 script-mode corpus ACs → **0** block findings
- **CONTROL**: the same 696 statements relabelled human-mode → **5** block findings

Separately, the bound oracle (`-t false-positive-bound`,
`packages/core/tests/unit/ac-quality.test.ts:202-227`) evaluates **9 hand-written in-file
string literals** and never opens the corpus. The statement says "every existing corpus
spec's"; the oracle says nine strings the test author typed.

## (b) The wordlist matches across hyphen boundaries — 5/5 real corpus hits are false positives

All five control hits are wrong:

| statement | flagged | why wrong |
|---|---|---|
| `…records one best-effort audit row…` (AC-PCI-3) | `best` | `-` is a `\b` boundary |
| `…via atomic reset + re-fast-track…` (AC-TIER-2) | `fast` | same |
| `lore review backfill-ledger fast-tracks…` (AC-TIER-8) | `fast` | same |
| `Typecheck clean` (AC-050-1, AC-051-1) | `clean` | tsc exit 0 is fully measurable |

Probed directly against `lintStatement`:

    "breakfast is served"            -> []        (documented case, correct)
    "the run is faster"              -> []        (documented case, correct)
    "the fast-track path is audited" -> ["fast"]  (UNDOCUMENTED, wrong)
    "a best-effort audit is written" -> ["best"]  (UNDOCUMENTED, wrong)

The module header claims the `\b` rule keeps `fast` out of `breakfast`/`faster`. It names
only SUFFIX collisions. Hyphenated compounds split at `\b`, and `fast-track`/`best-effort`
are native vocabulary in this codebase.

# Mechanism root — a skip rule hid a 100% false-positive rate behind a vacuous AC

96.7% of the corpus (696/720) is script-mode and therefore skipped. Fault (b) is unreachable
in production for that population, and fault (a) is the AC that would have caught it pointing
at the skipped population. The two faults protect each other: the FP rate is invisible
because the lint never runs on those statements, and the check that would have measured the
FP rate scoped itself to the statements the lint never runs on.

⛔ Transferable: **a detector's false-positive rate is not knowable from an oracle whose
population the detector is specified to skip.** Any lint with a skip rule needs its FP
measured with the skip REMOVED — the control run, not the production run.

# Required fix

1. Hyphen boundary: an `AC_ABSTRACT_WORDS` entry must not match when adjacent to `-` on
   either side. Preserve the existing suffix behaviour (`breakfast`, `faster` stay clear).
2. Restate `AC-ACQ-7` so its statement names a population the lint can actually block, and
   rebind its oracle to a test that reads the corpus rather than in-file literals — or, if
   reading the corpus from a unit test is rejected, state THAT explicitly and narrow the
   statement to what the nine fixtures actually prove. Either is acceptable; the present
   mismatch between the two is not.
3. Editing declared criteria demotes the approved spec to `draft` (D2). Budget a real review
   and a re-promotion via `lore approve` — never `set --status`.

⛔ This task is NOT authorisation to add a conjunction/compound detector. That was measured
and REFUSED (`knowledge-a-conjunction-detector-over-acceptance-criteria-is`: 80.1% fire rate,
~50% precision, and its false positives are the ACs complying with the false-oracle
discipline). These two faults are separable defects in an existing detector, not evidence
for a new one.

# Proxy / Silence / Opt-in

**Proxy.** An abstract word with no nearby measurable token is a proxy for "this criterion
is unverifiable". Input satisfying the proxy while violating the property: `Typecheck clean`
— flagged, yet fully oracle-bound. ACCEPTED as a residual after the hyphen fix, and it must
be NAMED in the module header rather than left for the next reader to rediscover; the
hyphen class is not accepted and is fixed here.

**Silence.** Fault (a) is a silent pass: 0 findings over a skipped population is
indistinguishable from 0 findings over a clean one. The restated AC must make the measured
population explicit in its own statement, so a future reader can tell which was measured.

**Opt-in.** The lint binds every `AcService.addCriterion` write, with the script-mode skip as
a documented carve-out. The carve-out is deliberate (an oracle command is bound) and stays —
what changes is that it can no longer be mistaken for evidence of a low FP rate.

# Oracle

- `lintStatement("the fast-track path is audited")` and
  `lintStatement("a best-effort audit is written")` each return `[]`; CONTROL —
  `lintStatement("the dashboard loads fast")` still returns a `fast` block finding, and
  `"breakfast is served"` / `"the run is faster"` stay `[]`. All five in one test, so a
  matcher that matches nothing cannot pass as green.
- The re-bound `AC-ACQ-7` oracle FAILS when fed a statement its restated wording claims to
  cover — record that inverted run as `--result expected-fail`.
- REGRESSION: the pre-existing `ac-quality.test.ts` assertions (the byte-identical SPEC-059
  refactor fixture) pass unmodified.

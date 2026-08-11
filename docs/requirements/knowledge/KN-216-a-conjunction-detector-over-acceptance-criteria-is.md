---
id: KN-216
type: knowledge
role: knowledge
title: "A conjunction detector over acceptance criteria is anti-correlated with this codebase's own false-oracle discipline — measured 80.1% fire, 50% precision, do not promote"
status: approved
priority: medium
created: 2026-08-02
updated: 2026-08-02
tags: []
parent: PRD-001
links:
  - {id: TASK-346, type: informs}
  - {id: TASK-345, type: informs}
---
# A conjunction detector over acceptance criteria is anti-correlated with this codebase's own false-oracle discipline — do not promote it

Answers `knowledge-handoff-agent-main-orchestrator-71` NS2: *"若要推广该检测器，需先解决
false-positive 率"*. Measured 2026-08-02 over the **whole corpus** (137 specs, 720 declared
acceptance criteria, dumped via `lore ac list --json` per spec, 0 read failures).

**Verdict: do not promote it — not at a lower false-positive rate, not as an advisory.**
The finding is not "the rate is too high to gate on"; it is that what the detector fires on
is, disproportionately, the thing this codebase requires authors to do.

## Measurement 1 — raw hit rate

The detector the originating task sanctioned ("conjunction token present in a statement"):

| Population | Count | Share |
|---|---|---|
| Declared ACs corpus-wide | 720 | 100% |
| Hit by the naive detector | **577** | **80.1%** |
| … containing ` and ` | 469 | 65.1% |
| … containing `;` | 320 | 44.4% |

## Measurement 2 — precision, hand-labelled on FULL statements

12 hits sampled deterministically and labelled against "≥2 claims that can pass and fail
INDEPENDENTLY" (truncated text was re-fetched in full first — the predecessor's error was
judging truncated statements):

- **Genuinely compound (6)**: AC-RC-7 (3 payload scenarios), AC-CP-6, AC-SP-6 (~9 claims),
  AC-DR-1, AC-S3-1 (8+ property claims), AC-V-3 (4 scenarios).
- **False positive (6)**: AC-LL-1, AC-068-2, AC-ACS-6, AC-080-7, AC-CLOSURE-6, AC-AEP-2.

**Precision ≈ 50%** — independently corroborating the handoff's 5/12 estimate. Extrapolated:
arming this as a gate flags 577 ACs, of which roughly 288 are correct by the rule the
detector is enforcing.

## The decisive finding — the FPs are the *disciplined* ACs

The false positives are not noise; they cluster into four mechanisms, and the largest is
a direct collision with a standing rule:

1. **Two facets of ONE observation, paired deliberately to defeat a false oracle.** The
   canonical case, AC-LL-1, states its own reason:
   > "…and BOTH exits 0 AND emits the literal substring Total documents on stdout;
   > **exit 0 alone is insufficient because a command that silently does nothing would
   > also produce it**"

   CLAUDE.md's standing lesson is *"False oracles — exit-code-true ≠ measured-the-right-
   thing"*. An AC that pairs an exit code with an output assertion is **complying**. A
   conjunction detector scores that compliance as a defect. AC-068-2 and AC-080-7 are the
   same shape (one execution, two observed facets).
2. **`and` inside a setup/precondition clause**, not between claims (AC-SP-6's fixture
   description — though that AC is compound for unrelated reasons).
3. **`and` inside corrective/provenance prose attached to the statement** — AC-AEP-2's
   `and`s are all inside "CORRECTED 2026-08-01 (the original statement's premise was
   unsatisfiable and its green was false)".
4. **`;` as a list separator inside a parenthetical**, not a claim boundary (AC-CLOSURE-6).

⛔ A detector whose error mode is "flags the authors who followed the other rule" cannot be
made safe by tuning its threshold. Under a gate, the cheapest way to green is to **unpair**
the exit-code-plus-output assertion — i.e. to reintroduce the exact false oracle the
codebase spent multiple slices eliminating. The handoff worried it "会诱使作者为凑绿去改无关
AC"; the真实 risk is worse than unrelated churn — it is targeted regression of a quality rule.

## Byproduct defect found while establishing the baseline

Looking for a precedent for "bound a lexical detector's FP rate", the only one is
`AC-ACQ-7` on `spec-spec-ac-quantifiability-gate-design-time-standardization-en`, guarding
the shipped `lintAcQuantifiability` (`packages/core/src/ac-quality.ts`, armed at
`AcService.addCriterion` write time). It has **two independent defects**:

**(a) The AC is vacuous by construction.** Its statement:
> "lintAcQuantifiability over every existing corpus spec's declared **script-mode** ACs
> yields 0 block findings"

The module's own documented invariant is that `verify.mode === "script"` criteria are
**NEVER** blocked by this lint. The AC scopes itself to exactly the population the lint is
specified to skip. Measured: 696 script-mode ACs → 0 block findings. **CONTROL** — the same
696 statements relabelled human-mode → **5 block findings**. The green measures the skip
rule, not the corpus.

**(b) The bound oracle does not read the corpus.** `-t false-positive-bound`
(`packages/core/tests/unit/ac-quality.test.ts:202-227`) evaluates **9 hand-written in-file
literals**. Nothing in the test opens the corpus. The statement says "every existing corpus
spec's"; the oracle says nine strings the test author typed.

**(c) And the 5 control hits are themselves 5/5 false positives** — a real, reproducible
FP mechanism in shipped code:

| Statement | Flagged | Why it is wrong |
|---|---|---|
| `a best-effort audit is written` | `best` | hyphen is a `\b` boundary |
| `the fast-track path is audited` | `fast` | same |
| `Typecheck clean` (×2, AC-050-1/AC-051-1) | `clean` | tsc exit 0 is fully measurable |

Probed directly against `lintStatement`: `"breakfast is served"` → `[]` and
`"the run is faster"` → `[]` (the two cases the module header names as handled), but
`"fast-track"` → `["fast"]` and `"best-effort"` → `["best"]`. The documented invariant
covers **suffixes** and not **hyphenated compounds** — and `fast-track`/`best-effort` are
native vocabulary in this codebase. In production this is entirely masked, because 696/720
(96.7%) of the corpus is script-mode and skipped.

⛔ Transferable lesson: **a detector's false-positive rate is not knowable from an oracle
whose population the detector is specified to skip.** Before trusting any lint's clean
bill, run the control — feed it the same inputs with the skip condition removed. Here the
skip hid a 100% FP rate on every real statement the lint could reach.

## Disposition

- Conjunction detector: **not promoted**, at any severity. Recorded as decided, not deferred.
- The originating task's oracle clause ("a simple detector … its false-positive rate is a
  design question **to state, not a reason to skip it**") is now discharged: the rate is
  stated (80.1% fire, ~50% precision) and the design answer is no.
- The `ac-quality.ts` hyphen-boundary FP and `AC-ACQ-7`'s vacuity are real, separable
  defects with their own fix path — they are NOT arguments for the conjunction detector.

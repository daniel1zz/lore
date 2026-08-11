---
id: TASK-390
type: task
role: plan
title: "AC statement drift is deterministically detectable: an unchanged statement whose -t-matched tests were all retitled keeps the oracle green while the statement is false"
status: draft
priority: high
created: 2026-08-01
updated: 2026-08-03
tags: []
parent: PRD-001
links:
  - {id: ADR-028, type: relates-to}
---
Filed per `knowledge-handoff-agent-main-orchestrator-69` NS8, reviewed through
`adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the` before filing.

## The defect this detector would have caught (verified in-corpus 2026-08-01)

`SPEC-067`'s `AC-067-4` today reads, verbatim from `extra.acceptance_criteria`:

> "SUPERSEDED 2026-08-01 by spec-lore-assess-project-evidence-rows-instead-of-embedding-the
> D3: an ungrounded absence-based dimension score is now REMOVED from dimension_scores at
> finalization … and applyGroundingConfidenceDowngrade no longer exists. **The oracle below
> still passes because the tests were retitled 'REGRESSION (superseded AC-067-4)' and updated
> to assert removal.**"

with the oracle unchanged:

    bunx vitest run packages/lore/tests/unit/service/assessment-finalize-downgrade.test.ts -t "AC-067-4"

So the AC's own statement documents the drift. That is the point: **the statement is honest
only because a human noticed and hand-annotated it.** For the window between the behaviour
being deleted and that annotation being written, the AC asserted a property about a function
(`applyGroundingConfidenceDowngrade`) that no longer existed, and its oracle was green the
whole time — because `-t "AC-067-4"` matches any test whose title merely CONTAINS that id,
including `REGRESSION (superseded AC-067-4)`, which asserts the OPPOSITE property.

Nothing detected this. Nothing would detect the next one.

## Why it is deterministically detectable (no LLM required)

Every input the detector needs is already stored or derivable:

1. The AC's `statement` string and its `verify.command`, both in `extra.acceptance_criteria`.
2. The AC's version history — `lore log <spec>` / `lore diff` already expose whether the
   `statement` changed between two versions.
3. The set of test titles the `-t` filter currently matches, obtainable by running the oracle
   in list mode.

The signal is the CONJUNCTION: the `statement` is byte-unchanged across a range, while the set
of matched test titles changed (a rename, a `REGRESSION`/`superseded` prefix appearing, or the
matched set going from N to 0). A statement that is still true after its tests were rewritten
is possible; a statement that was never re-examined while its tests were rewritten is a
review omission, and the conjunction is exactly what flags it for a human.

## Proxy / Silence / Opt-in — ADR three-question review

**Q1 Proxy — the detector is a proxy and its gap must be accepted explicitly.**
"Matched test titles changed while the statement did not" is a proxy for "the statement is now
false". Concrete input satisfying the proxy while violating the property: a purely cosmetic
test rename (typo fix in the title) leaves the statement correctly unchanged and still trips
the detector. **That gap is ACCEPTED**, on one condition: the output must be an ADVISORY that
names the specific AC, the old and new matched-title sets, and asks for a re-read — never a
gate, never a blocking refusal. A false advisory costs one re-read; a false green cost SPEC-067
an AC that asserted a deleted function.
Second, narrower proxy that is NOT accepted: keying on the word `superseded`/`REGRESSION`
appearing in a title. That is the contiguous-substring trap the corpus already catalogues —
it detects exactly the phrasing this one incident happened to use.

**Q2 Silence — the zero-match case is the loudest signal and must not degrade to "unchanged".**
If the `-t` filter matches ZERO tests, the current matched set is empty, and a naive
implementation comparing "empty vs empty" (both runs matching nothing) reports no drift while
the AC has NO coverage at all. Required: zero-match is its own reported state, distinct from
both "unchanged" and "changed" — this is the fourth appearance of the no-match-reads-as-pass
shape in this corpus and it must be handled by construction, not noticed later.

**Q3 Opt-in — must bind every script-mode AC, with no per-AC suppression flag.**
An opt-in drift check is worthless: the ACs whose authors would opt in are the ones already
being maintained. The detector runs over every script-mode AC in the corpus. If an individual
AC legitimately has a stable statement across a test rewrite, the resolution is a recorded
acknowledgement on that AC (auditable), never a flag that switches the detector off.

## Required — settle before implementing

- **Where does it run?** Candidates: a new `lore status --check-ac-drift` face (consistent with
  `--check-tree` / `--check-drift`), or an addition to the existing drift command. Decide, and
  do NOT invent a new top-level command if an existing face fits.
- **Against what baseline?** The detector needs two points in time. `lore log`/`lore diff`
  already carry statement history; the matched-title set is NOT stored anywhere and would have
  to be either recomputed live (needs the test runner — an IO dependency the pure core forbids)
  or persisted at AC-authoring time. This is the load-bearing design question: answer it first,
  because the "persist the matched set" answer changes the AC schema.
- **Back-catalogue**: every existing AC has no stored matched-title baseline, so the first run
  can only establish one, not detect drift. State that explicitly in the output rather than
  reporting a clean sweep — a first run that prints "no drift" over a corpus with no baselines
  is the exact false-green this task exists to remove.

## Oracle

- RED first: a fixture spec whose AC statement is unchanged while its `-t`-matched test is
  retitled must be REPORTED by the detector, and the test asserting that must fail before the
  fix.
- CONTROL: an AC whose statement AND tests both changed is not reported (that is a normal
  maintained edit).
- CONTROL: an AC whose statement and tests are both unchanged is not reported.
- CONTROL (the Q2 case): an AC whose `-t` filter matches zero tests is reported as
  `no-coverage`, a value distinguishable in the output from both other verdicts — assert the
  value, not merely that something was reported.
- CONTROL: the detector never changes an exit code that today is 0 for a corpus with no ACs.
- Fixture corpus is a throwaway (`mkdtemp` + `lore init`), never the repo's own `.lore/`.

## Second instance, produced BY this corpus one day later (2026-08-03)

`AC-ETI-4` on `spec-evidence-output-tail-integrity-a-self-reported-non-pass` read:

> CONTROL: a self-reported result=pass with an unfiltered command and no output_tail is still
> ACCEPTED — the new predicate must not widen into the pass path owned by findFilteredPass

`task-a-non-empty-output-tail-can-be-hand-authored-prose-and-the` (merge `82157f3`) then
DELIBERATELY performed exactly that widening. Its implementer rewrote the AC's test to assert the
new refusal, and the `-t 'AC-ETI-4'` oracle stayed green throughout — statement false, oracle green,
detector absent. Identical to the AC-067-4 case that motivated this task, one day later, in a slice
that had this very task open in its own corpus.

That is the strongest available argument for building the detector: knowing about the failure mode
did not prevent a repeat, because nothing at merge time compares an AC's statement against what its
tests now assert.

## ⛔ AC-067-4 is a BAD precedent — the detector must not steer people toward it

Handling the AC-ETI-4 case, the orchestrator first copied AC-067-4's shape and rewrote the statement
as a supersession NOTE ("SUPERSEDED 2026-08-03 by …, the widening was deliberate, tests were
rewritten"). The AI review judge rejected it, correctly:

> AC-ETI-4 is no longer an acceptance criterion in form — it is a supersession note. It declares no
> oracle, threshold, or observable state transition that a reader could check: the whole statement is
> historical narration. Nothing in it can pass or fail.

The statement was then rewritten as a CHECKABLE criterion pinning the widened behaviour, with the
supersession recorded as a trailing clause rather than as the whole content, and its oracle re-run
green. Spec review went 0.74 with three advisories → 0.82 with zero.

**Consequence for this task**: the detector's output must not merely say "statement and tests
disagree". It must steer toward the correct repair — restate the criterion so it pins the CURRENT
behaviour and remains pass/fail-able, with the reversal as an auditable clause — and away from
converting the AC into pure narration. AC-067-4 itself should be re-examined under that rule; it is
currently narration occupying an AC slot, and it is the example everyone will copy.

## Consequence for the detector's design

Both known instances share a signature the detector can key on WITHOUT natural-language
understanding: the AC's `statement` is byte-unchanged across a range in which the set of test titles
its `-t` filter matches DID change, AND the matched tests' own titles now contain a reversal marker
the statement lacks. AC-067-4's tests were retitled `REGRESSION (superseded AC-067-4)`; AC-ETI-4's
describe block was retitled `a self-reported pass with no output_tail is now REJECTED`. ⛔ Do not key
on those literal words — that is the contiguous-substring trap this corpus already catalogues. Key on
the structural fact: matched-title-set changed while statement did not.

---
id: TASK-345
type: task
role: plan
title: "De-vacuuming AC-ACQ-7 exposed three sibling faults it was masking: a withdrawn false-positive bound, an identically vacuous AC-ACQ-6, and a drifted verbatim fixture"
status: draft
priority: high
created: 2026-08-07
updated: 2026-08-07
tags: []
parent: PRD-001
---
# Defect — de-vacuuming AC-ACQ-7 exposed three sibling faults it was hiding

`task-ac-acq-7-is-vacuous-by-construction-and-its-oracle-never` landed (archived
2026-08-07, merged `581d716b`) and correctly fixed what it named: the hyphen-adjacency false
positive is gone, and AC-ACQ-7 no longer certifies a population the lint is specified to
skip. Verifying that fix surfaced three MORE faults on the same spec
(`spec-spec-ac-quantifiability-gate-design-time-standardization-en`), each of which the old
vacuous AC-ACQ-7 had been masking. The spec is currently `draft` (v11) with a BLOCKING
review judgment; it must not be approved until these are settled.

## (a) The false-positive bound was WITHDRAWN, not restated — and nothing says so

After the edit, **zero** declared ACs bind `-t false-positive-bound`
(measured: `lore ac list … | grep -c false-positive-bound` → 0). The 9-fixture test still
EXECUTES, because AC-ACQ-1's oracle runs the whole file unfiltered — but no criterion
CLAIMS a false-positive bound any more.

The independent review judge reached the same conclusion unprompted and stated the
consequence more sharply than this task's predecessor did:

> If the declared (hyphen-adjacency) AC-ACQ-7 is the authoritative one, the body's
> false-positive bound over the existing corpus is dropped entirely — removing the only
> safeguard that the new block-severity gate will not immediately reject already-merged
> corpus specs. That is a material scope reduction, not a wording nit.

⛔ Note the trap in "just restore the old wording": the old bound was FALSE on any
population the lint can reach. Measured corpus-wide control (script-mode statements
relabelled human-mode, i.e. the skip removed): **5 block findings before the fix, 3 after**.
A restored "yields 0 block findings" claim would be a new false oracle. The bound has to be
restated with the MEASURED number and its named residual classes, not with a zero.

## (b) AC-ACQ-6 has the IDENTICAL vacuity AC-ACQ-7 just shed

AC-ACQ-6: *"this spec's own declared acceptance_criteria produce 0 block findings from
lintAcQuantifiability"*, bound to `-t dogfood-self-application`.

Its fixture (`packages/core/tests/unit/ac-quality.test.ts:156+`) declares all seven criteria
via the `script(...)` helper — and the module's documented invariant is that
`verify.mode === "script"` criteria are NEVER blocked. Zero findings is guaranteed by the
skip, exactly as it was for the old AC-ACQ-7.

**The concrete input satisfying the proxy while violating the property is now in hand** — the
NEW AC-ACQ-7 statement itself. Measured on merged `581d716b`: the corpus-wide control flags
`AC-ACQ-7 [fast]`, because its restated statement quotes `"the dashboard loads fast"` as its
standalone example. So this spec's own declared AC text DOES contain an unquantified abstract
word; AC-ACQ-6 reports clean only because of the skip.

The judge independently flagged the same AC from a different angle:

> The dogfood AC is measurable but self-referential and near-tautological … It provides no
> independent signal about lint quality — it can be satisfied by weakening the wordlist.

## (c) The dogfood fixture is a hand transcription that has now silently drifted

The fixture's own comment claims provenance:

    // Verbatim from `lore ac list spec-spec-ac-quantifiability-gate-design-time-standardization-en`

That claim is now FALSE. Measured: the fixture still carries AC-ACQ-7's **old** statement
(`"lintAcQuantifiability over every existing corpus spec's declared script-mode ACs yields 0
block findings"`) and its **old** oracle (`-t false-positive-bound`), while the corpus
carries the new ones. Nothing detected the divergence — a transcribed fixture asserting
"verbatim" with no mechanism tying it to its source.

## (d) AC-ACQ-7 now names a symbol the spec body never specifies

Judge finding (`contract`): the declared AC binds `lintStatement`, which appears nowhere in
§Scope or §Design; the in-scope surface named there is `lintAcQuantifiability` plus the
`MEASURABLE_TOKEN` recognizer. No word-boundary / hyphen-adjacency matching rule is
specified anywhere in the body. The AC has no design counterpart to bind to.

# Mechanism root — one vacuous AC was load-bearing for its siblings' credibility

All four faults live on ONE spec, and the old vacuous AC-ACQ-7 was what made the set LOOK
coherent: while the FP bound was (vacuously) certified, nobody needed to ask whether
AC-ACQ-6 measured anything, whether the fixture matched its source, or whether the declared
ACs matched the body. Removing one vacuous certification did not create these faults — it
removed the thing that made them invisible.

⛔ Transferable: **de-vacuuming a single AC is not a local edit.** A vacuous AC subsidises
the credibility of every sibling that shares its population or its fixture, so the slice that
fixes one MUST re-evaluate the set. Budget the sibling sweep in the SAME slice, or expect the
next verification pass to find exactly what this one did.

# Required fix

1. **Two distinct AC ids, per the judge's blocking question.** Keep the hyphen-adjacency
   criterion under its own id; give the false-positive bound its own id, restated with the
   MEASURED number and the named residual classes (currently 3, all `clean`-in-`Typecheck
   clean` plus AC-ACQ-7's own self-reference) — ⛔ never a restored zero.
2. **Pair AC-ACQ-6 with a positive fixture** (a deliberately vague spec that MUST produce
   block findings), so the pair cannot both be satisfied by an under-strict lint. AND
   evaluate the dogfood fixture with the script-mode skip REMOVED — otherwise the pairing
   inherits the same vacuity.
3. **Make the dogfood fixture's provenance mechanical or drop the claim.** Either bind it to
   its source so drift fails loud, or delete the "Verbatim from" comment and state that it is
   a point-in-time copy — ⛔ an unverifiable provenance claim is worse than none.
4. **Specify `lintStatement` and the matching rule in §Scope/§Design** (word boundaries,
   hyphen adjacency, suffix handling) so the declared AC has a counterpart, then re-review
   and re-approve via `lore approve`. ⛔ Never `lore set --status`, and ⛔ never
   `--override-judgment` — the current blocking judgment is CORRECT and its two blocking
   questions are unanswered.
5. The judge also raised three advisories on AC-ACQ-2 / AC-ACQ-3 / AC-ACQ-5 (proxy scope not
   pinned; oracle weaker than designed behaviour; an "only under X" clause with no positive
   assertion) and a completeness gap: §Scope commits to `spec-promote` + g2-hook parity that
   NO AC exercises. Address or explicitly defer each with a reason.

# Proxy / Silence / Opt-in (binding — adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the)

**Proxy.** "This spec's own declared ACs produce 0 block findings" is a proxy for "this
spec's ACs are quantifiable". Concrete input satisfying the proxy while violating the
property: this spec's own AC-ACQ-7 as of `581d716b` — flagged `[fast]` the moment the
script-mode skip is removed, yet reported clean by AC-ACQ-6. NOT accepted; that is this
task. Residual after the fix, to be NAMED not silently carried: `Typecheck clean` blocks on
`clean` while being fully oracle-bound, and no lexical rule distinguishes it.

**Silence.** Three of the four faults are silent by construction: a withdrawn AC leaves no
marker, a skipped population reports the same `0` as a clean one, and a drifted transcription
still reads as authoritative. The restated FP-bound AC MUST make its measured population
explicit in its own statement, and the dogfood fixture MUST either fail loud on drift or stop
claiming verbatim provenance. ⛔ An empty finding list and a not-measured finding list must
not be the same value.

**Opt-in.** The `verify.mode === "script"` skip is a deliberate carve-out and stays — an
oracle command really is bound. What must change is that the carve-out can no longer be
mistaken for evidence: every AC scoped to a skipped population is vacuous, and the spec's own
AC set is the population most likely to be script-mode across the board.

# Oracle

- `lore ac list <spec>` shows a criterion bound to an unfiltered false-positive-bound test
  AND a separate criterion for hyphen adjacency — two distinct ids, both present. Assert the
  id SET, not a count.
- The dogfood evaluation, run with the script-mode skip removed, produces 0 block findings
  over this spec's CURRENT declared statements — and a CONTROL asserting the same evaluation
  DOES produce findings for a deliberately vague fixture, so an under-strict lint cannot pass
  both.
- A drift oracle: the dogfood fixture's transcribed statements match `lore ac list`'s current
  output, or the provenance claim is absent from the file (assert whichever design is chosen —
  ⛔ not both, and not neither).
- `grep -n "lintStatement" ` over the spec body returns ≥1 hit in §Scope or §Design.
- `lore approve <spec>` exits 0 only AFTER a fresh non-blocking judgment for the then-current
  version; record the pre-fix blocking judgment as the `expected-fail` control.

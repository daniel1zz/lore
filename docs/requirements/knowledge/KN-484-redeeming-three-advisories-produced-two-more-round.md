---
id: KN-484
type: knowledge
role: knowledge
title: "Redeeming three advisories produced two more rounds of the same defect, and the judge's escalation caught a real design break no self-check did"
status: approved
priority: medium
created: 2026-08-20
updated: 2026-08-23
tags: []
parent: PRD-001
links:
  - {id: SPEC-143, type: relates-to}
  - {id: KN-471, type: relates-to}
---
# Redeeming three advisories on SPEC-143 produced two more rounds of the same defect, and the review judge's escalation was the only mechanism that caught a real design break

Scope: one session, no code written. SPEC-143 went `approved` → `draft` → `approved` (v19 → v33), 7 ACs → 9, and accumulated revision records R2 through R8. Every finding below is measured, and the pattern across them matters more than any single one.

## 1. The defect class this spec kept reproducing

**A criterion that names a property, or even names an oracle, without naming the condition that DECIDES it.** Four occurrences in one spec:

| Record | Criterion | The clause with no deciding condition |
|---|---|---|
| R2 | AC-CT-1 | "the projection is the ONLY one in the codebase" — a whole-repo property, no oracle |
| R4 | AC-CT-6 | "work CONSTANT with respect to corpus size" — byte-equality measures side-effect freedom, not work performed |
| R6 | AC-CT-8 (new) | G5 was a declared GOAL measured only by a QA scenario; no AC asserted it |
| R7 | AC-CT-1/6/8 | "produces a string literal" (undefined), "under 2s" (no machine), "matching its stdout" (no pattern) |
| — | AC-CT-9 | `attestationFloor` accepts `unmeasured` and shows it as its own bucket — but `stampCurrency`'s return type has no such value |
| R10 | AC-CT-9(d) | "delete the duplicate predicate" — verified once, with no ratchet against re-introduction, while AC-CT-7 three criteria away argues exactly why a scan beats a test |
| R11 | AC-CT-3 | still declared the four-valued return, and its falsifier "make stampCurrency return `bound`" was UNREPRESENTABLE in the new type — an oracle that could never run, reading as coverage |
| R12 | AC-CT-9(d) | put five stamp-verdict buckets inside the `capture_source` distribution, which buckets a different axis and already sums to the row total on its own |

⛔ **All four were found by the review judge. None by the author's self-check** — and the author was, at the moment of writing R7, composing revision records ABOUT under-measured criteria. This is not an attention failure; it is what an AC looks like when written by a producer who already knows what they meant.

## 1b. The FIFTH occurrence, and this one the judge missed too

Found 2026-08-21 while running the plan skill's upstream-document gate, one day after the spec was
re-approved at 0.79 with no blocking questions.

AC-CT-9 (added in R8) asserts that `attestationFloor` ACCEPTS an `unmeasured`-radius record and that
`unmeasured` appears as **its own labelled bucket** in the `capture_source` distribution. The Scope
table and Migration Plan step 6 were updated to match — both now name five classes. But **C2's
interface signature was not**:

```
stampCurrency(…, blastRadiusChanged: boolean | "unmeasured")
  → { class: "bound" | "stale" | "unbound" | "legacy_unbound", … }
```

Four values. The mermaid node says four. And ADR-034 pins four in prose: "`stampCurrency` returns one
of `bound | stale | unbound | legacy_unbound`, never a boolean." So when the stamp is present and the
radius is unmeasurable, the declared signature can only return `bound` — claiming "compared, unchanged"
— or `stale` — claiming "changed". Both are false, and avoiding exactly that was the judge's original
blocking question.

⛔ **The review judge did NOT catch this**, and its consistency dimension explicitly reported the
opposite: "The Scope table and the AC set agree on every named symbol and file." That statement is
true and useless here — the contradiction is not between a symbol and a file, it is between a
**component's type signature** and a **criterion's prose assertion**. Nothing in the review pipeline
compares those two. Neither does any deterministic check: `schema`, `parent_contract`, `tree_position`
and `link_integrity` all passed.

⇒ The defect class from §1 has a sharper edge than "the author writes loosely". Here the author wrote
a precise, measurable criterion — and simply did not open the component section that had to carry it.
The reviewing mechanisms are organised around documents and symbols, not around **the contract a
criterion implies for the component named in it**.

⛔ **It happened a second time, 2026-08-23, and again only reading the code exposed it.** AC-CT-9(d)
said "the `capture_source` distribution buckets those five [stamp-verdict readings]". Opening
`assess-render.ts` to plan against it showed that distribution buckets a DIFFERENT axis — who recorded
the evidence, `runner` vs self-report — and already sums to the row total by itself. Folding a second
orthogonal axis into it yields non-exclusive buckets summing to twice the row count, contradicting
(d)'s own "summing to the row total" clause. Fixed as SPEC-143 R12: two parallel distributions.

Both instances (R9, R12) share a shape worth naming: **the contradiction is between a criterion's prose
and a RUNTIME STRUCTURE it names**, and neither the AI judge nor any deterministic check reads both
sides. Nine review rounds passed over R9's; eight passed over R12's. What found them, both times, was
opening the implementation in order to plan against it — which argues for doing that BEFORE the review
rounds rather than after.

**Resolution chosen 2026-08-21**: an ORTHOGONAL field rather than a fifth enum value. Stamp presence
and radius measurability are two independent axes; collapsing them into one enum was the modelling
error that made the contradiction possible. ADR-034's substantive decision (the non-forgeable
`arming_rev` cutoff) is untouched, so it needs an amendment, not a successor.

## 1c. The method was wrong, and that cost six rounds

Eight review rounds ran on this spec. Rounds 2 through 8 EACH found a genuine inconsistency, and each was
fixed in isolation — which guaranteed the next round would find the next one. That is not the judge being
thorough; it is the author using the wrong unit of work.

The AC set here is densely cross-referential: AC-CT-3 and AC-CT-9 share a type, AC-CT-10 references
AC-CT-9, AC-CT-1 references AC-CT-7's rule, AC-CT-4 and AC-CT-9 share a measurement, and the Scope table
plus Migration Plan reference all of them. ⛔ **Changing any referenced thing obliges a sweep of its
referents, and R9 changed a type that four other places referenced.** Fixing them one per review round
was the defect.

What a single closure pass found, once done properly — extract every AC's references to types, symbols and
files, then check each against the post-change contract:

| Found by | Defect |
|---|---|
| escalation | AC-CT-3 still declared the retired four-valued return |
| escalation | AC-CT-3's falsifier was unrepresentable in the new type — unrunnable, but reading as coverage |
| escalation | Scope table missing AC-CT-10's new scan and AC-CT-9(d)'s two edited files |
| **closure pass** | `verify-runner-service.ts` was in NO Scope row, though AC-CT-5 has asserted its seam since the spec was written — a gap predating R9 by the spec's entire life, through seven review rounds |
| **closure pass** | `export-docs-service.ts`, C7's producer side, likewise absent while AC-CT-6 asserts the `corpus_rev` it writes |
| **closure pass** | AC-CT-8 declared TWO skip triggers and exercised ONE — and the second, "the export index is contended", asserts an UNREACHABLE state, because C7's integer-compare form exists precisely so it cannot race that file. The wording was inherited verbatim from QA-5, which predates C7's integer form |

Three of six came from the closure pass, not the judge — including one that had survived the spec's whole
life. ⇒ **The AI judge is good at reading a document; it is not a substitute for computing a closure.**

⛔ Nothing in this repository computes that closure. `lore ac list` prints criteria independently, and the
judge reads them as prose. The sweep here was manual `grep` plus a hand-written extractor, and it is not
repeatable by anyone who does not think to do it.

## 2. Fixing an under-specification can introduce a new one

R7 tightened AC-CT-1's condition (ii) into four enumerated syntactic forms — correct — and then attached "a form outside them is a scan GAP to report, not to pass". The next review round showed that clause has no oracle either: nothing said where a gap is reported or what fails if it is not. Worse, it is **unimplementable in principle**: recognising an unenumerated form is the same act as enumerating it. R8 removed it.

⇒ A revision that adds precision is not automatically a net improvement. The added clause needs the same "what refuses this when violated" test as the clause it replaced.

## 3. The one BLOCKING escalation was a genuine design break, and it was mine

R3 (redeeming the AC-CT-4 advisory) added: "if ANY member of the resolved path set fails to resolve to a concrete EXISTING file, the WHOLE radius classifies `unmeasured`." Two consequences the author did not see and the judge did:

- It introduced a **FIFTH** classification while the Scope table still declared `attestationFloor` consumes "all four classes". The fifth class had no declared gate behaviour and no asserting AC.
- Either resolution collided with a stated goal: refusing `unmeasured` reproduces the mass-wedge outcome N2/G5 reject; accepting it bypasses the staleness mechanism for whatever population lands in the class. **The question is unanswerable without knowing the size of that population** — which nobody had measured.

## 4. So it was measured, and the measurement inverted the design

**Reachability, over all 831 script-mode ACs in this corpus (152 specs, 2026-08-20):**

| Class | Count | Share |
|---|---|---|
| Command yields no path-shaped token at all | 55 | 6% |
| All extracted tokens currently exist | 587 | 70% |
| At least one token does not exist | 189 | 22% |

R3's rule would have classified **29% `unmeasured`** — and that 22% bucket *structurally contains every red-first AC*, including all nine of SPEC-143's own, because a red-first AC's test file is by definition not yet on disk. The rule would have blinded the staleness mechanism precisely for the criteria under active implementation.

**And the premise was false.** Measured on a throwaway git repo the same day:

| pathspec state | `git diff --quiet <rev> HEAD -- <p>` |
|---|---|
| created after `<rev>` | exit 1 |
| deleted after `<rev>` | exit 1 |
| never existed | exit 0 |
| glob matching nothing | exit 0 |

Existence is irrelevant to the comparison's soundness — a created or deleted path is exactly the change a blast radius exists to detect. ⛔ R3 conflated **"the file is not there"** with **"the radius cannot be measured"**. Only the second is a real sink. Switching the test to pathspec VALIDITY dropped `unmeasured` from 29% to 6%.

⇒ The standing rule this repository already carries — *measure a field or command BEFORE pinning an AC to it, because tightening an oracle can destroy it* — was violated while its author was actively writing about under-measurement. Prose does not bind. The judge bound it.

## 5. `lore ac set` has a 2000-character statement ceiling, and it forces a useful split

`acceptance_criteria.N.statement` is capped at 2000 characters; exceeding it exits **4** with the field named. Four drafts were rejected before fitting. The forced split turned out to be the right architecture anyway:

- **statement** = the EXECUTION CONTRACT: the property, the deciding condition, the assertion halves, the controls, the falsifiers, and one compressed revision pointer.
- **spec body** (uncapped) = a dedicated `## Revision Records` section carrying, per revision, the prior form, the exact defect it produced, and why the change is a correction rather than a weakening.

⛔ Do not put the full revision rationale in the statement. It will not fit, and the reader who needs it is reading the spec, not running `lore verify`.

## 6. Declared scan blind spot, recorded so it is not rediscovered

AC-CT-1's RULE 2 guarantees "no second state-to-glyph projection **in four known syntactic shapes**", not "no second projection". The judge named three shapes that pass silently by construction: a glyph reached through a **helper call**, a **Map lookup**, and **string concatenation across variables**. This is a deliberate boundary — the alternative was the unimplementable duty removed in R8 — but AC-CT-1 must be read with that qualifier.

## 7. Operational slips worth not repeating

- **exit code measured through a pipe.** `lore ac set … | tail -20` reported `EXIT=0` on a validation failure, because `$?` was `tail`'s. Re-measured without the pipe: **exit 4**. The tool was correct; the measurement was not. This repository's own discipline names this exact trap, and it was walked into within the same hour of citing it.
- **A count written into a governance doc was false within minutes.** The falsifier-debt paragraph said "All seven criteria carry their falsifier as PROSE"; AC-CT-8 landed and made it a lie. Rewritten to "EVERY criterion on this spec". ⛔ Never pin a literal count next to a set you are still editing.
- **A mermaid node lagged a prior revision by three days.** R1 (2026-08-17) made `stampCurrency` four-valued; the Architecture diagram still rendered three. Caught by the judge's consistency dimension, not by any check. Diagram text is not covered by any oracle in this corpus.

## 7b. The same blindness at the PLAN layer, caught the same way

After the spec finally converged, a plan was cut from it and an independent read-only reviewer audited the
15 tasks. It returned NEEDS_WORK with five findings; four survived verification. Two generalise past this plan:

- **A task that asserts facts about `main` gets dispatched into a worktree unless it says otherwise.** The
  plan's gate task asserted the full dual-runner suite, binary provenance against a rebuilt `dist/lore`, and
  a restored spec status — all properties of the merged main checkout. Nothing in it said "not claimed from a
  worktree", and the plan's own dispatch model says implementers claim inside their own worktree. A cold-start
  implementer would therefore have evaluated main-only assertions against worktree artifacts and reported them
  as speaking for main. ⛔ Any task whose AC names the merged tree must say, in the task, that it is not a
  worktree claim — the dispatch model does not infer it.
- **Red-first evidence without `--ac` is unqueryable.** All seven RED-test tasks instructed
  `lore evidence … --result expected-fail` and none passed `--ac <AC-ID>`, though the flag exists and is
  documented ("references a structured AC id declared on the plan's parent spec"). Recorded that way, the red
  is free prose: "which ACs have an observed-red falsifier" has no field to query. ⛔ This would have
  REPRODUCED the exact residual the spec's own Falsifier-debt section names, inside the plan meant to close it.

A third finding was the familiar shape: the Risk Register claimed "three pairs share files" where enumerating
all 15 tasks' declared anchors returns exactly one. A count in a governance doc with no oracle, again.

⇒ Worth stating plainly: **the author's self-check missed all four at the plan layer too**, immediately after
a session in which it had missed seven at the spec layer. The independent pass is not a luxury applied to
hard documents; it is what substitutes for a mechanism that does not exist.

## 8. What is still unmechanized after this session

- **Falsifier debt.** All nine SPEC-143 criteria carry prose falsifiers ("MANDATORY FALSIFIER once implemented") because `--falsifier-find` requires the literal string on disk while red-first requires the AC first. Nothing counts or forces redemption of these. Needs its own spec; `--falsifier-deferred <reason>` remains the better of the two candidate designs.
- **Diagram/prose drift.** No oracle reads mermaid nodes or component prose against the AC set.
- **AC cross-reference closure.** Nothing computes which criteria reference a changed type, symbol or file,
  so a contract change is propagated by whoever remembers to look. Measured cost this session: six review
  rounds, three defects the judge never reported, one of them older than the change that exposed it.
- **Criterion-to-component contract drift.** Nothing compares a criterion's prose assertion against the
  TYPE SIGNATURE of the component it names — the §1b defect. The AI judge's consistency dimension checks
  symbol and file agreement and reports PASS while the contradiction stands; no deterministic check looks
  at this at all. This is the one failure mode in this session that survived every existing gate.
- **The defect class in §1 itself.** Four occurrences, all caught by an ADVISORY judge whose output is by definition non-binding. A deterministic check — "every AC clause stating a property names the command that decides it" — does not exist, and the AI lint that does exist (`ac_quantifiability`) passed all of the four while flagging only the numeric ones.

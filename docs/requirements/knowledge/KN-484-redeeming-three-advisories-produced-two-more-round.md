---
id: KN-484
type: knowledge
role: knowledge
title: "Redeeming three advisories produced two more rounds of the same defect, and the judge's escalation caught a real design break no self-check did"
status: approved
priority: medium
created: 2026-08-20
updated: 2026-08-21
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

**Resolution chosen 2026-08-21**: an ORTHOGONAL field rather than a fifth enum value. Stamp presence
and radius measurability are two independent axes; collapsing them into one enum was the modelling
error that made the contradiction possible. ADR-034's substantive decision (the non-forgeable
`arming_rev` cutoff) is untouched, so it needs an amendment, not a successor.

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

## 8. What is still unmechanized after this session

- **Falsifier debt.** All nine SPEC-143 criteria carry prose falsifiers ("MANDATORY FALSIFIER once implemented") because `--falsifier-find` requires the literal string on disk while red-first requires the AC first. Nothing counts or forces redemption of these. Needs its own spec; `--falsifier-deferred <reason>` remains the better of the two candidate designs.
- **Diagram/prose drift.** No oracle reads mermaid nodes or component prose against the AC set.
- **Criterion-to-component contract drift.** Nothing compares a criterion's prose assertion against the
  TYPE SIGNATURE of the component it names — the §1b defect. The AI judge's consistency dimension checks
  symbol and file agreement and reports PASS while the contradiction stands; no deterministic check looks
  at this at all. This is the one failure mode in this session that survived every existing gate.
- **The defect class in §1 itself.** Four occurrences, all caught by an ADVISORY judge whose output is by definition non-binding. A deterministic check — "every AC clause stating a property names the command that decides it" — does not exist, and the AI lint that does exist (`ac_quantifiability`) passed all of the four while flagging only the numeric ones.

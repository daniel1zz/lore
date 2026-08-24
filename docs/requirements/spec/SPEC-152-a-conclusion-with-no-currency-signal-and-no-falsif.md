---
id: SPEC-152
type: spec
role: spec
title: "A conclusion with no currency signal and no falsifier: retrieval ranks a superseded claim above the one that replaced it"
status: draft
priority: medium
created: 2026-08-24
updated: 2026-08-24
tags: []
parent: PRD-001
---
# Overview

A conclusion, once written, is never re-decided. This corpus holds 192 conclusion-bearing
documents (154 `retro` + 38 `adr`) joined by **23** `supersedes` edges, and exactly **one**
of them has ever been retracted. Nothing in the write path asks whether a new conclusion
contradicts an old one, nothing in the read path reveals which of two conflicting
conclusions is current, and — decisively — **nothing can turn a conclusion red**, because
the one mechanism that could has never been used.

This is the read-side half of the pair whose write-side half is the requirement-grading
spec. It shares that spec's single `arming_rev`.

## Measured, not inferred (2026-08-24, this corpus)

**M1 — the retrieval projection carries no currency signal.** `SearchHit` (measured, not
recalled) is exactly `{id, slug, title, snippet, score, type, status, created_at,
validity?}`. Two corrections to the obvious reading: `validity` IS present (SPEC-043 D3)
and search already filters invalidated hits by default; and `created_at` is there only
because its own JSDoc says it is needed "so `CorpusService.search`'s
default-invalidated-filter can compute `isInvalidated(hit, now)`". What is absent is
`updated_at`, any ordering axis other than bm25 `score`, and any projection of the
`supersedes` edges that do exist.

**M2 — the failure is reproducible, not hypothetical.** Query `capture attested evidence
provenance`:

| Rank | Score | Doc | Date |
|---|---|---|---|
| 1 | -6.96 | `task-lore-done-s-attestation-refusal-calls-a-capture-source` (archived) | 2026-08-03 |
| 3 | -6.63 | `knowledge-lore-evidence-capture-now-clears-the-attested-floor` | 2026-08-23 |

The rank-1 hit asserts a behaviour of `evidence-capture.ts:329-340` that the rank-3 hit
overturned three weeks later. The `links` table carries NO edge between them (the newer
doc's only edges are `informs` to an ADR and a spec). Nothing in either hit's fields lets
a reader tell which one is current.

**M3 — the write side records no convergence.** 23 `supersedes` edges out of
`knowledge`/`adr`; 32 retracted docs total, of which 11 `assessment`, 10 `handoff`, 10
`task`, and **1 `retro`**. Against 154 live retros.

**M4 — the falsifier exists and has never been wired.** `lore anchor add` accepts a
knowledge doc's `code_anchors` and `DriftCheckService.checkDrift` scans by `type`
parameter — both landed 2026-08-12. Live usage: **`knowledge` 0, `spec` 97.** The same
capability, 97 to 0. The difference is that the spec side has two things demanding it —
a standing rule in `CLAUDE.md` and the `scripts/check-anchor-coverage.ts` ratchet in
`hooks/pre-push` — and the knowledge side has neither. ⛔ The gap is an OBLIGATION, not
a capability; this is the fifth instance of "capability implemented, production wiring
absent" recorded in this repo.

## Goals / Non-Goals

**Goals**

- G1. A conclusion's currency is readable at the retrieval surface, not only by fetching
  and comparing bodies.
- G2. A conclusion that asserts a code fact can be turned RED by a machine when that code
  moves.
- G3. Writing a conclusion that contradicts a live one is refused, or the relationship is
  recorded — never silently added alongside.
- G4. Zero retroactive invalidation of the back-catalogue.

**Non-Goals**

- N1. Not deciding WHICH of two conflicting conclusions is correct. Newer is not truer;
  this spec makes the conflict visible and addressable, never auto-resolves it.
- N2. Not requiring anchors on ledger documents (`handoff | assessment | uat`) — they
  describe one event, not a standing fact.
- N3. Not changing the default invalidated-filter behaviour of `lore search`.
- N4. Not backfilling anchors onto 154 existing retros.

## Design

Dependency order matters and is not the order of discovery: **D1 and D3 are independent;
D2 depends on BOTH.** D2 alone would deadlock — it asks an author to declare what its new
conclusion supersedes, while the author cannot find the old one (D1) and no mechanical
signal says the old one is even about the same code (D3).

**D1 — the retrieval projection gains the three missing signals.** `SearchHit` gains
`updated_at`; `lore search` gains an explicit ordering axis (bm25 stays the default, so
no existing caller changes behaviour); and a hit that is the target of a `supersedes` edge
carries that fact. ⛔ The `supersedes` projection must come from the `links` table in the
SAME query — a second per-hit round trip is the N+1 that SPEC-043 D3 explicitly avoided
when it put `validity` on the hit, and this spec does not reintroduce it.

**D2 — convergence becomes an obligation with a mechanical trigger.** The trigger is
computable, not editorial: when a new conclusion-bearing doc declares `code_anchors` that
INTERSECT the anchors of a live conclusion-bearing doc, the write must declare the
relationship — `supersedes` (the old one is wrong now) or `relates-to` (both hold). An
undeclared intersection is refused with both slugs named. This is why D2 needs D3: the
intersection is computed over anchors, so it is empty and vacuous until anchors exist.

⛔ "Vacuously true" must be distinguishable from "true" here (North Star property 2): a
doc with no anchors trivially intersects nothing, so the refusal must report the anchor
count it compared over, never a bare pass.

**D3 — the knowledge-side ratchet, copied from the spec side.**
`scripts/check-anchor-coverage.ts` is the working prior art and it already solves the hard
part: it asserts that the set of live specs declaring no anchors equals an explicit
allowlist, **in both directions**, so neither a new unanchored doc nor a retract-to-escape
can leave the ratchet silently. Its own header records the measurement (2026-08-17: 151
live specs, 0 unanchored-and-invalidated). D3 extends that same ratchet to the
conclusion-bearing knowledge sub-types. ⛔ Extended, not duplicated — a second ratchet
script would be the two-copies drift shape.

**D4 — which knowledge owes an anchor, decided mechanically.** Two filters, both
computable from the record:

1. **`sub_type`**: `retro | reference | research` bear standing conclusions → owe anchors.
   `handoff | assessment | uat` are ledgers → exempt (N2).
2. **Body asserts a code fact**: the body contains a repo-relative path, a `file:line`,
   or a code symbol → owes anchors.

Filter 2 is a grep-checkable property of the text, not a judgment about importance. It is
the same rule this repo already applies to source comments ("a new comment MUST be written
in a form that can be grep-verified — naming file:line / symbol"), promoted from comments
to conclusion bodies.

**D5 — one shared arming cutoff.** Both obligations arm at the SAME `arming_rev` the
grading spec uses — `MAX(audit.id)` captured once, per
`adr-a-record-with-no-state-stamp-is-acceptable-but-never-green`. Pre-arming conclusions
classify legacy and are accepted; post-arming ones are not. The 154 existing retros are
not backfilled (N4) and not retro-failed.

## Trade-offs

- **T1 — D4's filter 2 will over-select.** A retro mentioning a path only in passing owes
  an anchor it does not really need. Accepted, and deliberately in this direction: an
  unnecessary anchor costs one drift probe, while a missing anchor costs a false
  conclusion riding undetected — measured in this repo at >= 5 days in one case, and 3
  weeks in M2's pair.
- **T2 — D2 can be satisfied cheaply by declaring `relates-to`.** An author who does not
  want to think can always pick the weaker edge. Accepted: `relates-to` still puts the two
  docs one hop apart, which is what M2's pair lacks entirely. Making the choice
  substantive is an AI-judge concern, deliberately out of the deterministic zone.
- **T3 — `updated_at` is a weak currency signal.** A doc edited for a typo looks newer
  than the conclusion that overturned it. Accepted: D1 makes currency VISIBLE, D2/D3 make
  it DECIDABLE; T3 is why this spec does not stop at D1 (see N1).


## Acceptance Criteria (structured)

- [·] [script] AC-CONV-1: SearchHit carries updated_at, and the store issues the SAME number of queries for 1 hit as for 50 — an N+1 regression guard, because SPEC-043 D3 put validity on the hit precisely to avoid a per-hit round trip and this spec must not reintroduce one. Counts queries, does not time them. Covered by describe "search hit carries updated_at with no per-hit round trip" in packages/lore/tests/unit/service/search-currency-projection.test.ts
  script: test — bunx vitest run packages/lore/tests/unit/service/search-currency-projection.test.ts -t 'updated_at with no per-hit round trip' 2>&1 && echo 'AC-CONV-1 PASS: every search hit carried updated_at and the measured store query count was identical for 1 hit and 50 hits'
- [·] [script] AC-CONV-2: Default ordering is UNCHANGED, pinned against a NAMED baseline artifact: packages/lore/tests/fixtures/search-bm25-baseline.json, generated on the merge-base commit BEFORE this spec lands by scripts/record-search-baseline.ts and committed, holding the ordered slug list for 5 fixed queries over a fixed seeded corpus. With no ordering argument the result order matches that fixture element-for-element; the fixture is never regenerated by the same run that asserts against it. The opt-in recency axis orders by updated_at DESC, ties broken by id ASC for determinism. Covered by describe "ordering: bm25 default is fixture-stable, recency axis is opt-in" in packages/lore/tests/unit/service/search-currency-projection.test.ts
  script: test — bunx vitest run packages/lore/tests/unit/service/search-currency-projection.test.ts -t 'ordering' 2>&1 && echo 'AC-CONV-2 PASS: default order matched search-bm25-baseline.json element-for-element across all 5 fixture queries and the opt-in recency axis ordered by updated_at DESC with id ASC tie-break'
- [·] [script] AC-CONV-3: A hit that is the target of a supersedes edge carries that fact, sourced from the SAME SQL as the hit itself. Proven two-sided: a hit with no such edge carries the absence explicitly rather than an omitted key, so "not superseded" is distinguishable from "not measured". Query count invariant to hit count, as in AC-CONV-1. Covered by describe "supersedes projection rides the hit query" in packages/lore/tests/unit/service/search-currency-projection.test.ts
  script: test — bunx vitest run packages/lore/tests/unit/service/search-currency-projection.test.ts -t 'supersedes projection' 2>&1 && echo 'AC-CONV-3 PASS: a superseded hit carried the edge from the same SQL, an unsuperseded hit carried an explicit absence rather than a missing key, and the query count did not grow with hit count'
- [·] [script] AC-CONV-4: The measured M2 failure is regression-locked using the REAL doc pair, not a synthetic one: after a supersedes edge is declared from knowledge-lore-evidence-capture-now-clears-the-attested-floor to task-lore-done-s-attestation-refusal-calls-a-capture-source, a search for the M2 query returns the older hit carrying the superseded signal. Runs against a throwaway corpus seeded with both real bodies, never this repo live .lore/. Covered by describe "M2 regression: the superseded capture claim is labelled" in packages/lore/tests/integration/m2-currency-regression.test.ts
  script: e2e — bunx vitest run packages/lore/tests/integration/m2-currency-regression.test.ts 2>&1 && echo 'AC-CONV-4 PASS: with the real M2 doc pair seeded in a throwaway corpus and the supersedes edge declared, the 2026-08-03 hit came back carrying the superseded signal'
- [·] [script] AC-CONV-5: The ratchet is EXTENDED inside scripts/check-anchor-coverage.ts (asserted: exactly ONE anchor-ratchet script tree-wide), whose documented exit contract is 0 clean / 1 repo-invariant failure / 2 scan failure. A suite spawns it three times against a throwaway corpus and asserts exit codes EXACTLY: baseline 0; after adding an anchor-owing retro with no code_anchors, EXACTLY 1 (never 2, which would mean the scan itself broke and would otherwise read as a successful refusal); after invalidating that same retro, STILL EXACTLY 1, because retracting must not be an escape. Covered by describe "knowledge anchor ratchet holds in both directions" in packages/lore/tests/integration/knowledge-anchor-ratchet.test.ts
  script: test — bunx vitest run packages/lore/tests/integration/knowledge-anchor-ratchet.test.ts 2>&1 && echo 'AC-CONV-5 PASS: exactly one ratchet script tree-wide, baseline exit 0, an unanchored anchor-owing retro drove exit exactly 1 not 2, and invalidating it still exited exactly 1'
- [·] [script] AC-CONV-6: The anchor-owing predicate enumerates all NINE KNOWLEDGE_SUB_TYPES values explicitly, with the verdict declared per value here so no reader has to infer any: OWES anchors = retro, reference, research, skill (each asserts a standing fact about code); EXEMPT = handoff, assessment, uat (ledgers describing one event), ideation (a proposal, not an assertion), prompt (template text). The test iterates KNOWLEDGE_SUB_TYPES itself, so a tenth value added upstream fails until classified. Filter two has a DECLARED recognizer, not prose: (i) repo-relative path = /(?:packages|scripts|hooks|assets|docs)\/[A-Za-z0-9_.\/-]+\.(?:ts|tsx|js|json|md|ya?ml)/; (ii) file:line = that pattern followed by /:\d+/; (iii) code symbol = a backtick-delimited token matching /^[A-Za-z_$][A-Za-z0-9_$]{2,}$/ THAT ALSO resolves to an exported symbol somewhere in the tree, so an ordinary English word in backticks is not mistaken for a symbol. Both polarities asserted per recognizer. Covered by describe "anchor-owing predicate: sub_type layer and body-asserts-code layer" in packages/lore/tests/unit/service/conclusion-convergence.test.ts
  script: test — bunx vitest run packages/lore/tests/unit/service/conclusion-convergence.test.ts -t 'anchor-owing predicate' 2>&1 && echo 'AC-CONV-6 PASS: all nine KNOWLEDGE_SUB_TYPES values were classified explicitly with no default branch, and each of the three declared recognizers matched its positive case and rejected its negative case including a backticked English word that resolves to no exported symbol'
- [·] [script] AC-CONV-7: An undeclared anchor intersection between two conclusion-bearing docs is REFUSED, with the message naming BOTH slugs and the anchor count it compared over. The vacuous case is distinguishable from the true case: a doc with zero anchors intersects nothing and passes, but its pass ALSO reports the compared anchor count, so "compared nothing" never renders as "compared and found nothing". Covered by describe "intersection refusal names both slugs and the compared count" in packages/lore/tests/unit/service/conclusion-convergence.test.ts
  script: test — bunx vitest run packages/lore/tests/unit/service/conclusion-convergence.test.ts -t 'intersection refusal' 2>&1 && echo 'AC-CONV-7 PASS: an undeclared anchor intersection was refused naming both slugs and the compared anchor count, and a zero-anchor vacuous pass reported its compared count too'
- [·] [script] AC-CONV-8: arming_rev has EXACTLY ONE definition tree-wide and THIS spec landing code carries a live READ of it. Scoped deliberately to what this spec alone controls: the sibling grading spec introduces the definition and asserts its own read, so neither spec can be blocked red waiting on the other to land. The shared-ness is protected by the exactly-one-definition half, which BOTH specs assert independently over the same tree — redundant on purpose, since a second cutoff appearing anywhere reddens both. Covered by describe "arming_rev is a single tree-wide definition read by this spec" in packages/lore/tests/unit/service/conclusion-convergence.test.ts
  script: test — bunx vitest run packages/lore/tests/unit/service/conclusion-convergence.test.ts -t 'arming_rev is a single tree-wide definition' 2>&1 && echo 'AC-CONV-8 PASS: arming_rev resolved to exactly 1 tree-wide definition and this spec landing code was measured to read it'
- [·] [script] AC-CONV-9: Every script-mode AC on this spec EXCEPT this one carries all FOUR named falsifier fields — falsifier_path, falsifier_find, falsifier_replace, falsifier_exit_code (as written by lore ac add --falsifier-path/--falsifier-find/--falsifier-replace/--falsifier-exit-code) — and lore verify --falsify drives each mutation to the exit code recorded in THAT AC own falsifier_exit_code field, compared for exact equality. This AC carries no falsifier by construction, not omission: its red state is a corpus condition, and the falsifier mechanism mutates FILES only, so it cannot express a corpus-state mutation. Covered by describe "every script-mode AC declares a reachable falsifier" in packages/lore/tests/integration/falsifier-coverage.test.ts
  script: other — bunx vitest run packages/lore/tests/integration/falsifier-coverage.test.ts 2>&1 && echo 'AC-CONV-9 PASS: every script-mode AC on this spec except AC-CONV-9 carried all four named falsifier fields and verify --falsify reached each AC own declared falsifier_exit_code exactly'

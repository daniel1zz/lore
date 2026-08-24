---
id: SPEC-152
type: spec
role: spec
title: "A conclusion with no currency signal and no falsifier: retrieval ranks a superseded claim above the one that replaced it"
status: approved
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
- **T4 — this spec labels the M2 inversion, it does not correct it.** AC-CONV-2 freezes the
  default bm25 order and N1 refuses to auto-rule which of two conflicting conclusions is
  right, so after this lands the superseded doc may STILL outrank its replacement in the
  measured M2 query. The defect closed is that the rank-1 hit was UNLABELLED, not that it
  was rank 1. ⛔ Do not read AC-CONV-4 as an ordering fix; it asserts the label only, and
  an earlier draft's attempt to also assert "the suite asserts nothing about rank" was
  removed because the absence of an assertion in a test body has no runtime oracle.


## Acceptance Criteria (structured)

- [·] [script] AC-CONV-1: SearchHit carries updated_at, and the store issues the SAME number of queries for 1 hit as for 50 — an N+1 regression guard, because SPEC-043 D3 put validity on the hit precisely to avoid a per-hit round trip and this spec must not reintroduce one. Counts queries, does not time them. Covered by describe "search hit carries updated_at with no per-hit round trip" in packages/lore/tests/unit/service/search-currency-projection.test.ts
  script: test — bunx vitest run packages/lore/tests/unit/service/search-currency-projection.test.ts -t 'updated_at with no per-hit round trip' 2>&1 && echo 'AC-CONV-1 PASS: every search hit carried updated_at and the measured store query count was identical for 1 hit and 50 hits'
- [·] [script] AC-CONV-2: Default ordering is UNCHANGED, pinned against a NAMED artifact: packages/lore/tests/fixtures/search-bm25-baseline.json, holding the ordered slug list for 5 fixed queries over a fixed seeded corpus, generated on the merge-base commit BEFORE this spec lands by the SEPARATE entrypoint scripts/record-search-baseline.ts. With no ordering argument the result order matches that fixture element-for-element. The never-regenerated-in-the-asserting-run rule has a concrete oracle: the suite computes the fixture SHA-256 before and after its assertions and requires equality, and asserts the recorder module is absent from the import graph reachable from the suite — so a suite that regenerates its own baseline fails on the hash, and one that imports the recorder fails on the graph. The opt-in recency axis orders by updated_at DESC, ties broken by id ASC. Covered by describe "ordering: bm25 default is fixture-stable, recency axis is opt-in" in packages/lore/tests/unit/service/search-currency-projection.test.ts
  script: test — bunx vitest run packages/lore/tests/unit/service/search-currency-projection.test.ts -t 'ordering' 2>&1 && echo 'AC-CONV-2 PASS: default order matched search-bm25-baseline.json element-for-element across all 5 queries, the fixture SHA-256 was identical before and after the run, the recorder was absent from the suite import graph, and the recency axis ordered by updated_at DESC with id ASC tie-break'
- [·] [script] AC-CONV-3: A hit that is the target of a supersedes edge carries that fact, sourced from the SAME SQL as the hit itself. Proven two-sided: a hit with no such edge carries the absence explicitly rather than an omitted key, so "not superseded" is distinguishable from "not measured". Query count invariant to hit count, as in AC-CONV-1. Covered by describe "supersedes projection rides the hit query" in packages/lore/tests/unit/service/search-currency-projection.test.ts
  script: test — bunx vitest run packages/lore/tests/unit/service/search-currency-projection.test.ts -t 'supersedes projection' 2>&1 && echo 'AC-CONV-3 PASS: a superseded hit carried the edge from the same SQL, an unsuperseded hit carried an explicit absence rather than a missing key, and the query count did not grow with hit count'
- [·] [script] AC-CONV-4: The M2 signal failure is regression-locked on the REAL doc pair: with a supersedes edge declared from knowledge-lore-evidence-capture-now-clears-the-attested-floor to task-lore-done-s-attestation-refusal-calls-a-capture-source, searching the M2 query in a throwaway corpus seeded with both real bodies returns the 2026-08-03 hit CARRYING the superseded signal. That label is the entire assertion; the scope this AC deliberately does NOT cover — ordering — is documented in the Trade-offs section as T4, not here. Never writes to this repo live .lore/. Covered by describe "M2 regression: the superseded capture claim is labelled" in packages/lore/tests/integration/m2-currency-regression.test.ts
  script: e2e — bunx vitest run packages/lore/tests/integration/m2-currency-regression.test.ts 2>&1 && echo 'AC-CONV-4 PASS: with the real M2 pair seeded and the supersedes edge declared, the 2026-08-03 hit came back carrying the superseded signal'
- [·] [script] AC-CONV-5: The ratchet is EXTENDED inside scripts/check-anchor-coverage.ts, never duplicated. An anchor-ratchet script is RECOGNIZED as a file under scripts/ whose content references the ledger path constant LEDGER_RELATIVE_PATH — not a filename glob — and the tree holds exactly ONE. A suite spawns it three times against a throwaway corpus asserting EXACT literal codes 0, 1, 1: baseline 0; after adding an anchor-owing retro with no code_anchors, EXACTLY 1 (never 2, which means the scan itself broke and would otherwise read as a successful refusal); after invalidating that same retro, STILL EXACTLY 1, because retracting must not be an escape. ⛔ The three literals are hardcoded in the suite with a comment citing the exit contract in that script module header and its exported main @returns tag. An earlier draft of this AC required the suite to PARSE those numbers out of the prose contract instead; that was removed deliberately — comment text has no parse oracle, so "read from the contract" could never be distinguished from "hardcoded" by any declared check, and rewording the header would silently change the oracle. Covered by describe "knowledge anchor ratchet holds in both directions" in packages/lore/tests/integration/knowledge-anchor-ratchet.test.ts
  script: test — bunx vitest run packages/lore/tests/integration/knowledge-anchor-ratchet.test.ts 2>&1 && echo 'AC-CONV-5 PASS: exactly one LEDGER_RELATIVE_PATH-referencing ratchet script tree-wide, and the three spawns exited exactly 0, 1 and 1 with the refusal never 2'
- [·] [script] AC-CONV-6: The anchor-owing predicate enumerates all NINE KNOWLEDGE_SUB_TYPES values (packages/core/src/types.ts) explicitly: OWES = retro, reference, research, skill; EXEMPT = handoff, assessment, uat (ledgers describing one event), ideation (a proposal, not an assertion), prompt (template text). The test iterates KNOWLEDGE_SUB_TYPES itself, so a tenth value fails until classified. Filter two uses three DECLARED recognizers: (i) repo-relative path = /(?:packages|scripts|hooks|assets|docs)\/[A-Za-z0-9_.\/-]+\.(?:ts|tsx|js|json|md|ya?ml)/; (ii) file:line = (i) followed by /:\d+/; (iii) code symbol = a backtick-delimited token matching /^[A-Za-z_$][A-Za-z0-9_$]{2,}$/ that ALSO resolves to a line matching /^\s*export\s+(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+<token>\b/m. The AUTHORITATIVE scope for (iii) is the enumerated glob packages/**/*.ts, packages/**/*.tsx, scripts/**/*.ts excluding **/*.test.ts and **/*.test.tsx. The suite asserts that glob EQUALS the file set read by buildImportGraph — LOCATED, so the referent is not floating: exported from @lore/core once the sibling grading spec D2 moves it there, and from scripts/changed-tests.ts until then; the suite imports whichever exists and fails if neither does. That equality is a HARD FAILURE on divergence, never a warning that proceeds. Both polarities asserted per recognizer. Covered by describe "anchor-owing predicate: sub_type layer and body-asserts-code layer" in packages/lore/tests/unit/service/conclusion-convergence.test.ts
  script: test — bunx vitest run packages/lore/tests/unit/service/conclusion-convergence.test.ts -t 'anchor-owing predicate' 2>&1 && echo 'AC-CONV-6 PASS: all nine KNOWLEDGE_SUB_TYPES classified with no default branch, each recognizer matched its positive and rejected its negative, and the authoritative glob was asserted EQUAL as a hard failure to the located buildImportGraph file set'
- [·] [script] AC-CONV-7: An undeclared anchor intersection between two conclusion-bearing docs is REFUSED, the refusal naming BOTH slugs and the count of anchors compared. The vacuous case is distinguishable from the true case on a NAMED observable, not by tone: both the refusal and the pass emit a structured field compared_anchor_count in the --json payload, and the suite asserts it is 0 on a zero-anchor doc and equal to the real intersection size otherwise. A pass with the field absent FAILS — "compared nothing" must never render identically to "compared and found nothing", which is the vacuity North Star property 2 forbids. Covered by describe "intersection refusal names both slugs and the compared count" in packages/lore/tests/unit/service/conclusion-convergence.test.ts
  script: test — bunx vitest run packages/lore/tests/unit/service/conclusion-convergence.test.ts -t 'intersection refusal' 2>&1 && echo 'AC-CONV-7 PASS: an undeclared intersection was refused naming both slugs, compared_anchor_count was present and correct on both the refusal and the pass paths, and a zero-anchor doc reported 0 rather than omitting the field'
- [·] [script] AC-CONV-8: arming_rev has EXACTLY ONE definition tree-wide and THIS spec landing code LIVE-CONSUMES it per the grading spec D2b. The SUBJECT is named, not left to the implementer: the consumer is packages/lore/src/service/conclusion-convergence.ts. Structural half: the import graph contains an edge from that named module to the module holding the single arming_rev definition. Behavioural half: this AC declared falsifier, driven by lore verify --falsify, must yield exactly the recorded falsifier_exit_code, and ⛔ falsifier_path MUST EQUAL the file holding that single definition, so the mutation cannot target an unrelated file. The observable is the stamp classification verdict on packages/lore/tests/fixtures/arming-cutoff-fixture.json, whose single pre-cutoff record reads legacy before the mutation and armed after. ⛔ The four field VALUES cannot be inlined at authoring time because the definition site does not exist until this spec lands; their non-emptiness and literal-1 code are owned by AC-CONV-9 and their target by the falsifier_path equality above, so each of the three drift modes — empty fields, arbitrary code, mutation aimed elsewhere — has an owner. A bare grep is NOT an accepted recognizer. The exactly-one-definition half is asserted independently by BOTH specs over the same tree. Covered by describe "arming_rev is a single tree-wide definition live-consumed here" in packages/lore/tests/unit/service/conclusion-convergence.test.ts
  script: test — bunx vitest run packages/lore/tests/unit/service/conclusion-convergence.test.ts -t 'arming_rev is a single tree-wide definition' 2>&1 && echo 'AC-CONV-8 PASS: exactly 1 tree-wide arming_rev definition, an import-graph edge from conclusion-convergence.ts to it, falsifier_path equal to the definition file, and the mutation flipped arming-cutoff-fixture.json from legacy to armed at the declared code'
- [·] [script] AC-CONV-9: Every script-mode AC on this spec EXCEPT this one carries all FOUR named falsifier fields — falsifier_path, falsifier_find, falsifier_replace, falsifier_exit_code — and lore verify --falsify drives each mutation to the exit code recorded on THAT AC, compared for exact equality. The quantified set is bounded from BOTH sides: the suite asserts the set it verified EQUALS this spec script-mode AC records minus this one (same cardinality AND same ids) and prints it, so a run that verified one AC and short-circuited FAILS rather than passing a non-emptiness check. ⛔ The recorded code is CONSTRAINED to a LITERAL per oracle family, not a phrase: vitest assertion-failure = 1 (crash = 2 or above); a repo check script on the check-anchor-coverage.ts contract, assertion-failure = 1 (scan-failure = 2). The families are a CLOSED set; an AC naming any oracle outside it FAILS until that family and its two literal codes are added here. Both families assert-fail at 1, so the suite asserts every recorded code is exactly 1 and never 2 or above. Without this an implementer could record whatever code the mutation happens to produce; and a mutation that makes the tool DIE proves the rule never ran, measured here as zero discriminating power. script-mode is DEFINED as the AC record mode field equal to the literal "script". This AC carries no falsifier by construction: its red state is a corpus condition and the mechanism mutates FILES only. Covered by describe "every script-mode AC declares a reachable, assertion-level falsifier" in packages/lore/tests/integration/falsifier-coverage.test.ts
  script: other — bunx vitest run packages/lore/tests/integration/falsifier-coverage.test.ts 2>&1 && echo 'AC-CONV-9 PASS: the verified set was asserted equal in cardinality and ids to this spec script-mode ACs minus AC-CONV-9, every member carried all four falsifier fields naming an enumerated family, every recorded code was exactly 1, and verify --falsify reached each exactly'

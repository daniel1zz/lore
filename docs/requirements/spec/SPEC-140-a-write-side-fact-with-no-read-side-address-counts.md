---
id: SPEC-140
type: spec
role: spec
title: "A write-side fact with no read-side address: counts with no member list, a doc type with no drift oracle, and a taxonomy with no filter"
status: approved
priority: medium
created: 2026-08-11
updated: 2026-10-10
tags: []
---
# Overview

Three facts this corpus records on the WRITE side are unreachable from the READ side,
measured by a downstream consumer on 2026-08-10/11. In each case the mechanism exists,
the data exists, and no query returns it — so a real, actionable signal renders as an
unactionable number or as nothing at all.

Shared shape: **a count with no member list, a doc type with no drift oracle, and a
taxonomy with no filter are the same defect — a fact admitted at write time that no
read surface can address.** This repo has already mechanized the first of the three
once (`lore status --enumerate <field>`, AC-FR-5: "a new `*_count` field with no
registered enumerator is refused by name"); `lore trace stats` is the surface that
mechanization never reached.

## Measured, not inferred

**G1 — `lore trace stats` reports two counts with no member list.** All-time run on a
consumer corpus: `Zero-hit searches: 20`, `Never-read docs: 168`, against a live
population of 276 docs (≈61% never read, ≈30% of searches returning nothing).
`--json`'s top-level keys are exactly `since / counts_by_kind / deny_by_checkpoint /
zero_hit_search_count / never_read_docs_count / deny_retry_gap` — no ids, no queries,
no flag to obtain them. Knowing 168 docs were never read supports no action:
archiving, rewriting, and "this one was SUPPOSED to be read" are all undecidable
without the list. `TraceStatsService` obtains both numbers from dedicated counting
store methods (`countTraceZeroHitSearches` / `countNeverReadDocs`,
`trace-stats-service.ts:93-94`), so today the count is not even derived from a list
that could be printed.

**G2 — `knowledge` cannot declare code anchors, so a domain-fact document's
assertions about code have ZERO drift detection.** `lore anchor add` refuses any
target that is not a task or a spec (`commands/anchor.ts:139`, "Expected a task or
spec document"), and `DriftCheckService.checkDrift` scans `findMany({type: "spec"})`
only (`drift-check-service.ts:117`). Cost, measured in the consumer's corpus: a
`knowledge` document declaring itself a MANDATORY pre-read for any "may this security
be traded" logic asserted that three market-data adapters all hardcode `null` for the
suspension signal. A census on 2026-08-11 FALSIFIED it (two adapters expose the
signal, n=4896, zero exceptions). The false assertion rode for ≥5 days with no
mechanism able to notice, and contributed to a Critical product defect passing two
UAT rounds green. Structural observation: the team files domain FACTS as `knowledge`
because a fact has no implementation plan — and `knowledge` is precisely the type
with no anchors and no drift check, while `spec`, which has both, semantically
demands an implementation plan a pure fact cannot supply.

**G3 — `knowledge` sub-types are unreachable as a retrieval filter.** `lore create
knowledge --sub-type` accepts 9 values (`ideation | retro | research | reference |
assessment | prompt | skill | handoff | uat`); neither `lore list` nor `lore search`
has a `--sub-type` flag (`--help` of both read in full). A domain-fact table is
therefore indistinguishable at the retrieval surface from 27+ handoffs and a pile of
retros/assessments; the consumer located G2's document by full-text search on
remembered content, not by navigation.

⚠ **Correction to the incoming report, recorded because the corpus must not inherit a
false premise.** The report asserted `lore list --type knowledge --json` returns
records with no `sub_type` field at all. That is FALSE on the current binary: every
record carries `meta: {t: "knowledge", sub_type: "<value>"}` — `deriveTypeMeta`
(`packages/core/src/doc-type-meta.ts:112`) parses it and `CorpusService.list`
attaches it (`corpus-service.ts:647,660`). Verified by direct run against this repo's
own corpus. The projection half of G3 is already closed; only the FILTER half is
open, and this spec fixes only what is actually broken.

# Scope

In scope — three mechanisms, each landing on a surface that ships:

- **M1 — every count `lore trace stats` reports is DERIVED from a member list that
  the same command can print.** `lore trace stats --enumerate <field>` mirrors
  `lore status --enumerate`'s contract exactly: a registry maps each `*_count` field
  to an enumerator, the count is `list.length` rather than a separately-tallied
  number, and an unregistered field name is refused BY NAME rather than silently
  returning nothing. Both existing counts (`zero_hit_search_count`,
  `never_read_docs_count`) are registered. Zero-hit enumeration honours the existing
  `--raw-queries` privacy boundary: without it, rows are returned WITHOUT literal
  query text.
- **M2 — `knowledge` may declare `code_anchors`, and `--check-drift` scans them.**
  `lore anchor add|rm|list` accepts a `knowledge` target with the spec grammar
  (`path[#Symbol]`); `knowledgeExtraSchema` gains the typed optional field;
  `DriftCheckService.checkDrift` scans knowledge alongside spec and reports the
  knowledge population separately, so a drift report can never imply it covered
  knowledge when it did not. All 9 sub-types are eligible — a retro's claim about
  code is exactly as falsifiable as a reference table's.

  **Declared field contract.** `DriftCheckResult` gains `knowledge_checked: number`,
  mirroring the existing `specs_checked` exactly (count of non-deleted KNOWLEDGE docs
  declaring ≥1 `code_anchors` entry). `DriftRow.spec_slug` is RENAMED to `doc_slug`
  and gains a REQUIRED `doc_type` field, so a knowledge breach can never be read as a
  spec breach; every consumer is updated in the same change and a repo-wide search for
  the old `spec_slug` spelling must return zero hits — ⛔ the two spellings are never
  allowed to coexist, which is the SSOT failure mode this repo has already paid for
  three times. `armed`/`consistent` keep their meaning over the UNION of both
  populations.
- **M3 — `--sub-type <v>` filters `lore list` and `lore search`, applied IN THE
  STORE QUERY.** ⛔ Not a post-filter in the service or the adapter: `lore list`
  already offers `--limit`/`--offset` over a stable sort, and filtering after the
  window would silently return fewer than `--limit` rows while more matches existed
  beyond the offset. The predicate therefore lands in `StoreInterface.findMany`'s
  filter set and is implemented by all three stores (SQLite, Turso, InMemory).
  Combining `--sub-type` with a `--type` other than `knowledge` is a usage error
  (exit 2), named — silently returning zero rows would be the same class of
  unactionable answer this spec exists to remove.

# Out of scope

- Advising at `lore create knowledge` time that content mentioning code paths should
  have been a spec (the reporter's D4 option 2). A regex over prose would fire on
  every retro that quotes a filename — a heuristic with a high false-positive rate
  installed at a write gate produces bypass habits, and M2 removes the need for it:
  a fact document can now carry a real anchor and be checked.
- A new doc type for "pure factual assertion" (D4 option 3). M2 makes the existing
  type sufficient; a new type would need parent-contract, lifecycle, gate, and
  mirror wiring for no reachable benefit.
- The `feed`-vs-ad-hoc-`get` consumption ratio (reporter's D3.4, `feed` at 3.6% of
  reads). An observation about how agents behave, with no defect in the tool it
  measures.
- Enumerators for `deny_by_checkpoint` / `counts_by_kind`: these already ship their
  member breakdown as the field's own value, so they are not counts-without-lists.

# Acceptance Criteria

Structured, machine-checkable criteria are declared via `lore ac add` — see
`lore get <this spec> --json`. Prose summary of what each oracle must be able to
observe going RED:

1. `--enumerate never_read_docs_count` returns exactly as many ids as the count
   reports, and the count is read from that list's length.
2. An unregistered `--enumerate` field name is refused naming the known fields.
3. `--enumerate zero_hit_search_count` withholds literal query text unless
   `--raw-queries` is also passed.
4. `lore anchor add <knowledge-doc> <path#Symbol>` stores the anchor, and
   `lore status --check-drift` reports a missing-file breach for it — with a control
   proving the same run stays clean when the file exists.
5. `lore list --type knowledge --sub-type retro --json` returns only retros, and the
   same query with `--limit 1 --offset 1` returns the SECOND retro rather than a row
   dropped by a post-window filter.
6. `--sub-type` with `--type spec` exits 2 naming the conflict.


## Acceptance Criteria (structured)

- [⚑] [script] AC-RR-1: lore trace stats --enumerate never_read_docs_count returns EXACTLY the expected never-read doc id set over a fixture corpus of at least three docs with at least two never read, and the reported never_read_docs_count equals that returned list's length.
  script: test — bun test packages/lore/tests/integration/cli/trace-enumerate-never-read.bun.test.ts 2>&1 && echo "AC-RR-1 PASS: the never-read count is derived from an enumerable member list whose ids match exactly"
- [⚑] [script] AC-RR-2: An unregistered enumerate field name on lore trace stats exits with code exactly 4 and names both registered fields in its refusal — never a silent empty result.
  script: test — bun test packages/lore/tests/integration/cli/trace-enumerate-unregistered.bun.test.ts 2>&1 && echo "AC-RR-2 PASS: an unregistered enumerate field is refused by name with exit exactly 4"
- [⚑] [script] AC-RR-3: Enumerating zero_hit_search_count WITHOUT --raw-queries omits the fixture's distinctive literal query string from the output entirely, and the same enumeration WITH --raw-queries includes it — both directions asserted in one run.
  script: test — bun test packages/lore/tests/integration/cli/trace-enumerate-zero-hit-privacy.bun.test.ts 2>&1 && echo "AC-RR-3 PASS: zero-hit enumeration honours the raw-queries privacy boundary in both directions"
- [⚑] [script] AC-RR-4: A knowledge doc's code anchor pointing at a MISSING path makes lore status --check-drift exit with code exactly 3, and the emitted drift row carries doc_type 'knowledge' with doc_slug equal to that doc plus the missing path; the CONTROL run, with the anchored file and symbol present, exits exactly 0 with zero drift rows attributed to doc_type 'knowledge' while knowledge_checked stays 1 — so the control discriminates the knowledge-anchor path itself, not global corpus cleanliness.
  script: test — bun test packages/lore/tests/integration/cli/knowledge-code-anchor-drift.bun.test.ts 2>&1 && echo "AC-RR-4 PASS: a knowledge code anchor enters --check-drift and the check discriminates present from missing"
- [⚑] [script] AC-RR-5: lore list --type knowledge --sub-type retro --json returns only retro-sub-typed docs, and the same query with --limit 1 --offset 1 returns the SECOND retro of the filtered set — proving the predicate is applied in the store query rather than after the pagination window.
  script: test — bun test packages/lore/tests/integration/cli/list-sub-type-filter.bun.test.ts 2>&1 && echo "AC-RR-5 PASS: sub_type filters in the store query, so limit/offset paginate the filtered set"
- [⚑] [script] AC-RR-6: A sub-type filter passed with --type spec, and one passed with no --type at all, BOTH exit with code exactly 2 and name the conflict — never a silently empty result set.
  script: test — bun test packages/lore/tests/integration/cli/list-sub-type-usage-error.bun.test.ts 2>&1 && echo "AC-RR-6 PASS: a sub-type filter outside --type knowledge is refused by name with exit exactly 2"
- [⚑] [script] AC-RR-7: lore search over a fixture corpus where retro and handoff docs both match the query returns only the retro when the sub-type filter is retro, and both without it — the same two-sided discrimination AC-RR-5 asserts for list.
  script: test — bun test packages/lore/tests/integration/cli/search-sub-type-filter.bun.test.ts 2>&1 && echo "AC-RR-7 PASS: search discriminates by sub_type and returns the unfiltered superset without the filter"
- [⚑] [script] AC-RR-8: DriftCheckResult carries knowledge_checked as its own field: on a fixture corpus with N knowledge docs of which zero declare code_anchors, knowledge_checked equals exactly 0 while specs_checked keeps its own independent value; after one of those N declares an anchor, knowledge_checked equals exactly 1 — and a repo-wide search finds zero remaining occurrences of the retired DriftRow.spec_slug spelling.
  script: test — bunx vitest run packages/lore/tests/unit/service/drift-population-reporting.test.ts 2>&1 && echo "AC-RR-8 PASS: the drift report names the knowledge scanned population separately from specs"
- [⚑] [script] AC-RR-9: The per-entry code_anchors grammar check lives at the SERVICE layer and is doc-type-agnostic, so every write surface inherits it -- closing the MCP side door at corpus-service.ts create/set that gated the check on type === spec. Driven through the MCP tool handler (lore_create and lore_set, which accept extra directly), never by calling the validator: (a) REFUSAL, both doors -- a knowledge doc carrying a grammar-invalid code_anchors entry is refused with a validation error and stores nothing, asserted by the doc being absent after create and by the target extra being byte-identical (SHA compared) before and after set; (b) CONTROL, the discriminator -- the SAME MCP door with a grammar-VALID knowledge entry is ACCEPTED and the stored entry is returned by extractParsedCodeAnchors, so the oracle can fail for a check that refuses everything as well as for one that refuses nothing; (c) the pre-existing spec-doc refusal through the same door is unchanged.
  script: test — bunx vitest run packages/lore/tests/unit/adapters/mcp-knowledge-anchor-grammar.test.ts 2>&1 && echo "AC-RR-9 PASS: the code_anchors grammar check is doc-type-agnostic at the service layer and the MCP door inherits it, with a valid-entry control"
- [⚑] [script] AC-RR-10: The drift row identity is doc-flavoured end to end, and the two spellings never coexist. ONE vitest file carries three halves. (a) BEHAVIOUR at the service: a DriftCheckService run over a fixture where a KNOWLEDGE doc breaches emits a row whose doc_id and doc_status equal that knowledge doc id and status (alongside doc_slug/doc_type), and a spec breach in the SAME run keeps its own values -- so a rename that hard-codes one doc type goes RED. (b) PRODUCTION RENDER, not implementation only: the drift renderers actually shipped -- renderDriftRepairHint in flows/drift-flow.ts and the row renderer in adapters/cli/commands/status.ts -- are called with that knowledge row and their output is asserted, so a rename that stops at the type definition leaves the render red. (c) CENSUS in the same file over packages/core/src, packages/lore/src and both test trees: ZERO WORD-BOUNDARY occurrences of the retired DriftRow spellings spec_id, spec_status and spec_slug (word-boundary anchored so unrelated identifiers such as shared_fake_parent_spec_id are not false hits), and ZERO occurrences of the residual note that recorded the gap (the literal phrase keep their historical SPEC-045 names) -- the note documenting a gap dies in the same change as the gap.
  script: test — bunx vitest run packages/lore/tests/unit/service/drift-row-doc-identity.test.ts 2>&1 && echo "AC-RR-10 PASS: drift rows carry doc_id/doc_status through service and both shipped renderers, and no spec-flavoured spelling survives"

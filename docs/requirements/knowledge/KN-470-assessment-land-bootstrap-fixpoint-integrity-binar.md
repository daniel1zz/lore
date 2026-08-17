---
id: KN-470
type: knowledge
role: knowledge
title: "Assessment: Land bootstrap fixpoint integrity: binary provenance, the anchor-coverage ratchet, and mirror content drift (2026-08-17)"
status: approved
priority: medium
created: 2026-08-17
updated: 2026-08-17
tags: []
parent: PLAN-121
links:
  - {id: PLAN-121, type: informs}
---
# Assessment: met (84/100)

Scope: plan `01KZQF85CB7MW3Y07ZFAVZJ2SY`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-BFI-1 | 88 | Two expected-fail rows include the exact RED (b) constant-sha case ('expected abcdef012… to be b2e8a9de…'), proving the equality-to-real-HEAD oracle discriminates. Green run 22/22. Test file itself not shown in diff, so assertion detail unverified. | 01KZQF9ZPPRHX1WX3SK6XH4PQY (expected-fail [2] shows constant-sha inequality; pass [5]/[8]) |
| AC-BFI-2 | 88 | Expected-fail rows show dev-synced/dev-stale green while the not-a-dev-checkout case failed, then all 7 green. Service code pins exact exits 0/3/0 via BINARY_PROVENANCE_EXIT_CODES with branch order documented. Integration test body unseen. | 01KZQF9ZPPRHX1WX3SK6XH4PQY ([3][4] expected-fail, [6][9] pass) |
| AC-BFI-3 | 92 | Segment-level red recorded (grep count 0), plus the declared one-copy-only red showing the parity diff failing, then green with grep count 2 and byte-identity holding. Manual pre-push run demonstrates real dev-stale exit 3 wiring. | 01KZQF9ZW1WHA0QX4STDZA9ZCG ([1][2][3] expected-fail incl. parity break; [4][5][9] pass) |
| AC-BFI-4 | 90 | RED (b) truncated-list case is explicitly evidenced ('count=3, printed 2 member(s)'), then 7/7 green. Diff shows code_anchor_specs registered in COUNT_FIELD_ENUMERATORS with count derived from members.length plus a loud cross-check against countArmedSpecs. | 01KZQFB1HZ159ZMAAM443Y0XNV ([1][2] expected-fail, [3][6] pass; status.ts diff) |
| AC-BFI-5 | 78 | Checker green on the real corpus and the visible ratchet suite exercises delete-row and reason='tbd' paired reds by name plus boundary cases. But the task's only expected-fail row carries ac_ref=(none) and 233 bytes of tail, so the red for AC-BFI-5 is weakly attributed. | 01KZQFA01A00XMT1RPYD4NGG4C ([1] expected-fail ac_ref=(none); [5][6][10] checker pass; ratchet test file in diff) |
| AC-BFI-6 | 85 | Visible test shows the paired transition on a throwaway lore-init corpus: unledgered spec exits exactly 1 naming the slug, one row added makes the identical run exit 0, with cohort and duplicate negatives. Red row for this AC is only the ac_ref=(none) 233-byte entry. | 01KZQFA01A00XMT1RPYD4NGG4C ([3][11] pass; anchor-coverage-ratchet.test.ts RED PAIRED case) |
| AC-BFI-7 | 80 | Green runs name the reverse-direction paired case explicitly (anchors declared on a ledgered spec exits exactly 1; row removed exits 0) plus an excluded-failure regression test. Test file omitted from diff, and no AC-specific expected-fail row exists. | 01KZQFA01A00XMT1RPYD4NGG4C ([4][12] pass, test titles quote the paired transition) |
| AC-BFI-8 | 92 | Three distinct expected-fail rows map to the baseline, RED (a) self-repairing check, and RED (c) forced exporter interleave, then 6/6 green twice (worktree and repo root). Both attested. Test file omitted but evidence commands name each red precisely. | 01KZQFB1VDS3HYFCD83BPYE3VT ([1][2][3] expected-fail; [4][7] pass; export-docs-service dryRun guard note) |
| AC-BFI-9 | 90 | Segment red (grep 0) and the one-copy-only parity red both recorded, then green with grep count 3 and byte-identity. Parity suite extended with an AC-BFI-9 invocation assertion, and a 13-test behavioural pre-push trip suite passes. | 01KZQFB1PQ7AFSC6MZZJX53F18 ([1][2] expected-fail; [3][4][6][7] pass) |
| AC-BFI-5 | 78 | Duplicate entry retained for the ledger AC: set-equality is asserted via entries.length == reported unanchored plus exit 0 covering both directions, which is a cardinality proxy rather than a direct set comparison in the visible test. | 01KZQFA01A00XMT1RPYD4NGG4C (HAPPY case asserts shipped.entries.length === unanchored) |

## Gaps

- The ledger/ratchet task's only expected-fail row has ac_ref=(none) and a 233-byte tail, so the red-first requirement for AC-BFI-5, AC-BFI-6 and AC-BFI-7 rests on an unattributed, uninspectable run. The plan's definition of done requires an expected-fail row recorded by the observing agent per task; here one row must cover three ACs and names none of them. Files: packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts.
- AC-BFI-5 demands set equality against the freshly measured unanchored set. The visible HAPPY case asserts only cardinality (shipped.entries.length === the checker's self-reported unanchored count) and leans on exit 0 to cover both directions; a slug-level set comparison is never performed in packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts, so a same-size but mismatched ledger is caught only by the checker itself.
- The parity suite documents, as measured, that a change set of exactly hooks/pre-push and assets/project/pre-push selects zero tests under bun run test:changed, so the wiring oracle is reached only by a deliberate or full-suite run. Protection today is the selector's loud-zero refusal, not coverage; closing it requires a change to scripts/changed-tests.ts.
- AC-BFI-3 carries an oracle=manual pass whose command uses a placeholder path (PATH=<worktree>/dist:$PATH sh hooks/pre-push), so the strongest end-to-end demonstration of the pre-push trip is not reproducible as recorded, and the full-suite pass on that task is likewise a manual, non-captured row.
- No knowledge docs are linked (0 captured), yet the diff records several measured, non-obvious findings only as source comments: the /$bunfs/ compiled-binary discriminator measurement, the concurrent sibling exporter that rewrites the mirror tree during an ordinary test run, and the verdict-line ordering needed for the 4000-byte evidence tail window.

## Recommendations

- Require each AC to carry its own expected-fail row with a non-truncated tail before a multi-AC task can be marked done; reject rows whose ac_ref is (none) as red-first evidence.
- Add a follow-up task to make scripts/changed-tests.ts select the pre-push parity suite when hooks/** or assets/** change, replacing the loud-zero refusal with real selection.
- Capture the three measured findings documented only in code comments as knowledge docs linked to this plan.
- Have AC-BFI-5's oracle assert a slug-level set comparison between the ledger and the freshly measured unanchored set, not a count comparison.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 170670ms
- Retried: true
- Truncated sections: task:task-compare-mirror-bodies-against-corpus-content-in-the-spec, diff:packages/lore/tests/unit/scripts/anchor-coverage-stale-exemption.test.ts, diff:scripts/anchor-coverage-ledger.json, diff:scripts/check-anchor-coverage.ts, diff:scripts/anchor-coverage-ledger.json, diff:packages/lore/tests/integration/binary-provenance-check.test.ts, diff:packages/lore/tests/unit/status/binary-provenance.test.ts, diff:scripts/build.ts, diff:.gitignore, diff:assets/project/pre-push, diff:hooks/pre-push, diff:packages/lore/tests/integration/anchor-coverage-surface.test.ts, diff:assets/project/pre-push, diff:hooks/pre-push, diff:packages/lore/tests/integration/pre-push-binary-provenance-trip.bun.test.ts, diff:scripts/export-spec-mirror-core.ts, diff:scripts/export-spec-mirror.ts, diff:scripts/tests/spec-mirror-content-drift.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 89 | 0.75 | evidence | All 9 ACs have passing oracle runs; diff shows real service-layer provenance, enumerator registration on the existing seam, and pre-push wiring in both copies with manifest regen. |
| evidence_integrity | 74 | 0.7 | evidence | Strong paired reds for BFI-1/2/3/4/8/9, but only 11 of 51 rows attested (0.20) and the BFI-5/6/7 red is a single 233-byte row with ac_ref=(none). |
| scope_fidelity | 90 | 0.7 | evidence | Changes track the six declared tasks and their anchors. Extras (provenance-missing exit 4, source-run state, CLAUDE.md updates) are documented as derived from AC-BFI-2's three pinned states. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-BFI-6 | The ledger/ratchet task's only expected-fail row has ac_ref=(none) and a 233-byte tail, so the red-first requirement for AC-BFI-5, AC-BFI-6 and AC-BFI-7 rests on an unattributed, uninspectable run. The plan's definition of done requires an expected-fail row recorded by the observing agent per task; here one row must cover three ACs and names none of them. Files: packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts. |
| evidence_integrity | minor | AC-BFI-5 | AC-BFI-5 demands set equality against the freshly measured unanchored set. The visible HAPPY case asserts only cardinality (shipped.entries.length === the checker's self-reported unanchored count) and leans on exit 0 to cover both directions; a slug-level set comparison is never performed in packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts, so a same-size but mismatched ledger is caught only by the checker itself. |
| outcome | minor | AC-BFI-9 | The parity suite documents, as measured, that a change set of exactly hooks/pre-push and assets/project/pre-push selects zero tests under bun run test:changed, so the wiring oracle is reached only by a deliberate or full-suite run. Protection today is the selector's loud-zero refusal, not coverage; closing it requires a change to scripts/changed-tests.ts. |
| evidence_integrity | minor | AC-BFI-3 | AC-BFI-3 carries an oracle=manual pass whose command uses a placeholder path (PATH=<worktree>/dist:$PATH sh hooks/pre-push), so the strongest end-to-end demonstration of the pre-push trip is not reproducible as recorded, and the full-suite pass on that task is likewise a manual, non-captured row. |
| outcome | minor | — | No knowledge docs are linked (0 captured), yet the diff records several measured, non-obvious findings only as source comments: the /$bunfs/ compiled-binary discriminator measurement, the concurrent sibling exporter that rewrites the mirror tree during an ordinary test run, and the verdict-line ordering needed for the 4000-byte evidence tail window. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require each AC to carry its own expected-fail row with a non-truncated tail before a multi-AC task can be marked done; reject rows whose ac_ref is (none) as red-first evidence. | One 233-byte unattributed red currently stands in for the red-first floor of AC-BFI-5/6/7. |
| plan | Add a follow-up task to make scripts/changed-tests.ts select the pre-push parity suite when hooks/** or assets/** change, replacing the loud-zero refusal with real selection. | The wiring ACs' oracles are otherwise reachable only via deliberate or full-suite runs. |
| process | Capture the three measured findings documented only in code comments as knowledge docs linked to this plan. | Knowledge capture is 0 despite non-obvious measurements that future agents will otherwise re-derive. |
| spec | Have AC-BFI-5's oracle assert a slug-level set comparison between the ledger and the freshly measured unanchored set, not a count comparison. | Cardinality equality plus exit 0 is a proxy; a direct set assertion is what the criterion states. |

## Unverifiable Materials

- packages/lore/tests/unit/scripts/anchor-coverage-stale-exemption.test.ts: Omitted from the diff; AC-BFI-7's assertions judged only from evidence test titles and exits.
- packages/lore/tests/integration/binary-provenance-check.test.ts: Omitted; the exactness of the 0/3/0 exit assertions and the skipped-token check judged from evidence tails only.
- packages/lore/tests/unit/status/binary-provenance.test.ts: Omitted; the equality-to-real-HEAD assertion inferred from an expected-fail tail showing the constant-sha mismatch.
- scripts/check-anchor-coverage.ts and scripts/anchor-coverage-ledger.json: Omitted; the reason predicate, cohort derivation and set-equality logic could not be read directly.
- hooks/pre-push and assets/project/pre-push contents: Omitted; wiring judged from grep counts, diff exits and parity-suite assertions rather than the files.
- scripts/tests/spec-mirror-content-drift.test.ts: Omitted; AC-BFI-8's hash-window and exit-code-2 assertions judged from evidence command strings and titles.
- scripts/build.ts provenance injection: Omitted; the define-based embedding is described by the service module header but not shown.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 7
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 9 declared criteria
- Task evidence: 6 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.20

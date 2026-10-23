---
id: KN-474
type: knowledge
role: knowledge
title: "Assessment: Land mirror identifier SSOT: a branded human_id, an idempotent migrate-export seam, and a drift check that writes nothing (2026-08-18)"
status: archived
priority: medium
created: 2026-08-18
updated: 2026-10-23
tags: []
parent: PLAN-125
links:
  - {id: PLAN-125, type: informs}
---
# Assessment: partially_met (78/100)

Scope: plan `01KZR64PCQF99XE5FBK3HHC82K`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-MIS-1 | 92 | Attested pass plus visible diff: :743 now composes formatMirrorHumanId, and the new unit suite seeds an UNPADDED mapping (forcing a real diff), pinning padded old/new_human_id, suggested_file_path, rename_command while asserting new_display stays 'SPEC-1'. Six-dimension coverage incl. dry-run no-wr… | 01KZR66AGMR0Y1VKY0H6S20PTX (evidence [7] attested pass; expected-fail [1] recorded red-first) |
| AC-MIS-2 | 84 | Attested pass; suite hashes export-index.json at three checkpoints on a mkdtemp corpus (asserted non-prefix of REPO_ROOT) via source-mode CLI. Weakness: the declared falsifier (revert :743 → red) is only a prose 'manually confirmed' note, not a permanent control like AC-MIS-5's runExport reverse te… | 01KZR66AGMR0Y1VKY0H6S20PTX (evidence [8] attested pass; [2]/[13] earlier reds) |
| AC-MIS-3 | 82 | Attested vitest pass; output tail shows the new cast-escape rule text naming schemas.ts as the sole sanctioned site. The rule implementation (check-ordinal-write-sites.mjs/.d.mts) and its fixture tests are omitted, so the exact-3 exit code, rule+file:line naming and in-allowlist-0 cases are not dir… | 01KZR66AVXD59BCRMHDA3885ME (evidence [7] attested pass; [1] expected-fail red-first) |
| AC-MIS-5 | 94 | Strongest AC: full test file visible. Throwaway corpus, sha256 snapshot of index + every mirror .md before/after runCheck, two independent drift vectors, plus a REGRESSION reverse control proving runExport DOES change the hashes (comparator non-vacuous). Attested 6-pass run. | 01KZR66B2EZFECVKSQQ55AARXH (evidence [5] attested pass; [1] red-first) |
| AC-MIS-4 | 88 | Attested 10-pass run; diff shows padded pins (SPEC-001, SPEC-001-alpha-decision.md, rename_command) and a self-assertion test reading import.meta.path, slicing at a boundary marker to avoid self-contamination, requiring RE-BASELINE / ordinal.ts:133-145 / 2026-08-10. specB seed change is justified i… | 01KZR66AGMR0Y1VKY0H6S20PTX (evidence [11]/[12] attested pass; [9] earlier inconclusive under the 4-grep command) |
| AC-MIS-6 | 70 | Ends attested-green (typecheck clean across 7 projects + brand suite), and the brand is visibly type-only with one .transform cast in schemas.ts. But a recorded fail [4] and repeated exit-code mis-measurement (task text pinned 'exit exactly 1'), and the AC's own text says the echo fix demoted the s… | 01KZR66AVXD59BCRMHDA3885ME (evidence [5] attested pass; [4] fail; [3] expected-fail) |
| AC-MIS-7 | 72 | One attested pass on the compiled e2e after a fresh build. The AC also requires the suite to self-assert its re-baseline record naming 63164c20 and the padded value; the 1592-byte tail shows only two case names, not that clause, and the file is omitted. AC exists only because prior anchor sets miss… | 01KZRHGRR9RKZ4WFPSFGJMHCFA (evidence [1] attested pass; [2] expected-fail on the stale pins) |

## Gaps

- The plan's Out of Scope section states '⛔ No task in this plan may touch scripts/tests/spec-mirror-export.test.ts', yet scripts/tests/spec-mirror-export.test.ts is listed in the changed-file manifest for this commit. No task evidence or note explains the change.
- .lore/export-index.json (this repo's own corpus artifact) is among the changed files. AC-MIS-5's oracle and the new tests repeatedly promise never to write the repo corpus; the change is plausibly a legitimate mirror export of new spec/plan docs, but nothing in the evidence trail accounts for it.
- mirror-roundtrip-idempotency.bun.test.ts's own header admits a single-doc round trip is a false-negative trap and relies on the mid-migrate checkpoint plus a one-time manual revert of ordinal-migration-service.ts:743 to prove discrimination. Every non-ERROR case seeds already-padded state, so a regression to formatDocDisplayId is caught only by the zero-reconcile assertion, not by a permanent reverse control as in AC-MIS-5.
- The single attested run for AC-MIS-7 has a 1592-byte tail showing two case names only; the AC's second requirement — that the compiled suite self-asserts its re-baseline record naming 63164c20 and the padded value — is not visible in any evidence record, and packages/lore/tests/e2e/migrate-ordinals-compiled.bun.test.ts is omitted from the diff.
- AC-MIS-6's exit-code discriminator was asserted as 'exit exactly 1' in the dispatched task text and 'exit exactly 2' in the AC's later CORRECTION, with a recorded fail (evidence [4]) between the two. The final green run is attested, but the negative-control file packages/lore/tests/unit/core/mirror-human-id-brand.bun.test.ts is unseen, so the mandatory TS18003 empty-include pairing cannot be confirmed.

## Recommendations

- Reconcile the out-of-scope prohibition with reality: either document why scripts/tests/spec-mirror-export.test.ts had to change and re-run its own suite as evidence, or revert that file.
- When an AC declares a falsifier that requires mutating source, land it as a permanent test control (fixture-driven) instead of a one-time manual probe recorded in prose.
- Make anchor sets enumerate every tier of a re-baselined pin (unit, integration, compiled e2e) before dispatch, e.g. by globbing sibling test files for the pinned literal.
- Re-review and re-approve the spec after the AC-MIS-6 summary-text edit that demoted it to draft, then re-attest the dependent claims.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 85758ms
- Retried: false
- Truncated sections: diff:.lore/export-index.json, diff:packages/lore/tests/e2e/migrate-ordinals-compiled.bun.test.ts, diff:packages/lore/tests/unit/core/mirror-human-id-brand.bun.test.ts, diff:packages/lore/tests/unit/service/export-docs-collision.test.ts, diff:packages/lore/tests/unit/service/mirror-human-id-ssot.bun.test.ts, diff:packages/lore/tests/unit/store/migrate-ordinals.bun.test.ts, diff:scripts/check-ordinal-write-sites.d.mts, diff:scripts/check-ordinal-write-sites.mjs, diff:scripts/tests/check-ordinal-write-sites.test.ts, diff:scripts/tests/spec-mirror-export.test.ts, diff:packages/lore/tests/e2e/migrate-ordinals-compiled.bun.test.ts
- Reasoning clipped for: AC-MIS-1, AC-MIS-2, AC-MIS-3, AC-MIS-4, AC-MIS-6, AC-MIS-7

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 87 | 0.75 | evidence | All 7 ACs end with an attested pass; the SSOT fix, brand, cast rule and read-only assertion are all visible and coherent in the diff. |
| evidence_integrity | 74 | 0.6 | evidence | Red-first/expected-fail records are present and credible, but attested ratio is 0.32, AC-MIS-6 shows a fail before pass, and AC-MIS-7's self-assertion clause is not shown in its tail. |
| scope_fidelity | 62 | 0.55 | evidence | Phase ordering held and source edits are minimal/justified, but an explicitly forbidden test file and .lore/export-index.json appear among changed files. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| scope_fidelity | major | — | The plan's Out of Scope section states '⛔ No task in this plan may touch scripts/tests/spec-mirror-export.test.ts', yet scripts/tests/spec-mirror-export.test.ts is listed in the changed-file manifest for this commit. No task evidence or note explains the change. |
| scope_fidelity | minor | — | .lore/export-index.json (this repo's own corpus artifact) is among the changed files. AC-MIS-5's oracle and the new tests repeatedly promise never to write the repo corpus; the change is plausibly a legitimate mirror export of new spec/plan docs, but nothing in the evidence trail accounts for it. |
| outcome | minor | AC-MIS-2 | mirror-roundtrip-idempotency.bun.test.ts's own header admits a single-doc round trip is a false-negative trap and relies on the mid-migrate checkpoint plus a one-time manual revert of ordinal-migration-service.ts:743 to prove discrimination. Every non-ERROR case seeds already-padded state, so a regression to formatDocDisplayId is caught only by the zero-reconcile assertion, not by a permanent reverse control as in AC-MIS-5. |
| evidence_integrity | minor | AC-MIS-7 | The single attested run for AC-MIS-7 has a 1592-byte tail showing two case names only; the AC's second requirement — that the compiled suite self-asserts its re-baseline record naming 63164c20 and the padded value — is not visible in any evidence record, and packages/lore/tests/e2e/migrate-ordinals-compiled.bun.test.ts is omitted from the diff. |
| evidence_integrity | minor | AC-MIS-6 | AC-MIS-6's exit-code discriminator was asserted as 'exit exactly 1' in the dispatched task text and 'exit exactly 2' in the AC's later CORRECTION, with a recorded fail (evidence [4]) between the two. The final green run is attested, but the negative-control file packages/lore/tests/unit/core/mirror-human-id-brand.bun.test.ts is unseen, so the mandatory TS18003 empty-include pairing cannot be confirmed. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Reconcile the out-of-scope prohibition with reality: either document why scripts/tests/spec-mirror-export.test.ts had to change and re-run its own suite as evidence, or revert that file. | An explicit ⛔ prohibition breached with no evidence record undermines the plan's scope contract. |
| process | When an AC declares a falsifier that requires mutating source, land it as a permanent test control (fixture-driven) instead of a one-time manual probe recorded in prose. | AC-MIS-5 did this (runExport reverse control) and is the strongest AC; AC-MIS-2 did not. |
| process | Make anchor sets enumerate every tier of a re-baselined pin (unit, integration, compiled e2e) before dispatch, e.g. by globbing sibling test files for the pinned literal. | AC-MIS-7 exists solely because AC-MIS-4's anchors named the unit test only — third recurrence in one session. |
| spec | Re-review and re-approve the spec after the AC-MIS-6 summary-text edit that demoted it to draft, then re-attest the dependent claims. | A draft spec hard-blocks descendant claims per the plan's own sequencing note. |

## Unverifiable Materials

- scripts/check-ordinal-write-sites.mjs and scripts/tests/check-ordinal-write-sites.test.ts: Omitted from the diff; AC-MIS-3's exact-3 exit, rule+file:line naming, and in-allowlist-0 behaviour judged from output tails only.
- packages/lore/tests/unit/core/mirror-human-id-brand.bun.test.ts: Omitted; the mandatory TS2322-vs-TS18003 discriminator pairing and exit-2 assertions could not be inspected.
- packages/lore/tests/e2e/migrate-ordinals-compiled.bun.test.ts: Omitted; the AC-MIS-7 self-asserted re-baseline record naming 63164c20 is not observable in the 1592-byte evidence tail.
- Cause of the .lore/export-index.json change: File omitted from the diff; cannot distinguish a legitimate mirror export from a test writing the live repo corpus.
- Reason scripts/tests/spec-mirror-export.test.ts changed: File omitted and no task evidence references it, so the scope breach cannot be characterized further.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 6
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 7 declared criteria
- Task evidence: 4 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.32

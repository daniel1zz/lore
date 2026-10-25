---
id: KN-425
type: knowledge
role: knowledge
title: "Assessment: Land mirror identifier SSOT: a branded human_id, an idempotent migrate-export seam, and a drift check that writes nothing (2026-08-11)"
status: archived
priority: medium
created: 2026-08-11
updated: 2026-10-23
tags: []
parent: PLAN-125
links:
  - {id: PLAN-125, type: informs}
---
# Assessment: partially_met (74/100)

Scope: plan `01KZR64PCQF99XE5FBK3HHC82K`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-MIS-1 | 88 | Diff shows :743 composing via formatMirrorHumanId; new test asserts padded old/new_human_id, suggested_file_path, rename_command and unpadded new_display. Attested pass plus prior expected-fail red. Only gap: single attested run. | 01KZR66AGMR0Y1VKY0H6S20PTX (evidence [1] red, [4]/[7] pass; ordinal-migration-service.ts:743 diff) |
| AC-MIS-2 | 85 | Round-trip suite hashes three checkpoints (export1/migrate/export2) on a mkdtemp corpus, attested pass after two recorded reds. Falsifier (reverting :743) verified only manually per header comment, not automated. | 01KZR66AGMR0Y1VKY0H6S20PTX (evidence [2]/[13] red, [5]/[8] pass) |
| AC-MIS-3 | 62 | One self-reported vitest pass; the rule text appears in output tail (allowlist message names schemas.ts). But the checker source and its test file are both truncated, exit-code-exactly-3 and real-tree-0 assertions unseen, and no attested run exists. | 01KZR66AVXD59BCRMHDA3885ME (evidence [1] expected-fail, [2] pass (unattested)) |
| AC-MIS-5 | 90 | Full test file visible: hashes index+all mirror files before/after runCheck, asserts ok:false via file_absent, human_id corruption survives, plus reverse control proving runExport does rewrite. Throwaway mkdtemp corpus, no live-tree check:spec-mirror. Attested pass. | 01KZR66B2EZFECVKSQQ55AARXH (evidence [1] red, [2]/[5] pass) |
| AC-MIS-4 | 86 | Pins re-baselined to SPEC-001/SPEC-001-alpha-decision.md with an in-place RE-BASELINE note; self-assertion test reads import.meta.path and slices at a boundary marker to avoid self-match. Attested pass, 10 tests. specB seed change is an input correction, documented. | 01KZR66AGMR0Y1VKY0H6S20PTX (evidence [10] red, [11]/[12] pass; diff of migrate-ordinals.bun.test.ts) |
| AC-MIS-6 | 52 | Attested pass exists only for a command whose echo text was itself edited mid-flight after a fail (exit 1 vs 2), and coverage still records 1 fail. The brand test file is truncated, so TS2322/TS18003 discrimination is unverifiable; the sanctioned cast is a zod .transform, not reviewable as exit-cod… | 01KZR66AVXD59BCRMHDA3885ME (evidence [4] fail, [5] pass after command echo edit) |

## Gaps

- AC-MIS-6's coverage records 1 pass and 1 fail. The failing run [4] and passing run [5] differ in the trailing echo text (exit 1 vs exit 2), and the fail tail shows a real TS2322 on Record<string,{human_id:string;...}>. The materials do not show what source change turned that red green, so the pass cannot be attributed to the brand landing correctly rather than to a command edit.
- AC-MIS-3 has one self-reported vitest pass and zero attested runs, while scripts/check-ordinal-write-sites.mjs, its .d.mts, and scripts/tests/check-ordinal-write-sites.test.ts are all truncated. The AC's three discriminating claims (exit exactly 3 on an unsanctioned fixture, 0 inside schemas.ts, 0 on the real tree) are therefore unverified from these materials.
- AC-MIS-2's declared falsifier (reverting :743 to formatDocDisplayId turns HAPPY red) is recorded only as a manual 2026-08-11 note in the test file header, not as an automated or attested artifact, so the suite's discriminating power rests on prose.
- AC-MIS-4's slice also changed a fixture INPUT (specB's seeded mapping SPEC-2 -> SPEC-002) in a GREEN attested AC-084-4 suite. It is documented and justified in-place, but it widens the re-baseline beyond the plan's stated 'pinned literals only' framing.

## Recommendations

- Require that any AC whose declared command text is edited mid-execution re-runs the FINAL command under attestation, and that the prior fail be annotated with the source change that resolved it — not just the command delta.
- Add an explicit evidence requirement that tree-wide checker rules (AC-MIS-3-style) ship with an attested run plus the checker source included in the review bundle.
- Record SPEC-135's re-review/re-approve after the two in-flight lore ac set edits, and re-read SPEC-084's status as the plan's own sequencing note demanded.
- Capture the two non-obvious measurements from this plan (tsc --noEmit exits 2 for both TS2322 and TS18003; SPEC-061 counts every test-file-shaped argv token) as knowledge docs.

## Judgment

- Provider: claude-cli
- Prompt version: 7
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 137793ms
- Retried: true
- Truncated sections: diff:.lore/export-index.json, diff:docs/requirements/knowledge/KN-423-handoff-agent-main-orchestrator.md, diff:docs/requirements/knowledge/KN-424-eight-findings-from-landing-four-governance-specs.md, diff:docs/requirements/plan/PLAN-122-land-governance-distribution-shipped-defaults-that.md, diff:docs/requirements/plan/PLAN-123-land-judgment-verification-path-checked-assess-fin.md, diff:docs/requirements/plan/PLAN-124-land-oracle-exclusivity-a-mirror-check-that-can-fa.md, diff:docs/requirements/plan/PLAN-125-land-mirror-identifier-ssot-a-branded-human-id-an.md, diff:docs/requirements/spec/SPEC-135-mirror-identifier-ssot-one-writer-for-export-index.md, diff:docs/requirements/spec/SPEC-136-oracle-exclusivity-in-a-shared-checkout-a-mirror-c.md, diff:docs/requirements/spec/SPEC-137-judgment-surfaces-must-verify-before-they-certify.md, diff:docs/requirements/spec/SPEC-138-governance-defaults-must-ship-and-every-recorded-g.md, diff:docs/requirements/task/TASK-655-make-mirrorhumanid-a-nominal-type-on.md, diff:docs/requirements/task/TASK-656-verify-assess-finding-paths-against-the-assessed-c.md, diff:docs/requirements/task/TASK-657-resolve-verifyfalsifier-s-execution-root-through-s.md, diff:docs/requirements/task/TASK-658-extract-the-repo-corpus-pollution-guard-into-a-pur.md, diff:docs/requirements/task/TASK-659-build-the-gap-namespace-checker-and-the-unowned-ga.md, diff:docs/requirements/task/TASK-660-collapse-the-two-divergent-unconfigured-upstream-r.md, diff:docs/requirements/task/TASK-661-raise-capture-timeout-ms-and-max-diff-chars-to-the.md, diff:docs/requirements/task/TASK-662-add-the-gitignored-scratch-probe-namespace-asserte.md, diff:docs/requirements/task/TASK-663-compose-the-step-3-export-index-reconcile-via.md, diff:docs/requirements/task/TASK-664-assert-the-mirror-drift-check-writes-nothing-runch.md, diff:docs/requirements/task/TASK-665-make-the-ac-fr-10-mirror-oracle-drive-the-read-onl.md, diff:packages/lore/tests/e2e/migrate-ordinals-compiled.bun.test.ts, diff:packages/lore/tests/unit/core/mirror-human-id-brand.bun.test.ts, diff:packages/lore/tests/unit/service/export-docs-collision.test.ts, diff:packages/lore/tests/unit/service/mirror-human-id-ssot.bun.test.ts, diff:packages/lore/tests/unit/store/migrate-ordinals.bun.test.ts, diff:scripts/check-ordinal-write-sites.d.mts, diff:scripts/check-ordinal-write-sites.mjs, diff:scripts/tests/check-ordinal-write-sites.test.ts, diff:scripts/tests/spec-mirror-export.test.ts
- Reasoning clipped for: AC-MIS-6

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 80 | 0.7 | evidence | Five of six ACs show attested or clearly-red-then-green oracle runs with visible implementation; AC-MIS-6 remains mixed (1 pass / 1 fail) and AC-MIS-3 is unattested. |
| evidence_integrity | 58 | 0.72 | evidence | Reds precede greens for most ACs, but attested ratio is 0.29, AC-MIS-3 has none, and AC-MIS-6's green followed an edit to the command's own summary text after a fail. |
| scope_fidelity | 84 | 0.6 | evidence | Anchors match the plan; spec-mirror-export.test.ts untouched in the shown diff and only listed as unseen. Docs/spec/task file churn and a KN-042 link edit are adjacent but plausible. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-MIS-6 | AC-MIS-6's coverage records 1 pass and 1 fail. The failing run [4] and passing run [5] differ in the trailing echo text (exit 1 vs exit 2), and the fail tail shows a real TS2322 on Record<string,{human_id:string;...}>. The materials do not show what source change turned that red green, so the pass cannot be attributed to the brand landing correctly rather than to a command edit. |
| evidence_integrity | major | AC-MIS-3 | AC-MIS-3 has one self-reported vitest pass and zero attested runs, while scripts/check-ordinal-write-sites.mjs, its .d.mts, and scripts/tests/check-ordinal-write-sites.test.ts are all truncated. The AC's three discriminating claims (exit exactly 3 on an unsanctioned fixture, 0 inside schemas.ts, 0 on the real tree) are therefore unverified from these materials. |
| outcome | minor | AC-MIS-2 | AC-MIS-2's declared falsifier (reverting :743 to formatDocDisplayId turns HAPPY red) is recorded only as a manual 2026-08-11 note in the test file header, not as an automated or attested artifact, so the suite's discriminating power rests on prose. |
| scope_fidelity | minor | AC-MIS-4 | AC-MIS-4's slice also changed a fixture INPUT (specB's seeded mapping SPEC-2 -> SPEC-002) in a GREEN attested AC-084-4 suite. It is documented and justified in-place, but it widens the re-baseline beyond the plan's stated 'pinned literals only' framing. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require that any AC whose declared command text is edited mid-execution re-runs the FINAL command under attestation, and that the prior fail be annotated with the source change that resolved it — not just the command delta. | AC-MIS-6's pass/fail pair is indistinguishable from an echo-string edit papering over a real red. |
| plan | Add an explicit evidence requirement that tree-wide checker rules (AC-MIS-3-style) ship with an attested run plus the checker source included in the review bundle. | Unattested + truncated checker leaves the rule's exit-code contract unverifiable. |
| spec | Record SPEC-135's re-review/re-approve after the two in-flight lore ac set edits, and re-read SPEC-084's status as the plan's own sequencing note demanded. | The spec's own CORRECTION notes state the edits demote it to draft, which blocks descendant claims. |
| process | Capture the two non-obvious measurements from this plan (tsc --noEmit exits 2 for both TS2322 and TS18003; SPEC-061 counts every test-file-shaped argv token) as knowledge docs. | Both cost an inconclusive verify and a spec revision this cycle; zero knowledge docs were linked. |

## Unverifiable Materials

- scripts/check-ordinal-write-sites.mjs and scripts/tests/check-ordinal-write-sites.test.ts: Truncated from the diff; AC-MIS-3's exit-exactly-3, allowlist-0, and real-tree-0 behaviour cannot be inspected.
- packages/lore/tests/unit/core/mirror-human-id-brand.bun.test.ts: Truncated; the TS2322-vs-TS18003 negative-control pairing central to AC-MIS-6 is visible only as a 2-line output tail.
- SPEC-084 and SPEC-135 current status records: No evidence record shows the status re-read the plan's sequencing risk section required after lore ac set edits.

## Facts Summary

- AC coverage: 6 declared criteria
- Task evidence: 3 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.29

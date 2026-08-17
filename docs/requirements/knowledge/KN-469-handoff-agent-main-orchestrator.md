---
id: KN-469
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-08-17
updated: 2026-08-17
tags: []
parent: PLAN-121
---
# Handoff — agent:main-orchestrator

SCOPE: 5 decisions + 7 next steps = 12 items to account for

## Plan

plan-land-bootstrap-fixpoint-integrity-binary-provenance-the

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | All 6 tasks landed, merged, attested and archived; ready=0 archived=6 matches the merged count. assess: outcome 89 / evidence_integrity 74 / scope_fidelity 90 | 95 |
| KD2 | assess's MAJOR is CORRECT this time — I machine-checked it: T4 holds exactly 1 expected-fail row, ac_ref empty, 231-byte tail, standing in for the red-first floor of AC-BFI-5/6/7 | 100 |
| KD3 | The AC-BFI-5 minor is also correct: the HAPPY case asserts entries.length only, so a same-size but wrong-membership ledger is caught by the checker alone, never by the test | 95 |
| KD4 | The literal-path-marker fix for test:changed is measured INERT and all three docs saying otherwise were corrected; the only real fix is a scripts/changed-tests.ts change | 100 |
| KD5 | The mirror content check is now armed and WILL redden the suite on a very high-frequency event: every lore claim/evidence edits a task body, so any corpus-touching session must export-docs --force and commit before the suite is green | 90 |

## Failing Oracle

(none)

## Next Steps

- NS1: Decide whether to archive the plan: all children are terminal, plan-close will evaluate, and the archival cascade after a passing gate is deliberately ungated — do not paste the printed command without deciding
- NS2: Follow-up task: make scripts/changed-tests.ts select the pre-push guards when hooks/** or assets/** change (membership needs a bare main(); scope rejects extensionless paths — both must change)
- NS3: Follow-up task: tighten AC-BFI-5's oracle to a slug-level set comparison instead of cardinality
- NS4: Capture as knowledge, currently only in source comments: the /$bunfs/ compiled-binary discriminator, the concurrent sibling exporter that rewrites the mirror during an ordinary test run, and the verdict-line ordering required by the 4000-byte tail window
- NS5: Rename packages/lore/tests/integration/pre-push-binary-provenance-trip.bun.test.ts — it now holds both AC-BFI-3 and AC-BFI-9 suites; pre-push-trip.bun.test.ts was the suggested name
- NS6: NOT MINE, still open: 6 plans from other sessions have all children terminal but sit in draft, so lore status --check-tree --check-drift exits 3 and pre-push is red for everyone
- NS7: NOT MINE: worktree agent-adc3194ed5fab9ce2 is a leftover from another session (HEAD is an ancestor of main, no unmerged commits)

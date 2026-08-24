---
id: KN-526
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-08-24
updated: 2026-08-24
tags: []
parent: PLAN-138
---
# Handoff — agent:main-orchestrator

SCOPE: 6 decisions + 5 next steps = 11 items to account for

## Plan

plan-land-the-github-intake-defect-channel-runner-cap-removal

## Task Refs

(none)

## Modified Files

- packages/lore/src/adapters/cli/commands/setup.ts
- packages/lore/src/adapters/cli/setup-check.ts

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | TICKET 117 NS1: links_broken===2 was never a real quantity. The number came from spec-mirror-export.test.ts:294 (baseline.exitCode), not line 301; the test never reached that assertion. It was attributed by test TITLE, not LINE. links_broken is 0; all five probes were right. GAP CLOSED. | 97 |
| KD2 | Root cause is structural: export-docs writes MDX-RESOLVED bodies (91745b) while content-parity compares the UNRESOLVED corpus source (15311b). Never equal; any corpus write re-reddens it. Its green window needs an exclusive corpus. See knowledge-the-mirror-content-parity-oracle-is-structurally | 92 |
| KD3 | TICKET 117 KD1 sharpened: all 14 spec ACs carry attested evidence (24 pass/0 fail/23 attested), but assess says partially_met 74/100 and the P6 task is draft with ac_scope=[] so verify cannot attest it. Archived-task count was never a completeness signal. | 88 |
| KD4 | Invariant 1 (full-repo typecheck exit 0) had NO passing record in this plan's history — two tasks recorded fail. It now passes: EXIT=0, 0 errors, unpiped. The TS2339 was adjudicated a TEST defect with evidence; no production type was touched. | 96 |
| KD5 | A regression was found by verification, not by any AC: setup --check --json printed TWO JSON documents, breaking every JSON.parse consumer and 9 bun tests. It broke pre-existing AC-076-2/AC-076-10 while every AC-GI-* stayed green. | 94 |
| KD6 | Two gate holes measured, recorded not worked around: deprecation does NOT cascade to anchor assertions (5 stale anchors survived approved-to-deprecated, removed by hand); check-tree's HUMAN renderer discards the id/slug its own --json carries. | 90 |

## Failing Oracle

(none)

## Next Steps

- NS1: Decide the live 12-report migration. The user's decision this session was explicitly to wait for main to be green; typecheck and the setup-JSON regression are now fixed and merged, so re-evaluate. Prefer the dry-run path first (AC-GI-11 asserts zero gh calls in dry-run) over a direct live run.
- NS2: The mirror content-parity oracle needs a DESIGN decision, not a re-export — re-exporting only moves the red to the next corpus write. Choose among the three options in knowledge-the-mirror-content-parity-oracle-is-structurally: resolved-vs-resolved, store-unresolved-and-resolve-at-read, or exclude placeholder-bearing docs WITH a visible trace in the count.
- NS3: Give the P6 verification task a real ac_scope or retire it: ac_scope=[] makes lore verify structurally inapplicable while assess still counts its absence as an undischarged Exit Criterion, so the task cannot be satisfied in its current shape.
- NS4: Batch corpus writes before running any suite. One lore write interleaved with a suite run reddens spec-mirror-export.test.ts on parity grounds — I did this to myself once and produced 3 self-inflicted failures. Order: all corpus writes, then mirror:export + export-docs --force, then commit, then verify.
- NS5: Two AC weaknesses assess named remain open: AC-GI-5 and AC-GI-12 pin oracles to vitest unit files while their statements promise CLI-surface behaviour, and AC-GI-4 rests one of five records on oracle=manual. Re-anchor onto CLI-level bun tests and script the manual one.

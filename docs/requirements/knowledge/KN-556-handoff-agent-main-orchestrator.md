---
id: KN-556
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-08-25
updated: 2026-08-25
tags: []
parent: PLAN-145
---
# Handoff — agent:main-orchestrator

SCOPE: 4 decisions + 6 next steps = 10 items to account for

## Plan

plan-close-the-read-side-a-github-filed-defect-becomes

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | Everyday flow LIVE, measured on the real config: lore issues, report-issue --list and all six read flags exit 0; issue adopt mints a claimable task; claim and issue resolve unchanged; resolve pushes resolution:* to GitHub. 12/12 SPEC-150 ACs attested.@0.95 | — |
| KD2 | AC-GR-8 was a VACUOUS oracle most of this plan: its scan read 0 while issues.ts:482 still refused six flags with exit 4 — the refusal said 'are not yet supported by' and cited a different spec. assess's judge caught it, no AC did. It now has a behavioural conjunct.@0.97 | — |
| KD3 | A full-suite green verdict is unobtainable while the orchestrator records evidence: two bun cases assert a clean corpus mirror and any lore write dirties it. Proved by isolation — 4 pass after sync+commit. The North Star already says this; now measured.@0.93 | — |
| KD4 | P5 deliberately NOT archived. Its criteria include a green full suite; 3 O(corpus) timeouts in spec-mirror-export.test.ts still fail (12s per pass x3 > 30s at 1704 docs) and contaminate mirror-status-parity by leaving the real mirror mutated.@0.96 | — |

## Failing Oracle

(none)

## Next Steps

- NS1: Fix task-skill-test-the-mirror-end-to-end-oracles-cost-o-corpus — TWO defects, not one: the O(corpus) budget AND the unconditional-restore/isolation gap that makes one file's timeout redden another. Fixing only the budget leaves the second armed.
- NS2: Then close P5: with those suites green, sync+commit the mirror, run both halves with NO corpus writes in between, then lore done. Do not archive P5 while any criterion is unmet.
- NS3: task-skill-implement-duplicate-slug-existing-id-names-the — sqlite/turso stores set DUPLICATE_SLUG.existing_id to the REJECTED doc's id; in-memory is correct. A false label. SPEC-150 D2 routes around it by re-deriving the slug.
- NS4: loader.ts silently treats a schema-invalid .lore/config.yaml as config: undefined, so feedback.upstream reads as unconfigured. Reported by an implementer, NOT independently re-verified by me.
- NS5: Root CLAUDE.md is 24 bytes under its 0.97 eviction floor — any addition now requires evicting a block first.
- NS6: NS5 from ticket 127 still untouched: ticket 121's lore list --fields ENOBUFS, --type scoping for drift-check timeouts, runLore surfacing result.error, spawnSync audit needs a check script.

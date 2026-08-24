---
id: KN-523
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-08-24
updated: 2026-08-24
tags: []
parent: PLAN-139
---
# Handoff — agent:main-orchestrator

SCOPE: 4 decisions + 8 next steps = 12 items to account for

## Plan

plan-implementation-claude-md-content-dimension-checks-split

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | KD1 CONFIRMED and extended: the same dangling-reference class also lives in SOURCE comments (9 present-tense refs to the deleted claude-md-check.ts), where checkReferenceExistence is structurally blind because it discovers memory files only@0.9 | — |
| KD2 | NS1 both halves DONE: SPEC-095 synced (4 falsified statements, re-approved v18) + fresh assess (met 86/100) + plan archived; root CLAUDE.md 23820 -> 21828 bytes, from 18 bytes under its eviction floor to 2010 under it@0.95 | — |
| KD3 | Defect channel READ and WRITE disagree on one config: report-issue refuses (exit 4), issues silently reads LOCAL (exit 0, byte-identical to --local). Unfilable through the channel itself; recorded in knowledge-five-governance-findings-measured-while-closing-the@0.9 | — |
| KD4 | Declined the judge's one SPEC-095 consistency MAJOR as a false positive: AC-CMC-1's oracle names the still-existing TEST file, not the deleted source module. Measured green, exit 0, 6 tests, before scoring@0.95 | — |

## Failing Oracle

(none)

## Next Steps

- NS1: F2: dispatch a task repointing the 9 present-tense claude-md-check.ts refs in source/scripts comments; anchor MUST cover every comment site and the AC must assert a live grep count of 0, not merely that new names appear
- NS2: F1 mechanism: one resolveFeedbackUpstream returning Result consumed by BOTH lore issues and report-issue; oracle asserts the verbs DIFFER under a valid non-local upstream and BOTH refuse under a retired-only one
- NS3: F3 mechanism: flag an index-section list item carrying NO resolvable backtick slug — three Same-doc pointers were invisible to --check-memory-pointers and one resolved to the WRONG document
- NS4: F4 mechanism: generate or test-diff the Document Lifecycle fenced block against schemas.ts:801 VALID_TRANSITIONS — it cited its own SSOT and still omitted approved->archived and in-review->draft
- NS5: F5: packages/core/src/CLAUDE.md is next to trip — 15704/16384, eviction floor 15892, 188 bytes away. Read live numbers from lore status --check-claude-md first
- NS6: USER DECISION: .lore/config.yaml still carries the retired feedback.upstream.corpus_path (warning on EVERY lore call). Migrating to feedback.upstream.repo changes where reports go; file is NOT git-tracked, so only a main-checkout actor can land it
- NS7: UNCOMMITTED: CLAUDE.md + .lore/export-index.json + 3 modified and 3 new mirror files sit in the working tree only, no commit (user did not ask). After any commit rerun bun run build — provenance blocks on a dist/lore older than HEAD
- NS8: OUT OF SCOPE, flagged only: two stale drafts under SPEC-095 from 2026-07-27 (assessment + UAT), and a stale claim on task-declare-a-falsifier-per-criterion-drive-lore-verify from bootstrap injection

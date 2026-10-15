---
id: KN-581
type: knowledge
role: knowledge
title: "Handoff — agent:session-cb37af5d"
status: approved
priority: medium
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PRD-001
---
# Handoff — agent:session-cb37af5d

SCOPE: 4 decisions + 3 next steps = 7 items to account for

## Plan

(none)

## Task Refs

(none)

## Modified Files

- docs/requirements/spec
- assets/hooks/session-start-resume.mjs

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | Session-start injection: only seat sessions get a payload = unfinished claims whose claim.worktree == seat branch + seat-plan resume_hint; main checkout gets nothing; my_claims dropped (empty under run identity) | 90 |
| KD2 | Specs/ACs are execution records (ADR-041): SPEC-080/context-provenance/handoff-neutrality NOT edited; new spec spec-session-start-injection-carries-only-the-session-s-own (draft, AC-SI-1..11); new behaviour only in NEW test files, retired assertions deleted from old ones (spec D10) | 90 |
| KD3 | Baseline edited in place: BR-328/329 rewritten and held at unconfirmed (leaf Q5 + held-table rows) until AC-SI-1/2 have a runner-recorded pass; BR-981 compact form carries no root | 85 |
| KD4 | Paused by user 2026-10-11 so the doc-role mechanism (issue #155: current-state vs execution-record types) lands first and then governs this initiative | 95 |

## Failing Oracle

(none)

## Next Steps

- NS1: After #155 lands: re-check this spec and the baseline edits against the new mechanism, then create the plan (3 tasks: core+service+CLI incl. seatClaims and compiled e2e [AC-SI-1,2,4,6,8,9,10,11]; hook Phase E [AC-SI-3,7]; prose sweep of 10 assets blocked-by hook task because both touch packages/lore/src/generated/assets-manifest.ts [AC-SI-5,7])
- NS2: Then S3 bundle review (spec + baseline-start-a-session + plan) and S4 single approval; approve baseline leaf and spec together
- NS3: AC falsifiers are named in statements only; declare --falsifier-* after the code exists (find-strings do not exist yet)

---
id: KN-618
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PLAN-175
---
# Handoff — agent:main-orchestrator

SCOPE: 4 decisions + 4 next steps = 8 items to account for

## Plan

plan-fix-105-the-citation-gate-honours-an-active-exemption-on

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | #105 fixed and merged (db77e5cf, AC-BLS2-19 attested, BR-959): an unexpired exemption admits an uncited criterion under enforce; missing/deprecated/retired cites still refused | 95 |
| KD2 | AC-BLS2-14 re-measured PASS 103/110 = 93.6% (seed 20261012), no catch-all; record knowledge-ac-bls2-14-re-measurement-after-105-fidelity-93-6-of. Successive samples 89.1% vs 93.6%: judge variance is the size of the margin, so this is one sample above the bar | 80 |
| KD3 | 15 judged-unfaithful cites removed under enforce (8 from the earlier sample, 7 from this one); 20 exemptions active (1.95%), all expire 2027-01-10; 12 branches still coverage 0 gaps and 0 uncited established\|observed rules | 95 |
| KD4 | Worktree cleanup belongs in lore, not in orchestrator memory or a user hook (owner choice: lore done auto-cleans the claim-recorded worktree + a sweep verb, after #105) — filed #106 | 90 |

## Failing Oracle

(none)

## Next Steps

- NS1: #106 (owner chose this next): lore-owned worktree cleanup — spec under the right PRD branch, then plan, RED, implement. Predicate: owning task archived, branch has >=1 own commit already in main (never a zero-commit branch), clean tree, quiet reflog >=30 min; non-force remove + branch -d; never a worktree no lore claim recorded; sweep defaults to report, --apply removes. Prior learnings: knowledge-git-branch-merged-lists-every-worktree-branch-that, knowledge-three-signals-said-a-peer-s-worktree-was-safe-to
- NS2: #104: census misses functions reached through dependency injection — RED first, then fix
- NS3: Plan slice 2c: fidelity judged at citation write time, two judges per pair, adjudication on disagreement (reduces the judge variance seen in AC-BLS2-14)
- NS4: 4-week freshness re-probe of the baseline (due about 2026-11-06)

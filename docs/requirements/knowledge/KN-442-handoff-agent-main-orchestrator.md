---
id: KN-442
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PLAN-128
---
# Handoff — agent:main-orchestrator

SCOPE: 3 decisions + 3 next steps = 6 items to account for

## Plan

plan-land-corpus-resolution-provenance-one-pure-resolver-one

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | Plan closed: 5 tasks + 1 adhoc merged, each attested by lore verify ON THE MERGED TREE (not in a worktree); plan archived through the plan-close gate; spec corrected to v27 and re-approved after lore review escalated on a contradiction I had left in it@0.95 | — |
| KD2 | The HTTP exemption in spec D5 is NOT delivered: loader.ts:355 gives every loadLoreApp-booted surface the SERVER startup-cwd provenance, so lore serve from a nested worktree would refuse every HTTP write. AC-CP-5(c) passed only because its spy drives a bare CorpusService default@0.9 | — |
| KD3 | A peer session committed to main in this same checkout throughout: it fixed the migrate-ordinals assertions my agents reported, and replaced the git safety gate mid-session. Four agents reproducing one failure was NOT independent evidence - same base tree@0.9 | — |

## Failing Oracle

(none)

## Next Steps

- NS1: Three follow-up tasks filed, unclaimed, all adhoc with anchors + ac_scope: task-the-http-exemption-is-conditional-on-where-lore-serve-was (high), task-the-pure-resolver-s-iswithin-rejects-everything-at-the, task-the-handoff-and-uat-carve-out-in-the-foreign-write-guard
- NS2: Broad suite on merged tree: 2048 pass / 2 fail across 204 files, captured on task-merged-tree-broad-suite-run-after-the-corpus-provenance. Both failures are spec-loop-e2e repo-pollution-guard naming THIS session's own uncommitted corpus writes, not a regression
- NS3: lore evidence --capture requires --result although it knows the spawned exit code, so a captured row's verdict is still typed by the recorder and can contradict its own tail. Derive result from the exit code, or emit an attestation block. Finding 9 in the retro

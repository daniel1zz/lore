---
id: KN-442
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-08-12
updated: 2026-10-10
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


## Addendum written after the handoff was first recorded

**The broad suite is GREEN and the run is in the corpus.** `task-merged-tree-broad-suite-run-after-the-corpus-provenance` now carries two runner-captured rows: the earlier `fail` (2048 pass / 2 fail / 204 files, both failures the repo-pollution guard reacting to uncommitted corpus writes), and a `pass` (2065 pass / 0 fail / 9693 expect() calls / 205 files / 861.51s) recorded at 2026-08-12T09:11:47Z on a clean corpus tree at `bf477336`. The `pass` row's verdict was cross-checked by the tool against the exit code it observed, so it is not self-reported. The next step in the original ticket — "re-run spec-loop-e2e to confirm" — is superseded by this and needs no action.

**A FOURTH follow-up task was filed after the original next-steps list**, and it is the most consequential of the four: `task-the-mirror-export-silently-skips-a-changed-knowledge-doc` (priority high). `bun run mirror:export` does not rewrite an existing mirror file when a knowledge doc's content changes — `KN-441` is frozen at 10521 bytes / doc v1 while the corpus is 17989 bytes / v9, the body having grown 71%. Reproducible: the file's md5 is identical before and after a fresh export. A discriminating control rules out "the export never rewrites anything": `SPEC-141`, edited in the same session, DID pick up its new section.

Why this one matters more than its size suggests: all three checks pass over the divergence. `mirror:export` exits 0 printing OK, `check:spec-mirror` exits 0 and states outright that content is not compared, and `git status` is CLEAN because the stale file matches its last commit — so the repo-pollution guard cannot see it either. A stale mirror is not dirty; it is quietly wrong, and the pre-push corpus gate renders it identically to a correct one. Treat any mirror-content claim in this corpus as unverified until that task lands, including the mirror files this session committed.

**One thing I could not determine.** A `lore evidence --capture` attempt at 16:39 local observed the suite exiting 1, and the tool discards the captured output when it refuses to record, so the cause of that particular red is unknown. I asserted at the time that it was mirror dirt from my own retro edit; that explanation is not supported, because the export does not rewrite that file at all. The later clean run makes it moot for the tree's current state, but do not carry my original explanation forward as fact.

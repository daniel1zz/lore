---
id: KN-280
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PRD-001
---
# Handoff — agent:main-orchestrator

SCOPE: 1 decisions + 1 next steps = 2 items to account for

## Plan

(none)

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | Stop-hook dlopen crash root-caused to app.ts's eager static TursoStore import: every App-constructing command needed a healthy TMPDIR (compiled bun unpacks the .node there). Fixed via lazy dynamic import + TMPDIR probe. 9 ACs attested, plan closed met 82/100.@high | — |

## Failing Oracle

(none)

## Next Steps

- NS1: Two open adhoc tasks: task-ac-ic-1-harness-runs-out-of-sampling-budget-under-load (AC-IC-1 collects 14/50 samples under load, nonConforming empty — raise attempt budget or emit loud inconclusive, never relax the exclusion rule) and task-ac-ll-8-guards-the-loader-strip-not-the-no-sync-bearing (needs a source-scanning call-site pin per AC-SL-2 precedent plus a liveness control).

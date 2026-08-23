---
id: TASK-779
type: task
role: plan
title: "[Skill:test] projector 9-state round trip and its live call site — RED"
status: archived
priority: high
phase: "P5: Projection + reads"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-138
plan: PLAN-138
---
Estimate: S
Source: AC-GI-4 of the governing spec; Invariant 3 (no zero-caller capability); Invariant 6 (resolution stays corpus-computed)
TDD-Role: red | Paired-Impl: the ResolutionProjector task in this phase

Scenarios:
- Given each of the 9 resolution states in turn, When the projector maps it to a label and the label is read back, Then the recovered state equals the original — 9 for 9
- Given a resolution whose GitHub-native representation collides with another (rejected, wontfix and superseded all map to not_planned), When the label is read back, Then the three remain distinguishable — proving the label rather than state_reason carries the fidelity
- Given `lore issue resolve` executing a ratified verdict, When it completes, Then a projection call was made — asserted against an injected projector spy, so a zero-caller implementation fails this case
- Given a hand-edited label that disagrees with the corpus-derived state, When the resolution is read, Then the CORPUS value is returned, never the label's
- Given a projection failure (network), When `lore issue resolve` runs, Then the corpus verdict is still recorded and the projection failure is reported, not swallowed

AC:
- Every scenario exists as an executable vitest case in the anchored file
- The anchored file exits non-zero before the paired implementation lands
- The third scenario is mandatory: without it a projector with no production caller satisfies every other case (the four-times-measured false-green of this repo)
- `lore evidence --result expected-fail` recorded BY THIS TASK when the red is observed

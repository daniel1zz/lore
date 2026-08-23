---
id: TASK-778
type: task
role: plan
title: "[Skill:implement] ResolutionProjector invoked from lore issue resolve"
status: draft
priority: high
phase: "P5: Projection + reads"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-138
plan: PLAN-138
links:
  - {id: TASK-775, type: blocks}
---
Estimate: M
Approach: a pure state-to-label mapping plus a write-only projection call, invoked from `lore issue resolve` — the moment a verdict is ratified is exactly when the label should be re-projected. The label is NEVER read back as truth (Invariant 6); it is read only by the drift detector in the paired read-side task.
Source: spec Scope entry ResolutionProjector and the Per-Field Authority table's "read back as truth: never" row
Dimensions: D-FUNC, D-CODE
Scope-Alt: projection may be best-effort on network failure provided the failure is reported loudly and the corpus verdict still lands
Covers: AC-GI-4

AC:
- Given the anchored test file from the paired red task, When it runs, Then all five cases pass
- Given `lore issue resolve` on a real corpus record, When it completes, Then a `resolution:<state>` label reflecting the corpus-computed value is present on the linked issue
- Given all 9 states, When each is projected and read back, Then all 9 round-trip equal
- Given a hand-edited label, When any read surface reports the resolution, Then it reports the corpus value
- A full-repo typecheck is exit 0

Integration: the live call site is `lore issue resolve` (anchored by this task). An implementation whose only caller is its unit test fails this task's third AC by construction.

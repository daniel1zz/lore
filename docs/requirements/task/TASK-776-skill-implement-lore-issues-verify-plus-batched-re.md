---
id: TASK-776
type: task
role: plan
title: "[Skill:implement] lore issues --verify plus batched read-side severity and category filters"
status: archived
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
Approach: one batched listing call per read surface (GraphQL or a single paginated REST call — measured: 100 issues with labels in 1022-1315ms for one quota unit), cached via `gh api --cache` (measured 48-61ms warm, quota not decremented), then filter locally over parsed front matter. `--verify` diffs the corpus-derived resolution against the label and writes nothing.
Source: spec Scope entries for --verify and the read-side filters; the measured search-bucket limit of 30/min
Dimensions: D-FUNC, D-UX
Scope-Alt: the cache TTL and its staleness stamp can ship as a fixed value rather than configurable
Covers: AC-GI-5, AC-GI-12

AC:
- Given the anchored test file from the paired red task, When it runs, Then all five cases pass
- Given a hand-edited label, When `lore issues --verify` runs, Then it names the divergence and exits with the divergence code; given no divergence, it exits 0
- Given 50 issues versus 1, When listed, Then the gh invocation counts are equal
- Given any filter flag, When rows are hidden, Then the printed total is the filtered count — a filtered listing must never print an unfiltered total
- A full-repo typecheck is exit 0

Integration: both surfaces are user-facing CLI flags; the ACs drive the CLI, not the underlying functions.

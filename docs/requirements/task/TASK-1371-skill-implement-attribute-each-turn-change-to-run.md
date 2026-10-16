---
id: TASK-1371
type: task
role: plan
title: "[Skill:implement] attribute each turn change to run, version control or unknown, and extend the source-edit finding"
status: archived
priority: critical
phase: "measurement"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-188
plan: PLAN-188
links:
  - {id: TASK-1377, type: blocks}
  - {id: TASK-1374, type: blocks}
---
Estimate: L
Approach: pure attributeTurn(diffEntries, editRecords, reflogSteps, conflictedPathsByStep) in assets/hooks/lib/session-trail.mjs: edit records first; vcs only for reflog steps taking in other commits (merge, pull, checkout, rebase, reset, cherry-pick, and 'commit (merge)' diffed against its first parent), content equal to the post-step HEAD, not conflicted; conflicted paths of a merge step recomputed from its two parents with git merge-tree --write-tree --name-only; commit / commit (amend) never vcs, so a squash merge is unknown (D15); an unrecognised action -> unknown; own commits are never laundered: own set = non-merge commits with reflog action commit / commit (amend) in this checkout since session.json started_at, plus their git patch-id --stable values; a candidate vcs path changed by a non-merge commit in oldHead..newHead that is own or shares an own patch-id -> unknown; the merge commit concluding a commit (merge) step is never own. user-prompt-turn-start.mjs records head in turn-start-snapshot.json and seeds the temporary index from the real index. stop-turn-review.mjs writes <turn>/changes.json (shared_working_copy from non-isolated helper records open during the turn), extends findSourceEdits (main + unknown count, vcs never, shared working copy -> listed not counted, attribution unmeasured -> no verdict), and reports not-measured parts in the block reason when blocking, otherwise as stdout JSON systemMessage with no decision, keeping the existing stderr line (D13). Confirm once in a real Claude Code session that a Stop systemMessage is displayed to the user and record it as manual evidence (D13 UNVERIFIED item); if it is not displayed, stop and report instead of choosing another channel. Keep stop-turn-review.mjs under 400 lines by putting logic in the lib.
Source: spec Design > Attribution at turn end; D5, D14, D15.
AC: AC-ST-3, AC-ST-4. Existing AC-TE-3 / AC-TE-7 tests (stop-turn-review.test.ts) must stay green.
Integration: changes.json is read by trail-review (unknown group), lore session trail and the handoff fill.
Governing spec: spec-session-trail-a-session-local-record-of-what-each-run-4 (read its Design section and Design Decisions before starting; cite rules through the spec's ACs, never restate them). Plan invariants I1-I7 apply.

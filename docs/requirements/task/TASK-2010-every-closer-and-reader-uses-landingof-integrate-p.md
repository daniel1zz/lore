---
id: TASK-2010
type: task
role: plan
title: "Every closer and reader uses landingOf: integrate, plan close, milestone review, get, tool protocol"
status: archived
priority: high
phase: "P3 Wiring and close"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-250
plan: PLAN-250
links:
  - {id: TASK-2004, type: blocks}
---
Covers: AC-ND-8
Approach: integrate records its landing through landingOf (same fields, kind commits) and its post-landing archive (BR-1356) calls the shared floors; milestone-review.ts skips a no-change task's commit range with the literal 'if (landing.kind === "no-change") continue;' (falsifier); lore get / lore log print 'Landing: no-change' or 'Landing: commits <tip>'; lore_done needs no new argument. The e2e runs dist/lore (bun run build first) against a throwaway corpus and repo.

## Must resolve before evidence

Case: a task holds an open no-branch claim, and a file anchor is added to it afterwards. BR-1468 is checked only at claim time, so the task could close as no-change from a pass at main's head without its file changes ever being measured.

Decision (2026-10-26): lore anchor add on a task that holds an open no-branch claim is REFUSED with exit 4. The message tells the holder to release and re-claim on a branch (lore claim <task> --worktree <path>) before adding the anchor. Nothing is written. The refusal sits in the one writer of extra.file_anchors for an existing task (lore anchor add, and lore_anchor_set over the tool protocol), so every path is covered.
Rejected option: invalidate (release) the no-branch claim when the anchor is added. That silently changes another run's lease mid-work, lets a different run take the task, and turns a visible conflict into an invisible one.
When this task lands: record the decision in the spec through the audited correction path (a lore rule propose correction on BR-1468 adding "an anchor cannot be added while a no-branch claim is open", plus an AC case asserting exit 4 and no anchor written), then a re-review.

Second item (2026-10-26). Root: the git facts probe is optional in TaskWorkflowService. Symptoms: (a) work-needs-branch (BR-1468) fires only when a probe is wired; (b) claim() without a probe writes a branch claim with no start_head, which the post-back-fill schema refuses. On int-356 this fails 7 tests: claim-session-fields (4), territory-replay (2), mcp-session-registry (1).
End state: the production composition (app.ts) always wires the git facts port; the port is a required constructor dependency, not optional. claim() with a branch whose start cannot be measured fails loud (exit 4, nothing written). Unit tests pass a fake port; there is no silent path. Done when those 7 tests are green with no skip, and an unwired probe can no longer type-check.

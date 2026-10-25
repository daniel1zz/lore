---
id: TASK-1739
type: task
role: plan
title: "Integrate lands a branch that deletes or renames a path a spec or knowledge doc code-anchors, leaving drift for every session"
status: draft
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Observed 2026-10-19: commit c3617042 (task-d3a-b, landed via lore integrate) deleted packages/lore/src/service/helper-scope-review.ts, which spec-session-trail-a-session-local-record-of-what-each-run-4 still code-anchored. The drift surfaced only after landing, in every session's turn-end review, and a peer session (lore-62) had to report it. The landing is the one point that knows both the deletion and the replacement. End state to design, alongside the own-diff judgment of spec-a-branch-s-own-diff-is-judged-at-integrate-the-turn-end: integrate computes the code anchors that the branch's own change deletes or renames (from git diff --name-status -M) and refuses, exit 4, listing each doc and anchor, until each anchor is moved (lore anchor rm/add) or the doc is invalidated; a rename moves the anchor automatically. Oracle: a throwaway repo where a spec anchors src/x.ts and a branch deletes it: integrate exits 4 naming the spec; after lore anchor rm it lands; a branch renaming src/x.ts to src/y.ts lands and the anchor reads src/y.ts.

---
id: TASK-505
type: task
role: plan
title: "Fix lore setup removal reaching through dev symlinks (D1-D4, D6)"
status: archived
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PRD-001
---
Implements D1-D4 and D6 of spec-lore-setup-deletes-repo-source-through-dev-symlinks, executed directly on main at the owner's instruction (no worktree, no subagent). D5 and D7 are deferred in the spec and carry no ACs.

Changes: RealSetupFsWriter.remove gains lstat-based presence (D1), unlinks a link target rather than following it (D2), refuses when an ancestor inside the boundary is a symlink (D3) with the scan bounded by the install root (D4); removeDirIfEmpty leaves a symlink alone and swallows ENOTDIR (D6); all six SetupService removal call sites pass boundary.

Verified failure-first: the four incident tests were RED before the fix, and stripping one call site's boundary turns AC-SL-2 RED.

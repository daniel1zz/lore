---
id: TASK-1730
type: task
role: plan
title: "lore bootstrap names only the business baseline root; the architecture tree root is unreachable from session start"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Found 2026-10-19: `lore bootstrap --json` reports `.data.root` = the business baseline root only ({"slug":"baseline-root"}); the architecture tree root (BASE-095, tree=architecture) appears nowhere in the bootstrap payload, so an agent starting a session cannot find the current-state architecture from the session-start overview. `lore search "architecture"` also does not rank BASE-095 in the top 4.

Expected: bootstrap names both tree roots (business and architecture) addressably, each with its tree label; check SPEC-205 BL-6 (bootstrap root pointer) before changing the shape, and keep existing consumers of `.data.root` working or migrate them in the same change.

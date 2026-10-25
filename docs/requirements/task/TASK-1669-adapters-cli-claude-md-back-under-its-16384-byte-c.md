---
id: TASK-1669
type: task
role: plan
title: "adapters/cli CLAUDE.md back under its 16384-byte ceiling"
status: archived
priority: high
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PRD-001
---
After today's landings packages/lore/src/adapters/cli/CLAUDE.md is 16499 bytes, over the module max_bytes ceiling of 16384 (lore status --check-claude-md). Evict detail into the corpus (the module's tier-2 knowledge doc, per lore governance claude-md) so the file holds only rules; do not just delete content. Oracle: lore status --check-claude-md reports the file within ceiling; bun run check:memory-files passes.

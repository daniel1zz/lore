---
id: TASK-1748
type: task
role: plan
title: "The store module memory file is over its byte ceiling on main"
status: archived
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Problem: packages/lore/src/store/CLAUDE.md is 16448 bytes on main (350ad2c9), over the module max_bytes ceiling 16384; `lore status --check-claude-md` exits 3 ([max_bytes]). It landed through 3289ef95 because the floor's `check:memory-files` (`lore context refresh --check`) reports every target within its ceiling for the same file.

AC: `lore status --check-claude-md` reports no [max_bytes] finding for packages/lore/src/store/CLAUDE.md; the evicted block lives verbatim in a knowledge doc linked from a one-line pointer in the file; `bun run check:memory-files` exits 0.

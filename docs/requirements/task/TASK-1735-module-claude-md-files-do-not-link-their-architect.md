---
id: TASK-1735
type: task
role: plan
title: "Module CLAUDE.md files do not link their architecture module cards (BASE-080..091)"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Found 2026-10-19: the 9 module CLAUDE.md files (core, store, service, ai, cli, mcp, http, eval, dashboard) never name their architecture module card (BASE-080..BASE-091 under BASE-079 "Architecture: current state"); grep for BASE-0 in them: 0 hits. A reader of a module file cannot reach its card, and nothing detects a card drifting from its module file.

Expected: each module CLAUDE.md links its module card by a stable address, the link is generated or checked (not hand-maintained prose), and a missing or dangling link turns an oracle red. Several module files are near their 16384-byte ceiling (service 264 bytes left), so the link must be short or generated into the managed section.

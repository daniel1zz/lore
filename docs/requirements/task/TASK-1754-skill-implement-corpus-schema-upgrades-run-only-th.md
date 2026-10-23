---
id: TASK-1754
type: task
role: plan
title: "[Skill:implement] Corpus schema upgrades run only through lore migrate schema; every other command refuses an older schema"
status: archived
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Decision (user, 2026-10-19): corpus schema upgrades run only through an explicit command.
Problem (observed 2026-10-19 landing migration 026): any lore command — read-only commands, integrate floors, hooks — that opens a corpus at an older schema rewrites it as a side effect. With many concurrent sessions nobody owns a rewrite of the largest table and nothing records who ran it: after 026 landed the shared corpus was already at 26 before the orchestrator's deliberate `lore status`, run by an unknown first command.
Approach: a new `lore migrate schema` upgrades the corpus to the binary's schema, inside the existing per-migration transactions, and records who ran it, from which working copy, the from/to versions and the duration (audit row); `--dry-run` lists the pending migrations. Every other command (CLI, MCP, HTTP, hooks) that opens a corpus at an older schema refuses with exit 4 naming the current and required versions and `lore migrate schema`; it never migrates. A corpus created by the running binary (lore init, throwaway test corpora) starts at the latest schema, so tests are unaffected; existing test fixtures that build an old-schema corpus and expect auto-migration call the migrate entry point explicitly. Release notes / `lore setup` output name the command after an upgrade.
AC: throwaway corpus built at schema N-1: `lore list` exits 4 naming both versions and `lore migrate schema`, user_version unchanged; `lore --mcp-server` and `lore serve` refuse the same way; `lore migrate schema` exits 0, user_version becomes N, one audit row records actor, from, to and duration; a second run prints that nothing is pending and writes nothing. Runner-produced red.

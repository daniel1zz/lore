---
id: KN-789
type: knowledge
role: knowledge
title: "Evicted from the CLI adapter module doc: exit codes, trace, anchor"
status: approved
priority: medium
created: 2026-10-20
updated: 2026-10-20
tags: []
---
# adapters/cli CLAUDE.md: evicted detail (exit-code history, trace enumerate, anchor advisory)

Verbatim blocks moved out of `packages/lore/src/adapters/cli/CLAUDE.md` to bring it back under its byte ceiling. The rule lines stay in the module file; the reasons and mechanism notes live here.

## Exit codes 8/9/10: why they exist, and the switch ripple

⛔ 8/9/10 exist so an unattended caller can tell "retry in 60s" from "misconfigured forever"; before them every gh transport failure collapsed into `1`. ⛔ Adding a `LoreError` member ripples to EVERY exhaustive switch over it, not just this one — `adapters/http/middleware.ts::loreErrorToStatus` and `eval/scenarios/placeholder-parse.ts::loreErrorMessage` both broke on the 8/9/10 addition and are NOT anchorable in advance by the task that adds the member.

## `trace` subcommand: `--enumerate` contract and retention

`--enumerate <field>` carries the SAME AC-FR-5 registry contract `status --enumerate` documents (`TRACE_COUNT_FIELD_ENUMERATORS`), strengthened two ways: the registry is keyed by a type DERIVED from the report shape, so a new `*_count` with no enumerator FAILS TO COMPILE; and enumerating `zero_hit_search_count` withholds literal query text unless `--raw-queries` is also passed. Startup runs bounded-batch retention pruning (`trace.retention_days`) unless `trace.enabled=false`.

## `anchor` advisory: task-only, file-anchor grammar

The non-resolving advisory is TASK-ONLY and consumes the FILE-anchor grammar — applying it to a `path#Symbol` anchor would probe the whole string as a literal path and report non-resolving every time, a guaranteed-false advisory; spec and knowledge are checked by `--check-drift` instead. `anchor add` + `create task --anchor` print a NON-BLOCKING stderr advisory naming each declared anchor that does not resolve on disk (exit code untouched, anchor stored — `service/anchor-resolution.ts`); `ready <plan>` injects the same cwd-rooted probe and carries `anchor_resolution` in `--json`, where `{probed:false}` (MCP/HTTP `ready`) is deliberately distinct from `{probed:true, unresolved:[]}`.

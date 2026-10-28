---
id: TASK-1978
type: task
role: plan
title: "[Skill:corpus] Open MCP-only tasks invalidated; open plans, tasks and knowledge drafts drop their MCP half"
status: archived
priority: high
phase: "Phase 3: Reconcile the corpus"
created: 2026-10-27
updated: 2026-10-27
tags: []
parent: PLAN-246
plan: PLAN-246
links:
  - {id: TASK-1933, type: blocks}
---
Estimate: M
Approach: main agent, corpus commands only; no code dependency. Invalidate MCP-only open tasks: task-tool-server-verifies-harness-run-by-process-ancestry (01M5TZWX0Q, claimed by a stale run of session 7903287b — release/invalidate per `lore invalidate --help`; record that plan #418's unlanded MCP commits are dropped at integration) and task-the-mcp-boot-carries-the-same-frozen-startup-cwd (01KZTRSMEA). Amend (drop the MCP half): 01KZ322T5Z (Face 1), 01M5V0HGXE, 01M5V0GGS4 P4, 01M5V9321S, 01M59XQSF6, 01M5KKGX77, 01M5CBVN25, 01M59Y7CZK, 01KZBHDFMZ, 01M0VY0FBK, 01M591HQYZ, 01M5CECYC8, plan #418's content; knowledge drafts 01M56QFRKE (MCP section) and 01M5CAEASW (McpRegistrar#add row). BR-1351: the pending modification in spec-a-lore-call-s-run-identity-is-injected-per-bash-call-and already omits the MCP sentence — re-check with `lore rule changes <that spec>` and record the check on plan #418; no edit. BR-569: correct the pending modification in spec-defect-clusters-round-2-part-a-sessions-seats-setup-init so its route list reads "(command line, web)" instead of "(command line, agent tools, web)": `lore rule propose <that spec> withdraw BR-569 --correction "lore MCP server removed (adr-retire-the-lore-mcp-server-the-cli-and-http-are-the-only)"` then `lore rule propose <that spec> modify BR-569 --statement "A saved verdict changes only by recording a new verdict. A general edit that would change a verdict record's structured details is refused with exit 4 naming the record action, on every route (command line, web); an edit that restates them unchanged is allowed." --correction "<same reason>"` (read `lore rule propose --help` first; the spec is locked). Do NOT touch any doc owned by lore-81 (Invariant I5): plan-decision-records-on-writes (01M5XPXPQV) and its tasks, plan-repeat-check-degradation-reported (01M5XPXQ7X).
Source: corpus map of 2026-10-27.
Dimensions: D-CORPUS
Scope-Alt: none
Covers: (supporting the spec's Goal)

AC:
- `lore get` of both MCP-only tasks shows them invalidated with a reason naming the retire ADR.
- For each amended doc, `lore get <doc> | grep -iE "lore_[a-z]+|--mcp-server|mcp server|mcp tool"` prints nothing.
- `lore ready <plan-418> --json` lists no task whose subject is MCP.
- `lore rule changes spec-defect-clusters-round-2-part-a-sessions-seats-setup-init | grep BR-569` shows "(command line, web)" and no "agent tools"; `lore rule changes spec-a-lore-call-s-run-identity-is-injected-per-bash-call-and | grep -A1 BR-1351` contains no "MCP".

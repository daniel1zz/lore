---
id: TASK-1957
type: task
role: plan
title: "[Skill:corpus] Baseline leaf bodies no longer describe the agent tool route"
status: archived
priority: medium
phase: "Phase 3: Reconcile the corpus"
created: 2026-10-27
updated: 2026-10-28
tags: []
parent: PLAN-246
plan: PLAN-246
links:
  - {id: TASK-1933, type: blocks}
---
Estimate: L
Approach: main agent, corpus commands only, after T6 lands. Find every live baseline leaf whose BODY (not its rule list) still describes the lore agent tool route / MCP / tool-server registration: `bun run mirror:export` in your session worktree, then `git grep -nliE 'agent tool route|agent tool interface|agent tools route|tool protocol|lore --mcp-server|mcp__lore__|MCP lore_|MCP returns isError|MCP stdio|tool-server registration|tool server (registration|de-registered)' -- docs/requirements/baseline` (≈26 leaves on the 2026-10-16 mirror, e.g. BASE-002 issue-loop, BASE-004 review, BASE-015 approve-a-document, BASE-031 attribute-work-to-a-run, BASE-032 install-the-agent-integration, BASE-038 judge-a-document, BASE-050, BASE-053 file-a-defect-report, BASE-054, BASE-070, BASE-075 standard-gates-and-write-paths, BASE-100, BASE-136 uninstall-an-integration). For each, add one pending revision that removes or rewrites the MCP-route sentence or open-question row (an open question that only asks about the agent tool route is removed), then `lore review <leaf>` + `lore approve <leaf> --item <item>`. Rule statements are changed by `lore rule apply` (T10) and AS/AD by T8, not here. Skip the mcp module card (T8 retires it).
Source: spec-remove-the-lore-mcp-server D8; S3 review 2026-10-27.
Dimensions: D-CORPUS
Scope-Alt: none
Covers: (supporting the spec's Goal; final check in T10)

AC:
- Every leaf found by the grep above has an approved revision without the MCP-route sentence (`lore get <leaf>` shows no pending revision).
- Re-running the grep after `bun run mirror:export` matches only rule-statement lines whose rule is in the spec's change set or is AS-6/8/9/19/AD-11 (T8), listed in the evidence.

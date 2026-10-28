---
id: TASK-1940
type: task
role: plan
title: "[Skill:corpus] ADRs, architecture tree, AS/AD rules and module card no longer describe a lore MCP server"
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
Estimate: M
Approach: main agent, corpus commands, after T6 lands. ADRs: invalidate adr-loreconfig-carriage-for-mcp-tools… (01KY8Z38VK) and adr-the-coverage-floor-s-mcp-arming… (01KYY22J8R) with `lore invalidate --superseded-by adr-retire-the-lore-mcp-server-the-cli-and-http-are-the-only --reason …`; amend ADR-044 (01M4MXYG8T) decisions 2/3, 01M5TZ6KN4 decision 4, ADR-002 (01KX0BA07R), ADR-048 (01M52SMXVE), ADR-053 draft (01M59HK2KK). Baseline: retire module card baseline-module-card-mcp-adapter (01M4J6Y3FN); revise baseline-lore-architecture, architecture-current-state, module-card-cli-adapter, module-card-ai, architecture-decision-records, service, dashboard, target-state nodes (one pending revision per item, then `lore review` + `lore approve --item`). Rules (`lore rule set <id> --statement …`, then review + approve; AS/AD cannot join a spec change set):
  - AS-6: "Adapters never let a failure escape their boundary: CLI maps every LoreError to an exit code, HTTP returns the JSON error envelope; every switch over LoreError is exhaustive."
  - AS-8: "Every gate and every write guard runs in the service layer, so a write is checked the same way whether it arrives through the CLI or HTTP. No write path honours LORE_GATE_BYPASS; only the read-only 'lore gate' pre-flight check, which writes nothing, reads it."
  - AS-9: "Every write that changes a spec's acceptance criteria passes the single AC write chokepoint (ac-write-chokepoint.ts). A write that replaces a spec's whole extra object (lore set, HTTP PATCH) also passes it, and is accepted only when it carries the stored criteria unchanged." Remove any example naming MCP lore_set.
  - AS-19: "Every audit entry written through an adapter records the surface the write came from (cli, agent, http_cookie or http_token; 'mcp' remains only on entries written before the tool server was removed) beside its acting identity, so one write is attributed the same way whichever surface it arrives through."
  - AD-11: "The claim-scoped corpus-write guard is armed only by the CLI loader (setCorpusWriteContext in adapters/cli/loader.ts); HTTP writes run with it unarmed. Tracked by issue #57 (open)."
Business-leaf body text is revised by the sibling task T8b, not here.
Source: corpus map of 2026-10-27; plan Risk R6.
Dimensions: D-CORPUS
Scope-Alt: ADR-045/049/047 and older ADRs that only list "CLI/MCP/HTTP" stay as historical records
Covers: (supporting the spec's Goal)

AC:
- `lore get` of both invalidated ADRs shows them invalidated, superseded by the retire ADR.
- `lore rule show AS-6|AS-8|AS-9|AS-19|AD-11` shows the new statement approved (not pending).
- `lore get baseline-module-card-mcp-adapter` shows it retired; `lore status --check-tree --check-drift` exits 0.

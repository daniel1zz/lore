---
id: PLAN-246
type: plan
role: plan
title: "Remove the lore MCP server"
status: approved
priority: medium
created: 2026-10-27
updated: 2026-10-28
tags: []
parent: SPEC-260
phases:
  - {name: "Phase 1: Remove consumers", description: "Parallel: T1 lore set --requires-uat, T2 setup registers no tool server, T3 decouple shared parity tests, T4 retire mcp_tool_count + reword messages/comments/skills, T5 drop the MCP hook matcher. Each removes an import of adapters/mcp or a runtime dependency on --mcp-server. T1 blocks T4 (SKILL.md text names the new flag); T4 blocks T5 (both regenerate packages/lore/src/generated/assets-manifest.ts)."}
  - {name: "Phase 2: Delete the server", description: "T6 deletes packages/lore/src/adapters/mcp/, the --mcp-server entry, @modelcontextprotocol/sdk, forWriteContext, the MCP half of read-side-by-filters, the bench script, MCP-only tests, CLAUDE.md/README references. Blocked by T2-T5 and T7a; merge additionally waits for lore-81's confirmation (Invariant I5)."}
  - {name: "Phase 3: Reconcile the corpus", description: "Main agent, corpus commands from the shared checkout. T7a supersede criteria whose command names a deleted MCP test (before T6 merges); T7b amend criteria/sections that only list MCP beside other surfaces; T8 ADRs, architecture tree, AS/AD rules, module card (after T6 lands); T9 open plans/tasks/knowledge drafts not owned by lore-81."}
  - {name: "Phase 4: Verify and close", description: "T10: full suite on main, lore verify, rule apply, fresh-consumer install check, mirror export, context refresh, spec anchors, remove this machine's lore MCP registration, notify lore-81."}
---
## Overview

Execute `spec-remove-the-lore-mcp-server` (ADR `adr-retire-the-lore-mcp-server-the-cli-and-http-are-the-only`): first remove every import of `adapters/mcp` and every runtime use of `--mcp-server` outside the adapter (Phase 1, parallel), then delete the server (Phase 2), reconcile the corpus (Phase 3, main agent, corpus commands only), and verify on main (Phase 4). Baseline: main 9bb6b4f9.

## Invariants

- I1 After every landing, `bun run check:floor` exits 0 on main (`lore integrate` refuses otherwise).
- I2 No task adds a line under `packages/lore/src/adapters/mcp/`; Phase 1 tasks only remove imports of it.
- I3 Read compat: every `"mcp"` literal still in `packages/*/src` after Phase 2 is one of the read-side sites named in the spec's Scope.Out (checked by AC-RMCP-1 + AC-RMCP-3).
- I4 No approved spec criterion's command names a test path that is deleted: T7a supersedes every such criterion before ANY task that deletes a test file lands (T7a blocks T5, T6a and T6).
- I5 Docs owned by session lore-81 (plan-decision-records-on-writes and its tasks; spec-a-decision-carrying-write-records-its-decision-on-its AC-DR-2/AC-DR-4; spec-a-filing-whose-repeat-check-could-not-read-the-filing-log AC-RL-2; plan-repeat-check-degradation-reported) are edited only by that session. T6 does not merge until lore-81 confirms those criteria no longer need an mcp-* test (agreed 2026-10-27).
- I6 Only the lore MCP server is in scope: references to other MCP servers in assets/skills stay.

## Risk Register

| # | Risk | Impact | Trigger | Mitigation | Contingency |
|---|---|---|---|---|---|
| R1 | Shared parity tests still import adapters/mcp after T3 | H | T6 typecheck fails on a test import | T3 AC: `git grep -n "adapters/mcp/" packages/lore/tests` lists only files T6 deletes | T6 deletes the stray MCP half under I2 |
| R2 | ~12 setup tests relied on MCP registration failing (exit 1) | M | setup tests red after T2 | T2 updates them to exit 0 and records why | none needed |
| R3 | Plan #418's unlanded branch (28 commits) touches call-scope.ts and conflicts with T6 | M | `lore integrate` exit 4 on the #418 branch | T9 invalidates its MCP-only task and records in plan #418 that MCP commits are dropped at integration | the #418 integrator drops them |
| R4 | lore-81 has not corrected its criteria when T6 is ready | M | T6 returned but I5 unconfirmed | message lore-81 at S4 approval | hold T6 merge; ask user if blocked > 1 session |
| R5 | BR-1351 and BR-569 cannot join this spec's change set (another unlanded spec already changes each) | L | `rule propose` refused (observed) | BR-1351's pending change already omits MCP (checked); T9 corrects BR-569's pending change to drop 'agent tools' (spec D7) | — |
| R6 | AS/AD architecture rules cannot be proposed in a spec change set (`rule propose` accepts BR-n only, observed) | L | — | T8 carries the full new statements and edits AS-6/8/9/19 and AD-11 with `lore rule set` after T6 lands, then review + approve | — |
| R7 | Generated packages/lore/src/generated/assets-manifest.ts serializes asset changes at integrate (open issue #307) | L | integrate refuses a branch touching it while another task holds it | only T4a and T5 touch assets/; T4a blocks T5 | — |

## Exit Criteria

All tasks archived; `lore verify plan-…` passes AC-RMCP-1…7; `lore rule apply spec-remove-the-lore-mcp-server` lands; `bun run test` green on main; `lore status --check-tree --check-drift` exit 0; this machine's `claude mcp list` has no `lore` entry.

## Decisions Log

- User (S1, 2026-10-27): read-compat for "mcp" values; setup does not clean old registrations; remove this machine's registration after landing; add `lore set --requires-uat` only; drop lore_batch/lore_schema/lore_context_bundle; no special `--mcp-server` handling; delete before #418 lands; coordinate with lore-81 by message.
- Strategy chosen: Dependency-Ordered (remove consumers → delete server → reconcile corpus → verify). Rejected: Big-Bang single task (one ~120-file diff, one red floor blocks everything, no parallelism); Corpus-First (amending ~35 specs before code would make the corpus describe a state that does not exist yet and demote specs for days).
- `lore agent` stays (API-key management, not an MCP entry); only its "Configure in .mcp.json" line is reworded (T4).
- No third-party research: pure deletion, no new library.
- S3 bundle review (2 lenses, 2026-10-27) applied in one pass: every modified/added rule now cited by the criterion that proves it (else `lore rule apply` refuses, landing-evidence.ts); AC-RMCP-1/3/6 cite live rules instead of rules this spec retires (new BR-1485, BR-1486; BR-1218); AC-RMCP-1 matches `--mcp-server` (not other MCP servers) and excludes the postinstall absence guard; new AC-RMCP-7 for the `lore status` surface change. Tasks: T4 split into T4a (skills, context variable, manifest) / T4b (messages + status, red-first) / T4c (comments only), all file-level anchors; MCP-only test deletion split into T6a (keeps every task under the 50-anchor cap without a directory hold); T3 keeps the AC-CRIT-6 CLI cases of list-omitted-invalid; AC-046-A / AC-RID-15 / AC-RID-16 moved from T7a (supersede) to T7b (amend) because their test files are edited, not deleted; T7a blocks T5 and T6a; T8 carries the full AS/AD statements and the three business-leaf body revisions; lore-81's spec removed from T7b.

- lore review round (2026-10-27): spec rejected 0.62 → applied: D2 exact mcp-literal file allowlist in AC-RMCP-1 (catches any write form); D5 explains why AC-RMCP-1 proves the route-only rule edits; D7 designs BR-1351 (already correct upstream) and BR-569 (T9 correction) end states; Scope.Out names the inert old hook entry (left for the user, like the registration); D8 corpus end-state check moved to T10 (a spec criterion must cite a rule and the only mirror rule, BR-1340, is changed here — citing it would deadlock rule apply); new T8b revises ≈26 baseline leaf bodies; vitest.node-files.ts moved to T6a. ADR rejected for missing parent → linked under the PRD.

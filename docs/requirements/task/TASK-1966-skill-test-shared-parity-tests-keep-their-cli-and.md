---
id: TASK-1966
type: task
role: plan
title: "[Skill:test] Shared parity tests keep their CLI and HTTP halves and drop the MCP half"
status: archived
priority: high
phase: "Phase 1: Remove consumers"
created: 2026-10-27
updated: 2026-10-27
tags: []
parent: PLAN-246
plan: PLAN-246
links:
  - {id: TASK-1959, type: blocks}
---
Estimate: L
Approach: test-only. In each shared test below delete the MCP half (the import of adapters/mcp/* or @modelcontextprotocol, the MCP client/transport setup, and the MCP-side assertions) and keep the CLI/HTTP halves unchanged. Delete a file only when MCP is its sole subject.
Source: code map of 2026-10-27 (spec-remove-the-lore-mcp-server, Scope "MCP half of shared parity tests").
Dimensions: D-CODE
Scope-Alt: none (T6 cannot typecheck while any of these import adapters/mcp)
Covers: (supporting AC-RMCP-1; no criterion of its own)

Files (packages/lore/tests/ unless noted; the four shared tests under tests/unit/adapters/ belong to T6, which anchors that directory): e2e/context-provenance-compiled (AC-CP-4 MCP half ~:233/276); e2e/resume-coverage-compiled (AC-RC-4 ~:447/504/532); integration/ac-superseded-readers (~:224); integration/autonomy-human-channel (~:215, keep HTTP only); integration/bulk-lifecycle (describe "mcp parity" ~:342-469); integration/cli/architecture-cli (~:234-248); integration/cli/baseline-root-navigation (~:400-448); integration/cli/list-omitted-invalid (drop the MCP describe ~:128-170 and its registerTools import; KEEP the AC-CRIT-6 CLI cases ~:94-126 — approved AC-CRIT-6 runs this file); integration/cli/report-issue-body-contract (~:374); integration/cli/write-attribution-matrix (~:629); integration/dc2-demotion-notice (~:192); integration/dc2-set-validation (~:164/194/210); integration/dc2-soft-delete-lifecycle (~:247); integration/gates/gate-hook-retirement-parity (~:214 and the MCP half of ~:231); integration/http/audit-surface ("AC-BLC-1 MCP surface" ~:166-176); integration/http/audit-verify-nonblocking (~:207 and the MCP leg of ~:300-373); integration/set-approval-gate-parity-surfaces (~:162-194); integration/write-requires-known-party (~:119); unit/service/ac-write-chokepoint (~:168/175/300); unit/service/rule-service (~:515); unit/service/claude-md-reference-grammar (~:53 `@reads mcp-tools.test.ts`); unit/service/landing-predicate-census (~:120-121 reads adapters/mcp/tools.ts text — delete those two assertions); unit/flows/blueprint-flow (~:4 comment).

AC:
- `git grep -n "adapters/mcp/\|@modelcontextprotocol" -- packages/lore/tests` run as `git grep -nl "adapters/mcp/\|@modelcontextprotocol" -- packages/lore/tests ':!packages/lore/tests/fixtures/**'` lists only: tests/unit/adapters/mcp-*.test.ts, tests/integration/mcp/*, tests/unit/assets/mcp-tool-count.test.ts (T6a deletes), tests/unit/adapters/{evidence-completeness-guard,evidence-dropped-file-guard,foreign-corpus-write-adapters,report-issue-required-flags,feedback-read-site-invariant}.test.ts, e2e/landing-from-git-facts-compiled, e2e/record-lock-compiled, unit/cli/write-commands-take-no-by, integration/cli-feed-task-start (T6 edits), unit/assets/registered-literal-lint (T4a), unit/distribution/postinstall (absence guard, kept).
- `bun run test:file <every edited file>` exits 0 on the worktree; `bun run typecheck` exits 0.
- No CLI/HTTP assertion is weakened: `git diff main --numstat -- <edited files>` shows 0 added lines per file, except import re-wrapping, each such added line listed with its reason in the evidence.

---
id: TASK-1849
type: task
role: plan
title: "[Skill:fix] Audit verify: narrow key read with covering index, worker runner for HTTP and MCP, anchor on every surface"
status: archived
priority: medium
phase: "P1"
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PLAN-235
plan: PLAN-235
---
Implements plan-audit-verify-reads-only-the-keys-it-joins-runs-off-the — read the plan (`lore get plan-audit-verify-reads-only-the-keys-it-joins-runs-off-the`): it carries the measurements, the three causes, design D1-D3, what was not chosen and why, and the acceptance. Governing spec: spec-079-audit-hardening-link-provenance-actor-fidelity-tamper (verdict unchanged).

Key code: packages/lore/src/service/audit-service.ts:387-437 (verify), :245-263 walkAuditChain, :270 checkAuditAnchor; store methods listAllVersions / queryAudit / listAuditChain in packages/lore/src/store/sqlite-store.ts (~1928, ~2682-2735) and the Turso and InMemory stores; HTTP route packages/lore/src/adapters/http/routes.ts:254 and :609-614 (handleAuditVerify); MCP tool packages/lore/src/adapters/mcp/tools.ts:~2730; CLI `lore audit verify` for anchor handling to mirror; app composition packages/lore/src/app.ts.

Review notes to honour:
- Open the worker's Turso store read-only and without sync (an embedded replica syncing from two threads can conflict); if libsql cannot open read-only, say so in your report before working around it.
- Pick a fixed, practical fixture size that still proves payload independence (e.g. 60k audit rows, 50k versions, content sized so the full-row read dominates); do not copy 886 MB. Measure p95 over enough requests to be stable; if a 50 ms bound is flaky on this machine, report the measured distribution rather than loosening it silently.

Oracles: one file per acceptance bullet group, red first (`--result expected-fail` on the current code), then green; record with `lore evidence <task> --oracle test --result pass --capture --command "<exact command>"`, tsc via `--oracle tsc --capture --result pass --command "bun run typecheck"`. Suggested: packages/lore/tests/integration/http/audit-verify-nonblocking.bun.test.ts, packages/lore/tests/unit/service/audit-verify-narrow-read.bun.test.ts, packages/lore/tests/unit/app/audit-verify-runner.test.ts. Re-run the existing audit-tamper and audit-anchor tests.

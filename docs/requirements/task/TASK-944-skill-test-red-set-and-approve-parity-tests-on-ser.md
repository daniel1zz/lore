---
id: TASK-944
type: task
role: plan
title: "[Skill:test] RED - set and approve parity tests on service and MCP surface (#65, #50)"
status: archived
priority: high
phase: "approval-parity"
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PLAN-154
plan: PLAN-154
links:
  - {id: TASK-943, type: blocks}
---
Estimate: M
Source: spec-approval-and-plan-closure-go-through-the-same-checks-on AC-AP-1, AC-AP-2, AC-AP-3 (statements are the contract; read them with `lore ac list <spec>`)
TDD-Role: red | Paired-Impl: task-skill-implement-set-to-approved-delegates-to-the-approve
Scenarios:
- NEW packages/lore/tests/integration/set-approval-gate-parity.bun.test.ts (AC-AP-1 cases a, b, c, d, e, f, f2, g, h): createApp on a mkdtemp SQLite corpus (never the repo's .lore/). Twin docs per case: one driven by corpusService.set, one by reviewService.approve; compare error code + message; count version and audit rows before/after. Judgments for the doc's CURRENT version via the app's judgment service.
- NEW packages/lore/tests/integration/set-approval-gate-parity-surfaces.bun.test.ts (AC-AP-2 cases a-f): MCP via registerTools on an in-process McpServer (pattern tests/integration/http/audit-surface.bun.test.ts), CLI via subprocess 'bun run src/index.ts' in the throwaway corpus, HTTP via real startHttpServer with a bearer token (stale expectedVersion -> 409 STALE_VERSION).
- RE-BASELINE packages/lore/tests/unit/service/tiered-review.test.ts (AC-AP-3): makeApp (:131-140) wires setApprovalPort as app.ts will; the :318 case approves through a judgment. Keep every describe name.
Dimensions: HAPPY (d, e, f2), NEGATIVE (a, b, c, h), BOUNDARY (g already approved; f2 echoed values), ERROR (f changed field; stale version), STATE (row counts), REGRESSION (tiered-review :318).
AC:
- Run every listed file against current main. New cases must fail on ASSERTIONS, not harness errors; a red that is a call to the not-yet-existing method the paired task adds (TypeError ... is not a function) is acceptable only for that method; say so in the evidence.
- At the moment of red, the agent that ran it records `lore evidence <this task> --oracle <test|e2e> --command "<exact command> 2>&1" --result expected-fail --capture`, one row per file (`2>&1` is required: --capture stores all stdout then all stderr, so without it the runner summary can fall out of the stored tail). Never transcribe a red later.
- Commit the tests on this task's branch; the paired implement task branches from that commit; never merge red to main alone.

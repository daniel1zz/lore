---
id: TASK-943
type: task
role: plan
title: "[Skill:implement] set to approved delegates to the approve path through an injected ApprovalPort (#65, #50)"
status: archived
priority: high
phase: "approval-parity"
created: 2026-10-12
updated: 2026-10-28
tags: []
parent: PLAN-154
plan: PLAN-154
links:
  - {id: TASK-930, type: blocks}
  - {id: TASK-956, type: blocks}
  - {id: TASK-939, type: blocks}
  - {id: TASK-925, type: blocks}
---
Estimate: M
Approach: (1) CorpusService (corpus-service.ts): declare `ApprovalPort` structurally (no import from review-service.ts), add `setApprovalPort(port)` beside `setCiteGate`/`setRuleStateService`. In `set()` (:2106), when the patch requests `status: "approved"` and the stored status is not approved: compute the CHANGED fields (value differs from stored; deep equality for extra/tags); if any changed field or a `correction` option is present return VALIDATION_ERROR field `status` naming the two-step form, before any write (D4); else, with a port wired, return `port.approve(id, { reviewer: <resolved actor>, expectedVersion: opts.expectedVersion, ...<the WriteActorOpts set() received> })` mapped to the set result shape (D1, D2) and remove the set-local spec-promote (:2587) and BR-1007 (:2609) blocks on this path; with no port keep today's direct write (D3). (2) ReviewService.approve (review-service.ts:676): accept `expectedVersion` (STALE_VERSION when it differs from the read version, before any write, so HTTP/dashboard return 409) and the same attribution options set() honours, declared structurally. (3) app.ts: hoist `reviewService` into a `const` at both App construction sites (~:799, ~:1171), then `corpusService.setApprovalPort({ approve: (id, o) => reviewService.approve(id, o) })` at both CorpusService sites (:713, :1103). Do not touch the ledger fast-track (:2976-3027).
Affected-test enumeration (run it; every file it prints that drives a composed App/CLI and sets approved without a judgment must be re-baselined — anchor any unlisted one with `lore anchor add` before editing): `grep -lE 'createApp|src/index\.ts|dist/lore|startHttpServer|registerTools|loadLoreApp|runLore|cli-live-rule' $(grep -rlE '"--status",[[:space:]]*"approved"|--status approved|status:[[:space:]]*"approved"' packages/lore/tests)` — 36 files on 2026-10-12. Known re-baselines (anchored): unit/adapters/cli-adr-decision-status.bun.test.ts:242, unit/service/gate-evaluation-trace.test.ts:297, tests/helpers/cli-live-rule.ts, integration/gate-enforcer-service-layer.bun.test.ts, integration/gate-spec-promote.bun.test.ts, unit/service/requires-uat-gate.test.ts, integration/gate-hooks.bun.test.ts, integration/archive-sweep-cli.bun.test.ts:261 (its plan approval only; the straggler case is re-baselined by task-skill-implement-archive-apply-honours-the-done-floor-port), e2e/bootstrap-injection-compiled.bun.test.ts:346. Each re-baseline reaches approved through a judgment (or `lore approve --override-no-judgment` where the test is not about judging) and records the original assertion + why in its evidence note. Run every enumerated file scoped (vitest vs bun by suffix), `bun run build` before compiled ones, `bun run typecheck`.
Source: spec-approval-and-plan-closure-go-through-the-same-checks-on D1-D4; issues #65, #50; facts corpus-service.ts:2106/:2569-2612, review-service.ts:676/:260/:279, routes.ts:803, dashboard-routes.ts:320-326.
Dimensions: D-FUNC, D-CODE
Scope-Alt: none
Covers: AC-AP-1, AC-AP-2, AC-AP-3, AC-AP-8

AC:
- AC-AP-1, AC-AP-2 and AC-AP-3 commands print their PASS lines (they were red at the paired RED task).
- Every file printed by the enumeration command passes under its runner.
- `bun run typecheck` exits 0; `grep -c '\.setApprovalPort(' packages/lore/src/app.ts` equals the assignment-form CorpusService count (2).
- Commit before attesting; stop at `lore release`.

---
id: TASK-1502
type: task
role: plan
title: "[Skill:implement] TG-6 check-prose-pins with ledger and pre-push wiring; fix four prose pins"
status: draft
priority: high
phase: "Phase 3: guards"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-201
plan: PLAN-201
links:
  - {id: TASK-1500, type: blocks}
  - {id: TASK-1493, type: blocks}
  - {id: TASK-1496, type: blocks}
---
Estimate: M
Approach: New scripts/check-prose-pins.ts modelled on scripts/check-test-budgets.ts (pure scanFile + checkLedger, stale entries fail). Scope packages/**/tests and scripts/tests; a file that reads assets/, docs/, *CLAUDE.md*, SKILL.md or .claude/rules/ is flagged for each positive toContain/toMatch/includes whose argument is a string or regex literal of 5 or more words; .not. assertions and imported constants are not flagged. Exceptions in scripts/prose-pin-ledger.json {file, literal_fingerprint, consumer, reason}. Wire into the package.json test chain next to check:ac-state-renderers and into hooks/pre-push guarded by file existence (as check-anchor-coverage.ts at :79-81), with assets/project/pre-push byte-identical (pre-push-parity.test.ts:100) and the assets manifest regenerated. Fix the 4 prose pins: packages/lore/tests/unit/assets/claude-md-contract-content.test.ts (101-144, 164-176, 202-212, 230-237, 259-264 → headings + key tokens; byte identity already held by the manifest sha at :184), packages/lore/tests/integration/claude-md-template-pointer.test.ts (:73 RULES_POINTER_TEXT → .claude/rules/*.md between the managed markers; same in setup-claude-md-adoption.bun.test.ts), packages/lore/tests/unit/setup-governance-retirement.test.ts:376-394 (→ latest_handoffs plus NEVER + handoff in one bullet of corpus-workflow-feed; duplicate in context-provenance-compiled.bun.test.ts:451), packages/lore/tests/e2e/plan-close-known-false-pass.bun.test.ts:165-166 (delete). Ledger the 10 contract-string files (pre-push-parity, pre-push-trip, real-setup-ports, setup-render, cli-drift, knowledge-code-anchor-drift, gate-enforcer-service-layer, gate-feeding-fresh-install, session-bootstrap-injection, session-bootstrap-seat-injection) with their consumer.
Source: spec-test-governance-guards-that-refuse-bad-tests-declared
AC: AC-TG-4; and check-prose-pins exits 0 on the real tree.

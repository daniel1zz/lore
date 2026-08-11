---
id: TASK-460
type: task
role: plan
title: "[Skill:test] RED projection splice suite binding the exact command of the first acceptance criterion"
status: archived
priority: medium
phase: "Phase 1: Pure Core"
created: 2026-07-27
updated: 2026-08-01
tags: []
parent: PLAN-088
plan: PLAN-088
---
Objective: author the RED vitest suite for AC-CTX-1 at the exact path packages/lore/tests/unit/service/context-projection.test.ts. Cover: five-state transitions (created/updated/unchanged/diverged_skip/appended), diverged_skip on fingerprint hash mismatch, splice idempotency (second apply byte-identical), Z2 byte-preservation on every path, CRLF tolerance, missing end-marker VALIDATION_ERROR fail-loud. Fixture builder pattern per claude-md-check.test.ts precedent. Suite MUST fail (module absent) at authoring time — record red run output. Spec: lore get spec-context-verb-family-two-zone-claude-md-anatomy-lore (Public Interface section is the contract).

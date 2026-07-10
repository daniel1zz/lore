---
id: TASK-084
type: task
role: plan
title: "T4: best-effort gate push + e2e closed-loop + full sweep"
status: archived
priority: high
phase: Push + e2e
created: 2026-07-09
updated: 2026-07-09
tags: []
parent: PLAN-021
plan: PLAN-021
---
## Task Objective
1. **Best-effort gate allow-path push** (§5.4): in `runSpecCreateGate`'s ALLOW branch, attempt to attach the applicable feed (same `lore feed` content) as PreToolUse `additionalContext`. FIRST verify whether Claude Code's PreToolUse allow decision can carry context (check hook output schema / docs). If it cannot, DO NOT force it — leave the pull path (T2) as the guaranteed surface and document the finding in a code comment. ⛔ Never block, never change the allow verdict. This is explicitly NON-AC-blocking.
2. **e2e closed-loop** (AC-P4-7) on a THROWAWAY corpus: seed an approved knowledge/skill (applies_to=spec) -> `lore feed spec-create` returns its slice (BEFORE producing) -> create the spec -> assert a governs link was auto-written -> `lore list --governed-by <skill>` lists the spec -> reverse nav confirms the backlink.
3. **Full oracle sweep**: `bun run typecheck`, `bun run test:vitest`, `bun run test:bun` — all green. Record attested evidence.

## Spec Reference
§5.4, §10 AC-P4-7, §11.4. Depends on T2 (feed) + T3 (provenance) landed.

## Acceptance Criteria
- AC-P4-7 e2e passes (feed-before-produce + provenance loop end-to-end).
- Push: either wired (if allow can carry context) OR documented-as-not-supported with pull as guaranteed fallback — no false block either way.
- Full sweep green.

## Context Digest
Throwaway corpus pattern: `packages/dashboard/tests/e2e/global-setup.ts` + existing `packages/lore/tests/integration/gate-*.bun.test.ts`. `runSpecCreateGate` is in `packages/lore/src/adapters/cli/commands/gate.ts` (allow branch prints "gate: pass"). Claude Code PreToolUse hook output: check whether `hookSpecificOutput` supports an `additionalContext` field on allow (it does for UserPromptSubmit; verify for PreToolUse).

## File Anchors
- EDIT `packages/lore/src/adapters/cli/commands/gate.ts` (allow-path push, best-effort)
- NEW `packages/lore/tests/integration/p4-e2e-*.bun.test.ts`
- READ dashboard e2e global-setup, existing gate integration tests

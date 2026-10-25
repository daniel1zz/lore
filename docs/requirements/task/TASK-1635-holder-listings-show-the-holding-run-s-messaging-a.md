---
id: TASK-1635
type: task
role: plan
title: "Holder listings show the holding run's messaging address"
status: archived
priority: high
phase: "surface"
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PLAN-213
plan: PLAN-213
---
Estimate: M
Covers: AC-MA-3, AC-MA-4 (spec-runs-carry-their-messaging-address-holder-listings-show-it; BR-1363, BR-1360)
Blocked by: T1 and task-claims-compare-runs-only-the-store-refuses-a-run-less (it edits task/phase workflow services, SessionService and core/task-workflow.ts, and makes run-less claims unconstructible).

## Approach

1. `readySessionSchema` (`packages/core/src/session.ts:667`, snake_case) gains `message_address: string | null`. `deriveSessions` (:745, groups by by/machine/worktree/session_id at :786-791) stays pure: it takes a lookup `harness_run -> main-run message address | null` as input. A group spans the main run and its subagents; resolve each claim's `harness_run` (claim schema field, `packages/core/src/task-workflow.ts:813`) to its run, then compute the session's main run id with `deriveRunId(run.harness, { sessionId: run.sessionRef })` (`packages/core/src/run-identity.ts:130`) and take that main run's address (BR-1363). Do NOT follow `parentRunId`: the hook never passes `--parent`, so in production every subagent run stores parentRunId NULL. Never join on `claim.session_id` or display name (Invariant I3).
2. Callers build the lookup from the store: `SessionService.computeActiveSessionsFrom` (session-service.ts:1219), task ready sessions (task-workflow-service.ts:5176), phase ready sessions (phase-workflow-service.ts:1419; no production caller, schema consistency only), territory (`commands/territory.ts:100` → `territory-partition.ts` foreign holder shapes :120/:189, text :360 prints the address). `lore ready` text: `formatSessionLine` (`commands/ready.ts:156`) prints the address. `packages/lore/src/flows/task-feed-flow.ts:219` narrows the type and needs no change (confirm with typecheck).
3. Dashboard: `packages/dashboard/src/lib/api.ts:870` ReadySession type and `packages/dashboard/tests/component/SessionsPanel.test.tsx:28` fixture gain the field.
4. e2e drives the built dist/lore with the installed hook in a mkdtemp project (pattern: tests/e2e/run-identity-e2e.bun.test.ts, dist/lore first on PATH at :75).

Source: lore-reader survey and bundle review 2026-10-20.

## AC

- Red first: write `packages/lore/tests/unit/service/holder-message-address.bun.test.ts` and `packages/lore/tests/e2e/run-message-address-e2e.bun.test.ts`; capture failing, then implement.
- AC-MA-3 and AC-MA-4 commands exit 0.
- Scoped floor: session-active-sessions-corpus-wide.test.ts, active-sessions-branches.bun.test.ts, claim-session-identity.test.ts, territory-partition.bun.test.ts, territory-replay.bun.test.ts, bootstrap-plan-membership.bun.test.ts, claim-session-capture-app-wiring.bun.test.ts, SessionsPanel.test.tsx, every file importing deriveSessions or readySessionSchema; `bun run typecheck` exit 0.

Scope-Alt: none; text lines and JSON fields are both in BR-1363.

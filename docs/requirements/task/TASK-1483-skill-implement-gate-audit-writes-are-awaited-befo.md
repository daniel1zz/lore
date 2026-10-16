---
id: TASK-1483
type: task
role: plan
title: "[Skill:implement] Gate audit writes are awaited before the store closes (deny path loses its audit row)"
status: draft
priority: high
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-197
plan: PLAN-197
---
Estimate: M
Approach: GateEnforcer.fireAndForgetAudit (gate-enforcer.ts:866-883) does not await the audit write; the sqliteStore is wrapped by withVerifiedWriteContext whose write awaits verifyOnce() (store/write-context-store.ts:191-194), so after a gate deny the CLI's app.close() -> releaseHandles() (app.ts:1053-1059) closes the store first and the deferred write fails ('gate-not-applicable audit not recorded ... Database has closed', gate-enforcer.ts:899). Track in-flight audit writes in GateEnforcer (like pruneState.inFlight) and await them in close() before releasing the store.
Source: lore set plan-round-0-make-main-green --status archived, 2026-10-16.
AC:
- after a CLI gate deny, the gate_not_applicable audit row is present (lore audit) and no 'Database has closed' warning is printed

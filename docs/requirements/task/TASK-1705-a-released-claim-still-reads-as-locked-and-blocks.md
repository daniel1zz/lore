---
id: TASK-1705
type: task
role: plan
title: "A released claim still reads as locked and blocks other sessions' anchor edits"
status: deprecated
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Observed 2026-10-19 (session 482f1e89) on task-the-main-ref-guard-refuses-checkout-of-main-integrate after its work landed (49278da8): `lore release <task>` exits with 'Task has no active claim to release' (the implementer released at v113), yet `lore get <task>` prints 'Standing: record · locked (claimed)' and 'Last write: … claimed: agent:session-482f1e89 (session)', and another session's edit-time anchor gate refused an edit to one of the task's anchors (packages/lore/tests/e2e/bootstrap-seat-injection-compiled.bun.test.ts) as 'held by the live claim of <task> (holder agent:session-482f1e89)' (relayed by session lore-81; verbatim text not captured).

Question to settle first: which state is true — a live claim the release path cannot see, or a released claim that the standing renderer and the anchor gate still read as live. Then one claim-liveness predicate, shared by release, the get renderer and the edit gate.

AC: on a throwaway corpus, a task claimed and then released: `lore get` does not print 'locked (claimed)', and an edit of its anchor by another actor is not refused as held by that task; a task still claimed: release succeeds and the gate refuses.

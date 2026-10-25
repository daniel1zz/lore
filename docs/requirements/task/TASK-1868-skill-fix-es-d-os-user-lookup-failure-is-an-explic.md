---
id: TASK-1868
type: task
role: plan
title: "[Skill:fix] ES-D OS user lookup failure is an explicit Invocation value, not an entry crash"
status: archived
priority: medium
phase: "P1"
created: 2026-10-18
updated: 2026-10-19
tags: []
parent: PLAN-240
plan: PLAN-240
---
Defect from ES-B (found by a lore assess of another plan, 2026-10-19): `resolveInvocation` (packages/core/src/invocation-node.ts:58) calls `userInfo().username` eagerly. That OS lookup can throw (e.g. no passwd entry for the uid in a container); before ES-B it was a lazy source reached only when the OS-username tier of actor resolution was actually taken (see packages/core/src/actor-resolution-node.ts docs, `osUsername` param). Now every lore invocation would fail at the entry in such an environment.

End-state fix (spec-process-state-end-state-one-invocation-per-entry-returned D1, no fallback, no deferred process read below the entry):
- The entry still performs the lookup once, but records its outcome explicitly: `Invocation.user` becomes a discriminated value, e.g. `{ ok: true, name: string } | { ok: false, reason: string }` (core type, no Node import).
- Actor resolution takes that value. Only when the OS-username tier is the one selected and the value is a failure does resolution fail loud (LoreError naming the reason); every other tier (explicit, session, worktree-derived) is unaffected.
- No thunk in the Invocation (a thunk would move the process read below the entry), no silent substitute name.

Acceptance (oracle `packages/core/tests/es-invocation-user.test.ts`, red first):
- `resolveInvocation` with a user lookup that throws returns an Invocation (does not throw) whose `user` is the failure with the thrown message as reason;
- `resolveActor` with an explicit/session/worktree-derived identity succeeds regardless of a failed user lookup;
- `resolveActor` that must fall through to the OS tier with a failed lookup returns/raises the LoreError naming the reason (exit 4 path through the CLI).
Inject the lookup into the resolver for the test (the resolver already takes injected resolvers: `InvocationResolvers`); production passes `() => userInfo().username` from the entry.
Update every consumer of `inv.user` (grep `\.user\b` in packages/*/src and tests) and the `liveInvocation()` test helper.
Add a one-line `reason:` comment at the lookup site citing the throw case.

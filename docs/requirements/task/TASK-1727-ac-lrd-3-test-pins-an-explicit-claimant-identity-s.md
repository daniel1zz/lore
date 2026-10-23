---
id: TASK-1727
type: task
role: plan
title: "AC-LRD-3 test pins an explicit claimant identity so it does not depend on the runner's environment"
status: archived
priority: high
phase: "P2"
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PLAN-220
plan: PLAN-220
---
lore verify of AC-LRD-3 from the shared checkout failed case (4): with no agent identity in the environment the actor fell back to the OS username, and the claim on another working copy tripped the same-name check (ACTOR_IDENTITY_COLLISION, BR-134) instead of exercising BR-1337. Inside the implementer's worktree the agent identity masked this. End state: every lore invocation in the test gives an explicit identity (as the sibling landing tests do), so the result never depends on who runs it. AC: AC-LRD-3 passes under lore verify from the shared checkout.

---
id: TASK-993
type: task
role: plan
title: "plan-promote does not check that a removed channel's consumers are all inside some task's anchors"
status: draft
priority: medium
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"planning","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"4b7c548b-72cb-4439-a159-c48aebfd7e9f"}
---

spec-run-only-write-identity-and-run-end-claim-release removed the LORE_ACTOR channel. The plan's anchors came from the spec prose, so packages/core/src/run-identity-node.ts (resolveInvocationIdentity read the env tier) belonged to no task, and about 90 test files injected identity through LORE_ACTOR. T1 needed two retries (5 + 6 red tests found only on main).

**Expected:** When a spec declares it removes a symbol/flag/env channel, plan-promote requires a census (grep of the channel) whose hits all fall inside declared task anchors, or an explicit exemption
**Actual:** Anchors are whatever the planner typed; consumers outside them surface as red tests after merge

Reported by: agent:session-e25636da

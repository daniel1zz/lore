---
id: TASK-879
type: task
role: plan
title: "lore-plan's TDD injection (test task blocks impl task) is unsatisfiable under lore done's floors"
status: draft
priority: medium
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"workflow-deadlock","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"a7ab5fc9-9877-495b-8253-4da73ae6c7b7"}
---

The lore-plan skill (mode-create §5.4) wires every [Skill:test] RED task as a 'blocks' blocker of its paired implement task. 'lore done' on the RED task requires (a) a result:pass row carrying attestation and (b) an unfiltered oracle:test pass run for EACH declared test-file anchor. Neither can exist until the implement task lands, and the implement task cannot become ready until the RED task is archived. --override-attestation clears (a) but not (b). Result: every TDD pair in a lore-planned plan deadlocks after the RED phase.

**Expected:** Either the skill wires test→impl with an artifact edge that is satisfied by the RED tests reaching main (not by archive), or lore done recognises a RED-role task (extra.red_first / TDD-Role: red) whose closure is gated on expected-fail evidence and closes after the paired impl's pass.
**Actual:** Deadlock; resolved by hand by unlinking the five edges (plan-claude-md-root-section-structure-check-and-adoption-mode D5).

Reported by: agent:main-orchestrator

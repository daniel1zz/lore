---
id: TASK-852
type: task
role: plan
title: "A resume ticket structurally cannot name the project goal: handoff has no goal anchor, and SCOPE CLOSURE explicitly excludes the one field that points at the root PRD"
status: draft
priority: medium
created: 2026-08-25
updated: 2026-08-25
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"resume-completeness","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"5018725b-7c60-403f-8239-993b0071e84c"}
---

Measured on this corpus 2026-08-25 while resuming knowledge-handoff-agent-main-orchestrator-133.

'lore feed session-resume --handoff <slug>' emits exactly four blocks: the handoff body, a PLAN-SCOPED readiness line, a COVERAGE FLOOR, and a SCOPE CLOSURE. Nothing in that output names the product goal, the root PRD, or any global progress figure.

The SCOPE CLOSURE block goes further than merely omitting it. Verbatim: 'It is NOT any of the corpus-global bootstrap injection fields: resume_hint, my_claims, active_sessions, armed_gates, root, pending_reviews, active_plans, latest_handoffs, corpus, archive_candidates.' The 'root' field is precisely the one that resolves the root PRD. So the resume protocol does not just fail to supply the goal — it instructs the resuming agent that the goal-bearing field is out of scope.

Consequence measured in this session: the resuming agent could enumerate the ticket's 5 decisions and 7 next steps, but could not state what the project's original objective was, and had to be asked by the human before it queried prd-lore-internal-first-ai-team-knowledge-platform (created 2026-06-07, version 76, which carries goals G1-G13 and a stated 9-12 month internal-first horizon). Without that human interjection the agent would have treated the ticket's NS1-NS6 as the totality of the work.

Population, so this is not read as a one-off: 136 handoff docs exist in this corpus. Every one is a plan-local snapshot. None carries a goal anchor, because the type has no field for one.

North Star mapping: fails 'Does this conclusion still hold with NO human present?' The corrective information arrived only because a human asked.

**Expected:** A resume ticket is self-sufficient for orienting a fresh session: it names the governing goal (root PRD or equivalent) and the ticket's position relative to it, so the resuming agent can tell local next-steps apart from the overall objective with no human interjection. Mechanically: 'lore handoff' accepts (or derives) a goal anchor, 'lore feed session-resume' renders it, and SCOPE CLOSURE distinguishes 'not your worklist' from 'not knowable to you' rather than lumping the goal-bearing 'root' field in with the ten corpus-global worklist fields it correctly excludes.
**Actual:** 'lore handoff' has --plan, --decision, --next, --file and no goal/PRD/progress parameter at all, so no handoff can carry a goal anchor even if its author wanted to. 'lore feed session-resume' renders only plan-scoped readiness. SCOPE CLOSURE names 'root' in its exclusion list, actively steering the resuming agent away from the only field that resolves the root PRD. Result: the resuming agent knows its 12 ticket items and not what the project is for.
**Repro command:** `lore feed session-resume --handoff knowledge-handoff-agent-main-orchestrator-133 2>&1 | grep -cE 'prd-|root PRD|G1|objective'   # prints 0; then: lore handoff --help 2>&1 | grep -cE -- '--goal|--prd|--objective'   # also prints 0`

Reported by: agent:main-orchestrator

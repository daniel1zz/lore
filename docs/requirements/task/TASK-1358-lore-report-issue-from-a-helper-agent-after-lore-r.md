---
id: TASK-1358
type: task
role: plan
title: "lore report-issue from a helper agent after lore release files the GitHub issue but its local corpus task is refused (gate:corpus-write:foreign-provenance)"
status: draft
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"issue-loop","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"a455a0a4-75c8-4bf2-ba8b-03c00fdd5860"}
---

Measured 2026-10-15: a lore-implementer subagent, after releasing its task, ran lore report-issue; GitHub issue #202 was created but the local task-gh-…-202 write was refused with gate:corpus-write:foreign-provenance. The two halves of one report diverged silently: the issue exists upstream with no corpus task, so lore issues --local, resolves links and done-closes could not see it until the main agent ran lore issue adopt 202 by hand.

**Expected:** Either both halves land (the local report task is a sanctioned write for any run, or is written before the GitHub call) or neither does, with the refusal naming lore issue adopt <n> as the repair
**Actual:** GitHub issue created, local corpus task refused; the report is invisible to the corpus until adopted by hand

Reported by: agent:session-66711aa8

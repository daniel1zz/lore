---
id: TASK-1347
type: task
role: plan
title: "lore-design: mode must be the first arg token, but the skill description never says so"
status: draft
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"skill-ux","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"a2031bdb-e13f-41db-851d-e2bba873b14f"}
---

The only text a caller sees before loading lore-design is its description, which does not mention that the first token of args is taken as the mode (architecture|api|database|system|module). A prose args string makes the first word the mode, the skill loads in full (~6k tokens), then refuses and asks for a re-invoke. Observed in a session: args starting 'Author ...' -> 'Mode: Author' -> re-invoke needed.

**Expected:** Description advertises the arg shape ('<mode> <context>'), or the skill infers/asks for the mode without a wasted full load
**Actual:** assets/skills/lore-design/SKILL.md:3 description has no arg contract; mode validation only happens after the body is loaded

Reported by: agent:session-ee1cedaf

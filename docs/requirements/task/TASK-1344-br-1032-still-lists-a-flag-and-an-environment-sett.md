---
id: TASK-1344
type: task
role: plan
title: "BR-1032 still lists a flag and an environment setting as sources of the recorded actor name, contradicting BR-1055 (no flag or environment setting supplies identity)"
status: draft
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"baseline-integrity","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"ebd68ee2-4457-4cfd-a2ee-c37563035393"}
---

Found 2026-10-15 while re-approving baseline-attribute-work-to-a-run after a rule landing: the judge escalates on two live established rules contradicting each other. BR-1032 names flag / environment setting / tool argument / working copy as name sources; BR-1055 says the environment never supplies a name and no write command takes --by; the working-copy source (BR-1022) is retired. The leaf cannot be approved until the rules agree.

**Expected:** BR-1032 restated to the sources BR-1055 and the code (utils.ts::resolveActorWithSource) actually allow
**Actual:** Two established rules contradict; the leaf stays draft

Reported by: agent:session-66711aa8

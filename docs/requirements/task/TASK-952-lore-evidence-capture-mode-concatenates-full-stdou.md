---
id: TASK-952
type: task
role: plan
title: "lore evidence capture mode concatenates full stdout then full stderr, so without 2>&1 the summary line falls out of the tail window"
status: archived
priority: medium
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"tool-quirk","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"e7a057de-be80-4674-ad8e-492120c3b718"}
---

In capture mode, lore evidence stores stdout followed by stderr (not interleaved) and keeps a 4000-char tail; a runner that prints its summary on stdout and noise on stderr loses the summary unless the command itself adds 2>&1 (user-05 prose). Documented today only as prose in the user layer (D4 of spec-rule-store-git-tracked-fragment-selection-on-demand-skill): the prose stays until this is fixed.

**Expected:** Capture interleaves the streams or keeps the stdout summary in the tail
**Actual:** Summary line can be pushed out by trailing stderr

Reported by: agent:session-e25636da

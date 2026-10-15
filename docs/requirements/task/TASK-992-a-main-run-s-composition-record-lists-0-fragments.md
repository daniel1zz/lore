---
id: TASK-992
type: task
role: plan
title: "A main run's composition record lists 0 fragments although 22 static lore rules files are loaded at its start"
status: draft
priority: medium
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"run-identity","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"0f91cae8-a252-4352-afdb-3d0f4bacbac8"}
---

lore run register computes composition from the hook:session-start outlet only (packages/lore/src/adapters/cli/commands/run.ts computeComposition), which selects dynamic main fragments. All main-audience fragments today are static and reach the session through rules files (~/.claude/rules/lore-user-*.md x17, <project>/.claude/rules/lore-*.md x5), which the composition never lists. BR-1028 says a run records the context fragments it was given at start. Measured 2026-10-12 in the lore repo: sqlite runs table, kind=main -> 2 runs, both json_array_length(composition.fragments)=0; lore fragments render --outlet hook:session-start returns an empty additionalContext.

**Expected:** A main run's composition lists every fragment the session was given at start: the dynamic hook:session-start selection plus the static rules:user and rules:project selections (id + sha256), so BR-1028 holds for main runs.
**Actual:** Main-run composition is always empty while ~39 KB of static rules text is loaded; only subagent runs carry a non-empty composition.
**Repro command:** `sqlite3 .lore/lore.db "select kind, json_array_length(json_extract(composition,'$.fragments')) from runs where kind='main'"`

Reported by: agent:session-e25636da

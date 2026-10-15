---
id: TASK-1165
type: task
role: plan
title: "Site census cannot resolve subcommands declared as standalone constants (uat, eval, issue) and silently under-counts sites when node_modules is absent"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"census-honesty","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"37a46e5b-247a-4c77-b76a-2ef8261de58a"}
---

Found by fast-mode excavators (plan-baseline-fast-mode-migration-of-the-remaining-9-branches). Blocks AC-BLS2-18 for the autonomy branch (coverage exit 1 on 2 unmeasured leaves). Related: #59/#60 (fixed layout differences, not absence), #58.

**Expected:** lore baseline sites/coverage resolve every CLI subcommand reachable from a command (uat record, eval <scenario>, issue adopt|resolve), and refuse (not_measured / non-zero) when cross-package imports cannot be resolved, instead of reporting complete
**Actual:** Fast-mode excavators measured: uat.ts:122 and eval.ts:406 declare subcommands as standalone constants the census cannot follow, so the autonomy leaves for UAT verdicts and evaluation scenarios cannot declare commands (declaring them exits 4) and stay UNMEASURED; 'baseline sites issue' fails for a subcommand-only command; with no node_modules in the analysed root, coverage reports complete with 35 of 58 (hygiene) / 66 of 89 (autonomy) sites — a silent drop (baseline.ts:160); 'baseline sites gate spec-create' silently ignores the second argument

Reported by: agent:main-orchestrator

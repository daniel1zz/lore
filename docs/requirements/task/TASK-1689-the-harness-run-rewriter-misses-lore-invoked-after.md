---
id: TASK-1689
type: task
role: plan
title: "The harness-run rewriter misses lore invoked after do/then/else, so loop bodies run without an attested run"
status: draft
priority: medium
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"hooks","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"4f0ea0af-8cc5-4d96-9675-c74a2e1662c2"}
---

pre-tool-harness-run.mjs (rewriteBashCommand) inserts --harness-run after every lore word at a command position: start, after &&, ||, ;, | and a VAR=value prefix. It does not treat shell keywords that start a command (do, then, else, elif, and the openers { and ( ) as command positions. A lore write inside 'for ...; do lore ...; done' or 'if ...; then lore ...; fi' therefore carries no run. Once every write needs a known party this is refused; observed with lore integrate, which refuses a caller without a run when migrate_command is configured.

**Expected:** lore after do/then/else/elif/{/( gets --harness-run like any other command position
**Actual:** for i in 1; do lore integrate <branch> --session <s>; done -> 'Validation failed on field identity: ... this invocation has no attested agent run'; the same lore integrate at the start of the line passes the identity check
**Repro command:** `for i in 1; do lore integrate worktree-agent-a0dd74342106e7518 --session a979eecd-9de8-4e71-a037-a0da0d1857e0; done`

Reported by: agent:session-a979eecd

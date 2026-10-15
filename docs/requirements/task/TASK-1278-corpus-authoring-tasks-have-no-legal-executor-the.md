---
id: TASK-1278
type: task
role: plan
title: "Corpus-authoring tasks have no legal executor: the dispatch-isolation gate forces implementers into worktrees, and worktrees are refused corpus writes (gate:corpus-write:foreign-provenance)"
status: draft
priority: medium
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"gate-composition","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"f54925ff-881e-45c8-afa4-2e3bc1242d01"}
---

Two shipped gates compose into a dead end for any plan task whose deliverable is corpus content (a probe set, a baseline tree, a build log). (1) assets/hooks/pre-dispatch-isolation-gate.mjs blocks Agent(subagent_type=lore-implementer) without isolation=worktree. (2) A lore create/rule add from inside a worktree is refused with gate:corpus-write:foreign-provenance (measured twice in plan-baseline-slice-1-rules-citations-rule-state-specification: task D1 'lore create knowledge' from a worktree refused; task D2 could not be dispatched at all). Read-only agent types cannot write either. So the only executor left is the orchestrator itself, which pulls long research into the main context — or an agent type chosen to dodge gate (1), which is exactly what the gates exist to prevent. Workaround used: the worktree agent produces a reviewed CLI command file in the scratchpad, the orchestrator executes it from the main checkout (claims/evidence attributed accordingly).

**Expected:** A sanctioned path for corpus-only tasks: e.g. the dispatch gate exempts tasks with no file anchors whose declared deliverable is corpus content, or the corpus-write gate admits a worktree whose actor holds a fresh claim on the target task / plan, with provenance recorded.
**Actual:** lore-implementer without worktree: blocked by the dispatch gate. With worktree: corpus writes refused (foreign-provenance).
**Repro command:** `Agent(subagent_type=lore-implementer) without isolation -> DISPATCH_ISOLATION_GATE; inside a worktree: lore create knowledge --sub-type reference --title X --content x -> gate:corpus-write:foreign-provenance`

Reported by: agent:main-orchestrator

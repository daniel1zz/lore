---
id: TASK-921
type: task
role: plan
title: "lore ac add silently discards a declared falsifier on a human- or ai-mode criterion and exits 0"
status: draft
priority: medium
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"silent-fallback","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"a2d5961f-307a-4e7c-96f5-bd69aeedcef6"}
---

Declaring a criterion with --mode human (or ai) plus the four --falsifier-* flags succeeds, prints the criterion, and stores it WITHOUT the falsifier. The help text says falsifier flags are 'script mode only', and per the drafting agent's excavation the revise path (lore ac set) refuses the same input — so add and set disagree, and add is a silent fallback. A caller who believes they declared a falsifier has no signal that it was dropped. Found while excavating the specification branch for the baseline validation experiment (adr-the-product-is-a-baseline-tree-specs-are-implementations).

**Expected:** lore ac add refuses (non-zero exit, message naming the falsifier flags as script-mode only) when any --falsifier-* flag is given with --mode human|ai, matching lore ac set.
**Actual:** exit 0; 'Added acceptance criterion'; lore ac list --json shows verify: {mode: human} with no falsifier.
**Repro command:** `cd $(mktemp -d) && git init -q && lore init && lore create prd --title P --content $'# P\n\n## Goal\nx' && lore create spec --title S --parent prd-p --kind feature --content $'# S\n\n## Scope\nx' && lore ac add spec-s AC-R-1 --statement 'Operator sees 3 rows within 200ms' --mode human --falsifier-path a.ts --falsifier-find x --falsifier-replace y --falsifier-exit-code 1; echo exit=$?; lore ac list spec-s --json`

Reported by: agent:main-orchestrator

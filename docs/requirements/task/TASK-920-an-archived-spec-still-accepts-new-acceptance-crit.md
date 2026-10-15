---
id: TASK-920
type: task
role: plan
title: "An archived spec still accepts new acceptance criteria (lore ac add exits 0 on a terminal-status spec)"
status: draft
priority: medium
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"lifecycle","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"f7cdda05-f17d-4d15-b03e-5bf8f085d7e6"}
---

archived is a terminal lifecycle status (no outbound transition), yet lore ac add on an archived spec succeeds and logs a new version. The drafting agent also reported code-anchor adds and body edits succeed on archived specs, and that such anchors then participate in drift checks; only the ac add path was re-verified by the main agent. A terminal doc that keeps mutating breaks 'archived = frozen record' for every census and assessment over it. Found during the baseline validation experiment (adr-the-product-is-a-baseline-tree-specs-are-implementations).

**Expected:** Writes that change an archived (or deprecated) spec's content, acceptance criteria or anchors are refused with a non-zero exit naming the terminal status.
**Actual:** lore ac add on an archived spec: exit 0, 'Added acceptance criterion', status stays archived, version incremented.
**Repro command:** `cd $(mktemp -d) && git init -q && lore init && lore create prd --title P --content $'# P\n\n## Goal\nx' && lore create spec --title S --parent prd-p --kind feature --content $'# S\n\n## Scope\nx' && lore ac add spec-s AC-R-1 --statement 'Exactly 2 rows returned' --mode human && lore set spec-s --status approved && lore set spec-s --status active && lore set spec-s --status archived && lore ac add spec-s AC-R-2 --statement 'Exactly 3 rows returned' --mode human; echo exit=$?`

Reported by: agent:main-orchestrator

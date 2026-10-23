---
id: TASK-1655
type: task
role: plan
title: "report-issue from a helper worktree creates the GitHub issue but fails to create its corpus record"
status: draft
priority: medium
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"issues","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"2bd8def1-7561-4d20-a783-7f98984964d2"}
---

Run from a helper's worktree, lore report-issue files the GitHub issue first and then tries to create the corpus task for it; the corpus write is refused by the foreign-provenance gate (the worktree resolves the shared corpus outside its own working tree), so the command prints a storage failure while the external issue already exists. The two halves are not one unit: the outward side effect happens, the record does not, and someone must later run lore issue adopt <n> by hand. Observed for #320 and #321.

**Expected:** either both happen or neither: check the corpus write is permitted before filing on GitHub (refuse up front naming why), or file and record atomically from a context that may write
**Actual:** 'corpus task could not be created' (gate:corpus-write:foreign-provenance) after the GitHub issue was created; lore issue adopt 320/321 was needed from the shared checkout

Reported by: agent:session-a979eecd

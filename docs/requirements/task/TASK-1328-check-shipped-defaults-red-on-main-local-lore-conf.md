---
id: TASK-1328
type: task
role: plan
title: "check-shipped-defaults red on main: local .lore/config.yaml sets workflow.turn_end.main_session_source_edits=block, shipped default is off"
status: archived
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"shipped-defaults","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"fd3b0e08-3a43-4c3b-8c2b-bd6c4995ecd1"}
---

scripts/check-shipped-defaults.ts exits 3 in the main checkout: DRIFT workflow.turn_end.main_session_source_edits — this repo's .lore/config.yaml overrides it to 'block', but the shipped surface carries 'off'. scripts/tests/check-shipped-defaults.test.ts 'main() against THIS worktree's own real repo root' fails (expected 0, got 3). Not reproducible in a fresh worktree because .lore/config.yaml is gitignored, so the oracle's verdict depends on untracked local state.

**Expected:** Either the shipped default is raised to block, or the key is in PROJECT_SPECIFIC_KEYS with a rationale; and the oracle's verdict does not depend on an untracked file
**Actual:** exit 3, one DRIFT violation; passes in any worktree lacking .lore/config.yaml

Reported by: agent:session-ee1cedaf

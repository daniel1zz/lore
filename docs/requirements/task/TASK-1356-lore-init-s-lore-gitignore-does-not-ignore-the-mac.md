---
id: TASK-1356
type: task
role: plan
title: "lore init's .lore/.gitignore does not ignore the machine-local project check cache (.lore/.lore-project-check.json)"
status: draft
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"setup-gitignore","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"85561b9e-452f-41ea-8445-35af585c3be9"}
---

lore setup --project --check writes its cache at .lore/.lore-project-check.json (task-skill-implement-lore-setup-project-check-classifies-every). The .lore/.gitignore that lore init writes lists only lore.db, lore.db-wal, lore.db-shm, so the cache (machine-local, rewritten with checked_at on every run) shows up as an untracked or modified file in every project repo and could be committed.

**Expected:** The machine-local project check cache is git-ignored by the .lore/.gitignore that lore init (and lore setup --project for existing repos) writes.
**Actual:** .lore/.gitignore has no entry for .lore-project-check.json; running lore setup --project --check dirties git status.

Reported by: agent:session-66711aa8

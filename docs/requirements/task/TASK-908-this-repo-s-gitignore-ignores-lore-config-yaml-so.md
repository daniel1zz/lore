---
id: TASK-908
type: task
role: plan
title: "This repo's .gitignore ignores .lore/config.yaml, so every governance setting it carries is local to one checkout"
status: draft
priority: medium
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"config-distribution","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"87a99b15-94fd-4f7b-b2b4-c2e4ad13aec7"}
---

Root .gitignore has '.lore/*' with only export-index.json and audit-anchor.json re-included. .lore/config.yaml therefore is untracked: the custom memory-file ceilings (root 220L/24576B), workflow.verification_profiles, gate knobs and now context.memory_files.adoption: enforce exist only on the machine that wrote them. Any other clone or CI resolves schema defaults (looser ceilings, adoption warn). Consumer projects are NOT affected: assets/project/gitignore.template ignores only .lore/lore.db*.

**Expected:** Team-shared governance config is tracked (re-include .lore/config.yaml), or the repo documents why it is local and where the shared copy lives.
**Actual:** Untracked; measured with git check-ignore -v .lore/config.yaml → .gitignore:18:.lore/*

Reported by: agent:main-orchestrator

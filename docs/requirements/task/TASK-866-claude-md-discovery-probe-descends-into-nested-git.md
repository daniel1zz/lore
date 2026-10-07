---
id: TASK-866
type: task
role: plan
title: "CLAUDE.md discovery probe descends into nested git repositories and lints another project's memory files"
status: draft
priority: medium
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"memory-file-probe","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"d39b4e86-9cbd-4088-9965-3e100fa7e2cb"}
---

real-memory-file-probe.ts excludes .git, node_modules and .claude/worktrees, but not a nested directory that is itself a git repository (has its own .git dir or file: an untracked clone, a vendored repo, a submodule). Its CLAUDE.md files are classified role:module and checked against this repo's budgets. Measured in this repo: untracked everything-workspace/ (own .git) contributes max_lines/max_bytes breaches; under adoption: enforce, lore status --check-claude-md would exit 3 and pre-push would refuse for a file that is not part of the repo.

**Expected:** The walk stops at any non-root directory containing .git (dir or file), the same way it skips linked worktrees; optionally reports the skipped roots.
**Actual:** Nested repos are linted as modules of the host repo.

Reported by: agent:main-orchestrator

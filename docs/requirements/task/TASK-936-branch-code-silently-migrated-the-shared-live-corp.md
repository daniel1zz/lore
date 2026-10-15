---
id: TASK-936
type: task
role: plan
title: "Branch code silently migrated the shared live corpus: repo tests run from a worktree resolve the main checkout's .lore and auto-migrate it"
status: draft
priority: medium
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PRD-001
---
---
{"severity":"critical","category":"data-integrity","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"e6148783-fb94-4d30-a3e5-5f8092ed737f"}
---

2026-10-12: the live corpus /…/lore/.lore/lore.db went from user_version 17 to 18 (migration 018 from an unmerged branch) while main's binary had no 018. Chain, measured by the implementer: (1) bunx vitest run --changed in a worktree runs script tests (scripts/tests/check-ac-ref-integrity.test.ts, packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts, scripts/tests/spec-mirror-export.test.ts) that spawn repo code with cwd REPO_ROOT; (2) a worktree has no .lore/, so findLoreDbPath falls back to the MAIN checkout's live corpus (SPEC M4); (3) SQLiteStore runs every pending forward migration on open, regardless of which code is running. Any branch with a migration therefore upgrades every session's shared DB irreversibly before review or merge. 'Never touch the live .lore/ from tests' (root CLAUDE.md) is prose only; three repo tests violate it. This time the migration only widened a CHECK, so older binaries kept working by luck.

**Expected:** A corpus is migrated only by a binary built from the corpus repo's main (binary provenance) or explicitly (lore db migrate); a corpus reached through git-common-dir fallback is never migrated; repo tests never resolve the live corpus
**Actual:** Opening the DB from any code auto-migrates it; worktree fallback reaches the live corpus; three repo tests open it

Reported by: agent:session-cb37af5d

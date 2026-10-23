---
id: TASK-1742
type: task
role: plan
title: "Delete the DocMan-era files under docs/ outside docs/requirements"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
docs/architecture/, docs/knowledge/, docs/planning/ and docs/claude-md-archive/ hold 10 DocMan-era hand-written files (last touched 3-4 months ago). None is imported into the corpus; the current-state architecture lives in the architecture tree (BASE-095) and CLAUDE.md archives in KN snapshots. The only in-repo reference is the generated-style @reads list in scripts/tests/check-no-nul-bytes.test.ts (lines naming those 10 paths). The untracked docs/.docman/ state dir was already removed locally on 2026-10-19.

Expected: the 10 files are deleted, their @reads lines are removed, the docs/.docman/ line in .gitignore is removed (DocMan retired), and only docs/requirements/ remains under docs/. Oracle: bun run test:file scripts/tests/check-no-nul-bytes.test.ts passes; git ls-files docs | grep -v '^docs/requirements/' prints nothing.

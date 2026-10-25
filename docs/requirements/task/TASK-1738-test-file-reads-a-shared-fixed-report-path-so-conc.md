---
id: TASK-1738
type: task
role: plan
title: "test:file reads a shared fixed report path, so concurrent runs from different worktrees overwrite each other's verdict"
status: archived
priority: critical
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Observed 2026-10-19 21:42: 'bun run test:file packages/lore/tests/integration/hooks/session-trail-runs.test.ts packages/lore/tests/integration/hooks/subagent-trail.test.ts' ran 26 tests, all passing, then printed 'bun runner exit 0; 0/2 path(s) collected tests' and exited 1. node_modules/.cache/test-file/bun.json held another session's report (worktree verify-t2-482f, compiled-root-coverage.bun.test.ts). Every worktree resolves node_modules to the main checkout's, so the fixed report path join(root,'node_modules','.cache','test-file',runner+'.json') is shared by all concurrent runs: a false FAIL, and a false PASS when the other run collected the same files. Fix: a per-invocation report path (mkdtemp), removed after reading. Oracle: two concurrent main() calls with stub runners writing different reports each judge only their own.

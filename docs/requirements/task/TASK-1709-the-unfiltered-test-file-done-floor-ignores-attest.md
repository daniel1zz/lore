---
id: TASK-1709
type: task
role: plan
title: "The unfiltered-test-file done floor ignores attested passes run from a verification worktree"
status: draft
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"gates","tags":["lore-done","unfiltered-test-file"],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"84076a37-fe14-413a-bb85-8d70c4a5673b"}
---

Observed 2026-10-19 on task-coverage-exits-1-only-for-undeclared-commands-the-floor. The project rule forbids running tests in the shared checkout, so the orchestrator ran each anchored test file in a clean detached worktree at main: `lore evidence <task> --oracle test --result pass --command 'cd /…/.claude/worktrees/verify-t1-482f && bun run test:file <file>' --capture`. Six such runner-attested rows (v22-v27, exit 0) were recorded; `lore done` still refused and listed every one of those files. The floor only accepts a command that runs the file 'from the repo root'. The only ways through were to run tests in the shared checkout (forbidden) or to have the implementer re-claim in its own worktree and re-run there, which is what unblocked it.

**Expected:** The floor recognises an attested run by the file it executed and the checkout root it ran in (as `lore verify --execution-root` does), so a run from any checkout at the landed commit counts; a filtered (-t) run still does not.
**Actual:** 'Task … declares test-file anchor(s) with no attested UNFILTERED result:pass run: scripts/tests/check-baseline-coverage-render.test.ts, packages/lore/tests/integration/cli/baseline-coverage.bun.test.ts, … — lore done requires … evidence row whose command runs that file … from the repo root … [floor: unfiltered-test-file]', despite rows v22-v27 for exactly those files.

Reported by: agent:session-482f1e89

---
id: TASK-631
type: task
role: plan
title: "T1 — governance verb + hook Phase C spawn + install-set retirement + tests (AC-083-1..4)"
status: archived
priority: medium
created: 2026-07-26
updated: 2026-07-27
tags: []
parent: PLAN-119
plan: PLAN-119
---
Implement SPEC-083 in one slice per its D1-D4: (1) new bootstrap-stage command packages/lore/src/adapters/cli/commands/governance.ts printing assets/governance/corpus-workflow.md resolved via the setup-args assets-root derivation, registered as a lazy subcommand in src/index.ts; (2) assets/hooks/session-start-resume.mjs Phase C: replace the installed-file read with a spawnSync of the resolved lore binary running the governance verb, fence format and fail-open contract unchanged; (3) remove governance/corpus-workflow.md from the machine install asset load set (file stays in assets/ as SSOT; seat-briefing.md stays installed); (4) regenerate packages/lore/src/generated/assets-manifest.ts via node scripts/embed-assets-manifest.mjs; (5) author tests: packages/lore/tests/integration/governance-compiled.bun.test.ts (byte-parity vs assets file, exit 0; requires bun run build first) and packages/lore/tests/unit/setup-governance-retirement.test.ts (install set excludes corpus-workflow.md, includes seat-briefing.md; hook source has zero corpus-workflow occurrences and names the governance verb as a spawn arg). Oracles scoped per worktree discipline: the two new test files + bun run typecheck + assets-ssot suite.

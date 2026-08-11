---
id: TASK-542
type: task
role: plan
title: "[T8] Fix macOS realpath assumption in three provision-suite corpus_path assertions"
status: archived
priority: medium
phase: "GREEN"
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: PLAN-105
plan: PLAN-105
---
Three assertions in packages/lore/tests/integration/report-issue-provision.bun.test.ts compare the WRITTEN feedback.upstream.corpus_path against the RAW mkdtempSync string (install.installRoot), but the resolver deliberately realpath-resolves — spec Design mandates 'symlink -> real path'. On macOS /var is a symlink to /private/var, so mkdtemp paths always differ from their realpath and these three fail with only a /private prefix delta. Independently reproduced by the orchestrator at 6 pass / 3 fail; the sibling suite tests/integration/report-issue-wiring-provision.bun.test.ts already asserts this SAME resolver against realpathSync(...) with an explicit macOS comment, so the two suites currently disagree about one resolver. Fix: change the three corpus_path assertions (near lines 413, 454, 561 — locate by the assertion text, line numbers drift) from .toBe(install.installRoot) to .toBe(realpathSync(install.installRoot)), importing realpathSync from node:fs if absent. Add a brief comment at the first site explaining WHY (macOS /var -> /private/var + the resolver's intentional realpath), so the next reader does not 'fix' it back. Do NOT touch any src/ file and do NOT relax any other assertion. Exit condition: cd packages/lore && bun test tests/integration/report-issue-provision.bun.test.ts runs 9 pass / 0 fail (run bun run build first — the suite's assertFreshBinary guard aborts on a stale dist/lore).

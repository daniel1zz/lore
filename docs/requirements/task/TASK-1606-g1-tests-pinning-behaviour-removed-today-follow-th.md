---
id: TASK-1606
type: task
role: plan
title: "G1 tests pinning behaviour removed today follow the new behaviour"
status: archived
priority: medium
phase: "G"
created: 2026-10-23
updated: 2026-10-26
tags: []
parent: PLAN-211
plan: PLAN-211
---
Main green, group A. These tests pin behaviour removed on purpose on 2026-10-23. Update them to the new behaviour, or delete them when they only tested the removed path. No code changes. Source: the full-suite run of main at 8a4c4f35, log scratchpad/fullsuite.log, triage clusters A1 to A8 and B4.

- A1: pre-push dropped --check-claude-md and prose-pins. Delete pre-push-structure-trip and pre-push-claude-md-trip. Rewrite pre-push-trip to the new step list.
- A2: delete tests/integration/hooks/stop-turn-review-drift-budget.test.ts, which covers the removed findings.
- A3: packages/core/tests/unit/autonomy-decide.test.ts. human-always is now push-force, archive-ref-prune and governance-loosen. The override classes are tier milestone, so their verdict is milestone.
- A4: session-start-upgrade-advisory. The detached setup --check is gone, so assert that it is no longer spawned.
- A5: integrate-complete-coverage and ric-branch-independent fixtures need a package.json with install, build and typecheck scripts. The lean floor reads them.
- A6: migration-014, 016 and 017 and run-message-address: the schema is now 34. Use LATEST_SCHEMA_VERSION, and build one-behind fixtures at 33.
- A7: fragment-variables golden and run-composition @reads for the new assets/context/ask-then-execute.md.
- A8: dashboard StatusPill test, where draft has 3 transitions.
- A9 leftover: pre-push-parity.test.ts must not cite AC-LG-7.
- B4: remove the vitest.node-files.ts line naming the deleted ai-provider-service-assess-reproducible-unknown-version.test.ts.

Oracle: every file above passes, run unfiltered.

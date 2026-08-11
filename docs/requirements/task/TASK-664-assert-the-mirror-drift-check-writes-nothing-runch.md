---
id: TASK-664
type: task
role: plan
title: "Assert the mirror drift check writes nothing: runCheck reports drift on a throwaway drifted corpus and leaves the index and every mirror file byte-identical"
status: archived
priority: medium
phase: "readonly"
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PLAN-125
plan: PLAN-125
---
D5 of the governing spec. scripts/export-spec-mirror.ts:167-200 runCheck JSDoc claims it 'NEVER calls exportDocs and never writes a byte'; turn that claim into an assertion, because a check that repairs what it checks can never fail. Build a THROWAWAY corpus (mkdtemp + lore init, per the canonical pattern in packages/dashboard/tests/e2e/global-setup.ts), export it, then deliberately drift it (a mapping carrying the unpadded form plus a renamed mirror file). Hash the export index and every mirror file, call runCheck(app, repoRoot) with that throwaway root, assert a nonzero drift verdict, then assert byte-for-byte hash equality after. The oracle must never invoke bun run check:spec-mirror against the live tree and must never write the repo corpus. Concurrent with the reconcile phase — this task's only anchor is a new file.

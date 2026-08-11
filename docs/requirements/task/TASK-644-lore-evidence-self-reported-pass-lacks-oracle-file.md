---
id: TASK-644
type: task
role: plan
title: "lore evidence self-reported pass lacks oracle-file-existence precondition — a test-oracle pass whose command matched zero files records cleanly (AC-080-3 incident: oracle file absent through two verify rounds while a manual pass stood in)"
status: archived
priority: medium
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PRD-001
---
## Repro
During SPEC-080, T1 recorded a manual/self-reported pass for AC-080-3 while the AC-bound oracle file cli-domain-overview-kind.bun.test.ts did not exist; only the close-out lore verify (SPEC-061 zero-match guard) caught it. lore evidence itself accepts any --result pass with no precondition on the named command.
## Expected
When lore evidence records oracle test/e2e with result pass, precheck the command's referenced test-file paths exist (or run the SPEC-061 judgeCompleteness zero-match heuristic on recorded output); absent file → VALIDATION_ERROR naming the missing path, not a silent record. Design must keep manual-oracle entries unaffected.
## Anchor
packages/lore/src/service/task-workflow-service.ts (appendEvidenceEntry), packages/lore/src/service/attestation.ts (judgeCompleteness reuse)
## Provenance
Judge recommendation, knowledge-assessment-implementation-spec-080-prd-as-outline (Typed Recommendations #1).

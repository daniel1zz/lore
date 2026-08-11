---
id: TASK-537
type: task
role: plan
title: "Reject placeholder command strings at evidence WRITE time (read path must stay tolerant)"
status: archived
priority: medium
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: PRD-001
---
lore assess recommended 'reject evidence records whose command field is not a runnable command (e.g. x, x3, x4) at record time'. A real incident produced exactly that: an agent debugging shell quoting recorded 3 probe entries with commands 'x','x3','x4' all result=pass on task-t4-cli-auto-config-flag-actionable-unconfigured-error. They are indistinguishable from real oracle runs except by reading the command text. CRITICAL DESIGN CONSTRAINT, measured not assumed: readEvidence (task-workflow-service.ts:303-307) parses via z.array(evidenceEntrySchema).safeParse and returns [] on ANY failure — all-or-nothing. task-t4 currently holds 13 entries, 3 of them placeholders; tightening the SHARED evidenceEntrySchema.command (packages/core/src/task-workflow.ts:192, currently z.string().min(1)) would drop ALL 13, not 3, silently zeroing that task's evidence and corrupting attestation-floor / AC-coverage / done-gate computations. So: do NOT touch evidenceEntrySchema. Add the check on the WRITE path only (TaskWorkflowService.addEvidence, line ~531) so historical records stay readable. Rule (conservative, must not false-positive on real short commands): reject when the trimmed command is shorter than 3 characters AND is not in an explicit allowlist of genuine short commands (ls, go, sh, cd, hg, bc, dd, df, du, ps, rm, cp, mv, ln, id, wc). This rejects x/x3/x4 while accepting ls, tsc, make, bun test. Fail LOUD with a VALIDATION_ERROR naming the offending value and the rule — never silently drop the entry. MANDATORY regression oracle: a test proving a task whose stored evidence ALREADY contains 'x' still reads back ALL its entries intact (this is the whole point of the write-path-only placement; a test that only checks the new rejection would miss the exact failure this constraint exists to prevent). Six-dimension coverage required.

---
id: TASK-543
type: task
role: plan
title: "[T7] Reconcile the two SPEC-073 baseline sub-cases that SPEC-OOB deliberately supersedes"
status: archived
priority: medium
phase: "GREEN"
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: PLAN-105
plan: PLAN-105
---
Unlocking buildReportIssueHint's unconfigured branch (T5) provably falsifies two PRE-EXISTING sub-assertions in packages/lore/tests/unit/adapters/report-issue-hint.bun.test.ts. This is intended supersession, not a regression: (a) the AC-073-1 BOUNDARY case ('unconfigured consumer's IDENTICAL gate denial carries 0 hint lines — stderr is EMPTY') runs the SAME gate spec-create command on the SAME unconfigured setup as AC-OOB-6 direction 1, which now requires exactly 1 provision line — a pure function of (errClass, upstreamConfigured) cannot satisfy both; (b) the AC-073-3 STATE case ('unconfigured consumer's SAME corrupted-db failure state carries 0 hint lines') for the internal errClass. Update BOTH to assert the NEW correct behaviour: an unconfigured gate/internal denial now carries exactly one provision-guidance line, while the underlying error text (PARENT_REQUIRED feeding pack on stdout, 'Storage failure' on stderr) stays unchanged. Preserve their BOUNDARY/STATE dimension intent — do not delete the cases, retarget their assertions. The CONFIGURED branch's wording stays byte-frozen (plan invariant 3) and AC-073-2's hint-scoping negatives (usage error exit 2, plain non-gate VALIDATION_ERROR carry 0 hint lines even when configured) must remain green. Exit condition: the full file runs 8 pass / 0 fail together with T5's implementation.

---
id: TASK-212
type: task
role: plan
title: "[Skill:test] T2 RED: issue-report-service + receipt-log vitest scenarios"
status: archived
priority: critical
phase: "Phase 2: Implementations"
created: 2026-07-24
updated: 2026-07-24
tags: []
parent: PLAN-045
plan: PLAN-045
links:
  - {id: TASK-216, type: blocks}
---
Estimate: S
Source: AC of task T3 (service track) — spec ACs AC-072-7, AC-072-13 + R-5 rail check ordering
TDD-Role: red | Paired-Impl: T3 service+receipt-log

Scenarios (Given/When/Then, executable vitest against faked IssueReportDeps):
- Given deps where openUpstream.createDraft returns err(GATE/VALIDATION error), When report() runs, Then the exact error code+message is returned and receipts.append was never called (AC-072-7).
- Given unset feedback.upstream cfg, When report() runs, Then VALIDATION_ERROR naming both config keys, and NO dep beyond config loading was invoked.
- Given probe returning user_version≠expected, When report(), Then VALIDATION_ERROR naming both versions and openUpstream never called (ordering: probe before open).
- Given upstream config with sync.enabled=true, When report(), Then VALIDATION_ERROR naming SQLite-only constraint and probe never called after config check (ordering).
- Given root mismatch, When report(), Then VALIDATION_ERROR expected-vs-found and createDraft never called.
- Given 10 open reports for reporter_project, When report(), Then VALIDATION_ERROR listing 10 ids, createDraft never called.
- Given searchDuplicates throwing err, When report(), Then result ok with dedup_degraded=true and createDraft still called (advisory never blocks).
- Given createDraft ok, When report(), Then receipts.append called exactly once AFTER createDraft resolution with {upstream_doc_id,title,at}.
- Given a receipts file with 1 corrupt line among 3, When ReceiptLog.read(), Then 2 entries returned + corrupt_lines=[2], no throw.
- Static pin (AC-072-13): scan packages/lore/src/service/issue-report-service.ts source, assert no value import from flows/ or bun:sqlite (import type allowed).

AC:
- All scenarios written as executable vitest tests in packages/lore/tests/unit/service/issue-report-service.test.ts + receipt-log.test.ts.
- Run bunx vitest run on both files → all RED, failure reason "missing implementation" (module not found / not implemented), not test bugs.
- Test names embed AC ids: at least one test matching -t 'AC-072-7' and one matching -t 'AC-072-13'.

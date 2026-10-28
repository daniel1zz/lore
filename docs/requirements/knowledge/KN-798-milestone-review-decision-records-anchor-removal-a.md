---
id: KN-798
type: knowledge
role: knowledge
title: "Milestone review: Decision records: anchor removal and exemptions"
status: approved
priority: medium
created: 2026-10-28
updated: 2026-10-28
tags: []
parent: PLAN-244
links:
  - {id: PLAN-244, type: informs}
---
# Milestone review: PASS

Fingerprint: 3a0b24e3f88651f3b3b9556521fb743cf8b191ce804d74506e12094e869bb647
Diff: derived from 7 commit(s), excluding 0 merged in from main across the plan's tasks

| Dimension | Verdict | Reason | Reference |
|---|---|---|---|
| correctness_vs_acs | pass | Trusted runners attested both criteria in red-then-green order. AC-DX-1 has an expected-fail run of anchor-rm-decision.bun.test.ts -t 'AC-DX-1', then passing runs. AC-DX-2 has an expected-fail run of exemption-decision.bun.test.ts -t 'AC-DX-2', then passing runs. Each task also has a full-file run and a passing typecheck. None of these passes is a self-report. No milestone decisions are waiting for this review. | Attested evidence for task-x1 (AC-DX-1) and task-x2 (AC-DX-2); test-first red/green order as in Beck, Test-Driven Development |
| spec_conformance | pass | The net X2 diff matches the spec's ac exempt scope. The commit history adds X2, reverts it and adds it again; the net result is the add. AcExemptionService now keeps judged.value on the row instead of 'validated, not kept'. selectPlanDecisions reads listDecisionExemptions by the plan spec's docIds and by the claim-run windows, with addresses deduplicated through `seen`. DecisionOutcomeService.rates counts exemption decisions under kind 'document revision' and in decisionsPerArchivedTask. The migration covers SQLite, Turso and InMemory. harness_run is the only addition the spec does not name, and window selection needs it. The X1 anchor rm files were cut from the diff, so X1 is judged only on its attested AC-DX-1 evidence. | spec-decision-records-cover-code-anchor-removal-and-keep Scope and D1/D2 |
| regression | pass | Three behaviours are at risk: reads of existing exemption rows, the exemption cap transaction, and version-row decision selection and rates. The new columns are nullable with no backfill, and rowToAcExemption tolerates their absence. The capped insert keeps its single transaction. Version-row selection code is unchanged. The full-suite run on main attributes no failing test files to this plan. | Full-suite run on main at d9524e16, attribution: none |
| design_necessity | pass | Each choice has an external reference. (1) A nullable additive column with an idempotent check-then-ALTER migration is the expand step of expand/contract schema change, and follows the earlier migration-041. (2) Keeping the judged decision on the row it justifies follows the ADR practice of recording a decision with what it governs. (3) harness_run records which run wrote the row, as the W3C PROV wasAttributedTo relation does, and window selection needs it. (4) The `<slug>#exempt:<AC>@<granted_at>` address works like a URI fragment, naming a subresource that has no version. | Fowler/Sadalage Parallel Change (expand/contract); Nygard Architecture Decision Records; W3C PROV-O wasAttributedTo; RFC 3986 fragment identifiers |
| snapshot_accuracy | na | no cited rule is contradicted; not verified: BR-1491 (unknown: no-commit-recorded), BR-1492 (unknown: no-code-anchors) (No cited rule is contradicted. BR-1491 is unknown (no commit recorded) and BR-1492 is unknown (no code anchors), so both are na.) | Cited rule state section |
| concurrency_safety | pass | The decision and harness_run are written in the same INSERT, inside the existing transaction that counts active rows and then inserts (BEGIN in SQLite, tx in Turso), so no write can be lost or split. The new reads are single SELECTs. One small leftover from the 041 pattern: the Turso migration checks then ALTERs without a transaction, so two processes starting together could make one fail with a duplicate-column error. That failure is loud, not corrupting, and resolves when the process restarts. | SQLite BEGIN IMMEDIATE write serialization; migration-041 precedent |
| security | pass | All new SQL binds values with ? placeholders. Window clauses are built from fixed strings, and the PRAGMA table name comes from a constant. A stored decision is checked against decisionRecordSchema when read. harness_run comes from the invocation identity, the same source as the existing writerSource. No new path for untrusted input or privilege escalation. | OWASP SQL Injection Prevention Cheat Sheet (parameterized queries) |

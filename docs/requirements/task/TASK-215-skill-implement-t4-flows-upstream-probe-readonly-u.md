---
id: TASK-215
type: task
role: plan
title: "[Skill:implement] T4 flows: upstream-probe (readonly) + upstream-context UpstreamPort + probe purity bun test"
status: archived
priority: high
phase: "Phase 2: Implementations"
created: 2026-07-24
updated: 2026-07-24
tags: []
parent: PLAN-045
plan: PLAN-045
links:
  - {id: TASK-214, type: blocks}
---
Estimate: M
Approach: per spec SPEC-072 §4 — flows/upstream-probe.ts: probeUpstreamDb via new Database(path,{readonly:true}) reading PRAGMA user_version, Result-wrapped; flows/upstream-context-flow.ts: buildUpstreamContext(corpusRoot) → UpstreamPort {resolveRootDoc,listOpenAdhocDrafts,searchDuplicates,createDraft,close} composing SQLiteStore + CorpusService ONLY (no telemetry/AI/GateEnforcer — task create consults no checkpoint, verified corpus-service.ts:749), re-asserting user_version===LATEST_SCHEMA_VERSION before store construction (TOCTOU guard). createDraft creates adhoc draft task (parent=upstream root PRD, extra from buildIssueReportExtra). bun-only (imported solely from CLI/MCP wiring).
Source: spec-072-upstream-issue-reporting-lore-report-issue-consumer §4; coupling-surface enumeration in spec §7 Design Decisions
Dimensions: D-FUNC, D-CODE
Scope-Alt: listOpenAdhocDrafts may over-fetch (all adhoc drafts) — pure filter narrows; optimization deferred without blocking
Covers: AC-072-12

AC:
- Given a WAL-mode temp db, When probeUpstreamDb runs, Then user_version returned and sha256 of db+-wal+-shm unchanged: cd packages/lore && bun test tests/unit/store/schema-probe.bun.test.ts -t 'AC-072-12' exit 0, ≥1 matched test.
- Given a temp corpus (lore init shape), When buildUpstreamContext + createDraft run, Then a draft adhoc task exists parented to that corpus root PRD (asserted in the same bun test file or a sibling flows test).
- Given a db with PRAGMA user_version downgraded, When buildUpstreamContext runs, Then err VALIDATION_ERROR naming both versions and no SQLiteStore constructed (db files byte-identical).
- bun run typecheck exit 0.

Integration: port consumed by T5 wiring; not user-reachable until T5.

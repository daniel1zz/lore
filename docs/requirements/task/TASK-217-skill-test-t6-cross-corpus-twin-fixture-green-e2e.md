---
id: TASK-217
type: task
role: plan
title: "[Skill:test] T6 cross-corpus twin-fixture GREEN e2e suite (AC-072-1..6,8..11)"
status: archived
priority: critical
phase: "Phase 3: Wiring & E2E"
created: 2026-07-24
updated: 2026-07-24
tags: []
parent: PLAN-045
plan: PLAN-045
---
Estimate: L (consciously accepted concentration: sole formal oracle for 10/13 spec ACs — audit finding)
Source: spec ACs AC-072-1..6, 8..11 (GREEN acceptance suite)
TDD-Role: green-acceptance | Paired-Impl: T5 wiring (and transitively T1-T4)

Approach: packages/lore/tests/unit/service/issue-report-cross-corpus.bun.test.ts — twin mkdtemp corpora fixture (consumer: lore init + config feedback.upstream.*; upstream: lore init + seeded root PRD); spawn compiled dist/lore (bun run build FIRST in beforeAll — stale-binary vector, SPEC-061 lesson); version-skew fixture = PRAGMA user_version downgrade on a migrated copy (synthetic, documented); MCP case via in-process registerTools harness (precedent files: packages/lore/tests/unit/adapters/mcp-tools-feed.test.ts, mcp-tools-task-workflow.test.ts). Each test name embeds its AC id for -t filtering with matched-count assertions.

Scenarios: one per AC —
- AC-072-1 round-trip: draft adhoc task in upstream, 7 issue_report fields, in pending queue, absent from ready --adhoc until approved.
- AC-072-2 unconfigured → exit 4 naming both keys, zero writes.
- AC-072-3 identity mismatch → exit 4 expected-vs-found, upstream doc count unchanged.
- AC-072-4 version skew → exit 4 naming both versions, sha256(db,-wal,-shm) identical pre/post.
- AC-072-5 sync-enabled upstream → exit 4 naming SQLite-only.
- AC-072-6 11th report → exit 4 listing 10 ids, upstream task count stays 10.
- AC-072-8 zero-doc upstream → possible_duplicates [], write succeeds exit 0.
- AC-072-9 2 concurrent reports → 2 distinct tasks + exactly 2 parseable receipt lines.
- AC-072-10 --list joins live status + rejection reason; upstream path removed → status unreachable, exit 0.
- AC-072-11 MCP without by → validation error; with by → same task shape as CLI.

AC:
- cd packages/lore && bun test tests/unit/service/issue-report-cross-corpus.bun.test.ts exit 0, with per-AC -t filters each matching ≥1 test (no zero-match false green).
- Suite never touches the repo's own .lore/ (paths under mkdtemp only — asserted by fixture construction).
- Full dual-runner suite green on main after merge (orchestrator-run).

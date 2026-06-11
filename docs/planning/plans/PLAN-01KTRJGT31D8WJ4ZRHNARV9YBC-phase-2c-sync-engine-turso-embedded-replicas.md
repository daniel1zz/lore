---
id: PLAN-01KTRJGT31D8WJ4ZRHNARV9YBC
type: plan
category: planning
title: Phase 2c — Sync Engine (Turso Embedded Replicas)
summary: >-
  Implement SPEC-009: TursoStore (libsql embedded replica), optimistic locking
  across all stores, lore sync CLI (setup/push/pull/status), config.yaml sync
  section. Strategy: Interface-First with 3-way parallel Phase 1.
status: approved
priority: critical
tags:
  - phase-2
  - sync
  - turso
  - libsql
  - optimistic-locking
created: '2026-06-10T10:51:15.944Z'
updated: '2026-06-11T05:10:45.688Z'
version: 1.0.4
plan_category: feature
governance_mode: attended
invariants:
  - 本地-only 零回归：无 sync 配置时 createApp 走 SQLiteStore，全量 vitest + bun test 通过
  - StoreInterface 契约唯一：TursoStore/SQLiteStore/InMemoryStore 行为等价，同一契约测试套验证
  - 无声 fallback 禁止：Turso 不可达写入返回 STORE_ERROR，不队列不吞错
  - 'auth_token 不明文入 config.yaml — 只存 ${LORE_SYNC_TOKEN} env 引用'
  - 乐观锁在 storage 层 conditional UPDATE (WHERE version=?)，0 rows → STALE_VERSION
  - bun build --compile 可编译，运行时不读模板文件
  - TS strict + Zod 数据边界（config.yaml 解析必过 Zod）
---
# Phase 2c — Sync Engine (Turso Embedded Replicas)

## Overview

Implements SPEC-009. Adds cloud sync via Turso embedded replicas: local SQLite remains the read path, writes forward to remote, optimistic locking prevents silent overwrites. Local-only mode is untouched.

Strategy: **Interface-First** (chosen over Risk-First, 2 alternatives compared) — Phase 0 defines contracts, Phase 1 runs three parallel tracks (disjoint file sets verified), Phase 2 integrates.

## Governance Mode

attended — phase gates require user confirmation.

## Decisions Log

- D-001: StoreInterface async (SPEC-009 §3.2 Option A) — landed in 183028c
- D-002: Optimistic locking via conditional UPDATE (WHERE version=?), 0 rows → STALE_VERSION
- D-003: Sync verification = local file: contract tests + manual acceptance checklist for remote path (user confirmed 2026-06-10)
- D-004: auth_token via ${LORE_SYNC_TOKEN} env reference, never plaintext in config.yaml
- D-005: Offline write = fail loud STORE_ERROR, no local queue (user confirmed 2026-06-10)
- D-006: sync push = logical replication — read local rows, batch INSERT to remote via @libsql/client direct connection (user confirmed 2026-06-10)
- D-007: Store selection = config.yaml sync.enabled + remote_url present → TursoStore, token from LORE_SYNC_TOKEN env, missing token fails loud (user confirmed 2026-06-10)

## Research Evidence

- [S] context7 /tursodatabase/libsql-client-ts: createClient({url:'file:', syncUrl, authToken, syncInterval(seconds), readYourWrites}); sync() → {frame_no, frames_synced}
- [实测] Bun 1.3.10: @libsql/client native binding works (CRUD + sync method present)
- [代码核实] sqlite-store.update has NO version check today; service set() does unconditional version+1

## Risk Register

| ID | Category | Impact | Trigger | Mitigation | Contingency |
|---|---|---|---|---|---|
| R1 | Technical | H | TursoStore fails opening existing bun:sqlite-created lore.db (WAL/journal incompat) | Phase 1b first task = fixture compat test against existing DB file | TursoStore uses separate db file + sync push rebuilds |
| R2 | Technical | M | Optimistic locking change breaks service layer set() signature | Phase 0 fixes contract explicitly (updateWithVersion semantics) before implementations | Keep legacy update() overload |
| R3 | Scope | M | sync push misses tables (docs/links/versions/audit/api_keys = 5 tables) | AC enumerates full table list + row-count reconciliation after push | Re-push idempotently |
| R4 | Dependency | L | User Turso credentials not provided → remote acceptance deferred | Manual acceptance checklist delivery = plan complete (user agreed) | Schedule follow-up verification |

## Exit Criteria

1. TursoStore passes the same StoreInterface contract suite as SQLiteStore (file: mode)
2. STALE_VERSION returned on concurrent stale write across all 3 store implementations
3. lore sync setup/push/pull/status work per SPEC-009 §5; clear error when unconfigured
4. Local-only zero regression (full vitest + bun test green)
5. bun run build compiles; compiled binary runs `lore sync status`
6. Manual acceptance checklist for remote path delivered

## Estimation

Total ~10 session-units; critical path Phase 0(1) → 1b(3) → 2(2) = 6 SU.


## Manual Acceptance Checklist (EC-6 — remote path, requires user Turso credentials)

Run after `lore sync setup --url <libsql://...> ` with LORE_SYNC_TOKEN set:

1. `lore sync push` → exit 0; output reports per-table row counts for ALL 5 tables: docs, links, versions, audit_log, api_keys
2. Row-count reconciliation: `turso db shell <db> "SELECT count(*) FROM docs"` matches local `sqlite3 .lore/lore.db "SELECT count(*) FROM docs"` (repeat per table)
3. Machine 2 (or fresh clone + same config): `lore list` shows the same docs after sync interval or `lore sync pull`
4. Concurrent write conflict: machine 1 edits doc X; machine 2 edits same doc X with stale version → second write returns STALE_VERSION (SPEC-009 §7 AC row 3, remote transport)
5. Offline behavior: disconnect network → `lore get <slug>` still works (local read); `lore create ...` returns STORE_ERROR (D-005 fail-loud)
6. `lore sync status` shows: remote URL, last sync time, frames synced

## Review Fixes Applied (2026-06-10)

- EC-6 concretized into 6-item checklist above (DocReview MINOR #1)
- SPEC-009 §7 AC "write queued or error" updated to "error (fail loud)" per D-005 — spec is living snapshot (MINOR #2)
- Phase 1a scope explicitly includes InMemoryStore version check (MINOR #3) — enforced in task decomposition
- syncInterval unit resolved: seconds ([S] context7 API reference + libsql source float secs) (MINOR #4)


## Consumer Coverage Notes

- `src/service/version-service.ts` — owned by task T1A-2 (expected_version adaptation at restore call site)
- `src/service/resolve.ts` — imports StoreInterface types only; update() signature change is backward-compatible (optional 3rd param) → no change needed
- `vitest.config.ts` — imports nothing from plan-owned files at runtime; alias config already covers new test paths → no change needed


## Session Handoff (2026-06-10 → next session)

### Accomplished
- Plan created + DocReview approved (0 BLOCKER/MAJOR, 4 MINOR fixed) + validate_plan quality 84
- 6 phases / 16 leaf tasks, TDD-paired (5 RED tasks), critical path P0→1b→P2 (6 SU)
- Doc chain registered: PLAN → SPEC-009 (feature-spec) → PRD-001
- User-confirmed decisions D-001..D-007 in Decisions Log above

### Not Started
- ALL execution. First dispatch wave (Phase 0, both ready, file-disjoint → parallel):
  1. TASK-01KTRJTXS3VP2KQPQ6VN7T39NJ — StoreInterface optimistic-lock contract (owns: src/store/store-interface.ts)
  2. TASK-01KTRJTXS1EQJ9YRXX466TCP10 — config schema RED tests (owns: tests/unit/core/config.test.ts)
  - then TASK-01KTRJTXS4FWRBC7C1DM14N42M (config Zod schema, depends on RED)

### Execution Protocol Reminders
- get_next_tasks(PLAN-01KTRJGT31D8WJ4ZRHNARV9YBC) → dispatch docman-implementer/tester subagents (worktree), merge immediately on return
- git baseline: main @ 549b008 (clean tree)
- Phase gate = attended: user confirms between phases

### Known Issues Carried Forward
- tsc --noEmit full-project OOM (preexisting, also on clean main; TS 5.9.3 + vitest 3.2.6 types). Workaround: src-only tsconfig subset for typecheck oracle. Root-cause fix is a separate task — not in this plan.
- 12 DocMan orphan docs remain (see RETRO-01KTTHD4F3F6S40C1XQGN85WAS) — fix via docman-doctor when needed.
- prepare_for_next_session tool errored (SqliteError: no such table documents) — handoff recorded here instead.

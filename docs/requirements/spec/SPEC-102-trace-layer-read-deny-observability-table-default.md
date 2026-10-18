---
id: SPEC-102
type: spec
role: spec
title: "Trace layer — read/deny observability table, default-on, with lore trace stats"
status: approved
priority: medium
created: 2026-07-28
updated: 2026-10-17
tags: []
links:
  - {id: SPEC-094, type: implements}
---
## Overview/Goal

Lore's core mechanisms (deterministic gates, feed packs, knowledge corpus) have ZERO read-side observability: gate skips are audited but gate DENIES are persisted nowhere; no record exists of which docs are ever read, which searches hit nothing, or whether feed packs are consumed. Every "is Lore working" debate runs on recollection. Upstream decisions: `knowledge-grill-review-2026-07-28-seven-product-direction` (decisions 2/3/6 — trace-first, same-DB trace table, deny statistics) and `knowledge-cross-corpus-generalization-retro-2026-07-28-guyin` (asymmetry 1: write-automation ≻ read-consumption on all three corpora).

Goal: a `trace_events` table in lore.db — separate from the tamper-evident audit chain, default ON, fire-and-forget — recording read events and gate-deny events, plus a `lore trace stats` aggregation surface that turns the benefit/friction debate into data.

## Scope

IN: migration-011 (`trace_events` + indexes); `TraceRecorder` DI port (mirroring the optional `recordGateSkip` port pattern — bare test constructions stay untraced); instrumentation of CorpusService.get / CorpusService.search / feed (checkpoint packs + session-resume) / MCP context_bundle / GateEnforcer deny path / `lore gate` CLI deny path; `lore trace stats [--since <iso>] [--json]` CLI verb; config keys `trace.enabled` (default true) + `trace.retention_days` (default 90); opportunistic bounded-batch retention pruning at CLI startup; Zod event schema in @lore/core.

OUT (explicitly): hash-chaining trace rows (audit chain stays the only tamper-evident stream); replicating trace to Turso/sync-push (local-only by design — see D3); tracing HTTP dashboard page views (dashboard reads go through the same services and are covered there); junction table for feed-served docs (D6); any daemon/background process; automated alerting on stats.

## Domain Concepts

| Entity | Aggregate | Lifecycle | Key invariants |
|---|---|---|---|
| trace_events | standalone append-only stream | insert → (retention prune DELETE only) | never blocks/fails the traced op; no UPDATE ever; not hash-chained; stats reads never emit trace rows (no recursion) |

## Schema (migration-011, additive, inlined SQL constant, IF NOT EXISTS, PRAGMA user_version = 11)

```sql
CREATE TABLE IF NOT EXISTS trace_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT NOT NULL,              -- ISO 8601 with ms (repo-wide TEXT-ISO convention; lexicographic == chronological, range-indexable)
  actor      TEXT NOT NULL,
  surface    TEXT NOT NULL,              -- cli|agent|mcp|http_cookie|http_token (SPEC-024); validated app-layer, no CHECK (forward-compat)
  session_id TEXT NOT NULL,              -- SAME derivation source as audit writes, never reconstructed
  kind       TEXT NOT NULL,              -- get|search|feed|context_bundle|gate_deny; validated by Zod, no CHECK (D2)
  doc_id     TEXT,                       -- get: doc read; else NULL; deliberately NO FK (D4)
  checkpoint TEXT,                       -- gate_deny + feed rows only (promoted from JSON per review consensus)
  hit_count  INTEGER,                    -- search rows only (promoted from JSON per review consensus)
  details    TEXT NOT NULL DEFAULT '{}'  -- JSON: search→{query}; feed→{docs_served[]}; gate_deny→{predicates_failed[],target_slug,layer:hook|service}
);
CREATE INDEX IF NOT EXISTS idx_trace_kind_ts    ON trace_events(kind, ts DESC);
CREATE INDEX IF NOT EXISTS idx_trace_kind_actor ON trace_events(kind, actor, ts DESC);
CREATE INDEX IF NOT EXISTS idx_trace_doc        ON trace_events(doc_id) WHERE doc_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trace_ts         ON trace_events(ts);   -- retention cutoff seek
```

## Access Patterns & Indexes

| Pattern | Query shape | Index |
|---|---|---|
| counts by kind over window | WHERE ts >= ? GROUP BY kind | idx_trace_kind_ts |
| deny breakdown | WHERE kind='gate_deny' GROUP BY checkpoint (+ json_each over predicates_failed, low volume) | idx_trace_kind_ts + checkpoint column |
| deny→retry-success gap | per deny row, next audit success same checkpoint+actor — computed READ-SIDE at stats time, never stored (readiness-is-computed ethos) | idx_trace_kind_actor + existing audit indexes |
| never-read docs | docs.id NOT IN (SELECT DISTINCT doc_id WHERE kind='get' AND ts >= ?) | idx_trace_doc |
| zero-hit searches | WHERE kind='search' AND hit_count = 0 | idx_trace_kind_ts (filter) |
| retention prune | DELETE WHERE id IN (SELECT id FROM trace_events WHERE ts < ? LIMIT 50000) loop — portable (no UPDATE_DELETE_LIMIT build-flag dependency) | idx_trace_ts |

## Migration Strategy

| Change | Steps | Rollback | Risk |
|---|---|---|---|
| migration-011 | additive CREATE TABLE/INDEX IF NOT EXISTS; user_version 10→11; LATEST_SCHEMA_VERSION=11 | irreversible by design (compiled-binary distribution; consistent with prior migrations) — documented | low: no existing-table ALTER; crash-safe idempotent re-run |
| Turso mode | trace writes go to a SEPARATE local bun:sqlite handle on the replica file — the exact ApiKeyStore precedent in app.ts composition root; trace_events NOT added to sync-push replicated set | n/a | keeps trace per-machine (D3); avoids merging machines' streams and shipping raw queries to remote |
| No auto_vacuum change | steady-state append+prune reuses freed pages; DB growth bounded by retention | n/a | avoids a VACUUM-requiring pragma flip on live 66MB DBs |

## Security & Privacy

| Field | Classification | Protection | Retention |
|---|---|---|---|
| details.query (search) | may contain secrets/personal context typed by users/agents | LOCAL-ONLY (never synced, D3); `lore trace stats` outputs AGGREGATES only — raw queries require explicit local `lore trace stats --raw-queries` | trace.retention_days (90) prune |
| actor read patterns | team-visibility concern in future multi-user sync | moot while local-only; if team-shared trace is ever proposed it REQUIRES its own spec + explicit opt-in (recorded here as a standing constraint) | same |
| details JSON assembly | built from user input | parameterized SQL throughout (repo invariant); JSON.stringify at the single recorder seam | n/a |

## Design Decisions

| ID | Decision | Rationale | Dissenting view |
|---|---|---|---|
| D1 | ts TEXT ISO-8601 (with ms) | repo-wide SSOT convention (audit/judgments all TEXT ISO); lexicographic order == chronological so b-tree range predicates seek fine | query-optimizer reviewer wanted INTEGER unix-ms; rejected — convention wins, index refutes the full-scan claim |
| D2 | no CHECK on kind/surface; Zod at the recorder boundary | forward-compat: new kinds must not require a migration nor break older binaries | schema-purist view (CHECK like review_judgments.decision) noted; decision set there is stable, kind set here is not |
| D3 | local-only, never replicated | privacy (raw queries), per-machine semantics, no sync-push coupling; ApiKeyStore separate-handle precedent for Turso mode | "unified team observability" deferred to a future opt-in spec |
| D4 | doc_id has NO FK | fire-and-forget insert must never fail on referential state; traces of deleted docs must survive | data-modeler reviewer wanted FK; rejected with this rationale |
| D5 | fire-and-forget TraceRecorder DI port | mirrors recordGateSkip: optional constructor port, absent in bare test constructions, swallow-and-continue on write failure | none |
| D6 | feed docs_served stays in details JSON (no junction table) | feed events are low-volume; "read" for never-read detection is defined as kind='get'; json_each suffices for feed coverage queries | data-modeler 1NF objection recorded; revisit only if feed-level per-doc analytics become a measured need |
| D7 | deny recorded at BOTH hook layer (lore gate CLI) and service layer (GateEnforcer), disambiguated by details.layer | the two layers see different traffic (hook denies pre-empt service calls); double-count avoided by layer tag in stats | none |

## Acceptance Criteria

Structured ACs follow via `lore ac add` (all mode=script, oracle=test, per tech-kind verification profile):

- AC-TRACE-1 migration: fresh `lore init` DB reaches user_version 11 with trace_events + all four indexes present.
- AC-TRACE-2 read instrumentation: CorpusService.get/search with a wired recorder insert rows with correct kind/actor/surface/doc_id/hit_count; bare construction (no recorder) inserts nothing. Expected values (judge advisory 2026-07-28 — the AC text must carry them, not the test author's memory): a `get` row has kind='get', doc_id = the resolved doc id, hit_count NULL; a `search` row has kind='search', doc_id NULL, hit_count = the result count (0 on a miss, never NULL); `surface` is the SPEC-024 resolved caller surface literal for the invoking adapter (cli|agent|mcp|http_cookie|http_token), not a hardcoded default.
- AC-TRACE-3 deny instrumentation + isolation: a service-layer gate deny inserts a kind='gate_deny' row carrying checkpoint + predicates_failed + layer; a recorder whose write THROWS does not alter the traced operation's Result.
- AC-TRACE-4 stats: `lore trace stats --json` returns, under `data`, exactly these keys — `since`, `counts_by_kind` (object keyed by kind), `deny_by_checkpoint` (array), `zero_hit_search_count` (number), `never_read_docs_count` (number), `deny_retry_gap` (array) — over the --since window; omitting --since defaults `since` to the Unix epoch (whole-history).
- AC-TRACE-5 retention: startup prune deletes only rows older than trace.retention_days, in batches of at most 50000 rows per DELETE statement (the bound is part of the contract, not an implementation detail — an unbounded single DELETE fails this AC); trace.enabled=false disables both recording and pruning.
- AC-TRACE-6 no recursion: running `lore trace stats` twice yields identical row counts (stats reads emit no trace rows).
- AC-TRACE-7 Turso isolation: in sync mode trace writes land via the local handle and trace_events is absent from the sync-push replicated table set.

### AC-TRACE-7 verifiability boundary (measured 2026-07-28, P4-hardening)

What its oracle actually proves, stated explicitly so no reader mistakes exit-0 for full coverage:

- PROVEN directly: `trace_events` is absent from the sync-push replicated table set (a source-text assertion over `REPLICATED_TABLES`) — the D3 invariant that matters most.
- NOT proven by execution: that a LIVE Turso composition routes trace writes to the local handle. Constructing the real `createApp` Turso branch in-test is blocked on the driver, not on effort: `@libsql/client`'s embedded-replica mode passes `syncUrl` straight to the native binding, which parses it as an `http::Uri` and PANICS the process (SIGABRT, uncatchable from JS) on both `file:` and `file://` forms; a syntactically valid `libsql://` URL instead makes `TursoStore`'s own schema init attempt a real network round-trip (~2.9s to fail locally, unbounded on a restricted runner) — non-hermetic either way. Both paths were attempted and measured.
- Consequently the local-handle wiring is verified structurally (composition-root reading + the separate-handle regression) rather than by executing the Turso branch. A future libsql release that accepts a local `syncUrl`, or a supported in-process fake, is what would close this — not another mirror test.

## Quality Gates (database mode) — checklist

- (1) FKs indexed: N/A — zero FKs by design (D4), justification documented.
- (2) Access-pattern justification: every index maps to a named stats query (table above).
- (3) Zero-downtime migration: additive-only, idempotent, crash-safe; irreversibility documented.
- (4) Data-type rules: no floats; TEXT ISO timestamps per repo convention (D1).


## Acceptance Criteria (structured)

- [·] [script] AC-TRACE-1: Fresh lore init DB reaches user_version 11 with trace_events table and idx_trace_kind_ts/idx_trace_kind_actor/idx_trace_doc/idx_trace_ts present
  script: test — bunx --bun vitest run packages/lore/tests/unit/store/trace-events.bun.test.ts -t AC-TRACE-1
  other_command=6
- [⚑] [script] AC-TRACE-2: CorpusService.get/search with wired TraceRecorder insert rows with correct kind/actor/surface/doc_id/hit_count; bare construction inserts nothing
  script: test — bunx vitest run packages/lore/tests/unit/service/trace-recorder.test.ts -t AC-TRACE-2
  other_command=1
- [⚑] [script] AC-TRACE-3: Service-layer gate deny inserts kind=gate_deny row with checkpoint+predicates_failed+layer; a throwing recorder does not alter the traced operation Result
  script: test — bunx vitest run packages/lore/tests/unit/service/trace-recorder.test.ts -t AC-TRACE-3
- [·] [script] AC-TRACE-4: lore trace stats --json returns counts-by-kind, deny-by-checkpoint, zero-hit-search count and never-read-docs count over --since window
  script: test — bunx --bun vitest run packages/lore/tests/integration/cli/trace-stats.bun.test.ts -t AC-TRACE-4
  other_command=6
- [·] [script] AC-TRACE-5: Startup prune deletes only rows older than trace.retention_days in bounded batches; trace.enabled=false disables recording and pruning
  script: test — bunx --bun vitest run packages/lore/tests/integration/cli/trace-stats.bun.test.ts -t AC-TRACE-5
  other_command=5
- [·] [script] AC-TRACE-6: Running lore trace stats twice yields identical trace_events row counts (stats reads emit no trace rows)
  script: test — bunx --bun vitest run packages/lore/tests/integration/cli/trace-stats.bun.test.ts -t AC-TRACE-6
  other_command=5
- [·] [script] AC-TRACE-7: In sync mode trace writes land via the separate local handle and trace_events is absent from the sync-push replicated table set
  script: test — bunx --bun vitest run packages/lore/tests/unit/store/trace-events.bun.test.ts -t AC-TRACE-7
  other_command=5

## Code anchors

- packages/lore/src/store/migrations/migration-011.ts
- packages/lore/src/service/trace-recorder.ts

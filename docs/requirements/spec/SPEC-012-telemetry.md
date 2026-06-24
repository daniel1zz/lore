---
id: SPEC-012
type: spec
role: spec
title: "Telemetry Module"
status: active
priority: medium
phase: P1
created: 2026-06-24
updated: 2026-06-24
tags: [telemetry, observability, phase-1]
parent: PRD-001
links:
  - {id: SPEC-001, type: implements, note: "Telemetry sits at service layer"}
  - {id: SPEC-003, type: consumes, note: "CLI commands invoke instrumented services"}
---

# SPEC-012 — Telemetry Module

---

## 1. Purpose

Add a minimal, non-blocking telemetry layer that appends structured events to a JSONL file. Telemetry is the data foundation for future eval framework comparisons, SLA tracking, and adoption metrics. MVP scope is intentionally narrow — no dashboard, no external sink, no sampling.

---

## 2. Module Boundaries

| File | Role |
|------|------|
| `src/core/telemetry.ts` | Schema (Zod), interface, NoOp + JSONL implementations, factory |
| `src/core/config.ts` | `telemetry?` section added to `LoreConfigSchema` |
| `src/app.ts` | Factory wires `Telemetry` into `CorpusService` based on config |
| `src/service/corpus-service.ts` | 5 instrumented methods: `create / get / list / search / link` |

No other service (ReviewService, VersionService, OutlineService, MigrationService, TreeCheckService) is instrumented in MVP.

---

## 3. Event Schema

```typescript
interface TelemetryEvent {
  ts: string;               // ISO 8601 UTC timestamp
  service: string;          // "CorpusService"
  method: string;           // "create" | "get" | "list" | "search" | "link"
  ok: boolean;              // true = success, false = error
  duration_ms: number;      // wall-clock call duration
  error_code?: string;      // LoreError.code when ok=false
  meta?: Record<string, unknown>; // optional structured context
}
```

Each event is serialized as a single JSON line (JSONL format) appended to the telemetry file. One event per service call.

---

## 4. Implementations

### 4.1 NoOpTelemetry

- `record()` is a no-op — zero allocations, zero IO
- `close()` is a no-op
- Used when: (a) `config.telemetry` is absent, (b) `config.telemetry.enabled=false`, (c) unit tests

### 4.2 JsonlTelemetry

- Appends `JSON.stringify(event) + "\n"` to the configured path via `appendFileSync`
- Constructor creates the parent directory (`mkdirSync({ recursive: true })`) if absent
- **IO errors in `record()` are always swallowed** — telemetry failures MUST NOT propagate to service callers
- `close()` sets an internal `closed` flag; subsequent `record()` calls become no-ops
- `close()` is idempotent

### 4.3 Invariant: record() never throws

This is the single most important invariant. Instrumented service methods call `this.recordTelemetryEvent()` after every code path (success or failure). If telemetry could throw, it would break the service contract. The JSONL writer wraps `appendFileSync` in a try/catch that discards all errors.

---

## 5. Configuration

Added to `LoreConfigSchema` (`.lore/config.yaml`):

```yaml
telemetry:
  enabled: true           # default: false (absent section = NoOp)
  path: .lore/telemetry.jsonl   # default path
```

**Default behavior**: when the `telemetry` section is absent, `createTelemetry(undefined)` returns `NoOpTelemetry`. This ensures the CLI's 21 existing commands produce no new file side effects unless the user explicitly opts in.

---

## 6. Instrumented Methods (MVP)

Only `CorpusService` is instrumented in MVP. The 5 chosen methods cover the most frequent user-facing operations:

| Method | Meta fields |
|--------|-------------|
| `create` | `{ type }` |
| `get` | `{ idOrSlug }` |
| `list` | `{ filter_type, count }` |
| `search` | `{ query_length, hits }` |
| `link` | `{ link_type }` |

The instrumentation pattern delegates the real work to a private `_impl` method, captures `startMs = Date.now()` before, and calls `recordTelemetryEvent` after with the Result. This ensures the event is recorded regardless of whether the call succeeded or failed, and with the correct duration.

---

## 7. Composition Root Wiring

`createApp(dbPath, config?)` now:
1. Calls `createTelemetry(config?.telemetry)` — returns NoOp if absent
2. Passes the `Telemetry` instance into `CorpusService`
3. Calls `telemetry.close()` inside `app.close()`

The `App` interface is not changed — telemetry is an internal implementation detail of `CorpusService`.

---

## 8. Future Work (not in MVP)

- **Multiple sinks**: structured to accept a `Telemetry[]` fan-out in future
- **Sampler**: wrap `JsonlTelemetry` with a sampling decorator (e.g., 10% of calls)
- **Dashboard**: read `telemetry.jsonl` to produce per-method latency percentiles
- **Remote sink**: send events to a remote endpoint (e.g., OTLP HTTP) without OpenTelemetry SDK dependency
- **Instrument other services**: ReviewService, VersionService, etc.
- **Session ID**: correlate events within a single CLI invocation

---

## 9. Test Coverage Requirements

See `tests/unit/core/telemetry.test.ts` for six-dimension coverage:
- HAPPY: record + flush to file
- NEGATIVE: IO error does not throw from record()
- BOUNDARY: meta field is nullable/absent
- ERROR: unwritable path → graceful degradation
- STATE: close() prevents subsequent writes
- REGRESSION: NoOpTelemetry implements all interface methods

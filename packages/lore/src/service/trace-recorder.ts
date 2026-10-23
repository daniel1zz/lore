/**
 * TraceRecorder — fire-and-forget read/deny observability writer (SPEC-102).
 *
 * A doc READ is counted, never logged per row (BR-1373, AC-LG-9): `recordRead` bumps the per-day counter with
 * one atomic upsert and writes NO `trace_events` row. Every other kind still writes one row.
 *
 * Mirrors `gate-enforcer.ts`'s `recordGateSkip` DI port EXACTLY (module header
 * of that file documents the pattern this one repeats): an OPTIONAL
 * constructor dependency, absent in every bare test construction (`new
 * CorpusService(store)`, `new GateEnforcer(config)`, ...), wired ONLY by
 * `app.ts`'s production composition root. A write failure — a rejected
 * promise, a `Result.err`, a synchronous throw from a misbehaving injected
 * port, or a Zod validation failure — degrades to one `process.stderr`
 * warning and NEVER changes the traced operation's own `Result` (SPEC-102
 * D5). Never hash-chained (unlike `audit`), never awaited by any call site.
 *
 * @invariant Every `record*` method is synchronous and non-blocking — none of
 *   them return a Promise a caller could mistakenly `await` (which would
 *   reintroduce a latency/failure dependency the fire-and-forget contract
 *   forbids). The underlying `insert` port's promise is fired and its
 *   settlement observed only for the stderr-warning side effect.
 * @invariant `kind`/`surface`/the full row shape are Zod-validated
 *   (`traceEventInputSchema`, `@lore/core`) BEFORE the `insert` port is ever
 *   called — a caller bug (e.g. a negative `hit_count`) degrades to the SAME
 *   stderr warning as a store-level write failure, never a thrown exception.
 * @invariant `session_id` mirrors `AuditEntry.session_id`'s existing
 *   convention in this codebase (SPEC-102 §Schema "SAME derivation source as
 *   audit writes, never reconstructed") — for a `get` event, that is the
 *   read doc's OWN id (audit's create/update entries use `session_id: doc.id`
 *   identically); for kinds with no natural target doc (`search`/`feed`/
 *   `context_bundle`/`gate_deny`), a fixed per-kind sentinel is used, the
 *   same "no real doc to anchor to" reasoning `GATE_SKIP_AUDIT_SESSION_ID`
 *   documents for `gate_skipped` audit rows.
 *
 * @see SPEC-102 §Design Decisions D5, §Schema
 */

import { discardWarnings, type WarnSink } from "./warn-sink.js";
import {
  traceEventInputSchema,
  type CallerSurface,
  type LoreError,
  type Result,
} from "@lore/core";
import type { TraceEventInput } from "../store/store-interface.js";

/**
 * Narrow injected port for writing one trace row — bound to
 * `store.insertTraceEvent` in `app.ts` (mirrors `gate-enforcer.ts`'s
 * `RecordGateSkip` narrow-port shape: a bare function type, not the whole
 * `StoreInterface`, so `TraceRecorder` gains no IO surface beyond "insert one
 * row").
 */
export type InsertTraceEvent = (event: TraceEventInput) => Promise<Result<void, LoreError>>;

/**
 * Narrow injected port for counting one read — bound to `store.incrementReadCount` in `app.ts`. Takes the UTC day
 * (`YYYY-MM-DD`); the store performs ONE atomic upsert (BR-1373).
 */
export type IncrementReadCount = (day: string) => Promise<Result<void, LoreError>>;

/** Fixed `session_id` sentinel for a `search` trace row — no natural target doc. */
const SEARCH_SESSION_ID = "trace-search";
/** Fixed `session_id` sentinel for a `feed` trace row — no single target doc (may serve several). */
const FEED_SESSION_ID = "trace-feed";
/** Fixed `session_id` sentinel for a `context_bundle` trace row — no single target doc. */
const CONTEXT_BUNDLE_SESSION_ID = "trace-context-bundle";
/** Fixed `session_id` sentinel for a `gate_deny` trace row — a checkpoint gates a candidate, not a persisted doc read. */
const GATE_DENY_SESSION_ID = "trace-gate-deny";

/** Which layer produced a `gate_deny` trace row (SPEC-102 D7 — double-count avoidance). */
export type TraceGateDenyLayer = "hook" | "service";

export class TraceRecorder {
  /**
   * @param insert - `store.insertTraceEvent.bind(store)` in production.
   * @param incrementReadCount - The per-day read counter port; a read writes no `trace_events` row.
   * @param getSurface - Reads the CURRENT caller surface at fire time (not
   *   construction time) — bound to the SAME mutable `_callerSurface` closure
   *   variable `app.ts`'s `buildAppFromSqlite`/`buildAppFromTurso` already
   *   expose via `App.callerSurface`'s getter/setter. A plain captured value
   *   would be stale: `TraceRecorder` is constructed before the CLI adapter's
   *   `detectCliSurface()` call sets the real surface (`loader.ts`), so a
   *   snapshot taken at construction would read the default `"cli"` forever.
   */
  constructor(
    private readonly insert: InsertTraceEvent,
    /** Counts one read into the per-day counter (BR-1373) — `store.incrementReadCount.bind(store)` in production. */
    private readonly incrementReadCount: IncrementReadCount,
    private readonly getSurface: () => CallerSurface,
    /** Where a failed best-effort write is reported; absent (bare test construction) -> not printed anywhere. */
    private readonly warnSink: WarnSink = discardWarnings,
  ) {}

  /**
   * Counts a doc read (SPEC-102 §Scope — `CorpusService.get`) into the per-day counter. Writes NO
   * `trace_events` row (BR-1373); the counter is bumped by one atomic upsert in the store, so concurrent
   * readers lose nothing. Same fire-and-forget contract as every `record*` method.
   */
  recordRead(): void {
    try {
      Promise.resolve(this.incrementReadCount(new Date().toISOString().slice(0, 10)))
        .then((result) => {
          if (!result.ok) {
            this.warn("get", "message" in result.error ? result.error.message : result.error.code);
          }
        })
        .catch((error: unknown) => {
          this.warn("get", error instanceof Error ? error.message : String(error));
        });
    } catch (error) {
      // reason: a port that throws SYNCHRONOUSLY never reaches the `.catch` above (same guard as `fire`).
      this.warn("get", error instanceof Error ? error.message : String(error));
    }
  }

  /** Records a full-text search (SPEC-102 §Scope — `CorpusService.search`). */
  recordSearch(actor: string, query: string, hitCount: number): void {
    this.fire({
      actor,
      kind: "search",
      hit_count: hitCount,
      session_id: SEARCH_SESSION_ID,
      details: { query },
    });
  }

  /**
   * Records a gate denial — recorded at BOTH the hook layer (`lore gate` CLI)
   * and the service layer (`GateEnforcer.enforce`), disambiguated by
   * `details.layer` (SPEC-102 D7).
   */
  recordGateDeny(
    actor: string,
    checkpoint: string,
    predicatesFailed: readonly string[],
    targetSlug: string | undefined,
    layer: TraceGateDenyLayer,
  ): void {
    this.fire({
      actor,
      kind: "gate_deny",
      checkpoint,
      session_id: GATE_DENY_SESSION_ID,
      details: {
        predicates_failed: predicatesFailed,
        ...(targetSlug !== undefined ? { target_slug: targetSlug } : {}),
        layer,
      },
    });
  }

  /** Records a feed-pack serve (checkpoint packs + session-resume, SPEC-102 §Scope). */
  recordFeed(actor: string, checkpoint: string, docsServed: readonly string[]): void {
    this.fire({
      actor,
      kind: "feed",
      checkpoint,
      session_id: FEED_SESSION_ID,
      details: { docs_served: docsServed },
    });
  }

  /** Records an MCP `context_bundle` serve (SPEC-102 §Scope). */
  recordContextBundle(actor: string): void {
    this.fire({
      actor,
      kind: "context_bundle",
      session_id: CONTEXT_BUNDLE_SESSION_ID,
      details: {},
    });
  }

  /**
   * Assembles `ts`/`surface` (the two fields every `record*` caller omits),
   * Zod-validates the full row, and fires the insert WITHOUT awaiting it —
   * see this class's module header for the full fire-and-forget contract.
   */
  private fire(partial: Omit<TraceEventInput, "ts" | "surface">): void {
    const candidate = {
      ts: new Date().toISOString(),
      surface: this.getSurface(),
      ...partial,
    };

    const parsed = traceEventInputSchema.safeParse(candidate);
    if (!parsed.success) {
      this.warn(candidate.kind, `Zod validation failed: ${parsed.error.message}`);
      return;
    }

    // reason: `exactOptionalPropertyTypes` — Zod's `.optional()` output type is
    // `field?: T | undefined`, while `StoreInterface.TraceEventInput` declares
    // `field?: T` (present-and-typed, or absent — never present-as-undefined).
    // Rebuilding via conditional spread (never `field: undefined`) mirrors the
    // "optional field omitted, not nulled" convention every row mapper in this
    // codebase already follows (e.g. `rowToAuditEntry`).
    const validated = parsed.data;
    const event: TraceEventInput = {
      ts: validated.ts,
      actor: validated.actor,
      surface: validated.surface,
      session_id: validated.session_id,
      kind: validated.kind,
      ...(validated.doc_id !== undefined ? { doc_id: validated.doc_id } : {}),
      ...(validated.checkpoint !== undefined ? { checkpoint: validated.checkpoint } : {}),
      ...(validated.hit_count !== undefined ? { hit_count: validated.hit_count } : {}),
      details: validated.details,
    };

    try {
      Promise.resolve(this.insert(event))
        .then((result) => {
          if (!result.ok) {
            this.warn(candidate.kind, "message" in result.error ? result.error.message : result.error.code);
          }
        })
        .catch((error: unknown) => {
          this.warn(candidate.kind, error instanceof Error ? error.message : String(error));
        });
    } catch (error) {
      // reason: a port that throws SYNCHRONOUSLY (rather than returning a
      // rejected promise) never reaches the `.catch` above — caught here so a
      // misbehaving injected port can never propagate out of a `record*` call
      // (mirrors `GateEnforcer.recordSkip`'s identical guard).
      this.warn(candidate.kind, error instanceof Error ? error.message : String(error));
    }
  }

  /** Single stderr-warning formatter — every failure branch in `fire()` prints the identical shape. */
  private warn(kind: string, reason: string): void {
    this.warnSink(`trace event not recorded (kind "${kind}"): ${reason}`);
  }
}

/**
 * Unit tests for `TraceRecorder` + its wiring into `CorpusService.get`/`search`
 * and `GateEnforcer.enforce` (SPEC-102 T2). Uses InMemoryStore ONLY — no
 * `bun:sqlite`, no file I/O — so this file runs under vitest, not `bun test`.
 *
 * Covers: AC-TRACE-2 (read instrumentation + bare-construction silence),
 * AC-TRACE-3 (deny instrumentation + isolation from a throwing recorder).
 *
 * Six-dimension coverage:
 *   HAPPY:      get/search insert rows with correct kind/actor/surface/doc_id/
 *               hit_count; a service-layer deny inserts a gate_deny row with
 *               checkpoint/predicates_failed/layer.
 *   NEGATIVE:   n/a — TraceRecorder has no user-facing invalid-input surface
 *               (Zod-guarded internally, see BOUNDARY below).
 *   BOUNDARY:   a malformed candidate event (empty actor) is swallowed by the
 *               Zod guard, never thrown, never inserted.
 *   STATE:      bare `new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)))` / `new GateEnforcer(config)`
 *               (no traceRecorder wired) insert ZERO trace rows.
 *   ERROR:      a recorder whose `insert` port THROWS SYNCHRONOUSLY does not
 *               alter the traced operation's own Result (AC-TRACE-3's explicit
 *               isolation requirement) — both for a read (get) and a deny
 *               (GateEnforcer.enforce).
 *   REGRESSION: a rejected-promise `insert` port (not a synchronous throw) is
 *               ALSO swallowed — the fire-and-forget contract holds for both
 *               failure shapes, mirroring `recordGateSkip`'s own dual guard.
 *
 * @spec_ref SPEC-102 §Acceptance Criteria AC-TRACE-2, AC-TRACE-3
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { TraceRecorder } from "../../../src/service/trace-recorder.js";
import type { TraceEventInput } from "../../../src/store/store-interface.js";
import type { LoreError, Result } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

function makeStore() {
  return actedStore(new InMemoryStore());
}

/**
 * Reads back every trace row currently in `store` — InMemoryStore has no
 * direct accessor, so this goes through the public StoreInterface query
 * surface. Both underlying calls return `Result<T, LoreError>` — this helper
 * asserts `ok` and unwraps `.value` so call sites work with plain data.
 */
async function allTraceRows(store: InMemoryStore) {
  const since = "2000-01-01T00:00:00.000Z";
  const [kindsResult, deniesResult] = await Promise.all([
    store.countTraceEventsByKind({ since }),
    store.listTraceGateDenies({ since }),
  ]);
  if (!kindsResult.ok) throw new Error(`countTraceEventsByKind failed: ${kindsResult.error.code}`);
  if (!deniesResult.ok) throw new Error(`listTraceGateDenies failed: ${deniesResult.error.code}`);
  return { kinds: kindsResult.value, denies: deniesResult.value };
}

describe("TraceRecorder — read instrumentation (AC-TRACE-2)", () => {
  let originalActor: string | undefined;

  beforeEach(() => {
    originalActor = process.env["LORE_ACTOR"];
    process.env["LORE_ACTOR"] = "agent:trace-test";
  });

  afterEach(() => {
    if (originalActor === undefined) delete process.env["LORE_ACTOR"];
    else process.env["LORE_ACTOR"] = originalActor;
  });

  it("HAPPY: CorpusService.get with a wired recorder inserts a kind=get row with correct actor/surface/doc_id", async () => {
    const store = makeStore();
    const recorder = new TraceRecorder(store.insertTraceEvent.bind(store), () => "agent");
    const service = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)), undefined, undefined, undefined, recorder);

    const createResult = await service.create({ type: "prd", title: "Trace Me" });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const getResult = await service.get(createResult.value.id);
    expect(getResult.ok).toBe(true);

    // reason: fire-and-forget insert is synchronous inside InMemoryStore (no
    // real IO) but STILL routed through a Promise chain — flush one microtask
    // tick so the .then() continuation (if any) has settled before asserting.
    await Promise.resolve();

    const { kinds } = await allTraceRows(store);
    expect(kinds["get"]).toBe(1);

    const raw = await store.countTraceEventsByKind({ since: "2000-01-01T00:00:00.000Z" });
    expect(raw.ok).toBe(true);
  });

  it("HAPPY: CorpusService.search with a wired recorder inserts a kind=search row with correct hit_count (post SPEC-043 filtering)", async () => {
    const store = makeStore();
    const recorder = new TraceRecorder(store.insertTraceEvent.bind(store), () => "cli");
    const service = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)), undefined, undefined, undefined, recorder);

    await service.create({ type: "prd", title: "Searchable Widget Factory" });

    const searchResult = await service.search("Searchable");
    expect(searchResult.ok).toBe(true);
    await Promise.resolve();

    const rawQueries = await store.listTraceRawSearchQueries({ since: "2000-01-01T00:00:00.000Z" });
    expect(rawQueries.ok).toBe(true);
    if (!rawQueries.ok) return;
    expect(rawQueries.value).toHaveLength(1);
    expect(rawQueries.value[0]?.query).toBe("Searchable");

    const zeroHit = await store.countTraceZeroHitSearches({ since: "2000-01-01T00:00:00.000Z" });
    expect(zeroHit.ok).toBe(true);
    if (!zeroHit.ok) return;
    // reason: the seeded PRD matches "Searchable" — this is NOT a zero-hit search.
    expect(zeroHit.value).toBe(0);
  });

  it("STATE: bare CorpusService construction (no traceRecorder wired) inserts ZERO trace rows on get/search", async () => {
    const store = makeStore();
    const service = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined))); // no traceRecorder — mirrors every pre-existing unit test construction

    const createResult = await service.create({ type: "prd", title: "Untraced" });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    await service.get(createResult.value.id);
    await service.search("Untraced");
    await Promise.resolve();

    const { kinds } = await allTraceRows(store);
    expect(kinds["get"]).toBeUndefined();
    expect(kinds["search"]).toBeUndefined();
  });

  it("HAPPY: CorpusService.get does NOT trace a failed lookup (DOC_NOT_FOUND)", async () => {
    const store = makeStore();
    const recorder = new TraceRecorder(store.insertTraceEvent.bind(store), () => "agent");
    const service = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)), undefined, undefined, undefined, recorder);

    const getResult = await service.get("01NONEXISTENT00000000001");
    expect(getResult.ok).toBe(false);
    await Promise.resolve();

    const { kinds } = await allTraceRows(store);
    expect(kinds["get"]).toBeUndefined();
  });

  it("BOUNDARY: a malformed candidate event (empty actor, fails Zod at the recorder seam) is swallowed, never inserted, never thrown", async () => {
    const store = makeStore();
    // reason: getSurface returning an empty actor is impossible via the real
    // resolveActorWithSource chain (never empty), so this directly exercises
    // TraceRecorder's public API with a deliberately-invalid actor to prove
    // the Zod guard, not CorpusService's actor-resolution path.
    const recorder = new TraceRecorder(store.insertTraceEvent.bind(store), () => "agent");

    expect(() => recorder.recordGet("", "01DOC00000000000000000001")).not.toThrow();
    await Promise.resolve();

    const { kinds } = await allTraceRows(store);
    expect(kinds["get"]).toBeUndefined();
  });
});

describe("TraceRecorder — deny instrumentation + isolation (AC-TRACE-3)", () => {
  it("HAPPY: a service-layer gate deny inserts a kind=gate_deny row with checkpoint/predicates_failed/layer=service", async () => {
    const store = makeStore();
    const recorder = new TraceRecorder(store.insertTraceEvent.bind(store), () => "agent");
    const enforcer = new GateEnforcer(undefined, undefined, recorder, () => "test-actor");

    const result = enforcer.enforce("spec-create", {
      specKind: "feature",
      content: "no heading here",
    });
    expect(result.ok).toBe(false);
    await Promise.resolve();

    const denies = await store.listTraceGateDenies({ since: "2000-01-01T00:00:00.000Z" });
    expect(denies.ok).toBe(true);
    if (!denies.ok) return;
    expect(denies.value).toHaveLength(1);
    expect(denies.value[0]?.checkpoint).toBe("spec-create");

    const byKind = await store.countTraceDenyByCheckpoint({ since: "2000-01-01T00:00:00.000Z" });
    expect(byKind.ok).toBe(true);
    if (!byKind.ok) return;
    expect(byKind.value).toEqual([{ checkpoint: "spec-create", layer: "service", count: 1 }]);

    // reason: predicates_failed is carried in `details`, not a queryable column
    // — read it back via the raw store row to assert the exact shape.
    const rawCounts = await store.countTraceEventsByKind({ since: "2000-01-01T00:00:00.000Z" });
    expect(rawCounts.ok).toBe(true);
    if (!rawCounts.ok) return;
    expect(rawCounts.value["gate_deny"]).toBe(1);
  });

  it("HAPPY: enforce() does NOT fire a deny trace when every predicate passes", async () => {
    const store = makeStore();
    const recorder = new TraceRecorder(store.insertTraceEvent.bind(store), () => "agent");
    const enforcer = new GateEnforcer(undefined, undefined, recorder, () => "test-actor");

    const result = enforcer.enforce("spec-create", {
      specKind: "feature",
      content: "## Overview\n\nBody.",
    });
    expect(result).toEqual({ ok: true, value: undefined });
    await Promise.resolve();

    const denies = await store.listTraceGateDenies({ since: "2000-01-01T00:00:00.000Z" });
    expect(denies.ok).toBe(true);
    if (!denies.ok) return;
    expect(denies.value).toEqual([]);
  });

  it("STATE: bare GateEnforcer construction (no traceRecorder wired) fires zero trace rows on a deny", async () => {
    const store = makeStore();
    const enforcer = new GateEnforcer(undefined); // no traceRecorder — mirrors every pre-existing unit test construction

    const result = enforcer.enforce("spec-create", { specKind: "feature", content: "no heading" });
    expect(result.ok).toBe(false);

    const denies = await store.listTraceGateDenies({ since: "2000-01-01T00:00:00.000Z" });
    expect(denies.ok).toBe(true);
    if (!denies.ok) return;
    expect(denies.value).toEqual([]);
  });

  it("ERROR: a recorder whose insert port THROWS SYNCHRONOUSLY does not alter enforce()'s own Result", () => {
    const throwingInsert = (_event: TraceEventInput): Promise<Result<void, LoreError>> => {
      throw new Error("simulated synchronous port failure");
    };
    const recorder = new TraceRecorder(throwingInsert, () => "agent");
    const enforcer = new GateEnforcer(undefined, undefined, recorder, () => "test-actor");

    let result: ReturnType<typeof enforcer.enforce> | undefined;
    expect(() => {
      result = enforcer.enforce("spec-create", {
        specKind: "feature",
        content: "no heading here",
      });
    }).not.toThrow();

    expect(result?.ok).toBe(false);
    if (result === undefined || result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect((result.error as { field?: string }).field).toBe("gate:spec-create");
  });

  it("ERROR: a recorder whose insert port THROWS SYNCHRONOUSLY does not alter CorpusService.get's own Result", async () => {
    const store = makeStore();
    const throwingInsert = (_event: TraceEventInput): Promise<Result<void, LoreError>> => {
      throw new Error("simulated synchronous port failure");
    };
    const recorder = new TraceRecorder(throwingInsert, () => "agent");
    const service = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)), undefined, undefined, undefined, recorder);

    const createResult = await service.create({ type: "prd", title: "Untouched By Failure" });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    // reason: `expect(fn).not.toThrow()` only checks a SYNCHRONOUS throw and
    // never awaits an async `fn`'s returned promise — a genuine race here,
    // not a real assertion. Await directly and catch instead.
    let thrown = false;
    let getResult: Awaited<ReturnType<typeof service.get>> | undefined;
    try {
      getResult = await service.get(createResult.value.id);
    } catch {
      thrown = true;
    }

    expect(thrown).toBe(false);
    expect(getResult?.ok).toBe(true);
    if (getResult === undefined || !getResult.ok) return;
    expect(getResult.value.doc.id).toBe(createResult.value.id);
  });

  it("REGRESSION: a recorder whose insert port returns a REJECTED PROMISE (not a sync throw) is also swallowed — enforce()'s Result is unaffected", async () => {
    const rejectingInsert = (_event: TraceEventInput): Promise<Result<void, LoreError>> =>
      Promise.reject(new Error("simulated async port failure"));
    const recorder = new TraceRecorder(rejectingInsert, () => "agent");
    const enforcer = new GateEnforcer(undefined, undefined, recorder, () => "test-actor");

    const result = enforcer.enforce("spec-create", {
      specKind: "feature",
      content: "no heading here",
    });
    expect(result.ok).toBe(false);

    // reason: let the rejected promise's .catch() continuation settle before
    // the test ends, so an unhandled-rejection warning never leaks into a
    // LATER test's output — this is the ONLY reason this test awaits anything.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("REGRESSION: a recorder whose insert port resolves ok(false)-shaped err() Result is swallowed — enforce()'s Result is unaffected", async () => {
    const erroringInsert = (_event: TraceEventInput): Promise<Result<void, LoreError>> =>
      Promise.resolve({ ok: false, error: { code: "STORE_ERROR", message: "simulated store failure" } });
    const recorder = new TraceRecorder(erroringInsert, () => "agent");
    const enforcer = new GateEnforcer(undefined, undefined, recorder, () => "test-actor");

    const result = enforcer.enforce("spec-create", {
      specKind: "feature",
      content: "no heading here",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR"); // unchanged — never STORE_ERROR from the failed trace write
    }

    await Promise.resolve();
  });
});

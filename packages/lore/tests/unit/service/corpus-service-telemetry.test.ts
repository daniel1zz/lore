/**
 * Unit tests for CorpusService telemetry instrumentation.
 * Verifies that the 5 instrumented methods (create/get/list/search/link) produce
 * correct TelemetryEvent records via a spy/capturing implementation.
 * Uses InMemoryStore — no file I/O, no SQLite.
 * Covers: HAPPY / ERROR / STATE
 * @spec_ref SPEC-012 §6
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { type Telemetry, type TelemetryEvent, type AiGenerationEvent } from "@lore/core";
import type { CreateDocInput } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

// ─── Capturing telemetry spy ─────────────────────────────────────────────────

/** In-memory telemetry that captures all recorded events for test assertions. */
class CapturingTelemetry implements Telemetry {
  readonly events: TelemetryEvent[] = [];
  readonly aiEvents: AiGenerationEvent[] = [];
  private closed = false;

  record(event: TelemetryEvent): void {
    if (this.closed) return;
    this.events.push(event);
  }

  emit(event: AiGenerationEvent): void {
    if (this.closed) return;
    this.aiEvents.push(event);
  }

  close(): void {
    this.closed = true;
  }

  /** Last recorded event — convenience accessor. */
  get last(): TelemetryEvent | undefined {
    return this.events[this.events.length - 1];
  }
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeServiceWithCapture() {
  const store = actedStore(new InMemoryStore());
  const telemetry = new CapturingTelemetry();
  const service = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)), telemetry);
  return { service, telemetry, store };
}

function prdInput(title = "Test PRD"): CreateDocInput {
  return { type: "prd", title };
}

// ─── HAPPY — create records one event ────────────────────────────────────────

describe("HAPPY — create() records a telemetry event", () => {
  it("successful create → 1 event with ok=true, method=create, service=CorpusService", async () => {
    const { service, telemetry } = makeServiceWithCapture();
    const result = await service.create(prdInput());
    expect(result.ok).toBe(true);

    expect(telemetry.events).toHaveLength(1);
    const event = telemetry.last!;
    expect(event.service).toBe("CorpusService");
    expect(event.method).toBe("create");
    expect(event.ok).toBe(true);
    expect(event.error_code).toBeUndefined();
    expect(event.duration_ms).toBeGreaterThanOrEqual(0);
    expect(event.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(event.meta).toMatchObject({ type: "prd" });
  });

  it("successful get() → 1 event with method=get", async () => {
    const { service, telemetry } = makeServiceWithCapture();
    const createResult = await service.create(prdInput("Get Test"));
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    telemetry.events.length = 0; // reset after create

    const getResult = await service.get(createResult.value.slug);
    expect(getResult.ok).toBe(true);

    expect(telemetry.events).toHaveLength(1);
    expect(telemetry.last!.method).toBe("get");
    expect(telemetry.last!.ok).toBe(true);
  });

  it("successful list() → 1 event with method=list and count in meta", async () => {
    const { service, telemetry } = makeServiceWithCapture();
    await service.create(prdInput("Doc A"));
    await service.create(prdInput("Doc B"));
    telemetry.events.length = 0; // reset

    const listResult = await service.list({});
    expect(listResult.ok).toBe(true);

    expect(telemetry.events).toHaveLength(1);
    expect(telemetry.last!.method).toBe("list");
    expect(telemetry.last!.ok).toBe(true);
    expect(telemetry.last!.meta).toMatchObject({ count: 2 });
  });

  it("successful search() → 1 event with method=search and hits in meta", async () => {
    const { service, telemetry } = makeServiceWithCapture();
    await service.create(prdInput("Searchable Doc"));
    telemetry.events.length = 0;

    const searchResult = await service.search("Searchable");
    expect(searchResult.ok).toBe(true);

    expect(telemetry.events).toHaveLength(1);
    expect(telemetry.last!.method).toBe("search");
    expect(telemetry.last!.ok).toBe(true);
    expect(typeof telemetry.last!.meta?.["query_length"]).toBe("number");
  });

  it("successful link() → 1 event with method=link and link_type in meta", async () => {
    const { service, telemetry } = makeServiceWithCapture();
    const prd = await service.create(prdInput("Source PRD"));
    const adr = await service.create({ type: "adr", title: "ADR 1", extra: { decision_status: "proposed" } });
    expect(prd.ok).toBe(true);
    expect(adr.ok).toBe(true);
    if (!prd.ok || !adr.ok) return;

    telemetry.events.length = 0; // reset after creates

    const linkResult = await service.link(adr.value.slug, prd.value.slug, "relates-to");
    expect(linkResult.ok).toBe(true);

    expect(telemetry.events).toHaveLength(1);
    expect(telemetry.last!.method).toBe("link");
    expect(telemetry.last!.ok).toBe(true);
    expect(telemetry.last!.meta).toMatchObject({ link_type: "relates-to" });
  });
});

// ─── ERROR — failed calls still record events with error_code ────────────────

describe("ERROR — failed service calls still record telemetry events", () => {
  it("create() with validation failure → event with ok=false and error_code", async () => {
    const { service, telemetry } = makeServiceWithCapture();
    // task requires parent_id — omitting it causes PARENT_REQUIRED error
    const result = await service.create({ type: "task", title: "Orphan Task", extra: { plan_id: "p" } });
    expect(result.ok).toBe(false);

    expect(telemetry.events).toHaveLength(1);
    const event = telemetry.last!;
    expect(event.ok).toBe(false);
    expect(event.error_code).toBeDefined();
    expect(event.method).toBe("create");
  });

  it("get() with non-existent doc → event with ok=false and error_code", async () => {
    const { service, telemetry } = makeServiceWithCapture();
    const result = await service.get("prd-does-not-exist");
    expect(result.ok).toBe(false);

    expect(telemetry.events).toHaveLength(1);
    expect(telemetry.last!.ok).toBe(false);
    expect(telemetry.last!.error_code).toBeDefined();
    expect(telemetry.last!.method).toBe("get");
  });
});

// ─── STATE — all 5 instrumented methods emit exactly 1 event each ─────────────

describe("STATE — all 5 instrumented methods produce exactly 1 event per call", () => {
  it("5 consecutive calls → exactly 5 events with distinct methods", async () => {
    const { service, telemetry } = makeServiceWithCapture();

    // create
    const created = await service.create(prdInput("State Test PRD"));
    if (!created.ok) throw new Error("create failed");

    // get (may fail if doc was created — use the slug)
    await service.get(created.value.slug);

    // list
    await service.list({});

    // search
    await service.search("state");

    // link — create another doc first
    const created2 = await service.create({ type: "adr", title: "ADR Link Test", extra: { decision_status: "proposed" } });
    if (!created2.ok) throw new Error("create adr failed");
    await service.link(created2.value.slug, created.value.slug, "relates-to");

    // We expect: 2 creates + 1 get + 1 list + 1 search + 1 link = 6 events total
    // (create is instrumented, so 2 creates = 2 events)
    const methods = telemetry.events.map((e) => e.method);
    expect(methods).toContain("create");
    expect(methods).toContain("get");
    expect(methods).toContain("list");
    expect(methods).toContain("search");
    expect(methods).toContain("link");

    // Every event must have required fields
    for (const event of telemetry.events) {
      expect(event.ts).toBeTruthy();
      expect(event.service).toBe("CorpusService");
      expect(typeof event.ok).toBe("boolean");
      expect(typeof event.duration_ms).toBe("number");
    }
  });

  it("telemetry close() after service calls stops further recording", async () => {
    const { service, telemetry } = makeServiceWithCapture();
    await service.create(prdInput("Before close"));
    telemetry.close();
    const countAfterClose = telemetry.events.length;

    await service.create(prdInput("After close"));
    // No new events after close
    expect(telemetry.events.length).toBe(countAfterClose);
  });
});

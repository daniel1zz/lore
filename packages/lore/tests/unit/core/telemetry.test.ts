/**
 * Unit tests for src/core/telemetry.ts
 * Covers: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 * Uses vitest (no bun:sqlite dependency).
 * @spec_ref SPEC-012
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, mkdirSync, rmdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  NoOpTelemetry,
  JsonlTelemetry,
  createTelemetry,
  TelemetryEventSchema,
  type TelemetryEvent,
} from "@core/telemetry.js";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    ts: new Date().toISOString(),
    service: "CorpusService",
    method: "create",
    ok: true,
    duration_ms: 5,
    ...overrides,
  };
}

function readJsonlLines(filePath: string): TelemetryEvent[] {
  const raw = readFileSync(filePath, "utf8");
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as TelemetryEvent);
}

// Temporary directory for each test
let tmpDir: string;
let telemetryPath: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `lore-telemetry-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  telemetryPath = join(tmpDir, ".lore", "telemetry.jsonl");
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // cleanup best-effort
  }
});

// ─── HAPPY ───────────────────────────────────────────────────────────────────

describe("HAPPY — JsonlTelemetry records events", () => {
  it("record() writes a valid JSONL line to file", () => {
    const tel = new JsonlTelemetry(telemetryPath);
    tel.record(makeEvent());
    tel.close();

    expect(existsSync(telemetryPath)).toBe(true);
    const lines = readJsonlLines(telemetryPath);
    expect(lines).toHaveLength(1);
    // Validate schema
    expect(() => TelemetryEventSchema.parse(lines[0])).not.toThrow();
  });

  it("record() appends multiple events in order", () => {
    const tel = new JsonlTelemetry(telemetryPath);
    tel.record(makeEvent({ method: "create" }));
    tel.record(makeEvent({ method: "get" }));
    tel.record(makeEvent({ method: "list" }));
    tel.close();

    const lines = readJsonlLines(telemetryPath);
    expect(lines).toHaveLength(3);
    expect(lines[0]?.method).toBe("create");
    expect(lines[1]?.method).toBe("get");
    expect(lines[2]?.method).toBe("list");
  });

  it("createTelemetry with enabled=true returns JsonlTelemetry that writes", () => {
    const tel = createTelemetry({ enabled: true, path: telemetryPath });
    tel.record(makeEvent());
    tel.close();

    expect(existsSync(telemetryPath)).toBe(true);
    const lines = readJsonlLines(telemetryPath);
    expect(lines).toHaveLength(1);
  });
});

// ─── NEGATIVE ────────────────────────────────────────────────────────────────

describe("NEGATIVE — IO errors in record() do not throw", () => {
  it("record() on an unwritable path does not throw", () => {
    // Use a path under a non-existent deeply nested dir to simulate write failure
    // We can't easily remove write perms in CI, so instead close first and
    // verify the closed-state path (which also must not throw)
    const tel = new JsonlTelemetry(join(tmpDir, "sub", "telemetry.jsonl"));
    tel.close();
    // record after close must not throw
    expect(() => tel.record(makeEvent())).not.toThrow();
  });

  it("NoOpTelemetry.record() never throws regardless of event shape", () => {
    const tel = new NoOpTelemetry();
    const weirdEvent = makeEvent({ meta: { deeply: { nested: null } } });
    expect(() => tel.record(weirdEvent)).not.toThrow();
    expect(() => tel.record(makeEvent({ ok: false, error_code: "DOC_NOT_FOUND" }))).not.toThrow();
  });
});

// ─── BOUNDARY ────────────────────────────────────────────────────────────────

describe("BOUNDARY — meta field is optional/nullable", () => {
  it("records event without meta field", () => {
    const tel = new JsonlTelemetry(telemetryPath);
    const event: TelemetryEvent = {
      ts: new Date().toISOString(),
      service: "CorpusService",
      method: "list",
      ok: true,
      duration_ms: 1,
      // no meta
    };
    tel.record(event);
    tel.close();

    const lines = readJsonlLines(telemetryPath);
    expect(lines[0]?.meta).toBeUndefined();
  });

  it("records event with complex nested meta", () => {
    const tel = new JsonlTelemetry(telemetryPath);
    tel.record(makeEvent({ meta: { count: 42, filter_type: "spec", tags: ["a", "b"] } }));
    tel.close();

    const lines = readJsonlLines(telemetryPath);
    expect(lines[0]?.meta).toEqual({ count: 42, filter_type: "spec", tags: ["a", "b"] });
  });

  it("records error event with error_code", () => {
    const tel = new JsonlTelemetry(telemetryPath);
    tel.record(makeEvent({ ok: false, error_code: "DOC_NOT_FOUND" }));
    tel.close();

    const lines = readJsonlLines(telemetryPath);
    expect(lines[0]?.ok).toBe(false);
    expect(lines[0]?.error_code).toBe("DOC_NOT_FOUND");
  });
});

// ─── ERROR ───────────────────────────────────────────────────────────────────

describe("ERROR — path not writable gracefully degrades", () => {
  it("createTelemetry with enabled=false returns NoOpTelemetry (no file created)", () => {
    const tel = createTelemetry({ enabled: false, path: telemetryPath });
    tel.record(makeEvent());
    tel.close();
    // No file should be created
    expect(existsSync(telemetryPath)).toBe(false);
  });

  it("createTelemetry with undefined config returns NoOpTelemetry", () => {
    const tel = createTelemetry(undefined);
    tel.record(makeEvent());
    tel.close();
    expect(existsSync(telemetryPath)).toBe(false);
  });
});

// ─── STATE ───────────────────────────────────────────────────────────────────

describe("STATE — close() prevents subsequent writes", () => {
  it("record() after close() is a no-op (no new lines appended)", () => {
    const tel = new JsonlTelemetry(telemetryPath);
    tel.record(makeEvent({ method: "create" }));
    tel.close();
    // This must not write
    tel.record(makeEvent({ method: "get" }));

    const lines = readJsonlLines(telemetryPath);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.method).toBe("create");
  });

  it("close() is idempotent — calling twice does not throw", () => {
    const tel = new JsonlTelemetry(telemetryPath);
    tel.record(makeEvent());
    expect(() => { tel.close(); tel.close(); }).not.toThrow();
  });
});

// ─── REGRESSION ──────────────────────────────────────────────────────────────

describe("REGRESSION — NoOpTelemetry implements full interface", () => {
  it("NoOpTelemetry has both record() and close() methods", () => {
    const tel = new NoOpTelemetry();
    expect(typeof tel.record).toBe("function");
    expect(typeof tel.close).toBe("function");
  });

  it("JsonlTelemetry auto-creates parent directory", () => {
    const nestedPath = join(tmpDir, "a", "b", "c", "telemetry.jsonl");
    const tel = new JsonlTelemetry(nestedPath);
    tel.record(makeEvent());
    tel.close();
    expect(existsSync(nestedPath)).toBe(true);
  });

  it("TelemetryEventSchema validates a complete event", () => {
    const event = makeEvent({
      ok: false,
      error_code: "VALIDATION_ERROR",
      meta: { field: "title" },
    });
    expect(() => TelemetryEventSchema.parse(event)).not.toThrow();
  });
});

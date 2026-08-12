/**
 * AC-OWN-5 (spec-multi-session-concurrency-queryable-ownership-checkout) —
 * `lore session list` derives each liveness verdict from the orchestrator
 * pid PLUS process start time, and NEVER from claim age. `isClaimStale`'s
 * TTL arithmetic may inform REPORTING (`ReadySession.stale`) but must never
 * decide the verdict — proved here by two directly contrasting cases: a
 * FRESH claim held by a DEAD process reports "dead", and a STALE claim held
 * by a LIVE process reports "alive". A pid that is currently alive but whose
 * OS-observed start time no longer matches the recorded one is the pid-reuse
 * defence and reports "dead" — pid alone is not sufficient identity.
 *
 * Two layers are exercised:
 *   1. `deriveLivenessVerdict` (`service/session-liveness.ts`) — the pure
 *      three-valued decision, in isolation.
 *   2. `SessionService.recordOwnHeartbeat` / `deriveSessionLiveness` — the
 *      service-level join, with FAKE `probeProcessStartTimePort`/
 *      `writeHeartbeatPort`/`readHeartbeatPort` injected via the
 *      constructor (never a real `ps` subprocess or real tmpdir file).
 *
 * Six-dimension coverage (service-level `deriveSessionLiveness` suite):
 *   HAPPY:      a fresh claim's recorded pid is alive with a matching start
 *               time → "alive"
 *   NEGATIVE:   a FRESH claim's recorded pid is confirmed dead (probe
 *               returns null) → "dead" — proves freshness does not grant
 *               "alive"
 *   BOUNDARY:   a STALE claim (`stale: true`) whose recorded pid is alive
 *               with a matching start time → "alive" — proves claim age
 *               does NOT decide the verdict, the direct contrast with NEGATIVE
 *   ERROR:      a live pid whose OS-observed start time no longer matches
 *               the recorded one (pid reuse) → "dead"
 *   STATE:      a session with no `session_id` at all → "unmeasured",
 *               regardless of whatever heartbeat data happens to exist
 *   REGRESSION: a claim recorded on a DIFFERENT machine → "unmeasured" even
 *               when the heartbeat data would otherwise say "alive" —
 *               probing is same-machine only
 *
 * @spec_ref spec-multi-session-concurrency-queryable-ownership-checkout AC-OWN-5
 */

import { describe, expect, it } from "bun:test";
import type { CreateDocInput, DocRecord, LoreError, ReadySession, Result } from "@lore/core";
import { err } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { SessionService } from "../../../src/service/session-service.js";
import {
  deriveLivenessVerdict,
  type SessionHeartbeatRecord,
} from "../../../src/service/session-liveness.js";

// ─── Pure deriveLivenessVerdict ──────────────────────────────────────────────

describe("deriveLivenessVerdict (pure)", () => {
  it("HAPPY: a matching probed start time is alive", () => {
    expect(deriveLivenessVerdict({ pid: 1, started_at: "T0" }, "T0", true)).toBe("alive");
  });

  it("NEGATIVE: a null probe (no such process) is dead", () => {
    expect(deriveLivenessVerdict({ pid: 1, started_at: "T0" }, null, true)).toBe("dead");
  });

  it("ERROR: a mismatched probed start time (pid reuse) is dead, never alive", () => {
    expect(deriveLivenessVerdict({ pid: 1, started_at: "T0" }, "T1", true)).toBe("dead");
  });

  it("STATE: an absent recorded heartbeat is unmeasured, regardless of the probe value", () => {
    expect(deriveLivenessVerdict(undefined, "T0", true)).toBe("unmeasured");
  });

  it("REGRESSION: cross-machine is always unmeasured even with a matching probe", () => {
    expect(deriveLivenessVerdict({ pid: 1, started_at: "T0" }, "T0", false)).toBe("unmeasured");
  });
});

// ─── Service-level join (fake ports) ────────────────────────────────────────

function makeSession(overrides: Partial<ReadySession>): ReadySession {
  return {
    by: "agent:x",
    branches: [],
    task_slugs: [],
    newest_at: "2026-08-12T10:00:00.000Z",
    ...overrides,
  };
}

/** Never-called stub — none of these tests exercise handoff creation. */
async function stubCreateHandoffDoc(_input: CreateDocInput): Promise<Result<DocRecord, LoreError>> {
  return err({
    code: "VALIDATION_ERROR",
    field: "handoff",
    message: "stubCreateHandoffDoc is not used by this suite",
  });
}

interface FakePorts {
  probePid: Map<number, string | null>;
  heartbeats: Map<string, SessionHeartbeatRecord>;
}

function makeService(): { service: SessionService; ports: FakePorts } {
  const ports: FakePorts = { probePid: new Map(), heartbeats: new Map() };
  const store = new InMemoryStore();
  const service = new SessionService(
    store,
    { claimTtlMinutes: 120, handoffTtlMinutes: 10080, createHandoffDoc: stubCreateHandoffDoc },
    async (pid: number) => (ports.probePid.has(pid) ? (ports.probePid.get(pid) as string | null) : null),
    async (sessionId: string, record: SessionHeartbeatRecord) => {
      ports.heartbeats.set(sessionId, record);
    },
    async (sessionId: string) => ports.heartbeats.get(sessionId),
  );
  return { service, ports };
}

describe("SessionService.deriveSessionLiveness (AC-OWN-5)", () => {
  it("HAPPY: a fresh claim's recorded pid is alive with a matching start time", async () => {
    const { service, ports } = makeService();
    ports.heartbeats.set("sess-happy", { pid: 100, started_at: "T0", machine: "host-a" });
    ports.probePid.set(100, "T0");

    const session = makeSession({ session_id: "sess-happy", machine: "host-a" });
    const [record] = await service.deriveSessionLiveness([session], "host-a");

    expect(record?.liveness).toBe("alive");
  });

  it("NEGATIVE: a FRESH claim held by a dead process reports dead (freshness grants nothing)", async () => {
    const { service, ports } = makeService();
    ports.heartbeats.set("sess-fresh-dead", { pid: 101, started_at: "T0", machine: "host-a" });
    ports.probePid.set(101, null); // process no longer exists

    const session = makeSession({
      session_id: "sess-fresh-dead",
      machine: "host-a",
      newest_at: new Date().toISOString(), // as fresh as possible
    });
    const [record] = await service.deriveSessionLiveness([session], "host-a");

    expect(record?.liveness).toBe("dead");
  });

  it("BOUNDARY: a STALE claim held by a live process reports alive — claim age never decides the verdict", async () => {
    const { service, ports } = makeService();
    ports.heartbeats.set("sess-stale-alive", { pid: 102, started_at: "T0", machine: "host-a" });
    ports.probePid.set(102, "T0");

    const session = makeSession({
      session_id: "sess-stale-alive",
      machine: "host-a",
      stale: true, // ReadySession.stale — deliberately present to prove it's ignored
      newest_at: "2020-01-01T00:00:00.000Z", // ancient, would fail any TTL check
    });
    const [record] = await service.deriveSessionLiveness([session], "host-a");

    expect(record?.liveness).toBe("alive");
    expect(record?.stale).toBe(true); // stale is carried through UNCHANGED, never merged into liveness
  });

  it("ERROR: a live pid whose start time no longer matches the recorded one (pid reuse) reports dead", async () => {
    const { service, ports } = makeService();
    ports.heartbeats.set("sess-reused", { pid: 103, started_at: "T0", machine: "host-a" });
    ports.probePid.set(103, "T1"); // a DIFFERENT process now occupies pid 103

    const session = makeSession({ session_id: "sess-reused", machine: "host-a" });
    const [record] = await service.deriveSessionLiveness([session], "host-a");

    expect(record?.liveness).toBe("dead");
  });

  it("STATE: a session with no session_id at all is unmeasured, even when a coincidentally-matching heartbeat exists", async () => {
    const { service, ports } = makeService();
    // reason: seed a heartbeat under a key that could never be looked up
    // anyway (no session_id to key by) — proves the absence check short-circuits
    // BEFORE any heartbeat lookup, not merely that this particular lookup misses.
    ports.heartbeats.set("unused-key", { pid: 104, started_at: "T0", machine: "host-a" });
    ports.probePid.set(104, "T0");

    const session = makeSession({ machine: "host-a" }); // no session_id
    const [record] = await service.deriveSessionLiveness([session], "host-a");

    expect(record?.liveness).toBe("unmeasured");
  });

  it("REGRESSION: a claim recorded on a different machine is unmeasured even though the heartbeat would say alive", async () => {
    const { service, ports } = makeService();
    ports.heartbeats.set("sess-cross-machine", { pid: 105, started_at: "T0", machine: "host-b" });
    ports.probePid.set(105, "T0"); // would report "alive" if probed

    const session = makeSession({ session_id: "sess-cross-machine", machine: "host-b" });
    // currentMachine is "host-a" — DIFFERS from the claim's recorded "host-b".
    const [record] = await service.deriveSessionLiveness([session], "host-a");

    expect(record?.liveness).toBe("unmeasured");
  });

  it("never drops a session — one record per input session, same order", async () => {
    const { service } = makeService();
    const sessions = [
      makeSession({ by: "a", session_id: "s1" }),
      makeSession({ by: "b" }),
      makeSession({ by: "c", session_id: "s3", machine: "elsewhere" }),
    ];

    const records = await service.deriveSessionLiveness(sessions, "host-a");

    expect(records).toHaveLength(3);
    expect(records.map((r) => r.by)).toEqual(["a", "b", "c"]);
  });
});

describe("SessionService.recordOwnHeartbeat (AC-OWN-5 write half)", () => {
  it("HAPPY: records a probed start time, later readable and joinable as alive", async () => {
    const { service, ports } = makeService();
    ports.probePid.set(200, "T5");

    await service.recordOwnHeartbeat("sess-self", 200, "host-a");
    expect(ports.heartbeats.get("sess-self")).toEqual({ pid: 200, started_at: "T5", machine: "host-a" });

    const session = makeSession({ session_id: "sess-self", machine: "host-a" });
    const [record] = await service.deriveSessionLiveness([session], "host-a");
    expect(record?.liveness).toBe("alive");
  });

  it("ERROR: a probe that cannot measure the caller's own pid records nothing (never a fabricated timestamp)", async () => {
    const { service, ports } = makeService();
    ports.probePid.set(201, null); // even our OWN pid probe can fail

    await service.recordOwnHeartbeat("sess-unmeasurable-self", 201, "host-a");

    expect(ports.heartbeats.has("sess-unmeasurable-self")).toBe(false);
  });
});

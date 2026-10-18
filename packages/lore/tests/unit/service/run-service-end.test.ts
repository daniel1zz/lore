/**
 * @spec_ref spec-run-only-write-identity-and-run-end-claim-release (Scope 4; spec-run-only-write-identity-and-run-end-claim-release#AC-ROI-4, spec-run-only-write-identity-and-run-end-claim-release#AC-ROI-6; BR-1057, BR-1029)
 *
 * `RunService.end` / `register` over the InMemoryStore with a recording fake claim port — the service's own
 * decisions (what it asks the claim owner, when it refuses) without a database or a spawned CLI.
 */

import { describe, expect, it } from "vitest";
import { ok, type RunId } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { RunService, type RunClaimEnder } from "../../../src/service/run-service.js";

const COMPOSITION = { schemaVersion: 1 as const, fragments: [] };
const NOW = new Date("2026-10-11T10:00:00.000Z");

function claimEnder(): RunClaimEnder & { calls: { runId: string; reason: string }[] } {
  const calls: { runId: string; reason: string }[] = [];
  return {
    calls,
    async endRunClaims(runId, reason) {
      calls.push({ runId, reason });
      return ok([{ task_slug: "t1", action: "released" as const, worktree: "not-measured" }]);
    },
  };
}

async function registered(store: InMemoryStore, service: RunService, session: string): Promise<RunId> {
  const result = await service.register({ harness: "claude-code", sessionId: session, composition: COMPOSITION });
  if (!result.ok) throw new Error(`fixture register failed: ${result.error.code}`);
  return result.value.id;
}

describe("RunService.end", () => {
  it("HAPPY: ends a registered run, asks the claim owner to end its claims, returns what it handled", async () => {
    const store = new InMemoryStore();
    const claims = claimEnder();
    const service = new RunService(store, () => NOW, claims, undefined, "/repo");
    const id = await registered(store, service, "s1");

    const result = await service.end(id, "session-end");

    expect(result).toEqual({
      ok: true,
      value: { outcome: "ended", claims: [{ task_slug: "t1", action: "released", worktree: "not-measured" }] },
    });
    expect(claims.calls).toEqual([{ runId: id, reason: "session-end" }]);
    expect(await store.getRunEnd(id)).toEqual({ ok: true, value: { endedAt: NOW.toISOString(), endReason: "session-end" } });
  });

  it("NEGATIVE: an unknown run id is ok(unknown-run), writes nothing and never touches claims", async () => {
    const store = new InMemoryStore();
    const claims = claimEnder();
    const service = new RunService(store, () => NOW, claims, undefined, "/repo");

    const result = await service.end("cc:ghost", "session-end");

    expect(result).toEqual({ ok: true, value: { outcome: "unknown-run" } });
    expect(claims.calls).toEqual([]);
    expect(await store.getRun("cc:ghost" as RunId)).toEqual({ ok: true, value: null });
  });

  it("BOUNDARY: a repeat end reports already-ended but still processes claims (a retry finishes a partial run end)", async () => {
    const store = new InMemoryStore();
    const claims = claimEnder();
    const service = new RunService(store, () => NOW, claims, undefined, "/repo");
    const id = await registered(store, service, "s2");
    await service.end(id, "first");

    const again = await service.end(id, "second");

    expect(again.ok && again.value.outcome).toBe("already-ended");
    expect(claims.calls.map((c) => c.reason)).toEqual(["first", "second"]);
    expect(await store.getRunEnd(id)).toEqual({ ok: true, value: { endedAt: NOW.toISOString(), endReason: "first" } });
  });

  it("ERROR: a blank reason is a VALIDATION_ERROR and ends nothing", async () => {
    const store = new InMemoryStore();
    const service = new RunService(store, () => NOW, claimEnder(), undefined, "/repo");
    const id = await registered(store, service, "s3");

    const result = await service.end(id, "   ");

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("VALIDATION_ERROR");
    expect(await store.getRunEnd(id)).toEqual({ ok: true, value: { endedAt: null, endReason: null } });
  });

  it("ERROR: a service built without a claim port refuses loudly rather than ending a run and leaving its claims", async () => {
    const store = new InMemoryStore();
    const service = new RunService(store, () => NOW, undefined, undefined, "/repo");
    const id = await registered(store, service, "s4");

    const result = await service.end(id, "session-end");

    expect(!result.ok && result.error.code).toBe("VALIDATION_ERROR");
    expect(await store.getRunEnd(id)).toEqual({ ok: true, value: { endedAt: null, endReason: null } });
  });
});

describe("RunService.register — reopen", () => {
  it("HAPPY: registering an ended run reopens it and returns the ORIGINAL stored record", async () => {
    const store = new InMemoryStore();
    const service = new RunService(store, () => NOW, claimEnder(), undefined, "/repo");
    const id = await registered(store, service, "s5");
    const original = await store.getRun(id);
    await service.end(id, "session-end");

    const again = await new RunService(store, () => new Date("2027-01-01T00:00:00.000Z"), undefined, undefined, "/repo").register({
      harness: "claude-code",
      sessionId: "s5",
      composition: COMPOSITION,
    });

    expect(again.ok && again.value).toEqual(original.ok ? original.value : undefined);
    expect(await store.getRunEnd(id)).toEqual({ ok: true, value: { endedAt: null, endReason: null } });
  });
});

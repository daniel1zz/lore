/**
 * plan-audit-verify-reads-only-the-keys-it-joins-runs-off-the, D2 + D3 — which runner each store kind gets,
 * and what the runner hands the verify it runs.
 *
 *   HAPPY:      SQLite file -> worker; Turso -> worker; InMemory -> in-loop (decided by store kind, by name)
 *   HAPPY:      the in-loop runner returns the service's own verdict
 *   NEGATIVE:   a worker that errors makes the request fail with that error, verbatim, never an in-loop retry
 *   NEGATIVE:   a worker verdict that is itself an error result is passed through unchanged
 *   BOUNDARY:   `since` reaches the job; absent stays absent (the worker applies the configured watermark)
 *   STATE:      an anchor file on disk reaches the job as `{head_id, head_hash}`; no file -> no anchor
 *   ERROR:      a malformed anchor file fails loud (VALIDATION_ERROR naming the file) and starts no worker
 *
 * Pure: the worker port is injected, so this file runs without a real Worker or a database.
 *
 * @spec_ref spec-079-audit-hardening-link-provenance-actor-fidelity-tamper
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok } from "@lore/core";
import { AuditService, type AuditVerifyResult } from "../../../src/service/audit-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import {
  buildAuditVerifyRunner,
  type AuditVerifyJob,
  type AuditVerifyWorkerPort,
} from "../../../src/service/audit-verify-runner.js";

const CLEAN: AuditVerifyResult = {
  clean: true,
  misses: [],
  since: "2000-01-01T00:00:00.000Z",
  chain: { clean: true, checked: 0 },
  anchor: { status: "absent" },
};

describe("buildAuditVerifyRunner", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "lore-verify-runner-"));
    mkdirSync(join(root, ".lore"), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function deps(port: AuditVerifyWorkerPort) {
    return { verifySince: "2000-01-01T00:00:00.000Z", anchorRoot: root, workerPort: port };
  }

  it("SQLite file store -> worker, handed the db path and the configured watermark", async () => {
    const port = vi.fn<AuditVerifyWorkerPort>(async () => ok(CLEAN));
    const runner = buildAuditVerifyRunner({ kind: "sqlite", dbPath: "/c/.lore/lore.db" }, deps(port));
    expect(runner.mode).toBe("worker");
    const r = await runner.verify();
    expect(r).toEqual(ok(CLEAN));
    expect(port).toHaveBeenCalledTimes(1);
    expect(port.mock.calls[0]?.[0]).toEqual({
      store: { kind: "sqlite", dbPath: "/c/.lore/lore.db" },
      verifySince: "2000-01-01T00:00:00.000Z",
    });
  });

  it("Turso store -> worker, handed the local replica path (no remote, no sync)", async () => {
    const port = vi.fn<AuditVerifyWorkerPort>(async () => ok(CLEAN));
    const runner = buildAuditVerifyRunner({ kind: "turso", localPath: "/c/.lore/lore.db" }, deps(port));
    expect(runner.mode).toBe("worker");
    await runner.verify();
    expect(port.mock.calls[0]?.[0].store).toEqual({ kind: "turso", localPath: "/c/.lore/lore.db" });
  });

  it("InMemory store -> in-loop: the worker port is never touched and the service's own verdict comes back", async () => {
    const port = vi.fn<AuditVerifyWorkerPort>(async () => ok(CLEAN));
    const service = new AuditService(new InMemoryStore(), { verifySince: "2000-01-01T00:00:00.000Z" });
    const runner = buildAuditVerifyRunner({ kind: "memory", auditService: service }, deps(port));
    expect(runner.mode).toBe("in-loop");
    const r = await runner.verify();
    expect(r).toEqual(await service.verify());
    expect(port).not.toHaveBeenCalled();
  });

  it("a worker that errors fails the request with that error, verbatim; the service is never run in-loop", async () => {
    const service = new AuditService(new InMemoryStore(), { verifySince: "2000-01-01T00:00:00.000Z" });
    const spy = vi.spyOn(service, "verify");
    const port: AuditVerifyWorkerPort = async () => err({ code: "STORE_ERROR", message: "worker blew up: unable to open database file" });
    // reason: the sqlite spec carries no AuditService at all; the spy proves the service object of another
    // composition is untouched, and the result below proves nothing was retried in this thread.
    const runner = buildAuditVerifyRunner({ kind: "sqlite", dbPath: "/c/.lore/lore.db" }, deps(port));
    const r = await runner.verify();
    expect(r).toEqual(err({ code: "STORE_ERROR", message: "worker blew up: unable to open database file" }));
    expect(spy).not.toHaveBeenCalled();
  });

  it("a worker port that REJECTS surfaces as a STORE_ERROR carrying the message", async () => {
    const port: AuditVerifyWorkerPort = async () => {
      throw new Error("Worker constructor refused");
    };
    const runner = buildAuditVerifyRunner({ kind: "sqlite", dbPath: "/c/.lore/lore.db" }, deps(port));
    const r = await runner.verify();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("STORE_ERROR");
    expect((r.error as { message: string }).message).toContain("Worker constructor refused");
  });

  it("`since` reaches the job; omitted stays omitted", async () => {
    const port = vi.fn<AuditVerifyWorkerPort>(async () => ok(CLEAN));
    const runner = buildAuditVerifyRunner({ kind: "sqlite", dbPath: "/c/.lore/lore.db" }, deps(port));
    await runner.verify({ since: "2026-10-01T00:00:00.000Z" });
    await runner.verify();
    expect((port.mock.calls[0]?.[0] as AuditVerifyJob).since).toBe("2026-10-01T00:00:00.000Z");
    expect("since" in (port.mock.calls[1]?.[0] as AuditVerifyJob)).toBe(false);
  });

  it("an anchor file on disk reaches the job; no file means no anchor", async () => {
    const port = vi.fn<AuditVerifyWorkerPort>(async () => ok(CLEAN));
    const runner = buildAuditVerifyRunner({ kind: "sqlite", dbPath: "/c/.lore/lore.db" }, deps(port));
    await runner.verify();
    expect("anchor" in (port.mock.calls[0]?.[0] as AuditVerifyJob)).toBe(false);

    writeFileSync(
      join(root, ".lore", "audit-anchor.json"),
      JSON.stringify({ head_id: 7, head_hash: "ab".repeat(32), entry_count: 7, anchored_at: "2026-10-19T00:00:00.000Z" }),
    );
    await runner.verify();
    expect((port.mock.calls[1]?.[0] as AuditVerifyJob).anchor).toEqual({ head_id: 7, head_hash: "ab".repeat(32) });
  });

  it("a malformed anchor file fails loud, naming the file, and starts no worker", async () => {
    const port = vi.fn<AuditVerifyWorkerPort>(async () => ok(CLEAN));
    writeFileSync(join(root, ".lore", "audit-anchor.json"), "{not json");
    const runner = buildAuditVerifyRunner({ kind: "sqlite", dbPath: "/c/.lore/lore.db" }, deps(port));
    const r = await runner.verify();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("VALIDATION_ERROR");
    expect((r.error as { message: string }).message).toContain("audit-anchor.json");
    expect(port).not.toHaveBeenCalled();
  });
});

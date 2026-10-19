/**
 * plan-audit-verify-reads-only-the-keys-it-joins-runs-off-the, D1 — the completeness join reads only the four
 * columns it joins on, through a covering index, so verify's cost does not depend on how large the stored
 * content is.
 *
 *   HAPPY:      `listVersionKeys` returns exactly (doc_id, version, action, created_at) on all three stores
 *   BOUNDARY:   the `since` watermark is inclusive and bounds the keys the way `listAllVersions(since)` does
 *   NEGATIVE:   a key row carries no content / extra / status / title (the payload never leaves the file)
 *   STATE:      the SQLite plan for the key read names a COVERING index (no table lookup)
 *   REGRESSION: verify's run time changes by <= 20% when every version's content is 10x larger
 *   REGRESSION: verify still reports a missing audit entry for a version, from the narrow read
 *
 * @spec_ref spec-079-audit-hardening-link-provenance-actor-fidelity-tamper
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuditService } from "../../../src/service/audit-service.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { TursoStore } from "../../../src/store/turso-store.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import type { StoreInterface } from "../../../src/store/store-interface.js";
import { seedAuditVerifyCorpus } from "../../integration/support/audit-verify-fixture.js";

const SMALL = { docs: 3, versionsPerDoc: 3, contentChars: 64, extraAuditRows: 0 } as const;

describe("listVersionKeys: the narrow completeness read", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lore-verify-narrow-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  async function keysOf(store: StoreInterface, since?: string): Promise<unknown[]> {
    const r = await (store as unknown as { listVersionKeys(s?: string): Promise<{ ok: boolean; value: unknown[] }> }).listVersionKeys(since);
    if (!r.ok) throw new Error(`listVersionKeys failed: ${JSON.stringify(r)}`);
    return r.value;
  }

  for (const kind of ["sqlite", "turso"] as const) {
    it(`${kind}: returns exactly the four join columns, oldest first, bounded inclusively by since`, async () => {
      const fixture = await seedAuditVerifyCorpus(dir, kind, SMALL);
      const store = kind === "sqlite" ? new SQLiteStore(fixture.dbPath) : new TursoStore({ localPath: fixture.dbPath });
      try {
        const all = await keysOf(store);
        expect(all).toHaveLength(9);
        for (const row of all) expect(Object.keys(row as object).sort()).toEqual(["action", "created_at", "doc_id", "version"]);
        const stamps = (all as { created_at: string }[]).map((r) => r.created_at);
        expect(stamps).toEqual([...stamps].sort());

        const cut = stamps[4] as string;
        const bounded = await keysOf(store, cut);
        expect(bounded).toHaveLength(5);
        expect((bounded[0] as { created_at: string }).created_at).toBe(cut);

        const full = await store.listAllVersions(cut);
        if (!full.ok) throw new Error("listAllVersions failed");
        expect(bounded).toEqual(full.value.map((v) => ({ doc_id: v.doc_id, version: v.version, action: v.action, created_at: v.created_at })));
      } finally {
        store.close();
      }
    });
  }

  it("in-memory: same four columns, same since bound", async () => {
    const store = new InMemoryStore();
    for (const [i, at] of ["2026-10-01T00:00:01.000Z", "2026-10-01T00:00:02.000Z", "2026-10-01T00:00:03.000Z"].entries()) {
      await store.insertVersion({
        doc_id: "d1" as never,
        version: i + 1,
        content: "payload",
        extra: { big: true },
        status: "draft",
        title: "t",
        action: i === 0 ? "create" : "update",
        created_at: at,
        created_by: "agent:t",
      });
    }
    const all = await keysOf(store);
    expect(all).toEqual([
      { doc_id: "d1", version: 1, action: "create", created_at: "2026-10-01T00:00:01.000Z" },
      { doc_id: "d1", version: 2, action: "update", created_at: "2026-10-01T00:00:02.000Z" },
      { doc_id: "d1", version: 3, action: "update", created_at: "2026-10-01T00:00:03.000Z" },
    ]);
    expect(await keysOf(store, "2026-10-01T00:00:02.000Z")).toHaveLength(2);
  });

  it("sqlite: the key read is answered from a covering index", async () => {
    const fixture = await seedAuditVerifyCorpus(dir, "sqlite", SMALL);
    new SQLiteStore(fixture.dbPath).close(); // runs migrations, including the covering-index one
    const db = new Database(fixture.dbPath, { readonly: true });
    const plan = db
      .query("EXPLAIN QUERY PLAN SELECT doc_id, version, action, created_at FROM versions WHERE created_at >= ? ORDER BY created_at ASC")
      .all("2026-10-01T00:00:00.000Z") as { detail: string }[];
    db.close();
    expect(plan.map((p) => p.detail).join(" | ")).toMatch(/USING COVERING INDEX/);
  });
});

describe("verify: cost independent of stored payload size", () => {
  const SHAPE = { docs: 1250, versionsPerDoc: 20, extraAuditRows: 4000 } as const;
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  async function openFixture(contentChars: number): Promise<{ service: AuditService; close: () => void }> {
    const dir = mkdtempSync(join(tmpdir(), "lore-verify-payload-"));
    dirs.push(dir);
    const fixture = await seedAuditVerifyCorpus(dir, "sqlite", { ...SHAPE, contentChars });
    const store = new SQLiteStore(fixture.dbPath);
    return { service: new AuditService(store, { verifySince: "2000-01-01T00:00:00.000Z" }), close: () => store.close() };
  }

  async function timeOnce(service: AuditService): Promise<number> {
    const t = performance.now();
    const r = await service.verify();
    const ms = performance.now() - t;
    if (!r.ok || !r.value.clean) throw new Error(`verify not clean: ${JSON.stringify(r)}`);
    return ms;
  }

  it("verify's run time moves by no more than 20% when every version's content is 10x larger", async () => {
    const small = await openFixture(1_000);
    const big = await openFixture(10_000);
    try {
      // reason: the two corpora are timed ALTERNATELY and each is judged by its best of 11 runs, so machine load
      // that comes and goes hits both sides and cannot be mistaken for a payload effect.
      let base = Infinity;
      let tenX = Infinity;
      for (let i = 0; i < 11; i++) {
        base = Math.min(base, await timeOnce(small.service));
        tenX = Math.min(tenX, await timeOnce(big.service));
      }
      console.log(`verify best-of-11: content 1k -> ${base.toFixed(1)} ms; content 10k -> ${tenX.toFixed(1)} ms; ratio ${(tenX / base).toFixed(2)}`);
      expect(tenX / base).toBeLessThanOrEqual(1.2);
    } finally {
      small.close();
      big.close();
    }
  }, 300_000);
});

describe("verify: completeness verdict is unchanged by the narrow read", () => {
  it("a version with no audit entry is still reported as a miss", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lore-verify-miss-"));
    try {
      const fixture = await seedAuditVerifyCorpus(dir, "sqlite", SMALL);
      const raw = new Database(fixture.dbPath);
      // reason: drop one version's audit row; the chain walk is not what this test is about, the miss is.
      raw.exec(`DELETE FROM audit WHERE doc_id = '01FIXTURE00000000000000001' AND json_extract(details, '$.version') = 2`);
      raw.close();
      const store = new SQLiteStore(fixture.dbPath);
      try {
        const r = await new AuditService(store, { verifySince: "2000-01-01T00:00:00.000Z" }).verify();
        if (!r.ok) throw new Error("verify failed");
        expect(r.value.misses).toEqual([
          expect.objectContaining({ doc_id: "01FIXTURE00000000000000001", version: 2, action: "update" }),
        ]);
        expect(r.value.clean).toBe(false);
      } finally {
        store.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

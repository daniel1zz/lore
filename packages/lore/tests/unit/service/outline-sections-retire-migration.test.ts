/**
 * Outline removal (task-remove-the-retired-outline-write-verbs-instead-of-keeping; BR-985 retired).
 *
 * The stored outline (`prd.extra.outline[]`) is removed from every stored PRD by a ONE-TIME migration
 * (`lore migrate outline-sections [--apply]`). Chosen end state: ARCHIVE. The removal is a normal document write, so the
 * version before it still carries the whole outline, and the audit row carries it verbatim (`details.removed`).
 *
 *   - `preview()` lists the PRDs carrying the key and writes nothing.
 *   - `apply()` removes the key (presence, not shape: a malformed value is migrated too), keeps every other `extra`
 *     key, status and title, and records the removed value in the audit row.
 *   - a second `apply()` writes nothing.
 *   - the outline writers and reader are gone from the source tree (grep-style assertions below).
 *
 * @reads packages/lore/src/service/corpus-service.ts
 * @reads packages/lore/src/app.ts
 * @reads packages/lore/src/adapters/retirements.ts
 * @reads packages/lore/src/adapters/cli/commands/outline.ts
 * @reads packages/lore/src/service/prd-outline-service.ts
 * @reads packages/lore/src/service/outline-migration-service.ts
 * @reads packages/lore/src/adapters/cli/index.ts
 * @reads packages/lore/src/adapters/cli/commands/migrate.ts
 * @reads packages/core/src/outline.ts
 *
 * Runner: vitest + `InMemoryStore`. Every `it()` title carries `OL-n`.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { err } from "@lore/core";
import type { CreateDocInput, DocRecord } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { actedStore } from "../../live-invocation.js";

const SERVICE_MODULE = "../../../src/service/outline-sections-retire-migration-service.js";

const OUTLINE = [
  { section: "distribution", title: "Distribution", tier: "domain", direction: "ship via npm" },
  { section: "pricing", title: "Pricing", tier: "core", direction: "free tier" },
];

async function fixture(): Promise<{ store: InMemoryStore; cs: CorpusService; prdWith: DocRecord; prdMalformed: DocRecord; prdArchived: DocRecord; prdPlain: DocRecord }> {
  const store = actedStore(new InMemoryStore());
  const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const mkPrd = async (title: string, extra: Record<string, unknown>): Promise<DocRecord> => {
    const r = await cs.create({ type: "prd", title, content: "prd body", extra } as CreateDocInput);
    if (!r.ok) throw new Error(`create prd failed: ${JSON.stringify(r.error)}`);
    return r.value;
  };
  const prdWith = await mkPrd("Prd with outline", { outline: OUTLINE, keep_me: true });
  const prdMalformed = await mkPrd("Prd with malformed outline", { outline: "oops" });
  const prdArchivedSeed = await mkPrd("Archived prd with outline", { outline: OUTLINE });
  const archived = await store.update(prdArchivedSeed.id, { status: "archived" });
  if (!archived.ok) throw new Error("archive seed failed");
  const prdPlain = await mkPrd("Prd without outline", { keep_me: true });
  return { store, cs, prdWith, prdMalformed, prdArchived: archived.value, prdPlain };
}

type Report = { ok: boolean; value?: { count: number; rows: { slug: string }[]; errors: string[] } };
async function load(): Promise<new (store: InMemoryStore, writer: CorpusService) => { preview(): Promise<Report>; apply(): Promise<Report> }> {
  const mod = (await import(SERVICE_MODULE)) as { OutlineSectionsRetireMigrationService: never };
  return mod.OutlineSectionsRetireMigrationService;
}

async function reread(store: InMemoryStore, id: string): Promise<DocRecord> {
  const found = await store.find(id);
  if (!found.ok || found.value === null) throw new Error(`doc ${id} missing`);
  return found.value;
}

describe("the stored outline is migrated away once (OL)", () => {
  it("OL-1 BOUNDARY: preview lists exactly the PRDs carrying the key and writes nothing", async () => {
    const { store, cs, prdWith, prdMalformed, prdArchived, prdPlain } = await fixture();
    const Service = await load();
    const result = await new Service(store, cs).preview();
    expect(result.ok).toBe(true);
    expect(result.value?.count).toBe(3);
    expect(result.value?.rows.map((r) => r.slug).sort()).toEqual([prdWith.slug, prdMalformed.slug, prdArchived.slug].sort());
    expect((await reread(store, prdWith.id)).extra["outline"]).toEqual(OUTLINE);
    expect((await reread(store, prdPlain.id)).version).toBe(prdPlain.version);
  });

  it("OL-2 HAPPY: apply removes the key from every carrying PRD, keeping other extra keys, status and title", async () => {
    const { store, cs, prdWith, prdMalformed, prdArchived } = await fixture();
    const Service = await load();
    const result = await new Service(store, cs).apply();
    expect(result.value?.count).toBe(3);
    expect(result.value?.errors).toEqual([]);
    for (const before of [prdWith, prdMalformed, prdArchived]) {
      const after = await reread(store, before.id);
      expect("outline" in after.extra).toBe(false);
      expect(after.status).toBe(before.status);
      expect(after.title).toBe(before.title);
    }
    expect((await reread(store, prdWith.id)).extra["keep_me"]).toBe(true);
  });

  it("OL-3 STATE: the removed outline is recorded verbatim in the audit row and survives in the prior version", async () => {
    const { store, cs, prdWith, prdMalformed } = await fixture();
    const Service = await load();
    await new Service(store, cs).apply();
    const audit = async (id: string): Promise<unknown[]> => {
      const rows = await store.queryAudit({ doc_id: id });
      if (!rows.ok) throw new Error("audit read failed");
      return rows.value
        .filter((e) => (e.details as { operation?: string } | undefined)?.operation === "outline-sections-retire")
        .map((e) => (e.details as { removed?: unknown }).removed);
    };
    expect(await audit(prdWith.id)).toEqual([OUTLINE]);
    expect(await audit(prdMalformed.id)).toEqual(["oops"]);
    const versions = await store.findVersions(prdWith.id);
    if (!versions.ok) throw new Error("versions read failed");
    expect(versions.value.some((v) => JSON.stringify(v).includes("ship via npm"))).toBe(true);
  });

  it("OL-4 REGRESSION: a second apply writes nothing, and a PRD without the key is never touched", async () => {
    const { store, cs, prdWith, prdPlain } = await fixture();
    const Service = await load();
    await new Service(store, cs).apply();
    const midVersion = (await reread(store, prdWith.id)).version;
    const second = await new Service(store, cs).apply();
    expect(second.value?.count).toBe(0);
    expect((await reread(store, prdWith.id)).version).toBe(midVersion);
    expect((await reread(store, prdPlain.id)).version).toBe(prdPlain.version);
  });

  it("OL-5 ERROR: a failing corpus read is returned, not swallowed into an empty migration", async () => {
    const { store, cs } = await fixture();
    const Service = await load();
    const failing = Object.create(store) as InMemoryStore;
    failing.findMany = async () => err({ code: "STORE_ERROR", message: "read failed" });
    const result = await new Service(failing, cs).apply();
    expect(result.ok).toBe(false);
  });

  it("OL-6 NEGATIVE: no outline write / remove / exempt / list code path remains in packages/lore/src and packages/core/src", () => {
    const root = new URL("../../../", import.meta.url);
    const gone = [
      "src/adapters/cli/commands/outline.ts",
      "src/service/prd-outline-service.ts",
      "src/service/outline-migration-service.ts",
    ];
    for (const rel of gone) expect(existsSync(new URL(rel, root)), rel).toBe(false);
    const read = (rel: string): string => readFileSync(new URL(rel, root), "utf8");
    expect(read("src/adapters/cli/index.ts")).not.toMatch(/outline:\s*\(\)\s*=>/);
    const app = read("src/app.ts");
    for (const token of ["PrdOutlineService", "prdOutlineService", "OutlineMigrationService(", "outlineMigrationService"]) {
      expect(app, token).not.toContain(token);
    }
    expect(read("src/adapters/cli/commands/migrate.ts")).not.toContain("prd-to-outline");
    expect(read("src/service/corpus-service.ts")).not.toContain("extra.outline cannot be changed");
    expect(read("src/adapters/retirements.ts")).not.toContain('target: "outline');
    const coreOutline = readFileSync(new URL("../core/src/outline.ts", root), "utf8");
    for (const token of ["outlineEntrySchema", "renderOutlineContent", "OUTLINE_ENTRY_TIERS", "OUTLINE_LINK_RELS"]) {
      expect(coreOutline, token).not.toContain(token);
    }
  });
});

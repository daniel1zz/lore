/**
 * BL-D2 (baseline-close-a-plan BR-250) — the legacy outline-sync exemption field (`plan.extra.prd_sync_exempt`)
 * is removed from every stored plan by a ONE-TIME migration (`lore migrate plan-outline-exempt [--apply]`),
 * after which BR-250's refusal (a general field edit that changes it) and listing (`lore status` "Exempt plans")
 * have nothing to guard or list and are DELETED from the code.
 *
 *   - `PlanOutlineExemptMigrationService.preview()` lists plans carrying the key and writes nothing.
 *   - `apply()` removes the key (presence, not shape: a malformed value is migrated too, never skipped), keeps every
 *     other `extra` key, keeps status and title, and records the removed value in the audit row.
 *   - a second `apply()` writes nothing.
 *   - the refusal and the listing are gone from the source tree (grep-style assertion below).
 *
 * @reads packages/lore/src/service/corpus-service.ts
 * @reads packages/lore/src/adapters/cli/commands/status.ts
 * @reads packages/core/src/outline.ts
 * @reads packages/lore/src/flows/status-prd-sync-flow.ts
 *
 * Runner: vitest + `InMemoryStore`. Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION; every
 * `it()` title carries `D2-n`.
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

const SERVICE_MODULE = "../../../src/service/plan-outline-exempt-migration-service.js";

const LEGACY = { reason: "domain doc tracked in a follow-up", by: "agent:old", at: "2026-07-26T00:00:00.000Z" };

async function fixture(): Promise<{ store: InMemoryStore; cs: CorpusService; planWith: DocRecord; planMalformed: DocRecord; planArchived: DocRecord; planPlain: DocRecord }> {
  const store = actedStore(new InMemoryStore());
  const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const mkPlan = async (title: string, extra: Record<string, unknown>): Promise<DocRecord> => {
    const r = await cs.create({ type: "plan", title, content: "plan body", extra } as CreateDocInput);
    if (!r.ok) throw new Error(`create plan failed: ${JSON.stringify(r.error)}`);
    return r.value;
  };
  const planWith = await mkPlan("Plan with legacy exemption", { phases: [{ name: "P1" }], prd_sync_exempt: LEGACY });
  const planMalformed = await mkPlan("Plan with malformed legacy exemption", { prd_sync_exempt: "oops" });
  const planArchived = await mkPlan("Archived plan with legacy exemption", { prd_sync_exempt: LEGACY });
  const archived = await store.update(planArchived.id, { status: "archived" });
  if (!archived.ok) throw new Error("archive seed failed");
  const planPlain = await mkPlan("Plan without exemption", { phases: [{ name: "P1" }] });
  return { store, cs, planWith, planMalformed, planArchived: archived.value, planPlain };
}

async function load(): Promise<new (store: InMemoryStore, writer: CorpusService) => {
  preview(): Promise<{ ok: boolean; value?: { count: number; rows: { slug: string }[]; errors: string[] } }>;
  apply(): Promise<{ ok: boolean; value?: { count: number; rows: { slug: string }[]; errors: string[] } }>;
}> {
  const mod = (await import(SERVICE_MODULE)) as { PlanOutlineExemptMigrationService: never };
  return mod.PlanOutlineExemptMigrationService;
}

async function reread(store: InMemoryStore, id: string): Promise<DocRecord> {
  const found = await store.find(id);
  if (!found.ok || found.value === null) throw new Error(`doc ${id} missing`);
  return found.value;
}

describe("the legacy outline-sync exemption is migrated away once (D2)", () => {
  it("D2-1 BOUNDARY: preview lists exactly the plans carrying the key and writes nothing", async () => {
    const { store, cs, planWith, planMalformed, planArchived, planPlain } = await fixture();
    const Service = await load();
    const result = await new Service(store, cs).preview();
    expect(result.ok).toBe(true);
    expect(result.value?.count).toBe(3);
    expect(result.value?.rows.map((r) => r.slug).sort()).toEqual([planWith.slug, planMalformed.slug, planArchived.slug].sort());
    expect((await reread(store, planWith.id)).extra["prd_sync_exempt"]).toEqual(LEGACY);
    expect((await reread(store, planPlain.id)).version).toBe(planPlain.version);
  });

  it("D2-2 HAPPY: apply removes the field from every carrying plan, keeping other extra keys, status and title", async () => {
    const { store, cs, planWith, planMalformed, planArchived } = await fixture();
    const Service = await load();
    const result = await new Service(store, cs).apply();
    expect(result.value?.count).toBe(3);
    expect(result.value?.errors).toEqual([]);
    for (const before of [planWith, planMalformed, planArchived]) {
      const after = await reread(store, before.id);
      expect("prd_sync_exempt" in after.extra).toBe(false);
      expect(after.status).toBe(before.status);
      expect(after.title).toBe(before.title);
    }
    expect((await reread(store, planWith.id)).extra["phases"]).toEqual([{ name: "P1" }]);
  });

  it("D2-3 STATE: the removed value is recorded in the audit row, a malformed one verbatim", async () => {
    const { store, cs, planWith, planMalformed } = await fixture();
    const Service = await load();
    await new Service(store, cs).apply();
    const audit = async (id: string): Promise<unknown[]> => {
      const rows = await store.queryAudit({ doc_id: id });
      if (!rows.ok) throw new Error("audit read failed");
      return rows.value.filter((e) => (e.details as { operation?: string } | undefined)?.operation === "plan-outline-exempt-migrate").map((e) => (e.details as { removed?: unknown }).removed);
    };
    expect(await audit(planWith.id)).toEqual([LEGACY]);
    expect(await audit(planMalformed.id)).toEqual(["oops"]);
  });

  it("D2-4 REGRESSION: a second apply writes nothing, and a plan without the key is never touched", async () => {
    const { store, cs, planWith, planPlain } = await fixture();
    const Service = await load();
    await new Service(store, cs).apply();
    const midVersion = (await reread(store, planWith.id)).version;
    const second = await new Service(store, cs).apply();
    expect(second.value?.count).toBe(0);
    expect((await reread(store, planWith.id)).version).toBe(midVersion);
    expect((await reread(store, planPlain.id)).version).toBe(planPlain.version);
  });

  it("D2-5 ERROR: a failing corpus read is returned, not swallowed into an empty migration", async () => {
    const { store, cs } = await fixture();
    const Service = await load();
    const failing = Object.create(store) as InMemoryStore;
    failing.findMany = async () => err({ code: "STORE_ERROR", message: "read failed" });
    const result = await new Service(failing, cs).apply();
    expect(result.ok).toBe(false);
  });

  it("D2-6 NEGATIVE: the refusal and the listing are gone from the source (BR-250 describes nothing live)", () => {
    const root = new URL("../../../", import.meta.url);
    const read = (rel: string): string => readFileSync(new URL(rel, root), "utf8");
    const corpus = read("src/service/corpus-service.ts");
    const status = read("src/adapters/cli/commands/status.ts");
    const outline = readFileSync(new URL("../core/src/outline.ts", root), "utf8");
    expect(corpus).not.toContain("extra.prd_sync_exempt cannot be changed");
    expect(corpus).not.toContain("exempt_plans");
    expect(corpus).not.toContain("extractPrdSyncExempt");
    expect(status).not.toContain("exempt_plans");
    expect(status).not.toContain("renderExemptPlansSection");
    expect(outline).not.toContain("prdSyncExemptSchema");
    expect(outline).not.toContain("prdSyncExemptEqual");
    expect(existsSync(new URL("src/flows/status-prd-sync-flow.ts", root))).toBe(false);
  });
});

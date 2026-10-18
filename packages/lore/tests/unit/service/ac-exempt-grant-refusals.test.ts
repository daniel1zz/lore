/**
 * BR-971 falsifier: an exemption grant is refused for a non-spec document, an expiry at or before now,
 * and a blank grantor; the 10% cap rounds DOWN (15 live criteria admit exactly 1); an admitted grant
 * writes no version row and no audit entry (the exemption record is the only trace).
 * Task: task-test-br-971-exemption-grant-refusals. AC: AC-P0C-4.
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { alwaysAutoOverridePort } from "../../helpers/always-auto-override-port.js";
import type { CreateDocInput, DocId } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { AcService } from "../../../src/service/ac-service.js";
import { AcExemptionService } from "../../../src/service/ac-exemption-service.js";

const NOW = new Date("2030-01-01T00:00:00.000Z");
const FUTURE = "2030-02-01T00:00:00.000Z";

async function setup(liveCriteria: number, wirePort = true) {
  const store = new InMemoryStore();
  const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const ac = new AcService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const prd = await cs.create({ type: "prd", title: "P", content: "root" } as CreateDocInput);
  if (!prd.ok) throw new Error("prd");
  const spec = await cs.create({ type: "spec", title: "S",content: "body" } as CreateDocInput);
  if (!spec.ok) throw new Error("spec");
  for (let i = 1; i <= liveCriteria; i++) {
    const r = await ac.addCriterion(spec.value.id, {
      id: `AC-R-${i}`,
      statement: `Does thing ${i}`,
      verify: { mode: "script", oracle: "test", command: `bun test ${i}` },
    });
    if (!r.ok) throw new Error(`seed ac ${i}: ${JSON.stringify(r.error)}`);
  }
  const svc = new AcExemptionService(store, () => NOW, wirePort ? alwaysAutoOverridePort() : undefined); // AU-T7: explicit test port
  return { store, svc, specId: spec.value.id as DocId, prdId: prd.value.id as DocId };
}

const grantOf = (specId: string, n: number, over: Record<string, unknown> = {}) => ({
  specIdOrSlug: specId,
  acId: `AC-R-${n}`,
  reason: "no governing rule yet",
  expiresAt: FUTURE,
  by: "agent:test",
  ...over,
});

/** LoreError is a union; only some members carry `message`. */
const msgOf = (e: unknown): string => (e as { message?: string }).message ?? "";

async function listed(svc: AcExemptionService) {
  const l = await svc.list({ now: NOW.toISOString() });
  if (!l.ok) throw new Error("list");
  return l.value;
}

describe("BR-971 exemption grant refusals", () => {
  it("override port required: a grant with NO override port wired is refused loudly (field autonomy) and stores nothing", async () => {
    const { svc, specId } = await setup(10, false);
    const r = await svc.grant(grantOf(specId, 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ code: "VALIDATION_ERROR", field: "autonomy" });
    expect(msgOf(!r.ok ? r.error : null)).toMatch(/No OverrideDecisionPort is wired/);
    expect(await listed(svc)).toEqual([]);
  });

  it("refuses a non-spec target (a prd) and stores nothing", async () => {
    const { svc, prdId } = await setup(15);
    const r = await svc.grant(grantOf(prdId, 1));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("VALIDATION_ERROR");
      expect(msgOf(r.error)).toContain("Expected a spec document");
    }
    expect(await listed(svc)).toHaveLength(0);
  });

  it("refuses an expiry exactly equal to now, and admits one 1ms later", async () => {
    const { svc, specId } = await setup(15);
    const equal = await svc.grant(grantOf(specId, 1, { expiresAt: NOW.toISOString() }));
    expect(equal.ok).toBe(false);
    if (!equal.ok) expect(msgOf(equal.error)).toContain("not in the future");
    expect(await listed(svc)).toHaveLength(0);
    const after = await svc.grant(grantOf(specId, 1, { expiresAt: new Date(NOW.getTime() + 1).toISOString() }));
    expect(after.ok).toBe(true);
  });

  it("refuses an expiry in the past", async () => {
    const { svc, specId } = await setup(15);
    const r = await svc.grant(grantOf(specId, 1, { expiresAt: new Date(NOW.getTime() - 1000).toISOString() }));
    expect(r.ok).toBe(false);
    expect(await listed(svc)).toHaveLength(0);
  });

  it.each([
    ["empty", ""],
    ["whitespace", "   "],
  ])("refuses a %s grantor and stores nothing", async (_n, by) => {
    const { svc, specId } = await setup(15);
    const r = await svc.grant(grantOf(specId, 1, { by }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(msgOf(r.error)).toContain("named grantor");
    expect(await listed(svc)).toHaveLength(0);
  });

  it("refuses a missing grantor", async () => {
    const { svc, specId } = await setup(15);
    const r = await svc.grant(grantOf(specId, 1, { by: undefined }));
    expect(r.ok).toBe(false);
    expect(await listed(svc)).toHaveLength(0);
  });

  it("with 15 live criteria the cap rounds down: 1st grant admitted, 2nd refused naming the cap", async () => {
    const { svc, specId } = await setup(15);
    expect((await svc.grant(grantOf(specId, 1))).ok).toBe(true);
    const second = await svc.grant(grantOf(specId, 2));
    expect(second.ok).toBe(false);
    if (!second.ok) expect(msgOf(second.error)).toMatch(/10\s*%/);
    const c = await svc.counts({ now: NOW.toISOString() });
    expect(c.ok && c.value.active).toBe(1);
    expect(c.ok && c.value.liveCriteria).toBe(15);
  });

  it("a second grant on an already-active criterion is refused at the service level", async () => {
    const { svc, specId } = await setup(30);
    expect((await svc.grant(grantOf(specId, 1))).ok).toBe(true);
    const again = await svc.grant(grantOf(specId, 1));
    expect(again.ok).toBe(false);
    expect(await listed(svc)).toHaveLength(1);
  });

  it("an admitted grant writes no version row and no audit entry", async () => {
    const { store, svc, specId } = await setup(15);
    const versionsBefore = await store.findVersions(specId);
    const allVersionsBefore = await store.listAllVersions();
    const auditBefore = await store.queryAudit({});
    if (!versionsBefore.ok || !allVersionsBefore.ok || !auditBefore.ok) throw new Error("store read");
    expect((await svc.grant(grantOf(specId, 1))).ok).toBe(true);
    const versionsAfter = await store.findVersions(specId);
    const allVersionsAfter = await store.listAllVersions();
    const auditAfter = await store.queryAudit({});
    if (!versionsAfter.ok || !allVersionsAfter.ok || !auditAfter.ok) throw new Error("store read");
    expect(versionsAfter.value).toHaveLength(versionsBefore.value.length);
    expect(allVersionsAfter.value).toHaveLength(allVersionsBefore.value.length);
    expect(auditAfter.value).toHaveLength(auditBefore.value.length);
    expect(await listed(svc)).toHaveLength(1);
  });
});

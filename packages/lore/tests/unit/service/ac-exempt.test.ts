/**
 * RED tests for criterion exemptions (baseline slice 2 spec C4 "Exemptions", AC-BLS2-10).
 * Task: task-skill-test-red-criterion-exemptions-with-cap-under.
 *
 * PINNED CONTRACT (the implementer must satisfy exactly this surface):
 *
 *  1. New module `packages/lore/src/service/ac-exemption-service.ts` exporting class
 *     `AcExemptionService`, constructed as `new AcExemptionService(store: StoreInterface)`.
 *       - `grant({ specIdOrSlug, acId, reason, expiresAt, by })`
 *            -> Promise<Result<AcExemption, LoreError>>
 *         `expiresAt` is an ISO-8601 string. Refused (ok:false, code VALIDATION_ERROR) when
 *         `reason` is missing / blank, `expiresAt` is missing / not a parseable date, or the
 *         spec or acId does not exist (DOC_NOT_FOUND / VALIDATION_ERROR).
 *         Refused (ok:false) with a message naming the "10%" cap when granting would push
 *         active exemptions above 10% of live criteria (active / liveCriteria > 0.10).
 *         Cap = floor(0.10 * liveCriteria) active exemptions; 20 live -> 2 allowed.
 *       - `list({ now?: string })` -> Promise<Result<AcExemptionView[], LoreError>>, each row
 *         `{ specId, acId, reason, expiresAt, by, state: "active" | "expired" }`; `state` is
 *         derived from `now` (default: current time): expiresAt <= now -> "expired".
 *       - `counts({ now })` -> Promise<Result<{ active, expired, liveCriteria, ratio }, LoreError>>
 *         `liveCriteria` = acceptance criteria across all non-deleted spec docs;
 *         `active` excludes expired rows; `ratio = active / liveCriteria`.
 *  2. Storage: rows live in the `ac_exemptions` table created by migration-014. StoreInterface
 *     gains (InMemoryStore implements both; SQLite does so atomically, CAS style like rule-id
 *     allocation in rule_registry):
 *       - `insertAcExemptionCapped(row: AcExemptionRow, cap: { liveCriteria: number; maxActive: number; now: string })`
 *            -> Promise<Result<AcExemptionRow, LoreError>>
 *         Atomically counts non-expired rows and inserts only if count < maxActive; otherwise
 *         returns ok:false (code VALIDATION_ERROR). Two concurrent calls must never both win the
 *         last slot.
 *       - `listAcExemptions()` -> Promise<Result<AcExemptionRow[], LoreError>>
 *         `AcExemptionRow = { doc_id, ac_id, reason, expires_at, granted_by, granted_at }`.
 *
 * Dimensions: HAPPY (grant, counts), NEGATIVE (no reason / no expiry / over cap), BOUNDARY
 * (cap exactly reached, 2 vs 3 of 20), STATE (expired excluded from active), ERROR (unknown AC),
 * REGRESSION (8-way race never exceeds cap, at store level and service level).
 *
 * @spec_ref AC-BLS2-10
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { alwaysAutoOverridePort } from "../../helpers/always-auto-override-port.js";
import type { CreateDocInput, DocId } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { AcService } from "../../../src/service/ac-service.js";

type Res<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
interface GrantInput {
  specIdOrSlug: string;
  acId: string;
  reason?: string;
  expiresAt?: string;
  by: string;
}
interface View {
  specId: string;
  acId: string;
  reason: string;
  expiresAt: string;
  by: string;
  state: "active" | "expired";
}
interface Counts {
  active: number;
  expired: number;
  liveCriteria: number;
  ratio: number;
}
interface ExemptionApi {
  grant(input: GrantInput): Promise<Res<unknown>>;
  list(opts?: { now?: string }): Promise<Res<View[]>>;
  counts(opts: { now: string }): Promise<Res<Counts>>;
}
interface CappedStore {
  insertAcExemptionCapped(
    row: Record<string, string>,
    cap: { liveCriteria: number; maxActive: number; now: string },
  ): Promise<Res<unknown>>;
  listAcExemptions(): Promise<Res<Array<Record<string, string>>>>;
}

// Variable specifier: the module does not exist yet, the file must still load.
const MODULE = "../../../src/service/ac-exemption-service.js";
async function makeService(store: InMemoryStore): Promise<ExemptionApi> {
  let mod: Record<string, unknown>;
  try {
    mod = (await import(/* @vite-ignore */ MODULE)) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`MISSING BEHAVIOUR: ac-exemption-service module not found (${String(e)})`);
  }
  const Ctor = mod["AcExemptionService"] as (new (s: InMemoryStore, clock?: () => Date, overrides?: unknown) => ExemptionApi) | undefined;
  if (typeof Ctor !== "function") {
    throw new Error("MISSING BEHAVIOUR: ac-exemption-service does not export AcExemptionService");
  }
  // AU-T7: explicit test port (the grant is decided; no port = refused)
  return new Ctor(store, undefined, alwaysAutoOverridePort());
}

function cappedStore(store: InMemoryStore): CappedStore {
  const s = store as unknown as Partial<CappedStore>;
  if (typeof s.insertAcExemptionCapped !== "function" || typeof s.listAcExemptions !== "function") {
    throw new Error("MISSING BEHAVIOUR: StoreInterface.insertAcExemptionCapped / listAcExemptions not implemented");
  }
  return s as CappedStore;
}

const DAY = 86_400_000;
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString();

async function setup(liveCriteria = 20) {
  const store = new InMemoryStore();
  const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const ac = new AcService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const prd = await cs.create({ type: "prd", title: "P", content: "root" } as CreateDocInput);
  if (!prd.ok) throw new Error("prd");
  const spec = await cs.create({ type: "spec", title: "S",content: "body" } as CreateDocInput);
  if (!spec.ok) throw new Error("spec");
  for (let i = 1; i <= liveCriteria; i++) {
    const r = await ac.addCriterion(spec.value.id, {
      id: `AC-E-${i}`,
      statement: `Does thing ${i}`,
      verify: { mode: "script", oracle: "test", command: `bun test ${i}` },
    });
    if (!r.ok) throw new Error(`seed ac ${i}: ${JSON.stringify(r.error)}`);
  }
  const svc = await makeService(store);
  return { store, svc, specId: spec.value.id as DocId };
}

const valid = (specId: string, n: number, over: Partial<GrantInput> = {}): GrantInput => ({
  specIdOrSlug: specId,
  acId: `AC-E-${n}`,
  reason: `legacy criterion ${n} has no governing rule`,
  expiresAt: inDays(30),
  by: "agent:test",
  ...over,
});

describe("AcExemptionService.grant: reason + expiry required", () => {
  it("grants an exemption carrying reason, expiry and grantor", async () => {
    const { svc, specId } = await setup();
    const exp = inDays(30);
    const r = await svc.grant(valid(specId, 1, { expiresAt: exp, reason: "no rule yet" }));
    expect(r.ok).toBe(true);
    const l = await svc.list();
    expect(l.ok && l.value).toEqual([
      expect.objectContaining({ acId: "AC-E-1", reason: "no rule yet", expiresAt: exp, by: "agent:test", state: "active" }),
    ]);
  });

  it("refuses a grant with no reason and stores nothing", async () => {
    const { svc, specId } = await setup();
    const r = await svc.grant(valid(specId, 1, { reason: undefined } as unknown as Partial<GrantInput>));
    expect(r.ok).toBe(false);
    const l = await svc.list();
    expect(l.ok && l.value).toHaveLength(0);
  });

  it("refuses a whitespace-only reason", async () => {
    const { svc, specId } = await setup();
    const r = await svc.grant(valid(specId, 1, { reason: "   " }));
    expect(r.ok).toBe(false);
  });

  it("refuses a grant with no expiry and stores nothing", async () => {
    const { svc, specId } = await setup();
    const r = await svc.grant(valid(specId, 1, { expiresAt: undefined } as unknown as Partial<GrantInput>));
    expect(r.ok).toBe(false);
    const l = await svc.list();
    expect(l.ok && l.value).toHaveLength(0);
  });

  it("refuses an unparseable expiry", async () => {
    const { svc, specId } = await setup();
    const r = await svc.grant(valid(specId, 1, { expiresAt: "someday" }));
    expect(r.ok).toBe(false);
  });

  it("refuses an AC id that does not exist on the spec", async () => {
    const { svc, specId } = await setup();
    const r = await svc.grant(valid(specId, 1, { acId: "AC-E-999" }));
    expect(r.ok).toBe(false);
  });
});

describe("AcExemptionService: 10% cap", () => {
  it("allows 2 of 20, refuses the 3rd (15%) with an error naming the 10% cap", async () => {
    const { svc, specId } = await setup(20);
    expect((await svc.grant(valid(specId, 1))).ok).toBe(true);
    expect((await svc.grant(valid(specId, 2))).ok).toBe(true);
    const third = await svc.grant(valid(specId, 3));
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.error.message).toMatch(/10\s*%/);
    const c = await svc.counts({ now: new Date().toISOString() });
    expect(c.ok && c.value.active).toBe(2);
  });

  it("the cap scales with live criteria: 10 live allows 1, refuses 2nd", async () => {
    const { svc, specId } = await setup(10);
    expect((await svc.grant(valid(specId, 1))).ok).toBe(true);
    expect((await svc.grant(valid(specId, 2))).ok).toBe(false);
  });

  it("8 concurrent grants that each fit alone never exceed the cap", async () => {
    const { svc, specId } = await setup(20);
    const results = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map((n) => svc.grant(valid(specId, n))));
    const granted = results.filter((r) => r.ok).length;
    expect(granted).toBeLessThanOrEqual(2);
    const c = await svc.counts({ now: new Date().toISOString() });
    expect(c.ok && c.value.ratio).toBeLessThanOrEqual(0.1);
    expect(c.ok && c.value.active).toBe(granted);
  });

  it("8 concurrent grants still fill the cap (the race does not over-refuse)", async () => {
    const { svc, specId } = await setup(20);
    await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map((n) => svc.grant(valid(specId, n))));
    const c = await svc.counts({ now: new Date().toISOString() });
    expect(c.ok && c.value.active).toBe(2);
  });

  it("store-level insertAcExemptionCapped is atomic: 8 racers for 2 slots admit exactly 2", async () => {
    const store = new InMemoryStore();
    const s = cappedStore(store);
    const now = new Date().toISOString();
    const rows = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
      doc_id: "SPEC1",
      ac_id: `AC-E-${n}`,
      reason: "r",
      expires_at: inDays(30),
      granted_by: "agent:test",
      granted_at: now,
    }));
    const rs = await Promise.all(rows.map((row) => s.insertAcExemptionCapped(row, { liveCriteria: 20, maxActive: 2, now })));
    expect(rs.filter((r) => r.ok)).toHaveLength(2);
    const listed = await s.listAcExemptions();
    expect(listed.ok && listed.value).toHaveLength(2);
  });
});

describe("AcExemptionService: expiry", () => {
  it("an expired exemption is excluded from active and shown as expired", async () => {
    const { svc, specId } = await setup(20);
    await svc.grant(valid(specId, 1, { expiresAt: inDays(5) }));
    const later = new Date(Date.now() + 10 * DAY).toISOString();
    const c = await svc.counts({ now: later });
    expect(c.ok && c.value).toEqual(expect.objectContaining({ active: 0, expired: 1, liveCriteria: 20, ratio: 0 }));
    const l = await svc.list({ now: later });
    expect(l.ok && l.value[0]?.state).toBe("expired");
  });

  it("the same exemption is active before its expiry", async () => {
    const { svc, specId } = await setup(20);
    await svc.grant(valid(specId, 1, { expiresAt: inDays(5) }));
    const c = await svc.counts({ now: new Date().toISOString() });
    expect(c.ok && c.value).toEqual(expect.objectContaining({ active: 1, expired: 0, ratio: 0.05 }));
  });
});

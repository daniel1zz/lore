/**
 * Rule BR-959 (task TG-44): an exemption excuses an UNCITED criterion, so it is active iff it is unexpired AND
 * its criterion cites no LIVE rule. Once the criterion cites a live rule the exemption is `satisfied`: it no
 * longer counts as active, no longer takes cap headroom, and a new grant may use the freed slot. A cite of a
 * rule that is not live (retired / deprecated) does not satisfy it. One predicate (`exemptionState`,
 * store-shared.ts) serves list/counts, headroom, the gate's waiver set and the grant cap.
 *
 * Real SQLite store in a throwaway temp corpus (never the repo's `.lore/`).
 *
 * Dimensions: HAPPY (cite frees the slot), NEGATIVE (non-live cite does not satisfy), BOUNDARY (cap of 1 of 10),
 * STATE (removing the cite re-activates), REGRESSION (uncited unexpired stays active; expired stays expired).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LoreConfigSchema, type CreateDocInput } from "@lore/core";
import { createApp, type App } from "../../../src/app.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { AcExemptionService } from "../../../src/service/ac-exemption-service.js";
import { exemptionHeadroom, indexBaseline, satisfiedExemptionKeys } from "../../../src/service/ac-cite-gate.js";
import { exemptionState } from "../../../src/store/store-shared.js";

const SKELETON = "## Overview/Goal\n\nx\n\n## Scope\n\nx\n\n## Acceptance Criteria\n\nx";
const DAY = 86_400_000;
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString();

async function must<T>(r: { ok: boolean; value?: T; error?: unknown }, what: string): Promise<T> {
  if (!r.ok) throw new Error(`fixture ${what} failed: ${JSON.stringify(r.error)}`);
  return r.value as T;
}

let dir: string;
let app: App;
let side: SQLiteStore;
let svc: AcExemptionService;
let specId: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "ac-exempt-satisfied-"));
  const config = LoreConfigSchema.parse({ project: { name: "exempt-sat", author: "tester" } });
  const made = createApp(join(dir, "c.db"), config);
  if ("ok" in made) throw new Error(`createApp failed: ${JSON.stringify(made)}`);
  app = made;
  side = new SQLiteStore(join(dir, "c.db"));
  svc = new AcExemptionService(side);
  const cs = app.corpusService;
  const rs = app.ruleService!;
  const prd = await must(await cs.create({ type: "prd", title: "Sat product", content: "root" } as CreateDocInput), "prd");
  const root = await must(await rs.addNode(prd.id, { node: "root", label: "Root", title: "Sat root", content: "r" }, { by: "agent:seed" }), "root");
  const branch = await must(
    await cs.create({
      type: "baseline", title: "Sat branch", slug: "baseline-sat", content: "b", parent_id: root.id,
      extra: { node: "branch", label: "Sat branch", glossary: [{ term: "Sat", meaning: "Satisfied" }] },
    } as CreateDocInput),
    "branch",
  );
  const leaf = await must(await rs.addNode(branch.id, { node: "leaf", label: "Leaf", title: "Sat leaf", content: "l" }, { by: "agent:seed" }), "leaf");
  for (const statement of ["First rule", "Second rule"]) {
    await must(await rs.addRule(leaf.id, { statement, confidence: "established", enforced_by: "guaranteed", examples: ["e"] }, { by: "agent:seed" }), "rule");
  }
  const spec = await must(await cs.create({ type: "spec", title: "Sat spec", content: SKELETON } as CreateDocInput), "spec");
  specId = spec.id;
  // 10 live criteria -> the cap is floor(10%) = 1 exemption. All uncited.
  for (let i = 1; i <= 10; i++) {
    await must(
      await app.acService!.addCriterion(specId, {
        id: `AC-S-${i}`,
        statement: `Does the thing ${i}`,
        verify: { mode: "script", oracle: "test", command: "bun test x" },
      }),
      `AC-S-${i}`,
    );
  }
});

afterEach(() => {
  side.close();
  app.close();
  rmSync(dir, { recursive: true, force: true });
});

const grant = (n: number) =>
  svc.grant({ specIdOrSlug: specId, acId: `AC-S-${n}`, reason: "no rule yet", expiresAt: inDays(30), by: "agent:test" });
const counts = async () => must(await svc.counts({ now: new Date().toISOString() }), "counts");
const cite = (n: number, ruleId: string) => app.acService!.citeCriterion(specId, `AC-S-${n}`, [ruleId]);

async function headroom(): Promise<number> {
  const rows = await must(await side.listAcExemptions(), "rows");
  const cites = await must(await side.listAcCites(), "cites");
  const baseline = await must(await side.findMany({ type: "baseline" }), "baseline");
  const states = indexBaseline(baseline).states;
  return exemptionHeadroom(10, rows, new Date().toISOString(), satisfiedExemptionKeys(rows, cites, states));
}

describe("exemption satisfied state (BR-959)", () => {
  it("an uncited unexpired exemption is active and takes the whole cap (control)", async () => {
    await must(await grant(1), "grant 1");
    expect(await counts()).toMatchObject({ active: 1, expired: 0, satisfied: 0, liveCriteria: 10 });
    expect(await headroom()).toBe(0);
    const second = await grant(2);
    expect(second.ok).toBe(false);
  });

  it("citing a live rule on the exempted criterion excludes it from counts().active and headroom, and frees the cap", async () => {
    await must(await grant(1), "grant 1");
    await must(await cite(1, "BR-1"), "cite AC-S-1");
    expect(await counts()).toMatchObject({ active: 0, expired: 0, satisfied: 1, ratio: 0 });
    expect(await headroom()).toBe(1);
    const listed = await must(await svc.list(), "list");
    expect(listed.find((e) => e.acId === "AC-S-1")?.state).toBe("satisfied");
    // the freed slot is usable by the grant cap check (store-side count applies the same predicate)
    expect((await grant(2)).ok).toBe(true);
    expect(await counts()).toMatchObject({ active: 1, satisfied: 1 });
  });

  it("a cite of a retired rule does not satisfy the exemption (control)", async () => {
    await must(await cite(1, "BR-2"), "cite while BR-2 is live");
    await must(await grant(1), "grant 1"); // cited-live at grant time: satisfied already
    await must(await app.ruleService!.setRule("BR-2", { lifecycle: "retired", note: "gone" }, { by: "agent:seed" }), "retire BR-2");
    expect(await counts()).toMatchObject({ active: 1, satisfied: 0 });
    expect(await headroom()).toBe(0);
    const listed = await must(await svc.list(), "list");
    expect(listed.find((e) => e.acId === "AC-S-1")?.state).toBe("active");
  });

  it("removing the only cite makes the exemption active again", async () => {
    await must(await grant(1), "grant 1");
    await must(await cite(1, "BR-1"), "cite");
    expect((await counts()).satisfied).toBe(1);
    await must(await app.acService!.citeCriterion(specId, "AC-S-1", ["BR-1"], { remove: true }), "uncite");
    expect(await counts()).toMatchObject({ active: 1, satisfied: 0 });
  });

  it("exemptionState: expired wins over satisfied; boundary expires_at == now is expired", () => {
    const row = { doc_id: "D", ac_id: "A", expires_at: "2026-01-01T00:00:00.000Z" };
    const keys = new Set(["D\u0000A"]);
    expect(exemptionState(row, "2026-01-01T00:00:00.000Z", keys)).toBe("expired");
    expect(exemptionState(row, "2025-12-31T00:00:00.000Z", keys)).toBe("satisfied");
    expect(exemptionState(row, "2025-12-31T00:00:00.000Z", new Set())).toBe("active");
  });
});

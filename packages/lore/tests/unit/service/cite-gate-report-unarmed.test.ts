/**
 * Report mode records would-refuse decisions on UNARMED branches too (orchestrator decision
 * 2026-10-08, citation gate C4 of spec-baseline-slice-2-completeness-census-per-branch-citation):
 * the number of writes a branch WOULD refuse must be measurable BEFORE the branch is armed.
 * `enforce` on an unarmed branch stays accepted with no row (pinned by cite-gate.test.ts).
 *
 * Dimensions: HAPPY (report + unarmed uncited add -> accepted + 1 row), NEGATIVE (live-cited add ->
 * no row), BOUNDARY (no armed branch at all; unplaced spec), STATE (row names ac id, code, mode;
 * revise records a row too), REGRESSION (enforce + unarmed still writes no row; mode off none).
 *
 * @spec_ref AC-BLS2-2
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { ulid } from "ulidx";
import { DOC_TYPE_ROLE_MAP } from "@lore/core";
import type { CreateDocInput, DocId, DocRecord } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { AcService } from "../../../src/service/ac-service.js";

const WOULD_REFUSE = "cite_gate_would_refuse";

type Cfg = { mode: "off" | "report" | "enforce"; armed_branches: string[] };

async function insertBaseline(store: InMemoryStore, slug: string, extra: Record<string, unknown>, parentId: DocId | null) {
  const id = ulid() as DocId;
  const now = new Date().toISOString();
  const doc: DocRecord = {
    id, slug, type: "baseline", role: DOC_TYPE_ROLE_MAP.baseline, title: slug, status: "draft", priority: "medium",
    content: slug, parent_id: parentId, created_at: now, updated_at: now, created_by: "test", version: 1,
    deleted_at: null, tags: [], extra,
  };
  const r = await store.insert(doc);
  if (!r.ok) throw new Error(`baseline insert failed: ${JSON.stringify(r.error)}`);
  return id;
}

const AC = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  statement: `Does the thing ${id}`,
  verify: { mode: "script", oracle: "test", command: "bun test x" },
  ...extra,
});

function gated(store: InMemoryStore, cfg: Cfg | undefined): AcService {
  return new AcService(store, new RecordLockService(store, new GateEnforcer(undefined)), { citeGate: cfg });
}

/** alpha (BR-1, BR-2 live) + beta (BR-20 live) branches; one spec citing alpha, one citing beta, one citing nothing. */
async function world() {
  const store = new InMemoryStore();
  const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const plain = new AcService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const root = await insertBaseline(store, "baseline-root", { node: "root" }, null);
  const alpha = await insertBaseline(store, "baseline-branch-alpha", { node: "branch" }, root);
  const beta = await insertBaseline(store, "baseline-branch-beta", { node: "branch" }, root);
  const live = (id: string) => ({ id, statement: `rule ${id}`, confidence: "established", enforced_by: "both", examples: ["e"], lifecycle: "live" });
  await insertBaseline(store, "baseline-leaf-alpha", { node: "leaf", rules: [live("BR-1"), live("BR-2")] }, alpha);
  await insertBaseline(store, "baseline-leaf-beta", { node: "leaf", rules: [live("BR-20")] }, beta);
  const prd = await cs.create({ type: "prd", title: "P", content: "root" } as CreateDocInput);
  if (!prd.ok) throw new Error("prd");
  const mk = async (title: string, seed?: Record<string, unknown>) => {
    const s = await cs.create({ type: "spec", title,content: "b" } as CreateDocInput);
    if (!s.ok) throw new Error("spec");
    if (seed !== undefined) {
      const a = await plain.addCriterion(s.value.id, seed);
      if (!a.ok) throw new Error(`seed ${JSON.stringify(a.error)}`);
    }
    return s.value.id as string;
  };
  return {
    store,
    inAlpha: await mk("In Alpha", AC("AC-A-1", { cites: ["BR-1"] })),
    inBeta: await mk("In Beta", AC("AC-B-1", { cites: ["BR-20"] })),
    unplaced: await mk("Unplaced"),
  };
}

async function rows(store: InMemoryStore, id: string) {
  const a = await store.queryAudit({ doc_id: id });
  if (!a.ok) throw new Error("audit");
  return a.value.filter((e) => (e.details as Record<string, unknown>)["operation"] === WOULD_REFUSE);
}

describe("report mode records would-refuse rows on unarmed branches (AC-BLS2-2, orchestrator decision a)", () => {
  const REPORT_ALPHA: Cfg = { mode: "report", armed_branches: ["baseline-branch-alpha"] };

  it("an uncited add on the UNARMED beta branch is accepted and records exactly one row", async () => {
    const w = await world();
    const res = await gated(w.store, REPORT_ALPHA).addCriterion(w.inBeta, AC("AC-B-2"));
    expect(res.ok).toBe(true);
    expect(await rows(w.store, w.inBeta)).toHaveLength(1);
  });

  it("the row names the criterion, the code and the mode", async () => {
    const w = await world();
    await gated(w.store, REPORT_ALPHA).addCriterion(w.inBeta, AC("AC-B-2"));
    const row = (await rows(w.store, w.inBeta))[0];
    expect(row?.details).toMatchObject({ ac_id: "AC-B-2", code: "AC_CITE_REQUIRED", mode: "report" });
  });

  it("with NO armed branch at all, report still records the row", async () => {
    const w = await world();
    await gated(w.store, { mode: "report", armed_branches: [] }).addCriterion(w.inAlpha, AC("AC-A-2"));
    expect(await rows(w.store, w.inAlpha)).toHaveLength(1);
  });

  it("an unplaced spec records a row under report (it is not armed, and still measured)", async () => {
    const w = await world();
    await gated(w.store, REPORT_ALPHA).addCriterion(w.unplaced, AC("AC-U-1"));
    expect(await rows(w.store, w.unplaced)).toHaveLength(1);
  });

  it("a revise of an uncited legacy criterion on an unarmed branch records a row", async () => {
    const w = await world();
    await new AcService(w.store, new RecordLockService(w.store, new GateEnforcer(undefined))).addCriterion(w.inBeta, AC("AC-B-LEG"));
    await gated(w.store, REPORT_ALPHA).setCriterion(w.inBeta, "AC-B-LEG", { statement: "Reworded legacy" });
    expect(await rows(w.store, w.inBeta)).toHaveLength(1);
  });

  it("a live-cited add on the unarmed branch records no row (different input, different outcome)", async () => {
    const w = await world();
    await gated(w.store, REPORT_ALPHA).addCriterion(w.inBeta, AC("AC-B-2", { cites: ["BR-20"] }));
    expect(await rows(w.store, w.inBeta)).toHaveLength(0);
  });

  it("a sibling add never produces a row for the untouched legacy criteria (only the new one)", async () => {
    const w = await world();
    await new AcService(w.store, new RecordLockService(w.store, new GateEnforcer(undefined))).addCriterion(w.inBeta, AC("AC-B-LEG"));
    await gated(w.store, REPORT_ALPHA).addCriterion(w.inBeta, AC("AC-B-2"));
    const found = await rows(w.store, w.inBeta);
    expect(found.map((r) => (r.details as Record<string, unknown>)["ac_id"])).toEqual(["AC-B-2"]);
  });
});

describe("the other mode x armed cells stay silent (regression, AC-BLS2-2)", () => {
  it("enforce + unarmed branch: accepted and NO row", async () => {
    const w = await world();
    const res = await gated(w.store, { mode: "enforce", armed_branches: ["baseline-branch-alpha"] }).addCriterion(w.inBeta, AC("AC-B-2"));
    expect(res.ok).toBe(true);
    expect(await rows(w.store, w.inBeta)).toHaveLength(0);
  });

  it("mode off: accepted and NO row, even with an armed branch listed", async () => {
    const w = await world();
    await gated(w.store, { mode: "off", armed_branches: ["baseline-branch-beta"] }).addCriterion(w.inBeta, AC("AC-B-2"));
    expect(await rows(w.store, w.inBeta)).toHaveLength(0);
  });

  it("no config but baseline docs present defaults to report and records the row", async () => {
    const w = await world();
    await gated(w.store, undefined).addCriterion(w.inBeta, AC("AC-B-2"));
    expect(await rows(w.store, w.inBeta)).toHaveLength(1);
  });
});

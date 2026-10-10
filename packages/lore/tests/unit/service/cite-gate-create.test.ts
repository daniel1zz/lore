/**
 * The citation gate covers `CorpusService.create`'s inline criteria (spec C3: create is a sanctioned AC
 * write path "with the same citation gate" — it must not bypass the gate `lore ac add` applies).
 *
 * Dimensions: HAPPY (live-cited inline AC accepted), NEGATIVE (uncited / retired-cited inline AC refused
 * with AC_CITE_REQUIRED + feeding pack), STATE (refused create leaves no doc), BOUNDARY (unarmed branch,
 * unplaced-but-all-armed), REGRESSION (bare CorpusService ungated; report mode records a row only after
 * the create commits; mode off silent).
 *
 * @spec_ref AC-BLS2-2
 */

import { describe, it, expect } from "vitest";
import { ulid } from "ulidx";
import { DOC_TYPE_ROLE_MAP } from "@lore/core";
import type { CreateDocInput, DocId, DocRecord } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";

const AC = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  statement: `Does the thing ${id}`,
  verify: { mode: "script", oracle: "test", command: "bun test x" },
  ...extra,
});

async function insertBaseline(store: InMemoryStore, slug: string, extra: Record<string, unknown>, parentId: DocId | null) {
  const id = ulid() as DocId;
  const now = new Date().toISOString();
  const doc: DocRecord = {
    id, slug, type: "baseline", role: DOC_TYPE_ROLE_MAP.baseline, title: slug, status: "draft", priority: "medium",
    content: slug, parent_id: parentId, created_at: now, updated_at: now, created_by: "test", version: 1,
    deleted_at: null, tags: [], extra,
  };
  const r = await store.insert(doc);
  if (!r.ok) throw new Error("baseline insert failed");
  return id;
}

async function world(gate: { mode: "off" | "report" | "enforce"; armed_branches: string[] } | "bare") {
  const store = new InMemoryStore();
  const cs = new CorpusService(store);
  if (gate !== "bare") cs.setCiteGate(gate);
  const root = await insertBaseline(store, "baseline-root", { node: "root" }, null);
  const alpha = await insertBaseline(store, "baseline-branch-alpha", { node: "branch" }, root);
  const beta = await insertBaseline(store, "baseline-branch-beta", { node: "branch" }, root);
  const rule = (id: string, lifecycle: string) => ({ id, statement: `rule ${id}`, confidence: "established", enforced_by: "both", examples: ["e"], lifecycle });
  await insertBaseline(store, "baseline-leaf-alpha", { node: "leaf", rules: [rule("BR-1", "live"), rule("BR-2", "retired")] }, alpha);
  await insertBaseline(store, "baseline-leaf-beta", { node: "leaf", rules: [rule("BR-20", "live")] }, beta);
  const prd = await cs.create({ type: "prd", title: "P", content: "root" } as CreateDocInput);
  if (!prd.ok) throw new Error("prd");
  const createSpec = (title: string, criteria: unknown[]) =>
    cs.create({ type: "spec", title,content: "body", extra: { acceptance_criteria: criteria } } as CreateDocInput);
  return { store, cs, createSpec };
}

const ENFORCE_ALL: { mode: "enforce"; armed_branches: string[] } = {
  mode: "enforce",
  armed_branches: ["baseline-branch-alpha", "baseline-branch-beta"],
};

async function specCount(store: InMemoryStore): Promise<number> {
  const r = await store.findMany({ type: "spec" });
  if (!r.ok) throw new Error("findMany");
  return r.value.length;
}

describe("create's inline criteria pass through the citation gate (AC-BLS2-2)", () => {
  it("a live-cited inline criterion is accepted", async () => {
    const w = await world(ENFORCE_ALL);
    expect((await w.createSpec("Born cited", [AC("AC-N-1", { cites: ["BR-1"] })])).ok).toBe(true);
  });

  it("an uncited inline criterion is refused with AC_CITE_REQUIRED and a feeding pack", async () => {
    const w = await world(ENFORCE_ALL);
    const res = await w.createSpec("Born uncited", [AC("AC-N-1")]);
    expect(res.ok).toBe(false);
    if (res.ok || res.error.code !== "AC_CITE_REQUIRED") throw new Error(`expected AC_CITE_REQUIRED, got ${JSON.stringify(res)}`);
    expect(res.error.feeding_pack?.cite_line).toMatch(/^lore ac cite spec-born-uncited AC-N-1 /);
  });

  it("an inline criterion citing a retired rule is refused", async () => {
    const w = await world(ENFORCE_ALL);
    const res = await w.createSpec("Born retired", [AC("AC-N-1", { cites: ["BR-2"] })]);
    expect(!res.ok && res.error.code).toBe("AC_CITE_REQUIRED");
  });

  it("a refused create leaves no spec behind", async () => {
    const w = await world(ENFORCE_ALL);
    const before = await specCount(w.store);
    await w.createSpec("Born uncited", [AC("AC-N-1")]);
    expect(await specCount(w.store)).toBe(before);
  });

  it("the spec's own criteria place it: a beta-cited spec on a branch that is not armed is accepted uncited elsewhere", async () => {
    const w = await world({ mode: "enforce", armed_branches: ["baseline-branch-alpha"] });
    const res = await w.createSpec("Born in beta", [AC("AC-N-1", { cites: ["BR-20"] }), AC("AC-N-2")]);
    expect(res.ok).toBe(true);
  });

  it("an unplaced new spec is refused only when every branch is armed", async () => {
    const some = await world({ mode: "enforce", armed_branches: ["baseline-branch-alpha"] });
    expect((await some.createSpec("Unplaced a", [AC("AC-N-1")])).ok).toBe(true);
    const all = await world(ENFORCE_ALL);
    const res = await all.createSpec("Unplaced b", [AC("AC-N-1")]);
    expect(!res.ok && res.error.code).toBe("AC_CITE_REQUIRED");
  });
});

describe("create under the other modes (AC-BLS2-2 regression)", () => {
  it("a bare CorpusService (no gate wired) accepts an uncited inline criterion", async () => {
    const w = await world("bare");
    expect((await w.createSpec("Bare", [AC("AC-N-1")])).ok).toBe(true);
  });

  it("mode off accepts and records no would-refuse row", async () => {
    const w = await world({ mode: "off", armed_branches: ["baseline-branch-alpha"] });
    const res = await w.createSpec("Off", [AC("AC-N-1")]);
    if (!res.ok) throw new Error("create");
    const audit = await w.store.queryAudit({ doc_id: res.value.id });
    expect(audit.ok && audit.value.filter((e) => e.action === "cite_gate_would_refuse")).toHaveLength(0);
  });

  it("report mode accepts the create and records one would-refuse row for the new spec", async () => {
    const w = await world({ mode: "report", armed_branches: [] });
    const res = await w.createSpec("Report", [AC("AC-N-1"), AC("AC-N-2", { cites: ["BR-1"] })]);
    if (!res.ok) throw new Error("create");
    const audit = await w.store.queryAudit({ doc_id: res.value.id });
    if (!audit.ok) throw new Error("audit");
    const rows = audit.value.filter((e) => (e.details as Record<string, unknown>)["operation"] === "cite_gate_would_refuse");
    expect(rows.map((r) => (r.details as Record<string, unknown>)["ac_id"])).toEqual(["AC-N-1"]);
  });
});

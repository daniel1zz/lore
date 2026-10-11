/**
 * RuleService.setSiteMap (baseline slice 2a, AC-BLS2-5): the only writer of a leaf's
 * `extra.site_map` and `extra.commands`.
 *
 * Spec-level expectations asserted here:
 *   - one successful call = exactly ONE new doc version and exactly ONE new audit row;
 *   - a write based on a stale version is refused (CAS) and changes nothing;
 *   - two concurrent callers never lose each other's mapping (both land, version +2);
 *   - an unknown rule id / blank reason / removing something absent is refused and writes nothing.
 *
 * InMemoryStore (no bun:sqlite) — MOCK RISK: hides SQLite transaction behaviour; the CLI e2e in
 * tests/integration/cli/baseline-coverage.bun.test.ts covers the real store.
 *
 * @spec_ref AC-BLS2-5
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { describe, it, expect, beforeEach } from "vitest";
import type { CreateDocInput, DocRecord } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { RuleService } from "../../../src/service/rule-service.js";

let store: InMemoryStore;
let corpus: CorpusService;
let svc: RuleService;
let leaf: DocRecord;

async function mustCreate(input: CreateDocInput): Promise<DocRecord> {
  const r = await corpus.create(input);
  if (!r.ok) throw new Error(`fixture create failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

async function fresh(id: string): Promise<DocRecord> {
  const r = await store.find(id as DocRecord["id"]);
  if (!r.ok || r.value === null) throw new Error(`fixture read failed: ${JSON.stringify(r)}`);
  return r.value;
}

async function auditRows(docId: string): Promise<number> {
  const r = await store.queryAudit({ doc_id: docId as DocRecord["id"] });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value.length;
}

beforeEach(async () => {
  store = new InMemoryStore();
  corpus = new CorpusService(store, new RecordLockService(store));
  svc = new RuleService(store);
  const prd = await mustCreate({ type: "prd", title: "P", content: "root" } as CreateDocInput);
  const root = await mustCreate({
    type: "baseline", title: "R", content: "r", parent_id: prd.id, extra: { node: "root", label: "Root" },
  } as CreateDocInput);
  const branch = await mustCreate({
    type: "baseline", title: "B", content: "b", parent_id: root.id, extra: { node: "branch", label: "Branch" },
  } as CreateDocInput);
  const created = await mustCreate({
    type: "baseline", title: "L", content: "l", parent_id: branch.id, extra: { node: "leaf", label: "Leaf" },
  } as CreateDocInput);
  const added = await svc.addRule(
    created.id,
    { statement: "first rule", confidence: "established", enforced_by: "guaranteed", examples: ["e1"] },
    { by: "fixture" },
  );
  if (!added.ok) throw new Error(`fixture addRule failed: ${JSON.stringify(added.error)}`);
  leaf = await fresh(created.id);
});

describe("RuleService.setSiteMap", () => {
  it("one call writes exactly one version and exactly one audit row", async () => {
    const v0 = leaf.version;
    const a0 = await auditRows(leaf.id);
    const res = await svc.setSiteMap(leaf.id, { sites: { "a.ts#f#X": ["BR-1"] }, addCommands: ["ac add"] }, { by: "t" });
    expect(res.ok).toBe(true);
    const after = await fresh(leaf.id);
    expect(after.version).toBe(v0 + 1);
    expect((await auditRows(leaf.id)) - a0).toBe(1);
  });

  it("stores the site map and commands under extra, different inputs giving different maps", async () => {
    await svc.setSiteMap(leaf.id, { sites: { "a.ts#f#X": ["BR-1"] }, addCommands: ["ac add"] }, { by: "t" });
    await svc.setSiteMap(leaf.id, { sites: { "b.ts#g#Y": ["non-business:plumbing"] }, addCommands: ["rule add"] }, { by: "t" });
    const after = await fresh(leaf.id);
    expect(after.extra["site_map"]).toEqual({ "a.ts#f#X": ["BR-1"], "b.ts#g#Y": ["non-business:plumbing"] });
    expect(after.extra["commands"]).toEqual(["ac add", "rule add"]);
  });

  it("a write based on a stale version is refused by the store and changes nothing", async () => {
    const staleVersion = leaf.version;
    await svc.setSiteMap(leaf.id, { sites: { "a.ts#f#X": ["BR-1"] } }, { by: "t" });
    const current = await fresh(leaf.id);
    const stale = await store.update(
      leaf.id,
      { extra: { ...leaf.extra, site_map: { "z.ts#z#Z": ["BR-1"] } } },
      { expected_version: staleVersion },
    );
    expect(stale.ok).toBe(false);
    expect((await fresh(leaf.id)).version).toBe(current.version);
    expect((await fresh(leaf.id)).extra["site_map"]).toEqual({ "a.ts#f#X": ["BR-1"] });
  });

  it("two concurrent callers both land: no lost update, version advances by 2", async () => {
    const v0 = leaf.version;
    const [r1, r2] = await Promise.all([
      svc.setSiteMap(leaf.id, { sites: { "a.ts#f#X": ["BR-1"] } }, { by: "t1" }),
      svc.setSiteMap(leaf.id, { sites: { "b.ts#g#Y": ["BR-1"] } }, { by: "t2" }),
    ]);
    expect(r1.ok && r2.ok).toBe(true);
    const after = await fresh(leaf.id);
    expect(Object.keys(after.extra["site_map"] as Record<string, unknown>).sort()).toEqual(["a.ts#f#X", "b.ts#g#Y"]);
    expect(after.version).toBe(v0 + 2);
  });

  it("refuses a rule id the leaf does not carry and writes nothing", async () => {
    const v0 = leaf.version;
    const a0 = await auditRows(leaf.id);
    const res = await svc.setSiteMap(leaf.id, { sites: { "a.ts#f#X": ["BR-9999"] } }, { by: "t" });
    expect(res.ok).toBe(false);
    expect((await fresh(leaf.id)).version).toBe(v0);
    expect(await auditRows(leaf.id)).toBe(a0);
  });

  it("refuses a blank non-business reason", async () => {
    const res = await svc.setSiteMap(leaf.id, { sites: { "a.ts#f#X": ["non-business:   "] } }, { by: "t" });
    expect(res.ok).toBe(false);
  });

  it("refuses removing a site that was never mapped", async () => {
    const res = await svc.setSiteMap(leaf.id, { removeSites: ["never.ts#x#Y"] }, { by: "t" });
    expect(res.ok).toBe(false);
  });

  it("refuses an empty change", async () => {
    const res = await svc.setSiteMap(leaf.id, {}, { by: "t" });
    expect(res.ok).toBe(false);
  });

  it("refuses a non-leaf target", async () => {
    const branch = await fresh(leaf.parent_id as string);
    const res = await svc.setSiteMap(branch.id, { addCommands: ["ac add"] }, { by: "t" });
    expect(res.ok).toBe(false);
  });
});

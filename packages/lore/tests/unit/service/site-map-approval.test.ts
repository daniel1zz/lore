// @layer service-rule-set-site-map AC-SMM-1
/**
 * AC-SMM-1: a map call that only sets/removes site mappings keeps an approved baseline leaf approved
 * (one version, one `baseline-map` audit row); a call that adds or removes a declared command demotes.
 * InMemoryStore - MOCK RISK: hides SQLite transactions; the CLI e2e covers the real store.
 * @spec_ref AC-SMM-1
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { CreateDocInput, DocRecord } from "@lore/core";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import type { RuleService } from "../../../src/service/rule-service.js";
import { makeRuleService } from "../../helpers/make-rule-service.js";
import { actedStore } from "../../live-invocation.js";

let store: InMemoryStore;
let corpus: CorpusService;
let svc: RuleService;
let leafId: DocRecord["id"];

async function mustCreate(input: CreateDocInput): Promise<DocRecord> {
  const r = await corpus.create(input);
  if (!r.ok) throw new Error(`fixture create failed: ${JSON.stringify(r.error)}`);
  return r.value;
}
async function fresh(): Promise<DocRecord> {
  const r = await store.find(leafId);
  if (!r.ok || r.value === null) throw new Error("fixture read failed");
  return r.value;
}
async function auditOps(): Promise<string[]> {
  const r = await store.queryAudit({ doc_id: leafId });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value.map((a) => String((a.details as Record<string, unknown> | undefined)?.["operation"]));
}

beforeEach(async () => {
  store = actedStore(new InMemoryStore());
  corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  svc = makeRuleService(store);
  const prd = await mustCreate({ type: "prd", title: "P", content: "root" } as CreateDocInput);
  const root = await mustCreate({ type: "baseline", title: "R", content: "r", parent_id: prd.id, extra: { node: "root", label: "Root" } } as CreateDocInput);
  const branch = await mustCreate({ type: "baseline", title: "B", content: "b", parent_id: root.id, extra: { node: "branch", label: "Branch" } } as CreateDocInput);
  const leaf = await mustCreate({ type: "baseline", title: "L", content: "l", parent_id: branch.id, extra: { node: "leaf", label: "Leaf" } } as CreateDocInput);
  leafId = leaf.id;
  const added = await svc.addRule(leaf.id, { statement: "first", confidence: "established", enforced_by: "guaranteed", examples: ["e"] }, { by: "fx" });
  if (!added.ok) throw new Error(JSON.stringify(added.error));
  // Seed a command and a site so removals are possible, then approve.
  const seeded = await svc.setSiteMap(leaf.id, { sites: { "a.ts#f#X": ["BR-1"] }, addCommands: ["ac add"] }, { by: "fx" });
  if (!seeded.ok) throw new Error(JSON.stringify(seeded.error));
  const approved = await corpus.set(leaf.id, { status: "approved" });
  if (!approved.ok || approved.value.status !== "approved") throw new Error("fixture approve failed");
});

describe("setSiteMap approval handling (AC-SMM-1)", () => {
  it("setting a site mapping keeps the leaf approved: +1 version, +1 baseline-map audit row, no demote row", async () => {
    const before = await fresh();
    const auditBefore = (await auditOps()).length;
    const mapRowsBefore = (await auditOps()).filter((o) => o === "baseline-map").length;
    const res = await svc.setSiteMap(leafId, { sites: { "b.ts#g#Y": ["non-business:wiring"] } }, { by: "t" });
    expect(res.ok).toBe(true);
    const after = await fresh();
    expect(after.status).toBe("approved");
    expect(after.version).toBe(before.version + 1);
    const ops = await auditOps();
    expect(ops.length).toBe(auditBefore + 1);
    expect(ops.filter((o) => o === "baseline-map").length).toBe(mapRowsBefore + 1);
    expect(ops).not.toContain("demote");
  });

  it("removing a site mapping keeps the leaf approved with exactly one version and one audit row", async () => {
    const before = await fresh();
    const auditBefore = (await auditOps()).length;
    const res = await svc.setSiteMap(leafId, { removeSites: ["a.ts#f#X"] }, { by: "t" });
    expect(res.ok).toBe(true);
    const after = await fresh();
    expect(after.status).toBe("approved");
    expect(after.version).toBe(before.version + 1);
    expect((await auditOps()).length).toBe(auditBefore + 1);
  });

  it("a call with BOTH a site and a new command demotes to draft (naive 'sites win' stays red)", async () => {
    const res = await svc.setSiteMap(leafId, { sites: { "b.ts#g#Y": ["BR-1"] }, addCommands: ["ac list"] }, { by: "t" });
    expect(res.ok).toBe(true);
    expect((await fresh()).status).toBe("draft");
  });

  it("adding only a command demotes", async () => {
    const res = await svc.setSiteMap(leafId, { addCommands: ["ac list"] }, { by: "t" });
    expect(res.ok).toBe(true);
    expect((await fresh()).status).toBe("draft");
  });

  it("removing only a command demotes", async () => {
    const res = await svc.setSiteMap(leafId, { removeCommands: ["ac add"] }, { by: "t" });
    expect(res.ok).toBe(true);
    expect((await fresh()).status).toBe("draft");
  });

  it("a refused site-only call leaves the approved leaf untouched (no version, still approved)", async () => {
    const before = await fresh();
    const res = await svc.setSiteMap(leafId, { sites: { "b.ts#g#Y": ["BR-99"] } }, { by: "t" });
    expect(res.ok).toBe(false);
    const after = await fresh();
    expect(after.status).toBe("approved");
    expect(after.version).toBe(before.version);
  });

  it("a draft leaf stays draft on a site-only call (control)", async () => {
    const demoted = await svc.addRule(leafId, { statement: "second", confidence: "established", enforced_by: "guaranteed", examples: ["e"] }, { by: "fx" });
    expect(demoted.ok).toBe(true);
    expect((await fresh()).status).toBe("draft");
    const res = await svc.setSiteMap(leafId, { sites: { "b.ts#g#Y": ["BR-1"] } }, { by: "t" });
    expect(res.ok).toBe(true);
    expect((await fresh()).status).toBe("draft");
  });
});

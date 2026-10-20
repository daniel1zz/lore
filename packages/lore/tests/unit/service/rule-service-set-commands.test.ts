// @layer service-rule-set-commands AC-BLS2-5
/**
 * RuleService.setCommands (baseline slice 2a, AC-BLS2-5; the site-map half retired by BR-1344): the only writer of a leaf's
 * `extra.commands`.
 *
 * Expectations asserted here:
 *   - one successful call = exactly ONE new doc version and exactly ONE new audit row;
 *   - a write based on a stale version is refused (CAS) and changes nothing;
 *   - two concurrent callers never lose each other's command (both land, version +2);
 *   - removing a command that is not declared, a blank command, an empty change and a non-leaf target are refused and write nothing;
 *   - the leaf never gains a `site_map` key: a site's rule is declared in code.
 *
 * InMemoryStore (no bun:sqlite) — MOCK RISK: hides SQLite transaction behaviour; the CLI e2e in
 * tests/integration/cli/baseline-coverage.bun.test.ts covers the real store.
 *
 * @spec_ref AC-BLS2-5
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect, beforeEach } from "vitest";
import type { CreateDocInput, DocRecord } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { RuleService } from "../../../src/service/rule-service.js";
import { makeRuleService } from "../../helpers/make-rule-service.js";
import { actedStore } from "../../live-invocation.js";

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
  store = actedStore(new InMemoryStore());
  corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  svc = makeRuleService(store);
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

describe("RuleService.setCommands", () => {
  it("one call writes exactly one version and exactly one audit row", async () => {
    const v0 = leaf.version;
    const a0 = await auditRows(leaf.id);
    const res = await svc.setCommands(leaf.id, { addCommands: ["ac add", "ac rm"] }, { by: "t" });
    expect(res.ok).toBe(true);
    const after = await fresh(leaf.id);
    expect(after.version).toBe(v0 + 1);
    expect((await auditRows(leaf.id)) - a0).toBe(1);
  });

  it("stores the commands under extra, different inputs giving different lists, and never writes a site map", async () => {
    await svc.setCommands(leaf.id, { addCommands: ["ac add"] }, { by: "t" });
    await svc.setCommands(leaf.id, { addCommands: ["rule add"], removeCommands: ["ac add"] }, { by: "t" });
    const after = await fresh(leaf.id);
    expect(after.extra["commands"]).toEqual(["rule add"]);
    expect(Object.keys(after.extra).some((key) => key.startsWith("site"))).toBe(false);
  });

  it("a write based on a stale version is refused by the store and changes nothing", async () => {
    const staleVersion = leaf.version;
    await svc.setCommands(leaf.id, { addCommands: ["ac add"] }, { by: "t" });
    const current = await fresh(leaf.id);
    const stale = await store.update(leaf.id, { extra: { ...leaf.extra, commands: ["z"] } }, { expected_version: staleVersion });
    expect(stale.ok).toBe(false);
    expect((await fresh(leaf.id)).version).toBe(current.version);
    expect((await fresh(leaf.id)).extra["commands"]).toEqual(["ac add"]);
  });

  it("two concurrent callers both land: no lost update, version advances by 2", async () => {
    const v0 = leaf.version;
    const [r1, r2] = await Promise.all([
      svc.setCommands(leaf.id, { addCommands: ["ac add"] }, { by: "t1" }),
      svc.setCommands(leaf.id, { addCommands: ["rule add"] }, { by: "t2" }),
    ]);
    expect(r1.ok && r2.ok).toBe(true);
    const after = await fresh(leaf.id);
    expect([...(after.extra["commands"] as string[])].sort()).toEqual(["ac add", "rule add"]);
    expect(after.version).toBe(v0 + 2);
  });

  it("refuses removing a command that was never declared, writing nothing", async () => {
    const v0 = leaf.version;
    const res = await svc.setCommands(leaf.id, { removeCommands: ["never declared"] }, { by: "t" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("VALIDATION_ERROR");
    expect((await fresh(leaf.id)).version).toBe(v0);
  });

  it("refuses a blank command and an empty change", async () => {
    const blank = await svc.setCommands(leaf.id, { addCommands: ["   "] }, { by: "t" });
    expect(blank.ok).toBe(false);
    const empty = await svc.setCommands(leaf.id, {}, { by: "t" });
    expect(empty.ok).toBe(false);
  });

  it("refuses a non-leaf target", async () => {
    const branch = await fresh(leaf.parent_id as string);
    const res = await svc.setCommands(branch.id, { addCommands: ["ac add"] }, { by: "t" });
    expect(res.ok).toBe(false);
  });
});

// @layer service-rule-set-site-map AC-BMB-1
/**
 * AC-BMB-1: ONE map call carrying a 50-row sites set on an approved leaf adds exactly one version and one
 * `baseline-map` audit row that lists all 50 sites, and the leaf stays approved; 50 single-site calls add 50
 * versions (the contrast). The same holds through the CLI adapter: `lore baseline map --sites-file` with 50 rows.
 *
 * Dimensions: HAPPY (50 rows -> 1 version), STATE (stays approved; audit lists every site), REGRESSION (the
 * single-site path still adds one version per call), BOUNDARY (a one-row sites file equals `--site`).
 * InMemoryStore - MOCK RISK: hides SQLite transactions; the CLI case runs the real wiring over a throwaway corpus.
 * @spec_ref spec-one-baseline-map-call-maps-many-sites-of-a-leaf-as-one#AC-BMB-1
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CreateDocInput, DocRecord } from "@lore/core";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import type { RuleService } from "../../../src/service/rule-service.js";
import { makeRuleService } from "../../helpers/make-rule-service.js";
import { actedStore } from "../../live-invocation.js";
import { buildMapFixture, rowsFor, type MapFixture } from "../../helpers/baseline-map-cli-fixture.js";

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
async function mapAudit(): Promise<Record<string, unknown>[]> {
  const r = await store.queryAudit({ doc_id: leafId });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value
    .map((a) => a.details as Record<string, unknown> | undefined)
    .filter((d): d is Record<string, unknown> => d?.["operation"] === "baseline-map");
}
function sitesOf(n: number): Record<string, string[]> {
  return Object.fromEntries(rowsFor(n, "BR-1").map((r) => [r.site, r.rules]));
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
  const approved = await corpus.set(leaf.id, { status: "approved" });
  if (!approved.ok || approved.value.status !== "approved") throw new Error("fixture approve failed");
});

describe("one map call with 50 sites (AC-BMB-1, service)", () => {
  it("adds exactly 1 version and 1 audit row listing all 50 sites; the leaf stays approved", async () => {
    const before = await fresh();
    const auditBefore = (await mapAudit()).length;
    const res = await svc.setSiteMap(leafId, { sites: sitesOf(50) }, { by: "t" });
    expect(res.ok).toBe(true);
    const after = await fresh();
    expect(after.status).toBe("approved");
    expect(after.version).toBe(before.version + 1);
    expect(Object.keys((after.extra["site_map"] ?? {}) as object)).toHaveLength(50);
    const rows = await mapAudit();
    expect(rows).toHaveLength(auditBefore + 1);
    const sites = rows[rows.length - 1]!["sites"] as string[];
    expect(sites).toHaveLength(50);
    expect(new Set(sites)).toEqual(new Set(Object.keys(sitesOf(50))));
  });

  it("contrast: 50 single-site calls add 50 versions and 50 audit rows", async () => {
    const before = await fresh();
    const auditBefore = (await mapAudit()).length;
    for (const [site, rules] of Object.entries(sitesOf(50))) {
      const res = await svc.setSiteMap(leafId, { sites: { [site]: rules } }, { by: "t" });
      expect(res.ok).toBe(true);
    }
    const after = await fresh();
    expect(after.version).toBe(before.version + 50);
    expect(after.status).toBe("approved");
    expect(await mapAudit()).toHaveLength(auditBefore + 50);
  });
});

describe("lore baseline map --sites-file with 50 rows (AC-BMB-1, CLI adapter)", () => {
  let fx: MapFixture;
  beforeAll(async () => {
    fx = await buildMapFixture();
  }, 120_000);
  afterAll(() => fx.dispose());

  it("one --sites-file call maps all 50 sites in exactly one version (exit 0)", async () => {
    const before = await fx.leafState();
    const file = fx.sitesFile("fifty.json", JSON.stringify(rowsFor(50, fx.ownRule)));
    const r = await fx.run(["baseline", "map", fx.leaf, "--sites-file", file]);
    expect(r.exitCode).toBe(0);
    const after = await fx.leafState();
    expect(Object.keys(after.siteMap)).toHaveLength(50);
    expect(after.version).toBe(before.version + 1);
  }, 120_000);

  it("a one-row sites file maps that site to the leaf's own rule", async () => {
    const file = fx.sitesFile("one.json", JSON.stringify([{ site: "x.ts#g#Z", rules: [fx.ownRule] }]));
    const r = await fx.run(["baseline", "map", fx.leaf, "--sites-file", file]);
    expect(r.exitCode).toBe(0);
    expect((await fx.leafState()).siteMap["x.ts#g#Z"]).toEqual([fx.ownRule]);
  }, 120_000);
});

// @layer service-rule-set-site-map AC-BMB-2
/**
 * AC-BMB-2: a sites set whose 50th row names a rule of ANOTHER leaf is refused as a whole with VALIDATION_ERROR
 * (CLI exit 4) naming that row; the leaf's version, site map and audit trail are unchanged. Every invalid row is
 * reported, not just the first.
 *
 * Dimensions: NEGATIVE (foreign rule refused), STATE (nothing written), ERROR (exact code / exit 4),
 * BOUNDARY (the LAST row is the bad one; two bad rows are both named), HAPPY (the same set minus the bad row writes).
 * @spec_ref spec-one-baseline-map-call-maps-many-sites-of-a-leaf-as-one#AC-BMB-2
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
async function auditCount(): Promise<number> {
  const r = await store.queryAudit({ doc_id: leafId });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value.length;
}

/** Rows 1..49 map the leaf's own BR-1; row 50 maps `foreign`. */
function fiftyWithBadLast(foreign: string): Record<string, string[]> {
  const rows = rowsFor(50, "BR-1");
  rows[49] = { site: rows[49]!.site, rules: [foreign] };
  return Object.fromEntries(rows.map((r) => [r.site, r.rules]));
}

let foreignRule = "";

beforeEach(async () => {
  store = actedStore(new InMemoryStore());
  corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  svc = makeRuleService(store);
  const prd = await mustCreate({ type: "prd", title: "P", content: "root" } as CreateDocInput);
  const root = await mustCreate({ type: "baseline", title: "R", content: "r", parent_id: prd.id, extra: { node: "root", label: "Root" } } as CreateDocInput);
  const branch = await mustCreate({ type: "baseline", title: "B", content: "b", parent_id: root.id, extra: { node: "branch", label: "Branch" } } as CreateDocInput);
  const leaf = await mustCreate({ type: "baseline", title: "L", content: "l", parent_id: branch.id, extra: { node: "leaf", label: "Leaf" } } as CreateDocInput);
  const other = await mustCreate({ type: "baseline", title: "O", content: "o", parent_id: branch.id, extra: { node: "leaf", label: "Other" } } as CreateDocInput);
  leafId = leaf.id;
  const own = await svc.addRule(leaf.id, { statement: "own", confidence: "established", enforced_by: "guaranteed", examples: ["e"] }, { by: "fx" });
  const foreign = await svc.addRule(other.id, { statement: "foreign", confidence: "established", enforced_by: "guaranteed", examples: ["e"] }, { by: "fx" });
  if (!own.ok || !foreign.ok) throw new Error("fixture addRule failed");
  foreignRule = foreign.value.ruleId;
  if (foreignRule === "BR-1") throw new Error("fixture needs a rule id that is not the leaf's own");
  const approved = await corpus.set(leaf.id, { status: "approved" });
  if (!approved.ok) throw new Error("fixture approve failed");
});

describe("setSiteMap is all-or-nothing (AC-BMB-2, service)", () => {
  it("a bad 50th row refuses all 50: VALIDATION_ERROR naming that row; version, site map and audit unchanged", async () => {
    const before = await fresh();
    const auditBefore = await auditCount();
    const res = await svc.setSiteMap(leafId, { sites: fiftyWithBadLast(foreignRule) }, { by: "t" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("VALIDATION_ERROR");
    expect(res.error.message).toContain("src/f50.ts#fn#E50");
    expect(res.error.message).toContain(foreignRule);
    const after = await fresh();
    expect(after.version).toBe(before.version);
    expect(after.status).toBe("approved");
    expect(after.extra["site_map"]).toBeUndefined();
    expect(await auditCount()).toBe(auditBefore);
  });

  it("reports EVERY invalid row, not only the first", async () => {
    const sites = fiftyWithBadLast(foreignRule);
    sites["src/f7.ts#fn#E7"] = ["BR-999"];
    const res = await svc.setSiteMap(leafId, { sites }, { by: "t" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("VALIDATION_ERROR");
    expect(res.error.message).toContain("src/f7.ts#fn#E7");
    expect(res.error.message).toContain("src/f50.ts#fn#E50");
  });

  it("the same 49 good rows without the bad one DO write, in one version", async () => {
    const before = await fresh();
    const sites = fiftyWithBadLast(foreignRule);
    delete sites["src/f50.ts#fn#E50"];
    const res = await svc.setSiteMap(leafId, { sites }, { by: "t" });
    expect(res.ok).toBe(true);
    expect((await fresh()).version).toBe(before.version + 1);
  });
});

describe("lore baseline map --sites-file refuses the whole file (AC-BMB-2, CLI adapter)", () => {
  let fx: MapFixture;
  beforeAll(async () => {
    fx = await buildMapFixture();
  }, 120_000);
  afterAll(() => fx.dispose());

  it("a foreign rule on row 50: exit 4, VALIDATION_ERROR naming that row, nothing written", async () => {
    const rows = rowsFor(50, fx.ownRule);
    rows[49] = { site: rows[49]!.site, rules: [fx.foreignRule] };
    const file = fx.sitesFile("bad50.json", JSON.stringify(rows));
    const before = await fx.leafState();
    const r = await fx.run(["baseline", "map", fx.leaf, "--sites-file", file, "--json"]);
    expect(r.exitCode).toBe(4);
    const body = JSON.parse(r.stdout) as { ok: boolean; error: { code: string; message: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("src/f50.ts#fn#E50");
    const after = await fx.leafState();
    expect(after.version).toBe(before.version);
    expect(after.siteMap).toEqual(before.siteMap);
  }, 120_000);
});

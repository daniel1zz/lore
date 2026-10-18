// @layer service-rule-set-site-map AC-SMM-2
/**
 * AC-SMM-2: `non-business:owned-by <leaf> BR-n[ BR-m...] — <reason>` is validated when a site is SET.
 * InMemoryStore - MOCK RISK: hides SQLite transactions.
 * @spec_ref AC-SMM-2
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
let mapped: DocRecord;
let owner: DocRecord;
let other: DocRecord;
let branch: DocRecord;
let ownerRule = "";
let retiredRule = "";
let otherRule = "";
const SITE = "a.ts#f#X";

async function mustCreate(input: CreateDocInput): Promise<DocRecord> {
  const r = await corpus.create(input);
  if (!r.ok) throw new Error(`fixture create failed: ${JSON.stringify(r.error)}`);
  return r.value;
}
async function addRule(leafId: string, statement: string): Promise<string> {
  const r = await svc.addRule(leafId, { statement, confidence: "established", enforced_by: "guaranteed", examples: ["e"] }, { by: "fx" });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return String(r.value["ruleId"]);
}
async function version(id: string): Promise<number> {
  const r = await store.find(id as DocRecord["id"]);
  if (!r.ok || r.value === null) throw new Error("read failed");
  return r.value.version;
}
async function leafNode(title: string, parent: DocRecord): Promise<DocRecord> {
  return mustCreate({ type: "baseline", title, content: "l", parent_id: parent.id, extra: { node: "leaf", label: title } } as CreateDocInput);
}

beforeEach(async () => {
  store = actedStore(new InMemoryStore());
  corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  svc = makeRuleService(store);
  const prd = await mustCreate({ type: "prd", title: "P", content: "root" } as CreateDocInput);
  const root = await mustCreate({ type: "baseline", title: "R", content: "r", parent_id: prd.id, extra: { node: "root", label: "Root" } } as CreateDocInput);
  branch = await mustCreate({ type: "baseline", title: "B", content: "b", parent_id: root.id, extra: { node: "branch", label: "Branch" } } as CreateDocInput);
  mapped = await leafNode("Mapped", branch);
  owner = await leafNode("Owner", branch);
  other = await leafNode("Other", branch);
  await addRule(mapped.id, "mapped rule");
  ownerRule = await addRule(owner.id, "owner rule");
  retiredRule = await addRule(owner.id, "to retire");
  otherRule = await addRule(other.id, "other rule");
  const retired = await svc.setRule(retiredRule, { lifecycle: "retired", note: "gone" }, { by: "fx" });
  if (!retired.ok) throw new Error(JSON.stringify(retired.error));
});

async function refused(entry: string): Promise<void> {
  const before = await version(mapped.id);
  const res = await svc.setSiteMap(mapped.id, { sites: { [SITE]: [entry] } }, { by: "t" });
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.error.code).toBe("VALIDATION_ERROR");
  expect(await version(mapped.id)).toBe(before);
}

describe("setSiteMap owned-by validation (AC-SMM-2)", () => {
  it("refuses an unknown node", async () => refused(`non-business:owned-by no-such-leaf ${ownerRule} — why`));
  it("refuses a branch as the owner", async () => refused(`non-business:owned-by ${branch.slug} ${ownerRule} — why`));
  it("refuses the leaf being mapped (by slug and by id)", async () => {
    await refused(`non-business:owned-by ${mapped.slug} BR-1 — why`);
    await refused(`non-business:owned-by ${mapped.id} BR-1 — why`);
  });
  it("refuses an entry naming no BR id", async () => refused(`non-business:owned-by ${owner.slug} — why`));
  it("refuses a retired rule", async () => refused(`non-business:owned-by ${owner.slug} ${retiredRule} — why`));
  it("refuses one retired id mixed with a live one", async () => refused(`non-business:owned-by ${owner.slug} ${ownerRule} ${retiredRule} — why`));
  it("refuses a rule that exists but is live on a different leaf", async () => refused(`non-business:owned-by ${owner.slug} ${otherRule} — why`));
  it("refuses a missing spaced em-dash separator", async () => {
    await refused(`non-business:owned-by ${owner.slug} ${ownerRule} why`);
    await refused(`non-business:owned-by ${owner.slug} ${ownerRule} - why`);
    await refused(`non-business:owned-by ${owner.slug} ${ownerRule}—why`);
  });
  it("refuses a blank reason after the dash", async () => {
    await refused(`non-business:owned-by ${owner.slug} ${ownerRule} — `);
    await refused(`non-business:owned-by ${owner.slug} ${ownerRule} —    `);
  });

  it("accepts a live rule of the named leaf, named by slug", async () => {
    const res = await svc.setSiteMap(mapped.id, { sites: { [SITE]: [`non-business:owned-by ${owner.slug} ${ownerRule} — handled there`] } }, { by: "t" });
    expect(res.ok).toBe(true);
  });
  it("accepts a live rule of the named leaf, named by id", async () => {
    const res = await svc.setSiteMap(mapped.id, { sites: { [SITE]: [`non-business:owned-by ${owner.id} ${ownerRule} — handled there`] } }, { by: "t" });
    expect(res.ok).toBe(true);
  });

  it("leaves a non-business reason not starting with owned-by unaffected", async () => {
    const res = await svc.setSiteMap(mapped.id, { sites: { [SITE]: ["non-business:owned-bye nothing"] } }, { by: "t" });
    expect(res.ok).toBe(true);
    const res2 = await svc.setSiteMap(mapped.id, { sites: { "b.ts#g#Y": ["non-business:start-up wiring"] } }, { by: "t" });
    expect(res2.ok).toBe(true);
  });

  it("validates only the sites set in this call: an already-stored stale entry does not block an unrelated map", async () => {
    const ok1 = await svc.setSiteMap(mapped.id, { sites: { [SITE]: [`non-business:owned-by ${owner.slug} ${ownerRule} — r`] } }, { by: "t" });
    expect(ok1.ok).toBe(true);
    const retire = await svc.setRule(ownerRule, { lifecycle: "retired", note: "later" }, { by: "t" });
    expect(retire.ok).toBe(true);
    const res = await svc.setSiteMap(mapped.id, { sites: { "c.ts#h#Z": ["BR-1"] } }, { by: "t" });
    expect(res.ok).toBe(true);
  });
});

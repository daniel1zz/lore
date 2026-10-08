/**
 * RED tests for the citation gate (baseline slice 2a §C4 CiteGate, QA-1, QA-5) —
 * task-skill-test-red-citation-gate-modes-x-armed-branch-feeding. Paired impl: C4.
 *
 * SPEC (C4): on an AC add or revise (never on untouched legacy ACs) refuse when the AC cites no
 * live rule, or cites a missing / deprecated / retired id — only if mode is `enforce` AND the
 * spec's branch is armed. `report` mode records a would-refuse audit row and passes. Default mode
 * is `off` with no baseline docs, `report` otherwise.
 *
 * PINNED CONTRACT for C4 (the implementer must satisfy exactly this surface):
 *  1. Config: `workflow.gates["ac-cite"] = { mode: "off"|"report"|"enforce", armed_branches: string[] }`.
 *     `armed_branches` holds the SLUGS of baseline docs with `extra.node === "branch"`. It reaches the
 *     service as `new AcService(store, { citeGate: <that raw object | undefined> })` (2nd ctor arg).
 *  2. Pure resolver, module `packages/lore/src/service/ac-cite-gate.ts`:
 *       `resolveCiteGateConfig(raw: unknown, hasBaselineDocs: boolean) -> { mode, armed_branches }`
 *     raw undefined -> mode `off` when !hasBaselineDocs, else `report`; armed_branches `[]`.
 *     An invalid mode THROWS (no silent fallback). Also `AcService.resolveCiteGate()`
 *       -> Promise<Result<{ mode, armed_branches }, LoreError>> (reads hasBaselineDocs from the
 *     store; an invalid configured mode is `ok: false`).
 *  3. A spec's branch = the branch (parent of the leaf) of the leaf most of its criteria cite. A spec
 *     citing nothing is "unplaced": armed only when EVERY branch in the corpus is armed.
 *  4. Refusal: `AcService.addCriterion` / `setCriterion` return `ok: false` with
 *     `error.code === "AC_CITE_REQUIRED"` and `error.feeding_pack =
 *       { candidates: Array<{ id: string; statement: string }>,   // <= 5, live rules only
 *         cite_line: string,        // paste-ready: `lore ac cite <spec-slug> <ac-id> <BR-id>`
 *         exemption_headroom: number }` // floor(10% of live ACs) - exemptions already granted
 *     Candidate ranking: rules cited by OTHER specs whose `extra.code_anchors` path matches one of
 *     this spec's code anchors come first, then the spec's branch's remaining live rules.
 *     A refused write leaves the spec (extra/version/status/version log) unchanged.
 *  5. Report mode on an armed branch: write accepted; exactly ONE audit row with
 *     `details.operation === "cite_gate_would_refuse"` (+ `details.ac_id`, `details.code ===
 *     "AC_CITE_REQUIRED"`). Any other mode/armed combination writes no such row.
 *  6. A revise (setCriterion) of an AC is gated; an untouched legacy uncited AC is never refused
 *     because a SIBLING is added or revised.
 *
 * Dimensions: HAPPY (live cite accepted, matrix), NEGATIVE (uncited/retired/deprecated/dangling
 * refused), BOUNDARY (unplaced spec, all-armed, <=5 candidates), STATE (refused write untouched;
 * audit row counts), REGRESSION (default-off outputs identical to today), PERFORMANCE (QA-1).
 *
 * @spec_ref AC-BLS2-2
 */

import { describe, it, expect } from "vitest";
import { ulid } from "ulidx";
import { DOC_TYPE_ROLE_MAP } from "@lore/core";
import type { CreateDocInput, DocRecord, DocId } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { AcService } from "../../../src/service/ac-service.js";

const REFUSAL = "AC_CITE_REQUIRED";
const WOULD_REFUSE = "cite_gate_would_refuse";
const GATE_MODULE = "../../../src/service/ac-cite-gate.js";

type Mode = "off" | "report" | "enforce";
interface GateCfg {
  mode: Mode;
  armed_branches: string[];
}
interface FeedingPack {
  candidates: Array<{ id: string; statement: string }>;
  cite_line: string;
  exemption_headroom: number;
}
type AnyResult = { ok: true; value: unknown } | { ok: false; error: { code: string; feeding_pack?: FeedingPack } };

// ─── Fixtures ────────────────────────────────────────────────────────────────

function rule(id: string, lifecycle: "live" | "deprecated" | "retired" = "live") {
  return {
    id,
    statement: `rule ${id} statement`,
    confidence: "established",
    enforced_by: "both",
    examples: ["example"],
    lifecycle,
    ...(lifecycle === "retired" ? { retired_note: "gone" } : {}),
  };
}

async function insertBaseline(
  store: InMemoryStore,
  slug: string,
  extra: Record<string, unknown>,
  parentId: DocId | null,
): Promise<DocId> {
  const id = ulid() as DocId;
  const now = new Date().toISOString();
  const doc: DocRecord = {
    id,
    slug,
    type: "baseline",
    role: DOC_TYPE_ROLE_MAP.baseline,
    title: slug,
    status: "draft",
    priority: "medium",
    content: slug,
    parent_id: parentId,
    created_at: now,
    updated_at: now,
    created_by: "test",
    version: 1,
    deleted_at: null,
    tags: [],
    extra,
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

function gated(store: InMemoryStore, cfg: GateCfg | undefined): AcService {
  // MOCK RISK: none — only the (not yet existing) 2nd constructor arg is cast past the type system.
  return new (AcService as unknown as new (s: InMemoryStore, o: unknown) => AcService)(store, {
    citeGate: cfg,
  });
}

interface World {
  store: InMemoryStore;
  cs: CorpusService;
  plain: AcService; // ungated: seeds legacy state
  specId: string;
  specSlug: string;
  otherSpecId: string;
}

/**
 * alpha branch: leaf with BR-1..BR-12 live, BR-13 retired, BR-14 deprecated.
 * beta branch: leaf with BR-20..BR-21 live.
 * Spec S (alpha): AC-S-1 cites BR-1, AC-S-2 cites BR-2, AC-LEG-1 uncited legacy.
 * Spec O (other): 37 ACs, AC-O-1 cites BR-9, AC-O-2 cites BR-11 (rest uncited) -> 40 ACs corpus-wide.
 */
async function world(): Promise<World> {
  const store = new InMemoryStore();
  const cs = new CorpusService(store);
  const plain = new AcService(store);
  const root = await insertBaseline(store, "baseline-root", { node: "root" }, null);
  const alpha = await insertBaseline(store, "baseline-branch-alpha", { node: "branch" }, root);
  const beta = await insertBaseline(store, "baseline-branch-beta", { node: "branch" }, root);
  const alphaRules = [
    ...Array.from({ length: 12 }, (_, i) => rule(`BR-${i + 1}`)),
    rule("BR-13", "retired"),
    rule("BR-14", "deprecated"),
  ];
  await insertBaseline(store, "baseline-leaf-alpha", { node: "leaf", rules: alphaRules }, alpha);
  await insertBaseline(store, "baseline-leaf-beta", { node: "leaf", rules: [rule("BR-20"), rule("BR-21")] }, beta);

  const prd = await cs.create({ type: "prd", title: "P", content: "root" } as CreateDocInput);
  if (!prd.ok) throw new Error("prd");
  const mk = async (title: string) => {
    const s = await cs.create({ type: "spec", title, parent_id: prd.value.id, content: "body" } as CreateDocInput);
    if (!s.ok) throw new Error("spec");
    return s.value;
  };
  const spec = await mk("Gate Subject");
  const other = await mk("Other Spec");
  for (const c of [AC("AC-S-1", { cites: ["BR-1"] }), AC("AC-S-2", { cites: ["BR-2"] }), AC("AC-LEG-1")]) {
    const a = await plain.addCriterion(spec.id, c);
    if (!a.ok) throw new Error(`seed ${JSON.stringify(a.error)}`);
  }
  const otherAcs = [
    AC("AC-O-1", { cites: ["BR-9"] }),
    AC("AC-O-2", { cites: ["BR-11"] }),
    ...Array.from({ length: 35 }, (_, i) => AC(`AC-OL-${i + 1}`)),
  ];
  for (const c of otherAcs) {
    const a = await plain.addCriterion(other.id, c);
    if (!a.ok) throw new Error(`seed other ${JSON.stringify(a.error)}`);
  }
  return { store, cs, plain, specId: spec.id, specSlug: spec.slug, otherSpecId: other.id };
}

async function setAnchors(store: InMemoryStore, id: string, anchors: string[]): Promise<void> {
  const d = await store.find(id as DocId);
  if (!d.ok || d.value === null) throw new Error("find");
  const r = await store.update(id as DocId, { extra: { ...d.value.extra, code_anchors: anchors } });
  if (!r.ok) throw new Error(`anchors ${JSON.stringify(r.error)}`);
}

async function fingerprint(store: InMemoryStore, id: string): Promise<string> {
  const d = await store.find(id as DocId);
  const v = await store.findVersions(id as DocId);
  if (!d.ok || d.value === null || !v.ok) throw new Error("fingerprint");
  return JSON.stringify({ extra: d.value.extra, version: d.value.version, status: d.value.status, n: v.value.length });
}

async function wouldRefuseRows(store: InMemoryStore, id: string) {
  const a = await store.queryAudit({ doc_id: id });
  if (!a.ok) throw new Error("audit");
  return a.value.filter((e) => (e.details as Record<string, unknown>)["operation"] === WOULD_REFUSE);
}

function refusalOf(r: AnyResult): { code: string; feeding_pack?: FeedingPack } | null {
  return r.ok ? null : r.error;
}

const ENFORCE_ALPHA: GateCfg = { mode: "enforce", armed_branches: ["baseline-branch-alpha"] };

// ─── Resolution of the config (AC item 1, QA-5) ──────────────────────────────

describe("cite gate — config resolution (AC-BLS2-2)", () => {
  async function resolver(): Promise<(raw: unknown, has: boolean) => GateCfg> {
    let mod: Record<string, unknown>;
    try {
      mod = (await import(/* @vite-ignore */ GATE_MODULE)) as Record<string, unknown>;
    } catch (e) {
      throw new Error(`MISSING BEHAVIOUR: ac-cite-gate module not found (${String(e)})`);
    }
    if (typeof mod["resolveCiteGateConfig"] !== "function") {
      throw new Error("MISSING BEHAVIOUR: ac-cite-gate does not export resolveCiteGateConfig");
    }
    return mod["resolveCiteGateConfig"] as (raw: unknown, has: boolean) => GateCfg;
  }

  it("no config and no baseline docs resolves to mode off", async () => {
    expect((await resolver())(undefined, false).mode).toBe("off");
  });

  it("no config but baseline docs present resolves to mode report", async () => {
    expect((await resolver())(undefined, true).mode).toBe("report");
  });

  it("an explicit enforce config is returned as given regardless of baseline presence", async () => {
    const cfg: GateCfg = { mode: "enforce", armed_branches: ["x", "y"] };
    expect((await resolver())(cfg, false)).toEqual(cfg);
  });

  it("an invalid mode throws instead of silently falling back", async () => {
    const r = await resolver();
    expect(() => r({ mode: "block", armed_branches: [] }, true)).toThrow();
  });

  it("AcService.resolveCiteGate on a corpus with no baseline docs and no config is mode off", async () => {
    const store = new InMemoryStore();
    const res = await (gated(store, undefined) as unknown as {
      resolveCiteGate(): Promise<{ ok: boolean; value?: GateCfg }>;
    }).resolveCiteGate();
    expect(res.ok && res.value?.mode).toBe("off");
  });

  it("AcService.resolveCiteGate with baseline docs and no config is mode report", async () => {
    const { store } = await world();
    const res = await (gated(store, undefined) as unknown as {
      resolveCiteGate(): Promise<{ ok: boolean; value?: GateCfg }>;
    }).resolveCiteGate();
    expect(res.ok && res.value?.mode).toBe("report");
  });

  it("AcService.resolveCiteGate rejects an invalid configured mode loudly", async () => {
    const { store } = await world();
    const bad = { mode: "block", armed_branches: [] } as unknown as GateCfg;
    const res = await (gated(store, bad) as unknown as {
      resolveCiteGate(): Promise<{ ok: boolean }>;
    }).resolveCiteGate();
    expect(res.ok).toBe(false);
  });
});

// ─── enforce x armed: refusals ────────────────────────────────────────────────

describe("cite gate — enforce + armed branch refuses (AC-BLS2-2)", () => {
  it("an added criterion citing nothing is refused with AC_CITE_REQUIRED", async () => {
    const w = await world();
    const res = await gated(w.store, ENFORCE_ALPHA).addCriterion(w.specId, AC("AC-NEW-1"));
    expect(refusalOf(res)?.code).toBe(REFUSAL);
  });

  it("an added criterion citing a retired id is refused", async () => {
    const w = await world();
    const res = await gated(w.store, ENFORCE_ALPHA).addCriterion(w.specId, AC("AC-NEW-1", { cites: ["BR-13"] }));
    expect(refusalOf(res)?.code).toBe(REFUSAL);
  });

  it("an added criterion citing a deprecated id is refused", async () => {
    const w = await world();
    const res = await gated(w.store, ENFORCE_ALPHA).addCriterion(w.specId, AC("AC-NEW-1", { cites: ["BR-14"] }));
    expect(refusalOf(res)?.code).toBe(REFUSAL);
  });

  it("an added criterion citing a dangling id is refused", async () => {
    const w = await world();
    const res = await gated(w.store, ENFORCE_ALPHA).addCriterion(w.specId, AC("AC-NEW-1", { cites: ["BR-999"] }));
    expect(refusalOf(res)?.code).toBe(REFUSAL);
  });

  it("an added criterion citing only retired ids is refused even when listed next to nothing live", async () => {
    const w = await world();
    const res = await gated(w.store, ENFORCE_ALPHA).addCriterion(w.specId, AC("AC-NEW-1", { cites: ["BR-13", "BR-14"] }));
    expect(refusalOf(res)?.code).toBe(REFUSAL);
  });

  it("an added criterion citing a live rule is accepted (different input, different outcome)", async () => {
    const w = await world();
    const res = await gated(w.store, ENFORCE_ALPHA).addCriterion(w.specId, AC("AC-NEW-1", { cites: ["BR-3"] }));
    expect(res.ok).toBe(true);
  });

  it("a refused add leaves the spec's extra, version, status and version log unchanged", async () => {
    const w = await world();
    const before = await fingerprint(w.store, w.specId);
    await gated(w.store, ENFORCE_ALPHA).addCriterion(w.specId, AC("AC-NEW-1"));
    expect(await fingerprint(w.store, w.specId)).toBe(before);
  });

  it("revising a legacy uncited criterion (statement change, no cite) is refused", async () => {
    const w = await world();
    const res = await gated(w.store, ENFORCE_ALPHA).setCriterion(w.specId, "AC-LEG-1", { statement: "Reworded legacy" });
    expect(refusalOf(res)?.code).toBe(REFUSAL);
  });

  it("revising a legacy criterion while adding a live cite is accepted", async () => {
    const w = await world();
    const res = await gated(w.store, ENFORCE_ALPHA).setCriterion(w.specId, "AC-LEG-1", {
      statement: "Reworded legacy",
      cites: ["BR-4"],
    });
    expect(res.ok).toBe(true);
  });

  it("revising a criterion so that its cites become retired-only is refused", async () => {
    const w = await world();
    const res = await gated(w.store, ENFORCE_ALPHA).setCriterion(w.specId, "AC-S-1", { cites: ["BR-13"] });
    expect(refusalOf(res)?.code).toBe(REFUSAL);
  });
});

// ─── enforce x unarmed / unplaced ─────────────────────────────────────────────

describe("cite gate — enforce but branch not armed (AC-BLS2-2)", () => {
  it("a spec whose criteria cite an unarmed branch accepts an uncited add", async () => {
    const w = await world();
    const gs = await w.cs.create({
      type: "spec",
      title: "Beta Spec",
      parent_id: (await w.store.find(w.specId as DocId).then((d) => (d.ok ? d.value?.parent_id : null))) as DocId,
      content: "body",
    } as CreateDocInput);
    if (!gs.ok) throw new Error("spec");
    const seeded = await w.plain.addCriterion(gs.value.id, AC("AC-B-1", { cites: ["BR-20"] }));
    if (!seeded.ok) throw new Error("seed");
    const res = await gated(w.store, ENFORCE_ALPHA).addCriterion(gs.value.id, AC("AC-B-2"));
    expect(res.ok).toBe(true);
  });

  it("an accepted add on an unarmed branch writes no would-refuse audit row", async () => {
    const w = await world();
    const parent = await w.store.find(w.specId as DocId).then((d) => (d.ok ? d.value?.parent_id : null));
    const gs = await w.cs.create({ type: "spec", title: "Beta Spec", parent_id: parent as DocId, content: "b" } as CreateDocInput);
    if (!gs.ok) throw new Error("spec");
    await w.plain.addCriterion(gs.value.id, AC("AC-B-1", { cites: ["BR-20"] }));
    await gated(w.store, ENFORCE_ALPHA).addCriterion(gs.value.id, AC("AC-B-2"));
    expect(await wouldRefuseRows(w.store, gs.value.id)).toHaveLength(0);
  });

  it("an unplaced spec (cites nothing) is NOT armed when only some branches are armed", async () => {
    const w = await world();
    const parent = await w.store.find(w.specId as DocId).then((d) => (d.ok ? d.value?.parent_id : null));
    const gs = await w.cs.create({ type: "spec", title: "Unplaced", parent_id: parent as DocId, content: "b" } as CreateDocInput);
    if (!gs.ok) throw new Error("spec");
    const res = await gated(w.store, ENFORCE_ALPHA).addCriterion(gs.value.id, AC("AC-U-1"));
    expect(res.ok).toBe(true);
  });

  it("an unplaced spec IS armed when every branch is armed", async () => {
    const w = await world();
    const parent = await w.store.find(w.specId as DocId).then((d) => (d.ok ? d.value?.parent_id : null));
    const gs = await w.cs.create({ type: "spec", title: "Unplaced", parent_id: parent as DocId, content: "b" } as CreateDocInput);
    if (!gs.ok) throw new Error("spec");
    const all: GateCfg = { mode: "enforce", armed_branches: ["baseline-branch-alpha", "baseline-branch-beta"] };
    const res = await gated(w.store, all).addCriterion(gs.value.id, AC("AC-U-1"));
    expect(refusalOf(res)?.code).toBe(REFUSAL);
  });

  it("a spec's branch is the branch most of its criteria cite, not the first or last cite", async () => {
    const w = await world();
    // AC-S-1/AC-S-2 cite alpha (2 of 3). Add one beta cite via ungated; majority stays alpha.
    await w.plain.addCriterion(w.specId, AC("AC-S-3", { cites: ["BR-20"] }));
    const res = await gated(w.store, ENFORCE_ALPHA).addCriterion(w.specId, AC("AC-NEW-1"));
    expect(refusalOf(res)?.code).toBe(REFUSAL);
  });
});

// ─── report mode ──────────────────────────────────────────────────────────────

describe("cite gate — report mode + armed branch (AC-BLS2-2)", () => {
  const REPORT_ALPHA: GateCfg = { mode: "report", armed_branches: ["baseline-branch-alpha"] };

  it("an uncited add is accepted", async () => {
    const w = await world();
    const res = await gated(w.store, REPORT_ALPHA).addCriterion(w.specId, AC("AC-NEW-1"));
    expect(res.ok).toBe(true);
  });

  it("an uncited add records exactly one would-refuse audit row", async () => {
    const w = await world();
    await gated(w.store, REPORT_ALPHA).addCriterion(w.specId, AC("AC-NEW-1"));
    expect(await wouldRefuseRows(w.store, w.specId)).toHaveLength(1);
  });

  it("the would-refuse row names the criterion and the refusal code", async () => {
    const w = await world();
    await gated(w.store, REPORT_ALPHA).addCriterion(w.specId, AC("AC-NEW-1"));
    const row = (await wouldRefuseRows(w.store, w.specId))[0];
    expect(row?.details).toMatchObject({ ac_id: "AC-NEW-1", code: REFUSAL });
  });

  it("two uncited adds record two rows (one per would-refuse decision)", async () => {
    const w = await world();
    const svc = gated(w.store, REPORT_ALPHA);
    await svc.addCriterion(w.specId, AC("AC-NEW-1"));
    await svc.addCriterion(w.specId, AC("AC-NEW-2"));
    expect(await wouldRefuseRows(w.store, w.specId)).toHaveLength(2);
  });

  it("a live-cited add records no would-refuse row", async () => {
    const w = await world();
    await gated(w.store, REPORT_ALPHA).addCriterion(w.specId, AC("AC-NEW-1", { cites: ["BR-5"] }));
    expect(await wouldRefuseRows(w.store, w.specId)).toHaveLength(0);
  });

  it("an add citing a retired id is accepted and recorded as would-refuse", async () => {
    const w = await world();
    const res = await gated(w.store, REPORT_ALPHA).addCriterion(w.specId, AC("AC-NEW-1", { cites: ["BR-13"] }));
    expect(res.ok && (await wouldRefuseRows(w.store, w.specId)).length).toBe(1);
  });
});

// ─── off mode ─────────────────────────────────────────────────────────────────

describe("cite gate — off mode (AC-BLS2-2)", () => {
  it("mode off accepts an uncited add on an armed branch and writes no gate row", async () => {
    const w = await world();
    const res = await gated(w.store, { mode: "off", armed_branches: ["baseline-branch-alpha"] }).addCriterion(
      w.specId,
      AC("AC-NEW-1"),
    );
    expect(res.ok && (await wouldRefuseRows(w.store, w.specId)).length).toBe(0);
  });
});

// ─── legacy untouched ─────────────────────────────────────────────────────────

describe("cite gate — untouched legacy criteria are never refused (AC-BLS2-2)", () => {
  it("adding a sibling with a live cite on an armed branch is accepted although AC-LEG-1 is uncited", async () => {
    const w = await world();
    const res = await gated(w.store, ENFORCE_ALPHA).addCriterion(w.specId, AC("AC-NEW-1", { cites: ["BR-6"] }));
    expect(res.ok).toBe(true);
  });

  it("after that add the legacy criterion is stored byte-identical and still uncited", async () => {
    const w = await world();
    const before = await w.store.find(w.specId as DocId);
    const legBefore = JSON.stringify(
      ((before.ok && before.value?.extra["acceptance_criteria"]) as Array<{ id: string }>).find((a) => a.id === "AC-LEG-1"),
    );
    await gated(w.store, ENFORCE_ALPHA).addCriterion(w.specId, AC("AC-NEW-1", { cites: ["BR-6"] }));
    const after = await w.store.find(w.specId as DocId);
    const legAfter = JSON.stringify(
      ((after.ok && after.value?.extra["acceptance_criteria"]) as Array<{ id: string }>).find((a) => a.id === "AC-LEG-1"),
    );
    expect(legAfter).toBe(legBefore);
  });

  it("revising a different, already-cited criterion is accepted although AC-LEG-1 is uncited", async () => {
    const w = await world();
    const res = await gated(w.store, ENFORCE_ALPHA).setCriterion(w.specId, "AC-S-1", { statement: "Reworded cited" });
    expect(res.ok).toBe(true);
  });

  it("citing a rule on the legacy criterion via citeCriterion is accepted (a cite is never refused as uncited)", async () => {
    const w = await world();
    const res = await gated(w.store, ENFORCE_ALPHA).citeCriterion(w.specId, "AC-LEG-1", ["BR-7"], {});
    expect(res.ok).toBe(true);
  });
});

// ─── feeding pack ─────────────────────────────────────────────────────────────

describe("cite gate — refusal feeding pack (AC-BLS2-2)", () => {
  async function refuse(anchorsSubject: string[], anchorsOther: string[]) {
    const w = await world();
    await setAnchors(w.store, w.specId, anchorsSubject);
    await setAnchors(w.store, w.otherSpecId, anchorsOther);
    const res = await gated(w.store, ENFORCE_ALPHA).addCriterion(w.specId, AC("AC-NEW-1"));
    return { w, pack: refusalOf(res)?.feeding_pack };
  }

  it("lists at most 5 candidate rules even though 12 live rules exist on the branch", async () => {
    const { pack } = await refuse(["packages/lore/src/x.ts#Foo"], ["packages/lore/src/x.ts"]);
    expect(pack?.candidates.length).toBeGreaterThan(0);
    expect(pack?.candidates.length).toBeLessThanOrEqual(5);
  });

  it("puts the rule cited by a spec with a matching code anchor first (BR-9)", async () => {
    const { pack } = await refuse(["packages/lore/src/x.ts#Foo"], ["packages/lore/src/x.ts"]);
    expect(pack?.candidates[0]?.id).toBe("BR-9");
  });

  it("with a different anchor match the first candidate changes (not a hardcoded order)", async () => {
    const { w } = await refuse(["a/b.ts"], ["a/b.ts"]);
    await setAnchors(w.store, w.otherSpecId, ["zzz/other.ts"]);
    // Re-anchor O's AC-O-2 (BR-11) as the match by moving the anchor onto a fresh spec citing only BR-11.
    const parent = await w.store.find(w.specId as DocId).then((d) => (d.ok ? d.value?.parent_id : null));
    const m = await w.cs.create({ type: "spec", title: "Matcher", parent_id: parent as DocId, content: "b" } as CreateDocInput);
    if (!m.ok) throw new Error("spec");
    await w.plain.addCriterion(m.value.id, AC("AC-M-1", { cites: ["BR-12"] }));
    await setAnchors(w.store, m.value.id, ["a/b.ts"]);
    await setAnchors(w.store, w.specId, ["a/b.ts#Sym"]);
    const res = await gated(w.store, ENFORCE_ALPHA).addCriterion(w.specId, AC("AC-NEW-2"));
    expect(refusalOf(res)?.feeding_pack?.candidates[0]?.id).toBe("BR-12");
  });

  it("never offers retired or deprecated rules as candidates", async () => {
    const { pack } = await refuse(["packages/lore/src/x.ts"], ["packages/lore/src/x.ts"]);
    const ids = pack?.candidates.map((c) => c.id) ?? [];
    expect(ids).not.toContain("BR-13");
    expect(ids).not.toContain("BR-14");
  });

  it("every candidate carries its statement", async () => {
    const { pack } = await refuse(["p/q.ts"], ["p/q.ts"]);
    expect(pack?.candidates.every((c) => c.statement === `rule ${c.id} statement`)).toBe(true);
  });

  it("includes a paste-ready `lore ac cite` line naming the spec, the new AC and the first candidate", async () => {
    const { w, pack } = await refuse(["packages/lore/src/x.ts"], ["packages/lore/src/x.ts"]);
    expect(pack?.cite_line).toBe(`lore ac cite ${w.specSlug} AC-NEW-1 BR-9`);
  });

  it("reports remaining exemption headroom as 10% of the 40 live ACs (4) when none are granted", async () => {
    const { pack } = await refuse(["p/q.ts"], ["p/q.ts"]);
    expect(pack?.exemption_headroom).toBe(4);
  });

  it("falls back to branch rules when no spec anchor matches (still <= 5, still non-empty)", async () => {
    const { pack } = await refuse(["no/match.ts"], ["something/else.ts"]);
    expect(pack?.candidates.length).toBeGreaterThan(0);
    expect(pack?.candidates.length).toBeLessThanOrEqual(5);
  });

  it("offers only rules of this spec's branch (alpha), never beta rules, in the fallback", async () => {
    const { pack } = await refuse(["no/match.ts"], ["something/else.ts"]);
    expect((pack?.candidates ?? []).map((c) => c.id)).not.toContain("BR-20");
  });
});

// ─── rollback: no baseline docs + no config (QA-5) ────────────────────────────

describe("cite gate — no baseline docs and no config leaves outputs unchanged (AC-BLS2-2, QA-5)", () => {
  async function run(svcFactory: (s: InMemoryStore) => AcService) {
    const store = new InMemoryStore();
    const cs = new CorpusService(store);
    const prd = await cs.create({ type: "prd", title: "P", content: "root" } as CreateDocInput);
    if (!prd.ok) throw new Error("prd");
    const spec = await cs.create({ type: "spec", title: "S", parent_id: prd.value.id, content: "b" } as CreateDocInput);
    if (!spec.ok) throw new Error("spec");
    const svc = svcFactory(store);
    const a = await svc.addCriterion(spec.value.id, AC("AC-Z-1"));
    const b = await svc.setCriterion(spec.value.id, "AC-Z-1", { statement: "Changed" });
    const audit = await store.queryAudit({ doc_id: spec.value.id });
    if (!audit.ok) throw new Error("audit");
    const d = await store.find(spec.value.id);
    return {
      a: JSON.stringify(a, (k, v) => (k.endsWith("_at") ? undefined : v)),
      b: JSON.stringify(b, (k, v) => (k.endsWith("_at") ? undefined : v)),
      ops: audit.value.map((e) => String((e.details as Record<string, unknown>)["operation"])).sort(),
      version: d.ok ? d.value?.version : -1,
    };
  }

  it("an uncited add and revise are accepted with no config", async () => {
    const r = await run((s) => gated(s, undefined));
    expect(JSON.parse(r.a).ok).toBe(true);
    expect(JSON.parse(r.b).ok).toBe(true);
  });

  it("outputs, audit operations and version are identical to the ungated service", async () => {
    const today = await run((s) => new AcService(s));
    const configless = await run((s) => gated(s, undefined));
    expect(configless).toEqual(today);
  });

  it("writes no would-refuse audit row", async () => {
    const r = await run((s) => gated(s, undefined));
    expect(r.ops).not.toContain(WOULD_REFUSE);
  });
});

// ─── QA-1 latency ─────────────────────────────────────────────────────────────

describe("cite gate — latency on a 1,500-rule corpus (AC-BLS2-2, QA-1)", () => {
  it("p95 added latency of 50 enforce-armed `ac add` calls is <= 50 ms", async () => {
    const store = new InMemoryStore();
    const cs = new CorpusService(store);
    const plain = new AcService(store);
    const root = await insertBaseline(store, "baseline-root", { node: "root" }, null);
    const alpha = await insertBaseline(store, "baseline-branch-alpha", { node: "branch" }, root);
    for (let l = 0; l < 15; l++) {
      const rules = Array.from({ length: 100 }, (_, i) => rule(`BR-${l * 100 + i + 1}`));
      await insertBaseline(store, `baseline-leaf-${l}`, { node: "leaf", rules }, alpha);
    }
    const prd = await cs.create({ type: "prd", title: "P", content: "root" } as CreateDocInput);
    if (!prd.ok) throw new Error("prd");
    const specs: string[] = [];
    for (let s = 0; s < 5; s++) {
      const sp = await cs.create({ type: "spec", title: `Lat ${s}`, parent_id: prd.value.id, content: "b" } as CreateDocInput);
      if (!sp.ok) throw new Error("spec");
      const seeded = await plain.addCriterion(sp.value.id, AC(`AC-L${s}-0`, { cites: [`BR-${s + 1}`] }));
      if (!seeded.ok) throw new Error("seed");
      specs.push(sp.value.id);
    }
    const svc = gated(store, ENFORCE_ALPHA);
    const times: number[] = [];
    let accepted = 0;
    for (let n = 1; n <= 50; n++) {
      const spec = specs[n % 5] as string;
      const t0 = performance.now();
      const res = await svc.addCriterion(spec, AC(`AC-L${n % 5}-${n}`, { cites: [`BR-${(n * 7) % 1500 + 1}`] }));
      times.push(performance.now() - t0);
      if (res.ok) accepted += 1;
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.ceil(times.length * 0.95) - 1] as number;
    // Guard against a vacuous pass: every call must really have been accepted by the gate path.
    expect(accepted).toBe(50);
    // The armed gate must be live in this very run, else the latency number measures nothing.
    const uncited = await svc.addCriterion(specs[0] as string, AC("AC-L0-UNCITED"));
    expect(refusalOf(uncited)?.code).toBe(REFUSAL);
    expect(p95).toBeLessThanOrEqual(50);
  });
});

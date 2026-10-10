/**
 * RED tests for AC citations (baseline slice 1 §C4, QA-6, AC-BLS1-6) —
 * task-skill-test-ac-cite-report-only-citations-counts-no [C3]. Paired impl: C4.
 *
 * PINNED CONTRACT for C4 (the implementer must satisfy exactly this surface):
 *
 *  1. `AcService.citeCriterion(spec, acId, ruleIds, { remove?: boolean }, opts?)`
 *       -> Promise<Result<{ criteria: AcceptanceCriterion[]; warnings: CiteWarning[] }, LoreError>>
 *     where `CiteWarning = { id: string; kind: "dangling" | "inactive" }`.
 *       - REPORT-ONLY: a dangling / deprecated / retired id is WRITTEN and yields exactly one
 *         warning for that id. It never rejects and never drops the id.
 *       - kind "dangling" = no baseline leaf carries the id; "inactive" = the rule's
 *         `lifecycle` is `deprecated` or `retired`. A `live` rule yields no warning.
 *       - Rule existence/lifecycle come from baseline leaves' `extra.rules[].lifecycle`.
 *       - Ids are de-duplicated (set semantics): citing an id twice stores it once.
 *       - `{ remove: true }` removes the ids from `cites`.
 *       - Does NOT demote an approved spec. Writes exactly 1 version row (spec.version + 1)
 *         and 1 audit entry whose `details.operation === "cite"` (and `ac_id`).
 *       - Unknown acId -> VALIDATION_ERROR; unknown spec -> DOC_NOT_FOUND.
 *  2. `AcService.addCriterion(spec, { ...criterion, cites })` stores `cites`, does NOT demote,
 *     and records the same report-only warnings in its audit entry as
 *     `details.cites = string[]` and `details.cite_warnings = CiteWarning[]`.
 *  3. `AcService.setCriterion(spec, acId, { cites: string[] })` is a valid sole patch field
 *     (REPLACES the list), follows set's existing rule (approved -> draft demotion), and records
 *     the same `details.cites` / `details.cite_warnings` in its audit entry.
 *  4. Exported pure counter, module `packages/lore/src/service/ac-citations.ts`:
 *       `countCitations(specs: DocRecord[], ruleIndex: ReadonlyMap<string, { lifecycle: "live"|"deprecated"|"retired" }>)`
 *         -> `{ acs_total, acs_citing, acs_uncited, cites_dangling, cites_to_inactive }`
 *     `acs_citing` = ACs with >=1 cite; `acs_uncited = acs_total - acs_citing`;
 *     `cites_dangling` = cite occurrences whose id is absent from ruleIndex;
 *     `cites_to_inactive` = cite occurrences whose rule is deprecated|retired.
 *     C7's status uses this function.
 *
 * Dimensions: HAPPY (live cite), NEGATIVE (dangling/deprecated/retired written + warned;
 * unknown AC), BOUNDARY (duplicate id once; remove), STATE (no demotion on cite/add,
 * demotion on set; version + audit), REGRESSION (falsifier: dangling is STORED and COUNTED).
 *
 * @spec_ref AC-BLS1-6
 */

import { describe, it, expect } from "vitest";
import { ulid } from "ulidx";
import { DOC_TYPE_ROLE_MAP } from "@lore/core";
import type { CreateDocInput, DocRecord, DocId } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { AcService } from "../../../src/service/ac-service.js";

type CiteWarning = { id: string; kind: "dangling" | "inactive" };
interface CiteApi {
  citeCriterion(
    spec: string,
    acId: string,
    ruleIds: string[],
    flags: { remove?: boolean },
    opts?: Record<string, unknown>,
  ): Promise<
    | { ok: true; value: { criteria: Array<{ id: string; cites?: string[] }>; warnings: CiteWarning[] } }
    | { ok: false; error: { code: string } }
  >;
}
interface Counts {
  acs_total: number;
  acs_citing: number;
  acs_uncited: number;
  cites_dangling: number;
  cites_to_inactive: number;
}
type CountFn = (
  specs: DocRecord[],
  ruleIndex: ReadonlyMap<string, { lifecycle: "live" | "deprecated" | "retired" }>,
) => Counts;

// Variable specifier: the module does not exist yet (C4), the file must still load.
const CITATIONS_MODULE = "../../../src/service/ac-citations.js";
async function loadCountCitations(): Promise<CountFn> {
  let mod: Record<string, unknown>;
  try {
    mod = (await import(/* @vite-ignore */ CITATIONS_MODULE)) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`MISSING BEHAVIOUR: ac-citations module with countCitations not found (${String(e)})`);
  }
  if (typeof mod["countCitations"] !== "function") {
    throw new Error("MISSING BEHAVIOUR: ac-citations does not export countCitations");
  }
  return mod["countCitations"] as CountFn;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

function rule(id: string, lifecycle: "live" | "deprecated" | "retired") {
  return {
    id,
    statement: `rule ${id}`,
    confidence: "established",
    enforced_by: "both",
    examples: ["example"],
    lifecycle,
    ...(lifecycle === "retired" ? { retired_note: "gone" } : {}),
  };
}

async function insertLeaf(store: InMemoryStore, rules: ReturnType<typeof rule>[]): Promise<void> {
  const id = ulid() as DocId;
  const now = new Date().toISOString();
  const doc: DocRecord = {
    id,
    slug: `baseline-leaf-${id.slice(-8).toLowerCase()}`,
    type: "baseline",
    role: DOC_TYPE_ROLE_MAP.baseline,
    title: "Leaf",
    status: "draft",
    priority: "medium",
    content: "leaf",
    parent_id: null,
    created_at: now,
    updated_at: now,
    created_by: "test",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: { node: "leaf", rules },
  };
  const r = await store.insert(doc);
  if (!r.ok) throw new Error(`leaf insert failed: ${JSON.stringify(r.error)}`);
}

const AC = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  statement: "Does the thing",
  verify: { mode: "script", oracle: "test", command: "bun test x" },
  ...extra,
});

async function setup() {
  const store = new InMemoryStore();
  const cs = new CorpusService(store);
  const ac = new AcService(store);
  await insertLeaf(store, [rule("BR-1", "live"), rule("BR-2", "deprecated"), rule("BR-3", "retired")]);
  const prd = await cs.create({ type: "prd", title: "P", content: "root" } as CreateDocInput);
  if (!prd.ok) throw new Error("prd");
  const spec = await cs.create({
    type: "spec",
    title: "S",
    content: "body",
  } as CreateDocInput);
  if (!spec.ok) throw new Error("spec");
  const added = await ac.addCriterion(spec.value.id, AC("AC-C-1"));
  if (!added.ok) throw new Error(`seed ac: ${JSON.stringify(added.error)}`);
  const u = await store.update(spec.value.id, { status: "approved" });
  if (!u.ok) throw new Error("approve");
  return { store, ac, specId: spec.value.id };
}

function citeApi(ac: AcService): CiteApi {
  const fn = (ac as unknown as Partial<CiteApi>).citeCriterion;
  if (typeof fn !== "function") {
    throw new Error("MISSING BEHAVIOUR: AcService.citeCriterion is not implemented");
  }
  return ac as unknown as CiteApi;
}

async function snapshot(store: InMemoryStore, specId: string) {
  const d = await store.find(specId as DocId);
  if (!d.ok || d.value === null) throw new Error("find");
  const v = await store.findVersions(specId as DocId);
  if (!v.ok) throw new Error("versions");
  const a = await store.queryAudit({ doc_id: specId });
  if (!a.ok) throw new Error("audit");
  const criteria = d.value.extra["acceptance_criteria"] as Array<{ id: string; cites?: string[] }>;
  const details = a.value.map((e) => e.details as Record<string, unknown>);
  return { doc: d.value, versions: v.value, details, criteria };
}

// ─── HAPPY / STATE ───────────────────────────────────────────────────────────

describe("ac cite — live rule (AC-BLS1-6)", () => {
  it("stores the cite, keeps the spec approved, logs 1 version and audit operation `cite`", async () => {
    const { store, ac, specId } = await setup();
    const before = await snapshot(store, specId);

    const res = await citeApi(ac).citeCriterion(specId, "AC-C-1", ["BR-1"], {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.warnings).toEqual([]);

    const after = await snapshot(store, specId);
    expect(after.criteria[0]?.cites).toEqual(["BR-1"]);
    expect(after.doc.status).toBe("approved");
    expect(after.doc.version).toBe(before.doc.version + 1);
    expect(after.versions.length).toBe(before.versions.length + 1);
    const cite = after.details.filter((d) => d["operation"] === "cite");
    expect(cite.length).toBe(1);
    expect(cite[0]?.["ac_id"]).toBe("AC-C-1");
  });
});

// ─── NEGATIVE: report-only ───────────────────────────────────────────────────

describe("ac cite — report-only warnings (written, 1 warning, counted)", () => {
  const cases: Array<[string, string, CiteWarning["kind"], keyof Counts]> = [
    ["dangling (missing id)", "BR-99", "dangling", "cites_dangling"],
    ["deprecated rule", "BR-2", "inactive", "cites_to_inactive"],
    ["retired rule", "BR-3", "inactive", "cites_to_inactive"],
  ];
  for (const [label, id, kind, countKey] of cases) {
    it(`${label}: written, exactly 1 warning naming the id, counted as ${countKey}=1`, async () => {
      const { store, ac, specId } = await setup();
      const res = await citeApi(ac).citeCriterion(specId, "AC-C-1", [id], {});
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.value.warnings).toEqual([{ id, kind }]);

      const after = await snapshot(store, specId);
      expect(after.criteria[0]?.cites).toEqual([id]);

      const countCitations = await loadCountCitations();
      const index = new Map([
        ["BR-1", { lifecycle: "live" as const }],
        ["BR-2", { lifecycle: "deprecated" as const }],
        ["BR-3", { lifecycle: "retired" as const }],
      ]);
      const counts = countCitations([after.doc], index);
      expect(counts[countKey]).toBe(1);
      expect(counts.acs_citing).toBe(1);
    });
  }

  it("unknown AC id -> VALIDATION_ERROR and the spec is unchanged", async () => {
    const { store, ac, specId } = await setup();
    const before = await snapshot(store, specId);
    const res = await citeApi(ac).citeCriterion(specId, "AC-NOPE-9", ["BR-1"], {});
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("VALIDATION_ERROR");
    expect((await snapshot(store, specId)).doc.version).toBe(before.doc.version);
  });
});

// ─── BOUNDARY ────────────────────────────────────────────────────────────────

describe("ac cite — duplicates and removal", () => {
  it("the same id cited twice is stored once", async () => {
    const { store, ac, specId } = await setup();
    await citeApi(ac).citeCriterion(specId, "AC-C-1", ["BR-1"], {});
    const res = await citeApi(ac).citeCriterion(specId, "AC-C-1", ["BR-1", "BR-1"], {});
    expect(res.ok).toBe(true);
    expect((await snapshot(store, specId)).criteria[0]?.cites).toEqual(["BR-1"]);
  });

  it("--remove drops the id and logs a version", async () => {
    const { store, ac, specId } = await setup();
    await citeApi(ac).citeCriterion(specId, "AC-C-1", ["BR-1", "BR-99"], {});
    const before = await snapshot(store, specId);
    const res = await citeApi(ac).citeCriterion(specId, "AC-C-1", ["BR-99"], { remove: true });
    expect(res.ok).toBe(true);
    const after = await snapshot(store, specId);
    expect(after.criteria[0]?.cites).toEqual(["BR-1"]);
    expect(after.versions.length).toBe(before.versions.length + 1);
    expect(after.doc.status).toBe("approved");
  });
});

// ─── STATE: add / set ────────────────────────────────────────────────────────

describe("ac add --cite / ac set --cite", () => {
  it("add with cites: stored, no demotion, report-only warning recorded in the audit entry", async () => {
    const { store, ac, specId } = await setup();
    const res = await ac.addCriterion(specId, AC("AC-C-2", { cites: ["BR-1", "BR-99"] }));
    expect(res.ok).toBe(true);
    const after = await snapshot(store, specId);
    expect(after.doc.status).toBe("approved");
    expect(after.criteria.find((c) => c.id === "AC-C-2")?.cites).toEqual(["BR-1", "BR-99"]);
    const entry = after.details.find((d) => d["operation"] === "add" && d["cites"] !== undefined);
    expect(entry?.["cites"]).toEqual(["BR-1", "BR-99"]);
    expect(entry?.["cite_warnings"]).toEqual([{ id: "BR-99", kind: "dangling" }]);
  });

  it("set with cites: replaces the list and demotes approved -> draft (set's rule)", async () => {
    const { store, ac, specId } = await setup();
    const res = await ac.setCriterion(specId, "AC-C-1", { cites: ["BR-2"] } as never);
    expect(res.ok, "ac set --cite must be a valid sole patch field").toBe(true);
    const after = await snapshot(store, specId);
    expect(after.criteria[0]?.cites).toEqual(["BR-2"]);
    expect(after.doc.status).toBe("draft");
    const entry = after.details.find((d) => d["operation"] === "set" && d["cites"] !== undefined);
    expect(entry?.["cite_warnings"]).toEqual([{ id: "BR-2", kind: "inactive" }]);
  });
});

// ─── REGRESSION: falsifier ───────────────────────────────────────────────────

describe("falsifier — a dangling cite is stored and counted, never dropped", () => {
  it("countCitations counts cites_dangling=1 for a stored dangling id and uncited ACs separately", async () => {
    const { store, ac, specId } = await setup();
    await ac.addCriterion(specId, AC("AC-C-3"));
    const res = await citeApi(ac).citeCriterion(specId, "AC-C-1", ["BR-404"], {});
    expect(res.ok).toBe(true);
    const after = await snapshot(store, specId);
    expect(after.criteria[0]?.cites, "dangling id must be STORED").toEqual(["BR-404"]);
    const countCitations = await loadCountCitations();
    expect(countCitations([after.doc], new Map())).toEqual({
      acs_total: 2,
      acs_citing: 1,
      acs_uncited: 1,
      cites_dangling: 1,
      cites_to_inactive: 0,
    });
  });
});

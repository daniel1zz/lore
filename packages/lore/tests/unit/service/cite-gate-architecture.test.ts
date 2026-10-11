/**
 * @spec_ref AC-BLS3-2
 * @task task-red-a-architecture-tree-and-as-ad-citation (RED; spec baseline-slice-3a, rule BR-980, owner decision D2)
 *
 * Citing (BL-5): a criterion may cite a business rule (BR-n) or an architecture standard rule (AS-n).
 * Citing a debt entry (AD-n) is refused with outcome code 4 and NOTHING is written; debt ids are named
 * only in a standard's current exceptions. A criterion citing only AS-n places its spec by that
 * standard's tree, without arming errors.
 *
 * CONTRACT (choices the spec leaves open; the implementation builds to exactly these):
 *   C1. `AC_CITE_ID_PATTERN` accepts BR-n and AS-n; AD-n is not a citable id.
 *   C2. The AD refusal is `err({ code: "AC_CITE_REQUIRED", message })` (the existing code the CLI maps to
 *       exit 4 via `exitCode()`); its message names the offending id. It is UNCONDITIONAL: it does not
 *       depend on the gate mode or on whether the spec's branch is armed (BR-980 states no condition),
 *       and it applies to every write path that carries cites: addCriterion, setCriterion, citeCriterion.
 *       Even a LIVE, registered AD-n (a debt entry that exists) is refused; so is a dangling AD-n.
 *   C3. "Nothing is written" = the spec's extra / version / status / version-log, the audit log and the
 *       ac_cites index are all byte-identical before and after the refused call.
 *   C4. A live AS-n is cited exactly like a live BR-n (same gate: retired / deprecated / dangling AS-n
 *       under enforce on an armed branch is refused with AC_CITE_REQUIRED; report mode records the
 *       would-refuse row and accepts).
 *   C5. Placement: `indexBaseline(docs).states` carries every AS-n rule's lifecycle; `branchOfRule`
 *       never maps an AS-n (architecture sections are not business branches), so a spec whose cites are
 *       all AS-n is "unplaced in any business branch" (`placeSpecInBranch` -> undefined) and a mixed
 *       spec is placed by its BR cites alone. Citing a live AS-n never produces an arming error: with
 *       every business branch armed the add is accepted.
 *
 * Dimensions: HAPPY (AS cite accepted under enforce+armed), NEGATIVE (AD refused, exit 4; retired /
 * deprecated / dangling AS refused), BOUNDARY (mixed BR+AD list, AD-999 dangling, AD that exists),
 * ERROR (nothing written), STATE (audit / ac_cites untouched), REGRESSION (BR path unchanged).
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { describe, it, expect } from "vitest";
import { ulid } from "ulidx";
import { DOC_TYPE_ROLE_MAP } from "@lore/core";
import type { CreateDocInput, DocId, DocRecord } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { AcService } from "../../../src/service/ac-service.js";
import { indexBaseline, placeSpecInBranch } from "../../../src/service/ac-cite-gate.js";
import { exitCode } from "../../../src/adapters/cli/utils.js";

type Mode = "off" | "report" | "enforce";
interface GateCfg {
  mode: Mode;
  armed_branches: string[];
}
type AnyResult = { ok: true; value: unknown } | { ok: false; error: { code: string; message?: string } };

const REFUSAL = "AC_CITE_REQUIRED";
const WOULD_REFUSE = "cite_gate_would_refuse";

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

async function insertBaseline(store: InMemoryStore, slug: string, extra: Record<string, unknown>, parentId: DocId | null): Promise<DocId> {
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

function gated(store: InMemoryStore, cfg: GateCfg | undefined): AcService {
  // MOCK RISK: none; only the 2nd constructor arg (the gate config) is cast past the type system.
  return new (AcService as unknown as new (s: InMemoryStore, o: unknown) => AcService)(store, { citeGate: cfg });
}

interface World {
  store: InMemoryStore;
  specId: string;
  /** A spec with NO criteria yet: its first (AS-only) criterion is the write under test. */
  freshSpecId: string;
  alphaSlug: string;
}

/**
 * Business: root -> alpha branch -> leaf (BR-1, BR-2 live).
 * Architecture: arch root -> standards section -> standard (AS-1 live, AS-2 retired, AS-3 deprecated)
 *               and a debt registry (AD-1 live).
 * Spec S (AC-S-1 cites BR-1, AC-S-2 uncited legacy); spec F has no criteria.
 */
async function world(): Promise<World> {
  const store = new InMemoryStore();
  const cs = new CorpusService(store, new RecordLockService(store));
  const root = await insertBaseline(store, "baseline-root", { node: "root" }, null);
  const alpha = await insertBaseline(store, "baseline-branch-alpha", { node: "branch" }, root);
  await insertBaseline(store, "baseline-leaf-alpha", { node: "leaf", rules: [rule("BR-1"), rule("BR-2")] }, alpha);

  const archRoot = await insertBaseline(store, "architecture-root", { tree: "architecture", node: "root" }, null);
  const section = await insertBaseline(store, "architecture-section-standards", { tree: "architecture", node: "section" }, archRoot);
  await insertBaseline(
    store, "architecture-standard-one",
    { tree: "architecture", node: "standard", rules: [rule("AS-1"), rule("AS-2", "retired"), rule("AS-3", "deprecated")] },
    section,
  );
  await insertBaseline(store, "architecture-debt-registry", { tree: "architecture", node: "debt-registry", rules: [rule("AD-1")] }, section);

  const prd = await cs.create({ type: "prd", title: "P", content: "root" } as CreateDocInput);
  if (!prd.ok) throw new Error("prd");
  const mk = async (title: string) => {
    const s = await cs.create({ type: "spec", title,content: "b" } as CreateDocInput);
    if (!s.ok) throw new Error("spec");
    return s.value.id as string;
  };
  const specId = await mk("Gate Subject");
  const plain = new AcService(store, new RecordLockService(store));
  for (const c of [AC("AC-S-1", { cites: ["BR-1"] }), AC("AC-S-2")]) {
    const a = await plain.addCriterion(specId, c);
    if (!a.ok) throw new Error(`seed ${JSON.stringify(a.error)}`);
  }
  return { store, specId, freshSpecId: await mk("Fresh Spec"), alphaSlug: "baseline-branch-alpha" };
}

const ENFORCE_ALPHA = (w: World): GateCfg => ({ mode: "enforce", armed_branches: [w.alphaSlug] });

async function fingerprint(store: InMemoryStore, id: string): Promise<string> {
  const d = await store.find(id as DocId);
  const v = await store.findVersions(id as DocId);
  const a = await store.queryAudit({ doc_id: id });
  const c = await store.listAcCites();
  if (!d.ok || d.value === null || !v.ok || !a.ok || !c.ok) throw new Error("fingerprint");
  return JSON.stringify({
    extra: d.value.extra, version: d.value.version, status: d.value.status,
    versions: v.value.length, audit: a.value.length, cites: c.value,
  });
}

function refusalOf(r: AnyResult): { code: string; message?: string } | null {
  return r.ok ? null : r.error;
}

async function citesOf(store: InMemoryStore, specId: string, acId: string): Promise<string[]> {
  const d = await store.find(specId as DocId);
  if (!d.ok || d.value === null) throw new Error("find");
  const acs = (d.value.extra["acceptance_criteria"] as Array<{ id: string; cites?: string[] }>) ?? [];
  return acs.find((a) => a.id === acId)?.cites ?? [];
}

// ─── The spec's describe ─────────────────────────────────────────────────────

describe("cite AS, refuse AD (BL-5)", () => {
  // ── AS is citable ──────────────────────────────────────────────────────────
  describe("a live AS-n is citable", () => {
    it("addCriterion citing a live AS-n is accepted under enforce on the armed branch", async () => {
      const w = await world();
      const res = await gated(w.store, ENFORCE_ALPHA(w)).addCriterion(w.specId, AC("AC-NEW-1", { cites: ["AS-1"] }));
      expect(res.ok).toBe(true);
    });

    it("the accepted AS cite is stored on the criterion", async () => {
      const w = await world();
      await gated(w.store, ENFORCE_ALPHA(w)).addCriterion(w.specId, AC("AC-NEW-1", { cites: ["AS-1"] }));
      expect(await citesOf(w.store, w.specId, "AC-NEW-1")).toEqual(["AS-1"]);
    });

    it("the accepted AS cite lands in the ac_cites index", async () => {
      const w = await world();
      await gated(w.store, ENFORCE_ALPHA(w)).addCriterion(w.specId, AC("AC-NEW-1", { cites: ["AS-1"] }));
      const rows = await w.store.listAcCites();
      expect(rows.ok && rows.value.filter((r) => r.ac_id === "AC-NEW-1").map((r) => r.rule_id)).toEqual(["AS-1"]);
    });

    it("citeCriterion (the `lore ac cite` path) adds a live AS-n next to the existing BR-1 with no warning", async () => {
      const w = await world();
      const res = await gated(w.store, ENFORCE_ALPHA(w)).citeCriterion(w.specId, "AC-S-2", ["AS-1"]);
      expect({ ok: res.ok, warnings: res.ok ? res.value.warnings : null }).toEqual({ ok: true, warnings: [] });
    });

    it("citeCriterion with a live AS-n persists it on that criterion only", async () => {
      const w = await world();
      await gated(w.store, ENFORCE_ALPHA(w)).citeCriterion(w.specId, "AC-S-2", ["AS-1"]);
      expect([await citesOf(w.store, w.specId, "AC-S-2"), await citesOf(w.store, w.specId, "AC-S-1")]).toEqual([["AS-1"], ["BR-1"]]);
    });

    it("setCriterion can re-point a criterion to a live AS-n", async () => {
      const w = await world();
      const res = await gated(w.store, ENFORCE_ALPHA(w)).setCriterion(w.specId, "AC-S-1", { cites: ["AS-1"] });
      expect(res.ok).toBe(true);
    });

    it("a mixed BR-1 + AS-1 cite list is accepted", async () => {
      const w = await world();
      const res = await gated(w.store, ENFORCE_ALPHA(w)).addCriterion(w.specId, AC("AC-NEW-1", { cites: ["BR-1", "AS-1"] }));
      expect(res.ok).toBe(true);
    });

    it("an AS cite is accepted under report and off modes as well (no refusal anywhere)", async () => {
      const w = await world();
      const report = await gated(w.store, { mode: "report", armed_branches: [w.alphaSlug] }).addCriterion(w.specId, AC("AC-R-1", { cites: ["AS-1"] }));
      const off = await gated(w.store, { mode: "off", armed_branches: [] }).addCriterion(w.specId, AC("AC-O-1", { cites: ["AS-1"] }));
      expect([report.ok, off.ok]).toEqual([true, true]);
    });

    it("report mode records NO would-refuse row for a live AS cite", async () => {
      const w = await world();
      await gated(w.store, { mode: "report", armed_branches: [w.alphaSlug] }).addCriterion(w.specId, AC("AC-R-1", { cites: ["AS-1"] }));
      const audit = await w.store.queryAudit({ doc_id: w.specId });
      expect(audit.ok && audit.value.filter((e) => (e.details as Record<string, unknown>)["operation"] === WOULD_REFUSE)).toHaveLength(0);
    });
  });

  // ── a non-live AS-n is gated like a non-live BR-n ──────────────────────────
  describe("a non-live AS-n is gated exactly like a non-live BR-n", () => {
    for (const [label, id] of [["retired", "AS-2"], ["deprecated", "AS-3"], ["dangling", "AS-999"]] as const) {
      it(`citing a ${label} ${id} is refused with ${REFUSAL} under enforce on the armed branch`, async () => {
        const w = await world();
        const res = await gated(w.store, ENFORCE_ALPHA(w)).addCriterion(w.specId, AC("AC-NEW-1", { cites: [id] }));
        expect(refusalOf(res)?.code).toBe(REFUSAL);
      });
    }

    it("report mode accepts a retired AS cite and records the would-refuse row", async () => {
      const w = await world();
      const res = await gated(w.store, { mode: "report", armed_branches: [w.alphaSlug] }).addCriterion(w.specId, AC("AC-R-1", { cites: ["AS-2"] }));
      const audit = await w.store.queryAudit({ doc_id: w.specId });
      const rows = audit.ok ? audit.value.filter((e) => (e.details as Record<string, unknown>)["operation"] === WOULD_REFUSE) : [];
      expect({ ok: res.ok, rows: rows.length }).toEqual({ ok: true, rows: 1 });
    });
  });

  // ── AD is refused ──────────────────────────────────────────────────────────
  describe("a debt entry AD-n is refused with outcome code 4 and nothing is written", () => {
    it("addCriterion citing a LIVE registered AD-1 is refused with AC_CITE_REQUIRED under enforce on the armed branch", async () => {
      const w = await world();
      const res = await gated(w.store, ENFORCE_ALPHA(w)).addCriterion(w.specId, AC("AC-NEW-1", { cites: ["AD-1"] }));
      expect(refusalOf(res)?.code).toBe(REFUSAL);
    });

    it("the refusal is AC_CITE_REQUIRED and maps to CLI exit code 4", async () => {
      const w = await world();
      const res = await gated(w.store, ENFORCE_ALPHA(w)).addCriterion(w.specId, AC("AC-NEW-1", { cites: ["AD-1"] }));
      expect({ code: res.ok ? "ok" : res.error.code, exit: res.ok ? null : exitCode(res.error) }).toEqual({ code: REFUSAL, exit: 4 });
    });

    it("the refusal message names the debt id", async () => {
      const w = await world();
      const res = await gated(w.store, ENFORCE_ALPHA(w)).addCriterion(w.specId, AC("AC-NEW-1", { cites: ["AD-1"] }));
      expect(refusalOf(res)?.message).toContain("AD-1");
    });

    it("a refused add leaves extra, version, status, version log, audit log and ac_cites untouched", async () => {
      const w = await world();
      const before = await fingerprint(w.store, w.specId);
      const res = await gated(w.store, ENFORCE_ALPHA(w)).addCriterion(w.specId, AC("AC-NEW-1", { cites: ["AD-1"] }));
      expect({ code: refusalOf(res)?.code, unchanged: (await fingerprint(w.store, w.specId)) === before }).toEqual({
        code: REFUSAL, unchanged: true,
      });
    });

    it("citeCriterion naming AD-1 is refused with AC_CITE_REQUIRED (exit 4) and writes nothing", async () => {
      const w = await world();
      const before = await fingerprint(w.store, w.specId);
      const res = await gated(w.store, ENFORCE_ALPHA(w)).citeCriterion(w.specId, "AC-S-2", ["AD-1"]);
      expect({
        code: res.ok ? "ok" : res.error.code,
        exit: res.ok ? null : exitCode(res.error),
        unchanged: (await fingerprint(w.store, w.specId)) === before,
      }).toEqual({ code: REFUSAL, exit: 4, unchanged: true });
    });

    it("the refusal does not depend on the gate: an UNGATED AcService refuses AD-1 on citeCriterion too", async () => {
      const w = await world();
      const before = await fingerprint(w.store, w.specId);
      const res = await new AcService(w.store, new RecordLockService(w.store)).citeCriterion(w.specId, "AC-S-2", ["AD-1"]);
      expect({ code: res.ok ? "ok" : res.error.code, unchanged: (await fingerprint(w.store, w.specId)) === before }).toEqual({
        code: REFUSAL, unchanged: true,
      });
    });

    it("the refusal does not depend on the mode: report and off modes refuse AD-1 on addCriterion as well", async () => {
      const w = await world();
      const report = await gated(w.store, { mode: "report", armed_branches: [w.alphaSlug] }).addCriterion(w.specId, AC("AC-R-1", { cites: ["AD-1"] }));
      const off = await gated(w.store, { mode: "off", armed_branches: [] }).addCriterion(w.specId, AC("AC-O-1", { cites: ["AD-1"] }));
      expect([refusalOf(report)?.code, refusalOf(off)?.code]).toEqual([REFUSAL, REFUSAL]);
    });

    it("setCriterion re-pointing a criterion to AD-1 is refused and the old cite stays", async () => {
      const w = await world();
      const res = await gated(w.store, ENFORCE_ALPHA(w)).setCriterion(w.specId, "AC-S-1", { cites: ["AD-1"] });
      expect({ code: refusalOf(res)?.code, cites: await citesOf(w.store, w.specId, "AC-S-1") }).toEqual({ code: REFUSAL, cites: ["BR-1"] });
    });

    it("a mixed list [BR-1, AD-1] is refused as a whole: the live BR-1 is not written either", async () => {
      const w = await world();
      const before = await fingerprint(w.store, w.specId);
      const res = await gated(w.store, ENFORCE_ALPHA(w)).addCriterion(w.specId, AC("AC-NEW-1", { cites: ["BR-1", "AD-1"] }));
      expect({ code: refusalOf(res)?.code, unchanged: (await fingerprint(w.store, w.specId)) === before }).toEqual({
        code: REFUSAL, unchanged: true,
      });
    });

    it("a dangling debt id AD-999 is refused the same way (the id family, not the registry, decides)", async () => {
      const w = await world();
      const res = await gated(w.store, ENFORCE_ALPHA(w)).citeCriterion(w.specId, "AC-S-2", ["AD-999"]);
      expect({ code: res.ok ? "ok" : res.error.code, exit: res.ok ? null : exitCode(res.error) }).toEqual({ code: REFUSAL, exit: 4 });
    });

    it("refusing AD-1 is not a blanket refusal: the same call with BR-2 is accepted (different input, different outcome)", async () => {
      const w = await world();
      const res = await gated(w.store, ENFORCE_ALPHA(w)).citeCriterion(w.specId, "AC-S-2", ["BR-2"]);
      expect(res.ok).toBe(true);
    });
  });

  // ── placement by the standard's tree, no arming errors ─────────────────────
  describe("a criterion citing only AS-n places its spec by that standard's tree", () => {
    async function indexOf(w: World) {
      const docs = await w.store.findMany({ type: "baseline" });
      return indexBaseline(docs.ok ? docs.value : []);
    }

    it("the gate index knows the lifecycle of every AS-n rule", async () => {
      const w = await world();
      const index = await indexOf(w);
      expect([index.states["AS-1"], index.states["AS-2"], index.states["AS-3"]]).toEqual(["live", "retired", "deprecated"]);
    });

    it("an AS-n rule belongs to no business branch (architecture sections are not branches)", async () => {
      const w = await world();
      expect((await indexOf(w)).branchOfRule.has("AS-1")).toBe(false);
    });

    it("a spec whose cites are all AS-n is placed in no business branch", async () => {
      const w = await world();
      expect(placeSpecInBranch([{ cites: ["AS-1"] }, { cites: ["AS-1"] }], await indexOf(w))).toBeUndefined();
    });

    it("a mixed spec is placed by its BR cites alone (an AS cite does not vote against or for a branch)", async () => {
      const w = await world();
      expect(placeSpecInBranch([{ cites: ["BR-1"] }, { cites: ["AS-1"] }, { cites: ["AS-1"] }], await indexOf(w))).toBe(w.alphaSlug);
    });

    it("the business branch is still the only branch the gate can arm", async () => {
      const w = await world();
      expect((await indexOf(w)).branches).toEqual([w.alphaSlug]);
    });

    it("an AS-only criterion on a fresh spec is accepted with every business branch armed (no arming error)", async () => {
      const w = await world();
      const res = await gated(w.store, ENFORCE_ALPHA(w)).addCriterion(w.freshSpecId, AC("AC-A-1", { cites: ["AS-1"] }));
      expect(res.ok).toBe(true);
    });

    it("an AS-only criterion on a fresh spec is accepted when no branch is armed", async () => {
      const w = await world();
      const res = await gated(w.store, { mode: "enforce", armed_branches: [] }).addCriterion(w.freshSpecId, AC("AC-A-1", { cites: ["AS-1"] }));
      expect(res.ok).toBe(true);
    });

    it("an AS-only criterion is stored with its cite (the spec is placed by it, not rewritten)", async () => {
      const w = await world();
      await gated(w.store, ENFORCE_ALPHA(w)).addCriterion(w.freshSpecId, AC("AC-A-1", { cites: ["AS-1"] }));
      expect(await citesOf(w.store, w.freshSpecId, "AC-A-1")).toEqual(["AS-1"]);
    });
  });

  // ── regression: the BR path is untouched ───────────────────────────────────
  describe("the business path is unchanged (regression)", () => {
    it("an uncited add on the armed branch is still refused with AC_CITE_REQUIRED", async () => {
      const w = await world();
      const res = await gated(w.store, ENFORCE_ALPHA(w)).addCriterion(w.specId, AC("AC-NEW-1"));
      expect(refusalOf(res)?.code).toBe(REFUSAL);
    });

    it("a live BR cite on the armed branch is still accepted", async () => {
      const w = await world();
      const res = await gated(w.store, ENFORCE_ALPHA(w)).addCriterion(w.specId, AC("AC-NEW-1", { cites: ["BR-2"] }));
      expect(res.ok).toBe(true);
    });

    it("a dangling BR-999 under enforce is still refused with AC_CITE_REQUIRED", async () => {
      const w = await world();
      const res = await gated(w.store, ENFORCE_ALPHA(w)).addCriterion(w.specId, AC("AC-NEW-1", { cites: ["BR-999"] }));
      expect(refusalOf(res)?.code).toBe(REFUSAL);
    });

    it("an id of an unknown family (XX-1) is still a schema refusal, not a citation", async () => {
      const w = await world();
      const res = await gated(w.store, ENFORCE_ALPHA(w)).addCriterion(w.specId, AC("AC-NEW-1", { cites: ["XX-1"] }));
      expect(res.ok).toBe(false);
    });
  });
});

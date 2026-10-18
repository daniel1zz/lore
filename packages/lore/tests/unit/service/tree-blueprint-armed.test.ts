// @reads lore.tree.yaml
/**
 * Regression oracles for the ARMED repo-root `lore.tree.yaml` blueprint (SPEC-032 T2).
 *
 * Unlike tree-check-service.test.ts (which exercises TreeCheckService against
 * synthetic, inline blueprints), this file loads the ACTUAL checked-in
 * `lore.tree.yaml` from the repo root and proves that its exact declared shape
 * — not a paraphrase of it — cannot pass by omission:
 *
 *   - a conformant fixture (every declared position populated) is consistent
 *   - a spec-less prd (min:1 unmet) is flagged `missing`
 *   - a doc placed at a structurally-invalid position is flagged `misplaced`
 *     (this is blueprint-INDEPENDENT — PARENT_TYPE_CONTRACT drives it — but
 *     re-proving it here pins the specific repo-root topology under test)
 *   - `task` is a LEAF: knowledge cannot live under a task (PARENT_TYPE_CONTRACT
 *     has no "task" entry for knowledge's allowed parents) — this is the
 *     "task is a LEAF type" invariant from SPEC-032 §3.2 v4
 *   - knowledge-under-knowledge is deliberately UNMODELED: the blueprint has no
 *     recursive knowledge->knowledge position, so a knowledge doc nested under
 *     another knowledge doc produces NO drift at all (neither missing/extra,
 *     since walkBlueprint never visits that position, nor misplaced, since
 *     PARENT_TYPE_CONTRACT.knowledge explicitly allows "knowledge" as a parent)
 *
 * A misconfigured blueprint (e.g. `min: 0` for the required spec slot, or a
 * missing knowledge-under-adr position) would flip these assertions from
 * "detects the defect" to "silently passes" — the tests are load-bearing.
 *
 * Six dimensions covered here: HAPPY / NEGATIVE / BOUNDARY / STATE (parse
 * shape pinning). ERROR / REGRESSION dimensions for the underlying mechanism
 * are already covered exhaustively by tree-check-service.test.ts; this file's
 * REGRESSION angle is narrower: it pins the *repo-root file's actual content*
 * against silent drift (e.g. someone loosening `min: 1` to `min: 0`).
 *
 * @spec_ref AC-2 (SPEC-032 T2)
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { TreeCheckService } from "../../../src/service/tree-check-service.js";
import type { DocRecord, DocId, DocType, TreeBlueprint } from "@lore/core";
import { DOC_TYPE_ROLE_MAP, parseTreeBlueprint } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

// ─── Locate + parse the REAL repo-root lore.tree.yaml ──────────────────────

const REPO_ROOT = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "..",
);
const BLUEPRINT_PATH = join(REPO_ROOT, "lore.tree.yaml");

let blueprint: TreeBlueprint;

beforeAll(() => {
  const raw = readFileSync(BLUEPRINT_PATH, "utf8");
  const parsed = parseTreeBlueprint(raw);
  if (!parsed.ok) {
    throw new Error(`repo-root lore.tree.yaml failed to parse: ${JSON.stringify(parsed.error)}`);
  }
  blueprint = parsed.value;
});

// ─── Helpers ────────────────────────────────────────────────────────────────

let idCounter = 0;
function makeId(): DocId {
  idCounter += 1;
  return `01TEST${String(idCounter).padStart(20, "0")}` as DocId;
}

async function seedDoc(
  store: InMemoryStore,
  partial: Partial<DocRecord> & { type: DocType; id: DocId },
): Promise<DocRecord> {
  const now = new Date().toISOString();
  const rec: DocRecord = {
    id: partial.id,
    slug: partial.slug ?? `${partial.type}-${partial.id.slice(-6).toLowerCase()}`,
    type: partial.type,
    role: DOC_TYPE_ROLE_MAP[partial.type],
    title: partial.title ?? "T",
    status: "draft",
    priority: "medium",
    content: "",
    parent_id: partial.parent_id ?? null,
    created_at: now,
    updated_at: now,
    created_by: "test",
    version: partial.version ?? 1,
    deleted_at: partial.deleted_at ?? null,
    tags: [],
    extra: partial.extra ?? {},
  };
  const r = await store.insert(rec);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

// ─── STATE — pin the parsed shape of the checked-in file ───────────────────

describe("repo-root lore.tree.yaml — parsed shape pinning (STATE)", () => {
  it("AC-2.SHAPE-01: root is prd with min normalized-away default (raw file has no root.min, defaults to 0)", () => {
    expect(blueprint.version).toBe(1);
    expect(blueprint.root.type).toBe("prd");
    // The raw file intentionally omits root.min — parseTreeBlueprint defaults it to 0.
    // (The CLI layer separately normalizes this to 1 at check-time; the parser itself
    // must NOT silently invent a 1 here — that would hide a real Zod-default regression.)
    expect(blueprint.root.min).toBe(0);
  });

  it("AC-2.SHAPE-02: prd's children include spec with min:1 (the load-bearing requirement)", () => {
    const specChild = blueprint.root.children.find((c) => c.type === "spec");
    expect(specChild).toBeDefined();
    expect(specChild?.min).toBe(1);
  });

  it("AC-2.SHAPE-03: spec's children include plan(min:0), adr(min:0), knowledge(min:0)", () => {
    const specChild = blueprint.root.children.find((c) => c.type === "spec")!;
    const childTypes = specChild.children.map((c) => c.type).sort();
    expect(childTypes).toEqual(["adr", "knowledge", "plan"]);
    for (const c of specChild.children) {
      expect(c.min).toBe(0);
    }
  });

  it("AC-2.SHAPE-04: plan-under-spec's children are exactly task(min:0) and knowledge(min:0) — task has NO children (LEAF)", () => {
    const specChild = blueprint.root.children.find((c) => c.type === "spec")!;
    const planChild = specChild.children.find((c) => c.type === "plan")!;
    expect(planChild).toBeDefined();
    const taskChild = planChild.children.find((c) => c.type === "task");
    const knowledgeChild = planChild.children.find((c) => c.type === "knowledge");
    expect(taskChild).toBeDefined();
    expect(knowledgeChild).toBeDefined();
    // task is a LEAF type: it must not declare its own children in the blueprint.
    expect(taskChild?.children).toHaveLength(0);
  });

  it("AC-2.SHAPE-05: adr (both root-level and under spec) declares exactly one child: knowledge(min:0)", () => {
    const rootAdr = blueprint.root.children.find((c) => c.type === "adr")!;
    expect(rootAdr).toBeDefined();
    expect(rootAdr.children).toHaveLength(1);
    expect(rootAdr.children[0]?.type).toBe("knowledge");

    const specChild = blueprint.root.children.find((c) => c.type === "spec")!;
    const nestedAdr = specChild.children.find((c) => c.type === "adr")!;
    expect(nestedAdr).toBeDefined();
    expect(nestedAdr.children).toHaveLength(1);
    expect(nestedAdr.children[0]?.type).toBe("knowledge");
  });

  it("AC-2.SHAPE-06: root-level children are exactly spec, adr, plan, knowledge, baseline (no duplicates, no extras)", () => {
    const types = blueprint.root.children.map((c) => c.type).sort();
    expect(types).toEqual(["adr", "baseline", "knowledge", "plan", "spec"]);
  });
});

// ─── HAPPY — a fully-nested conformant fixture is consistent ───────────────

describe("repo-root lore.tree.yaml — HAPPY", () => {
  it("AC-2.HAPPY-01: a fixture populating every declared position is consistent, zero drifts", async () => {
    const store = actedStore(new InMemoryStore());
    const svc = new TreeCheckService(store);

    const prd = await seedDoc(store, { id: makeId(), type: "prd" });
    const spec = await seedDoc(store, { id: makeId(), type: "spec" });
    const plan = await seedDoc(store, { id: makeId(), type: "plan", parent_id: spec.id });
    await seedDoc(store, { id: makeId(), type: "task", parent_id: plan.id });
    await seedDoc(store, { id: makeId(), type: "knowledge", parent_id: plan.id });
    const adrUnderSpec = await seedDoc(store, { id: makeId(), type: "adr", parent_id: spec.id });
    await seedDoc(store, { id: makeId(), type: "knowledge", parent_id: adrUnderSpec.id });
    await seedDoc(store, { id: makeId(), type: "knowledge", parent_id: spec.id });

    const rootAdr = await seedDoc(store, { id: makeId(), type: "adr", parent_id: prd.id });
    await seedDoc(store, { id: makeId(), type: "knowledge", parent_id: rootAdr.id });
    const rootPlan = await seedDoc(store, { id: makeId(), type: "plan", parent_id: prd.id });
    await seedDoc(store, { id: makeId(), type: "task", parent_id: rootPlan.id });
    await seedDoc(store, { id: makeId(), type: "knowledge", parent_id: rootPlan.id });
    await seedDoc(store, { id: makeId(), type: "knowledge", parent_id: prd.id });

    const result = await svc.checkTree(blueprint);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.drifts).toEqual([]);
    expect(result.value.consistent).toBe(true);
  });

  it("AC-2.HAPPY-02: minimal fixture (prd + one spec only) is ALSO consistent — different shape, still passes (defeats a hardcoded-true check)", async () => {
    const store = actedStore(new InMemoryStore());
    const svc = new TreeCheckService(store);
    const prd = await seedDoc(store, { id: makeId(), type: "prd" });
    await seedDoc(store, { id: makeId(), type: "spec" });

    const result = await svc.checkTree(blueprint);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.consistent).toBe(true);
  });
});

// ─── BOUNDARY — prd with zero specs (min:1 unmet) ──────────────────────────

describe("repo-root lore.tree.yaml — BOUNDARY (missing)", () => {
  it("AC-2.BND-01: prd with zero specs → exactly one `missing` drift for the spec slot", async () => {
    const store = actedStore(new InMemoryStore());
    const svc = new TreeCheckService(store);
    await seedDoc(store, { id: makeId(), type: "prd" });
    // No spec seeded at all.

    const result = await svc.checkTree(blueprint);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.consistent).toBe(false);

    const missing = result.value.drifts.filter((d) => d.kind === "missing");
    expect(missing).toHaveLength(1);
    expect(missing[0]?.expected?.type).toBe("spec");
    expect(missing[0]?.expected?.min).toBe(1);
  });

  it("AC-2.BND-02: prd with one spec satisfies min:1 exactly — no missing drift at the boundary", async () => {
    const store = actedStore(new InMemoryStore());
    const svc = new TreeCheckService(store);
    const prd = await seedDoc(store, { id: makeId(), type: "prd" });
    await seedDoc(store, { id: makeId(), type: "spec" });

    const result = await svc.checkTree(blueprint);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const missing = result.value.drifts.filter((d) => d.kind === "missing");
    expect(missing).toHaveLength(0);
  });
});

// ─── NEGATIVE — misplaced doc against the real blueprint's topology ───────

describe("repo-root lore.tree.yaml — NEGATIVE (misplaced)", () => {
  it("AC-2.NEG-00: a spec parented directly under the prd is misplaced — the blueprint's spec slot is \"no parent\" (BR-2, BR-400)", async () => {
    // re-baseline: the repo blueprint still DRAWS spec under prd, but a spec takes no parent, so a
    // spec that carries the prd as its parent is the defect, not the conformant shape.
    const store = actedStore(new InMemoryStore());
    const svc = new TreeCheckService(store);
    const prd = await seedDoc(store, { id: makeId(), type: "prd" });
    const parentedSpec = await seedDoc(store, { id: makeId(), type: "spec", parent_id: prd.id });

    const result = await svc.checkTree(blueprint);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.consistent).toBe(false);
    const misplaced = result.value.drifts.filter((d) => d.kind === "misplaced");
    expect(misplaced.map((d) => d.actual?.id)).toEqual([parentedSpec.id]);
  });

  it("AC-2.NEG-01: a spec parented under a plan → misplaced drift, non-conformant", async () => {
    const store = actedStore(new InMemoryStore());
    const svc = new TreeCheckService(store);
    const prd = await seedDoc(store, { id: makeId(), type: "prd" });
    const plan = await seedDoc(store, { id: makeId(), type: "plan", parent_id: prd.id });
    // Directly seed a spec under a plan — bypasses CorpusService's
    // isValidParentType create-time gate (confirmed: create/link both enforce
    // it; only raw store writes or the legacy migration path can produce this).
    const misplacedSpec = await seedDoc(store, { id: makeId(), type: "spec", parent_id: plan.id });

    const result = await svc.checkTree(blueprint);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.consistent).toBe(false);

    const misplaced = result.value.drifts.filter((d) => d.kind === "misplaced");
    expect(misplaced).toHaveLength(1);
    expect(misplaced[0]?.actual?.id).toBe(misplacedSpec.id);
  });

  it("AC-2.NEG-02: task is a LEAF — a knowledge doc parented under a task is misplaced (PARENT_TYPE_CONTRACT has no task entry for knowledge)", async () => {
    const store = actedStore(new InMemoryStore());
    const svc = new TreeCheckService(store);
    const prd = await seedDoc(store, { id: makeId(), type: "prd" });
    const spec = await seedDoc(store, { id: makeId(), type: "spec" });
    const plan = await seedDoc(store, { id: makeId(), type: "plan", parent_id: spec.id });
    const task = await seedDoc(store, { id: makeId(), type: "task", parent_id: plan.id });
    const orphanKnowledge = await seedDoc(store, {
      id: makeId(),
      type: "knowledge",
      parent_id: task.id,
    });

    const result = await svc.checkTree(blueprint);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.consistent).toBe(false);

    const misplaced = result.value.drifts.filter(
      (d) => d.kind === "misplaced" && d.actual?.id === orphanKnowledge.id,
    );
    expect(misplaced).toHaveLength(1);
  });

  it("AC-2.NEG-03: knowledge-under-knowledge is deliberately UNMODELED — produces ZERO drift (not misplaced, not missing/extra)", async () => {
    // PARENT_TYPE_CONTRACT.knowledge includes "knowledge" as a valid parent type,
    // so this is NOT a contract violation (no misplaced drift). The blueprint has
    // no recursive knowledge->knowledge position, so walkBlueprint never visits
    // it either (no missing/extra drift). This is the exact "deliberately NOT
    // modeled" behavior called out in SPEC-032 §3.2 — silence, not rejection.
    const store = actedStore(new InMemoryStore());
    const svc = new TreeCheckService(store);
    const prd = await seedDoc(store, { id: makeId(), type: "prd" });
    const spec = await seedDoc(store, { id: makeId(), type: "spec" });
    const parentKnowledge = await seedDoc(store, {
      id: makeId(),
      type: "knowledge",
      parent_id: spec.id,
    });
    const nestedKnowledge = await seedDoc(store, {
      id: makeId(),
      type: "knowledge",
      parent_id: parentKnowledge.id,
    });

    const result = await svc.checkTree(blueprint);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The corpus is otherwise conformant (prd + spec satisfy min:1); the nested
    // knowledge doc must contribute NO drift record referencing it at all.
    const anyDriftAboutNested = result.value.drifts.filter(
      (d) => d.actual?.id === nestedKnowledge.id,
    );
    expect(anyDriftAboutNested).toHaveLength(0);
    expect(result.value.consistent).toBe(true);
  });
});

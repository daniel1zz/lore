/**
 * @spec_ref AC-BLS2-19
 *
 * Rule BR-959 / issue #105: under `workflow.gates.ac-cite.mode: enforce` on an armed branch, an UNEXPIRED
 * exemption on (spec, ac) admits that criterion ending up UNCITED (e.g. its only citation was judged wrong
 * and is removed). It never admits a cite of a missing/deprecated/retired rule; an expired exemption admits
 * nothing; exemption scope is exactly (spec doc_id, ac_id).
 *
 * Real AcService + real SQLite store (throwaway temp corpus, never the repo's `.lore/`). Exemptions are seeded
 * through a second SQLiteStore handle on the same file, the way ac-exemptions.bun.test.ts races two handles.
 *
 * Dimensions: HAPPY (case 1), NEGATIVE (2, 3, 4, 5), BOUNDARY (expires_at == now), STATE (version unchanged).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LoreConfigSchema, type CreateDocInput } from "@lore/core";
import { createApp, type App } from "../../../src/app.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";

const PROJECT = { name: "exempt", author: "tester" };
const SKELETON = "## Overview/Goal\n\nx\n\n## Scope\n\nx\n\n## Acceptance Criteria\n\nx";
const PAST = "2020-01-01T00:00:00.000Z";
const FUTURE = "2999-01-01T00:00:00.000Z";

async function must<T>(r: { ok: boolean; value?: T; error?: unknown }, what: string): Promise<T> {
  if (!r.ok) throw new Error(`fixture ${what} failed: ${JSON.stringify(r.error)}`);
  return r.value as T;
}

const AC = (id: string, cites: string[]) => ({
  id,
  statement: `Does the thing ${id}`,
  verify: { mode: "script", oracle: "test", command: "bun test x" },
  cites,
});

let dir: string;
let app: App;
let side: SQLiteStore;
let specId: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "cite-gate-exempt-"));
  const config = LoreConfigSchema.parse({
    project: PROJECT,
    workflow: { gates: { "ac-cite": { mode: "enforce", armed_branches: ["baseline-exempt"] } } },
  });
  const made = createApp(join(dir, "c.db"), config);
  if ("ok" in made) throw new Error(`createApp failed: ${JSON.stringify(made)}`);
  app = made;
  side = new SQLiteStore(join(dir, "c.db"));
  const cs = app.corpusService;
  const rs = app.ruleService!;
  const prd = await must(await cs.create({ type: "prd", title: "Exempt product", content: "root" } as CreateDocInput), "prd");
  const root = await must(await rs.addNode(prd.id, { node: "root", label: "Root", title: "Exempt root", content: "r" }, { by: "agent:seed" }), "root");
  const branch = await must(
    await cs.create({
      type: "baseline", title: "Exempt branch", slug: "baseline-exempt", content: "b", parent_id: root.id,
      extra: { node: "branch", label: "Exempt branch", glossary: [{ term: "Ex", meaning: "Exemption" }] },
    } as CreateDocInput),
    "branch",
  );
  const leaf = await must(await rs.addNode(branch.id, { node: "leaf", label: "Leaf", title: "Exempt leaf", content: "l" }, { by: "agent:seed" }), "leaf");
  for (const statement of ["First rule", "Second rule"]) {
    await must(await rs.addRule(leaf.id, { statement, confidence: "established", enforced_by: "guaranteed", examples: ["e"] }, { by: "agent:seed" }), "rule");
  }
  const spec = await must(await cs.create({ type: "spec", title: "Exempt spec", content: SKELETON} as CreateDocInput), "spec");
  specId = spec.id;
  // Seed criteria while every cite is live (BR-1, BR-2 are the two rules just added).
  await must(await app.acService!.addCriterion(specId, AC("AC-E-1", ["BR-1"])), "AC-E-1");
  await must(await app.acService!.addCriterion(specId, AC("AC-E-2", ["BR-1"])), "AC-E-2");
});

afterEach(() => {
  side.close();
  app.close();
  rmSync(dir, { recursive: true, force: true });
});

async function exempt(acId: string, expiresAt: string, docId = specId): Promise<void> {
  const r = await side.insertAcExemptionCapped(
    { doc_id: docId, ac_id: acId, reason: "no rule yet", expires_at: expiresAt, granted_by: "agent:test", granted_at: PAST },
    { liveCriteria: 100, maxActive: 100, now: PAST },
  );
  if (!r.ok) throw new Error(`fixture exemption failed: ${JSON.stringify(r.error)}`);
}

async function version(): Promise<number> {
  const r = await app.corpusService.get(specId);
  return (await must(r as { ok: boolean; value?: { version: number } }, "get")).version;
}

async function citesOf(acId: string): Promise<string[] | undefined> {
  const r = await app.acService!.listCriteria(specId);
  const listed = await must(r as { ok: boolean; value?: { criteria: Array<{ id: string; cites?: string[] }> } }, "list");
  return listed.criteria.find((c) => c.id === acId)?.cites;
}

const removeSoleCite = (acId: string) => app.acService!.citeCriterion(specId, acId, ["BR-1"], { remove: true });

describe("cite gate admits exempted uncited criteria (#105)", () => {
  it("an unexpired exemption admits removing the criterion's only citation, leaving it uncited", async () => {
    await exempt("AC-E-1", FUTURE);
    const r = await removeSoleCite("AC-E-1");
    expect(r.ok ? "ok" : r.error.code).toBe("ok");
    expect((await citesOf("AC-E-1")) ?? []).toEqual([]);
  });

  it("an expired exemption admits nothing: AC_CITE_REQUIRED and the spec version is unchanged", async () => {
    await exempt("AC-E-1", PAST);
    const before = await version();
    const r = await removeSoleCite("AC-E-1");
    expect(!r.ok && r.error.code).toBe("AC_CITE_REQUIRED");
    expect(await version()).toBe(before);
    expect(await citesOf("AC-E-1")).toEqual(["BR-1"]);
  });

  it("with no exemption the removal is refused and nothing is written", async () => {
    const before = await version();
    const r = await removeSoleCite("AC-E-1");
    expect(!r.ok && r.error.code).toBe("AC_CITE_REQUIRED");
    expect(await version()).toBe(before);
    expect(await citesOf("AC-E-1")).toEqual(["BR-1"]);
  });

  it("an exempted criterion revised to cite a retired rule is refused and nothing is written", async () => {
    await must(await app.ruleService!.setRule("BR-2", { lifecycle: "retired", note: "gone" }, { by: "agent:seed" }), "retire BR-2");
    await exempt("AC-E-1", FUTURE);
    const before = await version();
    const r = await app.acService!.setCriterion(specId, "AC-E-1", { cites: ["BR-2"] });
    expect(r.ok ? "ok" : r.error.code).toMatch(/^(AC_CITE_REQUIRED|VALIDATION_ERROR)$/);
    expect(await version()).toBe(before);
    expect(await citesOf("AC-E-1")).toEqual(["BR-1"]);
  });

  it("an exemption on a different criterion of the same spec does not admit the target's removal", async () => {
    await exempt("AC-E-2", FUTURE);
    const before = await version();
    const r = await removeSoleCite("AC-E-1");
    expect(!r.ok && r.error.code).toBe("AC_CITE_REQUIRED");
    expect(await version()).toBe(before);
    expect(await citesOf("AC-E-1")).toEqual(["BR-1"]);
  });
});

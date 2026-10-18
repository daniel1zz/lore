/**
 * impact-service-standing.test.ts — AC-DR-6: `ImpactService.impact(BR-n)` splits what a change touches into
 * `living` (the rule's leaf + dependent leaves, editable in place) and `records` (the citing spec criteria,
 * locked once approved), additively beside the unchanged `citingCriteria` / `dependentLeaves` / `cycles`.
 *
 * Spec: spec-documents-are-living-or-records-a-locked-record-is-never D7; BR-1051, BR-1052.
 * Dimensions: HAPPY (split), NEGATIVE (unknown rule), BOUNDARY (uncited rule, no dependents), REGRESSION (old fields).
 */

import { describe, expect, it } from "vitest";
import { ulid } from "ulidx";
import { DOC_TYPE_ROLE_MAP } from "@lore/core";
import type { DocId, DocRecord } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { ImpactService } from "../../../src/service/impact-service.js";
import { actedStore } from "../../live-invocation.js";

function rule(id: string, statement: string) {
  return { id, statement, confidence: "established", enforced_by: "both", examples: ["example"], lifecycle: "live" };
}

async function insertDoc(store: InMemoryStore, over: Partial<DocRecord> & Pick<DocRecord, "type" | "slug">) {
  const now = new Date().toISOString();
  const doc = {
    id: ulid() as DocId,
    title: over.slug,
    status: "draft",
    priority: "medium",
    content: "body",
    parent_id: null,
    created_at: now,
    updated_at: now,
    created_by: "test",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
    role: DOC_TYPE_ROLE_MAP[over.type],
    ...over,
  } as DocRecord;
  const r = await store.insert(doc);
  if (!r.ok) throw new Error(`insert failed: ${JSON.stringify(r.error)}`);
}

const leaf = (store: InMemoryStore, slug: string, rules: ReturnType<typeof rule>[], dependsOn: string[] = []) =>
  insertDoc(store, {
    type: "baseline",
    slug,
    extra: { node: "leaf", rules, ...(dependsOn.length ? { depends_on: dependsOn } : {}) },
  });

const spec = (store: InMemoryStore, slug: string, acId: string, cites: string[]) =>
  insertDoc(store, {
    type: "spec",
    slug,
    extra: {
      acceptance_criteria: [
        { id: acId, statement: `criterion ${acId}`, verify: { mode: "script", oracle: "test", command: "bun test x" }, cites },
      ],
    },
  });

async function fixture(): Promise<InMemoryStore> {
  const store = actedStore(new InMemoryStore());
  await leaf(store, "leaf-a", [rule("BR-x", "Orders must be idempotent")]);
  await leaf(store, "leaf-b", [rule("BR-b", "B rule")], ["BR-x"]);
  await spec(store, "spec-one", "AC-1", ["BR-x"]);
  await spec(store, "spec-two", "AC-7", ["BR-x"]);
  return store;
}

describe("ImpactService standing split (AC-DR-6)", () => {
  it("AC-DR-6 returns living = [leaf, dependent leaf] and records = the two citing {slug, acId} pairs", async () => {
    const r = await new ImpactService(await fixture()).impact("BR-x");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.living).toEqual(["leaf-a", "leaf-b"]);
    expect(r.value.records).toEqual([
      { slug: "spec-one", acId: "AC-1" },
      { slug: "spec-two", acId: "AC-7" },
    ]);
  });

  it("AC-DR-6 keeps citingCriteria, dependentLeaves and cycles unchanged", async () => {
    const r = await new ImpactService(await fixture()).impact("BR-x");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // reason: citingCriteria keeps the cite-index row order (unchanged, unsorted), so compare order-insensitively.
    expect([...r.value.citingCriteria].sort((a, b) => a.spec.localeCompare(b.spec))).toEqual([
      { spec: "spec-one", ac: "AC-1" },
      { spec: "spec-two", ac: "AC-7" },
    ]);
    expect(r.value.dependentLeaves).toEqual(["leaf-b"]);
    expect(r.value.cycles).toEqual([]);
  });

  it("AC-DR-6 an uncited rule with no dependents has living = [its leaf] and records = []", async () => {
    const store = actedStore(new InMemoryStore());
    await leaf(store, "solo", [rule("BR-s", "Solo rule")]);
    const r = await new ImpactService(store).impact("BR-s");
    expect(r.ok && r.value.living).toEqual(["solo"]);
    expect(r.ok && r.value.records).toEqual([]);
  });

  it("AC-DR-6 an unknown rule is DOC_NOT_FOUND", async () => {
    const r = await new ImpactService(await fixture()).impact("BR-nope");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("DOC_NOT_FOUND");
  });
});

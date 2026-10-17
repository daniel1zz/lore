// @layer service-rule-find-anchor-suffix
/**
 * find({file}) strips a `#Symbol` suffix on code anchors (and on the query) before comparing paths.
 * @spec_ref AC-BLS2-6
 */
import { describe, it, expect } from "vitest";
import { ulid } from "ulidx";
import { DOC_TYPE_ROLE_MAP } from "@lore/core";
import type { DocId, DocRecord } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { RuleReadService } from "../../../src/service/rule-read-service.js";

async function put(store: InMemoryStore, type: "baseline" | "spec", slug: string, extra: Record<string, unknown>) {
  const now = new Date().toISOString();
  const r = await store.insert({
    id: ulid() as DocId,
    type,
    slug,
    title: slug,
    status: "draft",
    priority: "medium",
    content: "b",
    parent_id: null,
    created_at: now,
    updated_at: now,
    created_by: "t",
    version: 1,
    deleted_at: null,
    tags: [],
    extra,
    role: DOC_TYPE_ROLE_MAP[type],
  } as DocRecord);
  if (!r.ok) throw new Error("insert failed");
}

describe("rule find by file with #Symbol anchors (AC-BLS2-6)", () => {
  it("matches an anchor carrying a #Symbol suffix, and ranks by citation count then id", async () => {
    const store = new InMemoryStore();
    const rule = (id: string) => ({ id, statement: `s ${id}`, confidence: "established", enforced_by: "both", examples: ["e"], lifecycle: "live" });
    await put(store, "baseline", "leaf", { node: "leaf", rules: [rule("BR-2"), rule("BR-10")] });
    const ac = (id: string, cites: string[]) => ({ id, statement: id, verify: { mode: "script", oracle: "test", command: "x" }, cites });
    await put(store, "spec", "s1", {
      acceptance_criteria: [ac("AC-1", ["BR-10"]), ac("AC-2", ["BR-10", "BR-2"])],
      code_anchors: ["src/a.ts#Foo"],
    });
    const svc = new RuleReadService(store);
    const hit = await svc.find({ file: "src/a.ts" });
    expect(hit.ok && hit.value).toEqual(["BR-10", "BR-2"]);
    const hit2 = await svc.find({ file: "src/a.ts#Bar" });
    expect(hit2.ok && hit2.value).toEqual(["BR-10", "BR-2"]);
    const miss = await svc.find({ file: "src/b.ts" });
    expect(miss.ok && miss.value).toEqual([]);
  });
});

/**
 * Recorded governing-spec resolution (BR-1494, BR-1495): an ad-hoc task resolves its criteria
 * through `extra.governing_spec` only; a deprecated spec and a superseded criterion still resolve.
 */
import { describe, it, expect } from "vitest";
import { checkScopeDeclaredOnSpec, extractGoverningSpecRef, resolveRecordedGoverningSpec } from "../../src/acceptance.js";
import type { DocRecord } from "../../src/types.js";

function doc(slug: string, type: string, status: string, extra: Record<string, unknown>): DocRecord {
  return {
    id: slug.toUpperCase(), slug, type, role: type, title: slug, status, priority: "medium", content: "",
    parent_id: null, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    created_by: "t", version: 1, deleted_at: null, tags: [], extra,
  } as unknown as DocRecord;
}

const crit = (id: string, extra: Record<string, unknown> = {}) => ({ id, statement: "s", verify: { mode: "human" }, ...extra });
const first = doc("first", "spec", "approved", { acceptance_criteria: [crit("AC-X-1")] });
const second = doc("second", "spec", "approved", { acceptance_criteria: [crit("AC-X-1")] });
const old = doc("old", "spec", "deprecated", {
  acceptance_criteria: [crit("AC-Y-1"), crit("AC-Z-1", { superseded_by: { spec: "first", ac: "AC-X-1", reason: "moved", by: "t", at: "2026-01-01T00:00:00.000Z" } })],
});
const task = (extra: Record<string, unknown>) => doc("t", "task", "approved", { adhoc: true, ...extra });

describe("resolveRecordedGoverningSpec", () => {
  it("HAPPY: two specs declare AC-X-1; the recorded one wins, by slug or by id", () => {
    for (const ref of ["first", "FIRST"]) {
      const r = resolveRecordedGoverningSpec(task({ governing_spec: ref }), [second, first], "t");
      expect(r.ok && r.value.spec.slug).toBe("first");
    }
  });
  it("BOUNDARY: a deprecated spec resolves AC-Y-1 and its superseded AC-Z-1 (BR-1494)", () => {
    const r = resolveRecordedGoverningSpec(task({ governing_spec: "old" }), [first, old], "t");
    expect(r.ok && r.value.criteria.map((c) => c.id)).toEqual(["AC-Y-1", "AC-Z-1"]);
  });
  it("NEGATIVE: no recorded spec refuses naming `lore scope spec`; there is no lookup by scope id", () => {
    const r = resolveRecordedGoverningSpec(task({ ac_scope: ["AC-X-1"] }), [first], "t");
    expect(!r.ok && JSON.stringify(r.error)).toContain("lore scope spec");
  });
  it("NEGATIVE: a recorded spec that is not in the corpus refuses", () => {
    expect(resolveRecordedGoverningSpec(task({ governing_spec: "gone" }), [first], "t").ok).toBe(false);
  });
  it("extractGoverningSpecRef ignores a blank or non-string value", () => {
    expect(extractGoverningSpecRef(task({ governing_spec: "" }))).toBeUndefined();
    expect(extractGoverningSpecRef(task({ governing_spec: 3 }))).toBeUndefined();
  });
});

describe("checkScopeDeclaredOnSpec", () => {
  it("HAPPY: declared ids, superseded included, pass", () => {
    expect(checkScopeDeclaredOnSpec(["AC-Y-1", "AC-Z-1"], old, "t").ok).toBe(true);
  });
  it("NEGATIVE: an undeclared id is refused naming the declared ids", () => {
    const r = checkScopeDeclaredOnSpec(["AC-Q-9"], first, "t");
    expect(!r.ok && JSON.stringify(r.error)).toMatch(/AC-Q-9.*AC-X-1/);
  });
});

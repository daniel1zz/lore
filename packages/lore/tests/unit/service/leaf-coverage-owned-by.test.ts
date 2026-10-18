// @layer service-leaf-coverage AC-SMM-3
/**
 * AC-SMM-3: a site excused only by `non-business:owned-by <leaf> BR-n — <reason>` is covered only while
 * that leaf still resolves to a leaf and every named rule is live on it. Pure: no store.
 * @spec_ref AC-SMM-3
 */
import { describe, it, expect } from "vitest";
import { computeLeafCoverage } from "../../../src/service/leaf-coverage.js";
import { buildOwnerLeafIndex } from "../../../src/service/owned-by.js";

const site = { key: "a.ts#f#X", file: "a.ts", symbol: "f", code: "X", dynamic: false } as const;
const entry = "non-business:owned-by owner-leaf BR-7 — handled there";
const rule = (id: string, lifecycle: string) => ({ id, lifecycle });
const leafDoc = (id: string, slug: string, rules: Array<{ id: string; lifecycle: string }>, node = "leaf") => ({ id, slug, extra: { node, rules } });

function gaps(docs: ReturnType<typeof leafDoc>[], e = entry): string[] {
  return computeLeafCoverage({
    sites: [site], siteMap: { [site.key]: [e] }, liveRuleIds: [], ownerLeaves: buildOwnerLeafIndex(docs),
  }).gaps;
}

describe("computeLeafCoverage owned-by entries (AC-SMM-3)", () => {
  it("is not a gap while the named rule is live on the named leaf (slug and id)", () => {
    const docs = [leafDoc("ID-1", "owner-leaf", [rule("BR-7", "live")])];
    expect(gaps(docs)).toEqual([]);
    expect(gaps(docs, "non-business:owned-by ID-1 BR-7 — r")).toEqual([]);
  });
  it("is a gap when the named rule was retired", () => {
    expect(gaps([leafDoc("ID-1", "owner-leaf", [rule("BR-7", "retired")])])).toEqual([site.key]);
  });
  it("is a gap when the named rule moved to another leaf (rule exists, live, elsewhere)", () => {
    expect(gaps([leafDoc("ID-1", "owner-leaf", []), leafDoc("ID-2", "else", [rule("BR-7", "live")])])).toEqual([site.key]);
  });
  it("is a gap when the owner leaf was deleted or renamed (no such slug)", () => {
    expect(gaps([])).toEqual([site.key]);
    expect(gaps([leafDoc("ID-1", "renamed-leaf", [rule("BR-7", "live")])])).toEqual([site.key]);
  });
  it("is a gap when the owner is no longer a leaf", () => {
    expect(gaps([leafDoc("ID-1", "owner-leaf", [rule("BR-7", "live")], "branch")])).toEqual([site.key]);
  });
  it("is a gap when only one of several named rules is no longer live", () => {
    const docs = [leafDoc("ID-1", "owner-leaf", [rule("BR-7", "live"), rule("BR-8", "retired")])];
    expect(gaps(docs, "non-business:owned-by owner-leaf BR-7 BR-8 — r")).toEqual([site.key]);
  });
  it("is a gap when the lookup is absent (an owned-by entry cannot be judged blind)", () => {
    const r = computeLeafCoverage({ sites: [site], siteMap: { [site.key]: [entry] }, liveRuleIds: [] });
    expect(r.gaps).toEqual([site.key]);
  });
  it("a plain non-business reason stays accounted for with no lookup (control)", () => {
    const r = computeLeafCoverage({ sites: [site], siteMap: { [site.key]: ["non-business:start-up wiring"] }, liveRuleIds: [] });
    expect(r.ok).toBe(true);
  });
  it("a live own rule next to a stale owned-by still accounts for the site", () => {
    const r = computeLeafCoverage({ sites: [site], siteMap: { [site.key]: [entry, "BR-1"] }, liveRuleIds: ["BR-1"], ownerLeaves: buildOwnerLeafIndex([]) });
    expect(r.ok).toBe(true);
  });
});

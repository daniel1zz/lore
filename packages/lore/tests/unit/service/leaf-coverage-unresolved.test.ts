/**
 * computeLeafCoverage treats a census with unresolved imports as INCOMPLETE (issue #94):
 * never a smaller site list presented as complete.
 * @spec_ref AC-BLS2-15
 */
import { describe, it, expect } from "vitest";
import { computeLeafCoverage } from "../../../src/service/leaf-coverage.js";

const site = { key: "a.ts#f#X", file: "a.ts", symbol: "f", code: "X", dynamic: false } as const;
const mapped = { "a.ts#f#X": ["BR-1"] };

describe("computeLeafCoverage with unresolved imports (#94)", () => {
  it("is NOT ok and names the specifier and importing file, even when every site is mapped", () => {
    const r = computeLeafCoverage({
      sites: [site],
      siteMap: mapped,
      liveRuleIds: ["BR-1"],
      unresolvedImports: [{ specifier: "@lore/core", from: "x/y.ts" }],
    });
    expect(r.ok).toBe(false);
    expect(r.unresolvedImports).toEqual(["@lore/core (from x/y.ts)"]);
    expect(r.gaps).toEqual([]);
  });

  it("stays ok, with no unresolvedImports key, when none are reported (control)", () => {
    const r = computeLeafCoverage({ sites: [site], siteMap: mapped, liveRuleIds: ["BR-1"], unresolvedImports: [] });
    expect(r).toEqual({ gaps: [], notMeasured: [], ok: true });
  });
});

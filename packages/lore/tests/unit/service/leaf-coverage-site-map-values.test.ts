/**
 * findCorruptSiteMapValues (spec-baseline-coverage-refuses-only-undeclared-commands-a-site, BR-1248): a stored site_map value
 * that is not a `BR-n` id is corrupt data, named by leaf, site and value. Dimensions: HAPPY (only BR-n -> none) / NEGATIVE
 * (free text, owned-by text, an empty string, a lower-case id each corrupt) / BOUNDARY (one BR-n next to a bad value in the
 * same entry) / ERROR-free by design (pure).
 */
import { describe, expect, it } from "vitest";
import { findCorruptSiteMapValues } from "../../../src/service/leaf-coverage.js";

describe("findCorruptSiteMapValues", () => {
  it("HAPPY: a map of BR-n ids only is not corrupt", () => {
    expect(findCorruptSiteMapValues("leaf", { "a.ts#f#X": ["BR-1"], "b.ts#g#Y": ["BR-2", "BR-30"] })).toEqual([]);
  });

  it("NEGATIVE: free text, owned-by text, an empty value and a lower-case id are each reported with leaf, site and value", () => {
    const map = { "a.ts#f#X": ["non-business: x"], "b.ts#g#Y": ["non-business:owned-by other BR-1 — why"], "c.ts#h#Z": [""], "d.ts#i#W": ["br-1"] };
    expect(findCorruptSiteMapValues("leaf", map)).toEqual([
      { leaf: "leaf", site: "a.ts#f#X", value: "non-business: x" },
      { leaf: "leaf", site: "b.ts#g#Y", value: "non-business:owned-by other BR-1 — why" },
      { leaf: "leaf", site: "c.ts#h#Z", value: "" },
      { leaf: "leaf", site: "d.ts#i#W", value: "br-1" },
    ]);
  });

  it("BOUNDARY: a BR-n id beside a bad value in one entry reports only the bad value", () => {
    expect(findCorruptSiteMapValues("leaf", { "a.ts#f#X": ["BR-1", "BR-1 extra"] })).toEqual([{ leaf: "leaf", site: "a.ts#f#X", value: "BR-1 extra" }]);
  });
});

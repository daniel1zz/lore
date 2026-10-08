/**
 * RED test: completeness census (listSites) + leaf coverage (computeLeafCoverage).
 * Fixture: packages/lore/tests/fixtures/site-census/ — runCommand -> Service.process with
 * 3 `return err({code})` sites, 1 gate-predicate failure, 1 registry-lookup call (dynamic).
 * Covers HAPPY / NEGATIVE / BOUNDARY / STATE.
 * @spec_ref AC-BLS2-5
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listSites } from "../../../src/service/site-census.js";
import { computeLeafCoverage } from "../../../src/service/leaf-coverage.js";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/site-census",
);
const entry = { file: "command.ts", symbol: "runCommand" };

const KEYED = [
  "service.ts#Service.process#NEGATIVE_INPUT",
  "service.ts#Service.process#ZERO_INPUT",
  "service.ts#Service.process#TOO_LARGE",
  "service.ts#Service.process#GATE_NOT_READY",
];
const LIVE = ["BR-001", "BR-002", "BR-003"];

describe("listSites (census)", () => {
  it("lists exactly the 4 keyed err/gate sites reached from the entry", () => {
    const keys = listSites({ rootDir, entry })
      .filter((s) => !s.dynamic)
      .map((s) => s.key)
      .sort();
    expect(keys).toEqual([...KEYED].sort());
  });

  it("reports the registry-lookup call as exactly 1 dynamic (not_measured) site", () => {
    const dyn = listSites({ rootDir, entry }).filter((s) => s.dynamic);
    expect(dyn).toHaveLength(1);
    expect(dyn[0].file).toBe("service.ts");
  });

  it("each keyed site has key === file#symbol#code", () => {
    for (const s of listSites({ rootDir, entry }).filter((x) => !x.dynamic)) {
      expect(s.key).toBe(`${s.file}#${s.symbol}#${s.code}`);
    }
  });

  it("an entry that calls nothing yields no sites (different input, different output)", () => {
    expect(
      listSites({ rootDir, entry: { file: "service.ts", symbol: "isReady" } }),
    ).toEqual([]);
  });
});

describe("computeLeafCoverage", () => {
  const sites = () => listSites({ rootDir, entry });
  const dynKey = () => sites().find((s) => s.dynamic)!.key;

  it("3 of 4 mapped -> exactly 1 gap, 1 not_measured, ok=false", () => {
    const siteMap = {
      [KEYED[0]]: ["BR-001"],
      [KEYED[1]]: ["BR-002"],
      [KEYED[2]]: ["BR-003"],
    };
    const r = computeLeafCoverage({ sites: sites(), siteMap, liveRuleIds: LIVE });
    expect(r.gaps).toEqual([KEYED[3]]);
    expect(r.notMeasured).toEqual([dynKey()]);
    expect(r.ok).toBe(false);
  });

  it("a site mapped only to a retired rule id counts as a gap", () => {
    const siteMap = {
      [KEYED[0]]: ["BR-001"],
      [KEYED[1]]: ["BR-002"],
      [KEYED[2]]: ["BR-003"],
      [KEYED[3]]: ["BR-999"],
      [dynKey()]: ["non-business:registry dispatch"],
    };
    const r = computeLeafCoverage({ sites: sites(), siteMap, liveRuleIds: LIVE });
    expect(r.gaps).toEqual([KEYED[3]]);
    expect(r.ok).toBe(false);
  });

  it("all mapped + dynamic justified with non-business:<reason> -> ok=true", () => {
    const siteMap = {
      [KEYED[0]]: ["BR-001"],
      [KEYED[1]]: ["BR-002"],
      [KEYED[2]]: ["BR-003"],
      [KEYED[3]]: ["BR-001"],
      [dynKey()]: ["non-business:registry dispatch"],
    };
    const r = computeLeafCoverage({ sites: sites(), siteMap, liveRuleIds: LIVE });
    expect(r).toEqual({ gaps: [], notMeasured: [], ok: true });
  });

  it("all keyed mapped but dynamic unjustified -> not_measured remains, ok=false", () => {
    const siteMap = Object.fromEntries(KEYED.map((k) => [k, ["BR-001"]]));
    const r = computeLeafCoverage({ sites: sites(), siteMap, liveRuleIds: LIVE });
    expect(r.gaps).toEqual([]);
    expect(r.notMeasured).toEqual([dynKey()]);
    expect(r.ok).toBe(false);
  });
});

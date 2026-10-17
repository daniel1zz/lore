// @reads package.json
// @reads packages/**
// @reads tsconfig.json
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

interface Site {
  key: string;
  file: string;
  symbol: string;
  code?: string;
  dynamic: boolean;
}
interface CensusApi {
  listSites(input: { rootDir: string; entry: { file: string; symbol: string } }): Site[];
}
interface CoverageApi {
  computeLeafCoverage(input: {
    sites: Site[];
    siteMap: Record<string, string[]>;
    liveRuleIds: string[];
  }): { gaps: string[]; notMeasured: string[]; ok: boolean };
}

// Variable specifiers: the modules do not exist yet; the file must still load and typecheck.
const CENSUS_MODULE = "../../../src/service/site-census.js";
const COVERAGE_MODULE = "../../../src/service/leaf-coverage.js";

async function loadFn<T>(modulePath: string, name: string): Promise<T> {
  let mod: Record<string, unknown>;
  try {
    mod = (await import(/* @vite-ignore */ modulePath)) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`MISSING BEHAVIOUR: module ${modulePath} not found (${String(e)})`);
  }
  const fn = mod[name];
  if (typeof fn !== "function") {
    throw new Error(`MISSING BEHAVIOUR: ${modulePath} does not export ${name}`);
  }
  return mod as T;
}
const loadCensus = () => loadFn<CensusApi>(CENSUS_MODULE, "listSites");
const loadCoverage = () => loadFn<CoverageApi>(COVERAGE_MODULE, "computeLeafCoverage");

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
] as const;
const LIVE = ["BR-001", "BR-002", "BR-003"];

describe("listSites (census)", () => {
  it("lists exactly the 4 keyed err/gate sites reached from the entry", async () => {
    const { listSites } = await loadCensus();
    const keys = listSites({ rootDir, entry })
      .filter((s) => !s.dynamic)
      .map((s) => s.key)
      .sort();
    expect(keys).toEqual([...KEYED].sort());
  });

  it("reports the registry-lookup call as exactly 1 dynamic (not_measured) site", async () => {
    const { listSites } = await loadCensus();
    const dyn = listSites({ rootDir, entry }).filter((s) => s.dynamic);
    expect(dyn).toHaveLength(1);
    expect(dyn[0]!.file).toBe("service.ts");
  });

  it("each keyed site has key === file#symbol#code", async () => {
    const { listSites } = await loadCensus();
    for (const s of listSites({ rootDir, entry }).filter((x) => !x.dynamic)) {
      expect(s.key).toBe(`${s.file}#${s.symbol}#${s.code}`);
    }
  });

  it("an entry that calls nothing yields no sites (different input, different output)", async () => {
    const { listSites } = await loadCensus();
    expect(
      listSites({ rootDir, entry: { file: "service.ts", symbol: "isReady" } }),
    ).toEqual([]);
  });
});

describe("computeLeafCoverage", () => {
  const setup = async () => {
    const { listSites } = await loadCensus();
    const { computeLeafCoverage } = await loadCoverage();
    const sites = listSites({ rootDir, entry });
    const dynKey = sites.find((s) => s.dynamic)!.key;
    return { computeLeafCoverage, sites, dynKey };
  };

  it("3 of 4 mapped -> exactly 1 gap, 1 not_measured, ok=false", async () => {
    const { computeLeafCoverage, sites, dynKey } = await setup();
    const siteMap = {
      [KEYED[0]]: ["BR-001"],
      [KEYED[1]]: ["BR-002"],
      [KEYED[2]]: ["BR-003"],
    };
    const r = computeLeafCoverage({ sites, siteMap, liveRuleIds: LIVE });
    expect(r.gaps).toEqual([KEYED[3]]);
    expect(r.notMeasured).toEqual([dynKey]);
    expect(r.ok).toBe(false);
  });

  it("a site mapped only to a retired rule id counts as a gap", async () => {
    const { computeLeafCoverage, sites, dynKey } = await setup();
    const siteMap = {
      [KEYED[0]]: ["BR-001"],
      [KEYED[1]]: ["BR-002"],
      [KEYED[2]]: ["BR-003"],
      [KEYED[3]]: ["BR-999"],
      [dynKey]: ["non-business:registry dispatch"],
    };
    const r = computeLeafCoverage({ sites, siteMap, liveRuleIds: LIVE });
    expect(r.gaps).toEqual([KEYED[3]]);
    expect(r.ok).toBe(false);
  });

  it("all mapped + dynamic justified with non-business:<reason> -> ok=true", async () => {
    const { computeLeafCoverage, sites, dynKey } = await setup();
    const siteMap = {
      [KEYED[0]]: ["BR-001"],
      [KEYED[1]]: ["BR-002"],
      [KEYED[2]]: ["BR-003"],
      [KEYED[3]]: ["BR-001"],
      [dynKey]: ["non-business:registry dispatch"],
    };
    const r = computeLeafCoverage({ sites, siteMap, liveRuleIds: LIVE });
    expect(r).toEqual({ gaps: [], notMeasured: [], ok: true });
  });

  it("all keyed mapped but dynamic unjustified -> not_measured remains, ok=false", async () => {
    const { computeLeafCoverage, sites, dynKey } = await setup();
    const siteMap = Object.fromEntries(KEYED.map((k) => [k, ["BR-001"]]));
    const r = computeLeafCoverage({ sites, siteMap, liveRuleIds: LIVE });
    expect(r.gaps).toEqual([]);
    expect(r.notMeasured).toEqual([dynKey]);
    expect(r.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Census fidelity (task-skill-test-red-census-interface-dispatch-bootstrap-list)
// Spec C1/C2: a site reached only through dynamic dispatch (an interface-typed call) is
// reported as not_measured, never silently dropped; app-bootstrap symbols on the shared
// non-business list are reported in a separate `bootstrap` list, not as gaps.
// ─────────────────────────────────────────────────────────────────────────────

const ifaceRoot = path.join(rootDir, "iface");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const NONBUSINESS_MODULE = "../../../src/service/site-census-nonbusiness.js";

/** A listSites result: the main site list, optionally carrying a `bootstrap` list. */
type CensusResult = Site[] & { bootstrap?: Site[] };
interface FidelityApi {
  listSites(input: { rootDir: string; entry: { file: string; symbol: string } }): CensusResult;
  resolveCommandEntry(input: { rootDir: string; command: string }): { file: string; symbol: string };
}
const loadFidelity = () => loadFn<FidelityApi>(CENSUS_MODULE, "listSites");

/** Main list of a result; tolerates `{ sites, bootstrap }` as well as an array carrying `.bootstrap`. */
function mainSites(r: unknown): Site[] {
  if (Array.isArray(r)) return r as Site[];
  const sites = (r as { sites?: Site[] }).sites;
  if (!Array.isArray(sites)) throw new Error("listSites result has neither array shape nor `.sites`");
  return sites;
}

describe("listSites: interface-method calls are not_measured sites", () => {
  const entryCapped = { file: "command.ts", symbol: "runCapped" };

  it("reports the interface call as one dynamic site keyed <Interface>#insertCapped", async () => {
    const { listSites } = await loadFidelity();
    const hits = mainSites(listSites({ rootDir: ifaceRoot, entry: entryCapped })).filter((s) =>
      s.key.includes("CappedStore#insertCapped"),
    );
    expect(hits.map((s) => s.key)).toHaveLength(1);
    expect(hits[0]!.dynamic).toBe(true);
  });

  it("reports it exactly once although the service calls insertCapped twice", async () => {
    const { listSites } = await loadFidelity();
    const keys = mainSites(listSites({ rootDir: ifaceRoot, entry: entryCapped })).map((s) => s.key);
    expect(keys.filter((k) => k.includes("insertCapped"))).toHaveLength(1);
  });

  it("does not turn the interface call into a keyed (covered-looking) err site", async () => {
    const { listSites } = await loadFidelity();
    const keyed = mainSites(listSites({ rootDir: ifaceRoot, entry: entryCapped })).filter((s) => !s.dynamic);
    expect(keyed.map((s) => s.key)).toEqual([]);
  });

  it("an entry that never calls the interface reports no interface site (control)", async () => {
    const { listSites } = await loadFidelity();
    const r = mainSites(listSites({ rootDir: ifaceRoot, entry: { file: "pure.ts", symbol: "runPure" } }));
    expect(r.filter((s) => s.key.includes("insertCapped"))).toEqual([]);
  });

  it("the interface site is not_measured in leaf coverage until justified (never covered)", async () => {
    const { listSites } = await loadFidelity();
    const { computeLeafCoverage } = await loadCoverage();
    const sites = mainSites(listSites({ rootDir: ifaceRoot, entry: entryCapped }));
    const r = computeLeafCoverage({ sites, siteMap: {}, liveRuleIds: [] });
    expect(r.notMeasured.some((k) => k.includes("CappedStore#insertCapped"))).toBe(true);
  });
});

describe("listSites: shared non-business bootstrap list", () => {
  const loadList = async (): Promise<readonly string[]> => {
    let mod: Record<string, unknown>;
    try {
      mod = (await import(/* @vite-ignore */ NONBUSINESS_MODULE)) as Record<string, unknown>;
    } catch (e) {
      throw new Error(`MISSING BEHAVIOUR: ${NONBUSINESS_MODULE} not found (${String(e)})`);
    }
    const list = mod["NON_BUSINESS_SYMBOLS"];
    if (!Array.isArray(list)) throw new Error("MISSING BEHAVIOUR: NON_BUSINESS_SYMBOLS is not exported as an array");
    return list as readonly string[];
  };
  // A list entry names a symbol either bare or as `<file>#<symbol>`.
  const inList = (list: readonly string[], s: Site): boolean =>
    list.includes(s.symbol) || list.includes(`${s.file}#${s.symbol}`);

  it("exports a non-empty NON_BUSINESS_SYMBOLS list of strings", async () => {
    const list = await loadList();
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((e) => typeof e === "string" && e.length > 0)).toBe(true);
  });

  it("a census result carries a `bootstrap` array (empty when no listed symbol is reached)", async () => {
    const { listSites } = await loadFidelity();
    const r = listSites({ rootDir, entry }) as CensusResult;
    expect(r.bootstrap).toEqual([]);
  });

  it("sites inside listed symbols land in `bootstrap`, never in the main list (real `ac add` census)", async () => {
    const { listSites, resolveCommandEntry } = await loadFidelity();
    const list = await loadList();
    const r = listSites({ rootDir: repoRoot, entry: resolveCommandEntry({ rootDir: repoRoot, command: "ac add" }) });
    const bootstrap = r.bootstrap;
    if (!Array.isArray(bootstrap)) throw new Error("MISSING BEHAVIOUR: result has no `bootstrap` array");
    expect(bootstrap.length).toBeGreaterThan(0);
    expect(bootstrap.every((s) => inList(list, s))).toBe(true);
    expect(mainSites(r).filter((s) => inList(list, s)).map((s) => s.key)).toEqual([]);
  }, 120_000);

  it("bootstrap and main lists never share a site key", async () => {
    const { listSites, resolveCommandEntry } = await loadFidelity();
    const r = listSites({ rootDir: repoRoot, entry: resolveCommandEntry({ rootDir: repoRoot, command: "ac add" }) });
    if (!Array.isArray(r.bootstrap)) throw new Error("MISSING BEHAVIOUR: result has no `bootstrap` array");
    const boot = new Set(r.bootstrap.map((s) => s.key));
    expect(mainSites(r).filter((s) => boot.has(s.key))).toEqual([]);
  }, 120_000);
});

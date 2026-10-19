// @reads packages/lore/src/adapters/cli/**
/**
 * AC-BCG-3 (spec-baseline-coverage-refuses-only-undeclared-commands-a-site): `lore baseline map` writes BR-n values only.
 * The excuse grammar is gone: no `--non-business` option, a site with no rule is refused naming BR-655, and a value that
 * is free text, a retired rule or another leaf's rule is refused naming the value (BR-654). Every refusal exits exactly 4
 * and leaves the leaf's version count unchanged; a row mapping the site to an unretired rule of the leaf exits 0.
 *
 * Fixture: the throwaway mini lore checkout of coverage-mini-corpus (leaf A and leaf B each carry one rule). Never touches
 * the repo's .lore/. Dimensions: HAPPY (unretired own rule -> 0), NEGATIVE (each refused shape -> 4 naming it), STATE
 * (version count unchanged on every refusal), BOUNDARY (one bad row in a many-row file refuses the whole file),
 * REGRESSION (the pre-change verb accepted `--non-business` and wrote it).
 *
 * @spec_ref spec-baseline-coverage-refuses-only-undeclared-commands-a-site#AC-BCG-3
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMiniCorpus, type MiniCorpus } from "../../helpers/coverage-mini-corpus";

const corpora: MiniCorpus[] = [];
const scratch: string[] = [];
afterEach(() => {
  for (const c of corpora.splice(0)) c.dispose();
  for (const d of scratch.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function mini(): Promise<MiniCorpus> {
  const c = await buildMiniCorpus();
  corpora.push(c);
  return c;
}

async function leafVersion(c: MiniCorpus, leaf: string): Promise<number> {
  const r = await c.run(["get", leaf, "--json"]);
  return (JSON.parse(r.stdout) as { data: { doc: { version: number } } }).data.doc.version;
}

async function ruleOf(c: MiniCorpus, leaf: string): Promise<string> {
  const r = await c.run(["get", leaf, "--json"]);
  const rules = (JSON.parse(r.stdout) as { data: { doc: { extra: { rules: { id: string }[] } } } }).data.doc.extra.rules;
  return (rules[0] as { id: string }).id;
}

function sitesFile(rows: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "bcg3-sites-"));
  scratch.push(dir);
  const path = join(dir, "sites.json");
  writeFileSync(path, JSON.stringify(rows));
  return path;
}

describe("AC-BCG-3 the site-map write takes BR-n values only", () => {
  it("--help lists no non-business option", async () => {
    const c = await mini();
    const r = await c.run(["baseline", "map", "--help"]);
    const text = r.stdout + r.stderr;
    expect(text).toContain("--rule");
    expect(text.toLowerCase()).not.toContain("non-business");
    expect(text).not.toContain("nonBusiness");
  }, 120_000);

  it("--non-business is no longer an option: nothing is written", async () => {
    const c = await mini();
    const [site] = await c.sitesOf("alpha");
    const before = await leafVersion(c, c.leafA);
    const r = await c.run(["baseline", "map", c.leafA, "--site", site as string, "--non-business", "storage"]);
    expect(r.exitCode, r.stdout + r.stderr).toBe(4);
    expect(await leafVersion(c, c.leafA)).toBe(before);
  }, 120_000);

  it("a site with no rule exits exactly 4 naming BR-655, nothing written", async () => {
    const c = await mini();
    const [site] = await c.sitesOf("alpha");
    const before = await leafVersion(c, c.leafA);
    const r = await c.run(["baseline", "map", c.leafA, "--site", site as string]);
    expect(r.exitCode, r.stdout + r.stderr).toBe(4);
    expect(r.stderr).toContain("BR-655");
    expect(await leafVersion(c, c.leafA)).toBe(before);
  }, 120_000);

  it("a sites-file row with free text exits exactly 4 naming the value, nothing written", async () => {
    const c = await mini();
    const [site] = await c.sitesOf("alpha");
    const before = await leafVersion(c, c.leafA);
    const file = sitesFile([{ site, rules: ["non-business: storage"] }]);
    const r = await c.run(["baseline", "map", c.leafA, "--sites-file", file]);
    expect(r.exitCode, r.stdout + r.stderr).toBe(4);
    expect(r.stderr).toContain("non-business: storage");
    expect(await leafVersion(c, c.leafA)).toBe(before);
  }, 120_000);

  it("a sites-file row in the retired { site, nonBusiness } shape exits exactly 4, nothing written", async () => {
    const c = await mini();
    const [site] = await c.sitesOf("alpha");
    const before = await leafVersion(c, c.leafA);
    const file = sitesFile([{ site, nonBusiness: "storage" }]);
    const r = await c.run(["baseline", "map", c.leafA, "--sites-file", file]);
    expect(r.exitCode, r.stdout + r.stderr).toBe(4);
    expect(r.stderr).toContain("BR-655");
    expect(await leafVersion(c, c.leafA)).toBe(before);
  }, 120_000);

  it("a retired rule of the leaf exits exactly 4 naming the value, nothing written", async () => {
    const c = await mini();
    const [site] = await c.sitesOf("alpha");
    const rule = await ruleOf(c, c.leafA);
    const retired = await c.run(["rule", "set", rule, "--lifecycle", "retired", "--note", "gone"]);
    expect(retired.exitCode, retired.stdout + retired.stderr).toBe(0);
    const before = await leafVersion(c, c.leafA);
    const r = await c.run(["baseline", "map", c.leafA, "--site", site as string, "--rule", rule]);
    expect(r.exitCode, r.stdout + r.stderr).toBe(4);
    expect(r.stderr).toContain(rule);
    expect(await leafVersion(c, c.leafA)).toBe(before);
  }, 120_000);

  it("another leaf's rule exits exactly 4 naming the value, nothing written", async () => {
    const c = await mini();
    const [site] = await c.sitesOf("alpha");
    const foreign = await ruleOf(c, c.leafB);
    const before = await leafVersion(c, c.leafA);
    const r = await c.run(["baseline", "map", c.leafA, "--site", site as string, "--rule", foreign]);
    expect(r.exitCode, r.stdout + r.stderr).toBe(4);
    expect(r.stderr).toContain(foreign);
    expect(await leafVersion(c, c.leafA)).toBe(before);
  }, 120_000);

  it("BOUNDARY: one bad row in a file with a good row refuses the whole file, nothing written", async () => {
    const c = await mini();
    const [site] = await c.sitesOf("alpha");
    const own = await ruleOf(c, c.leafA);
    const before = await leafVersion(c, c.leafA);
    const file = sitesFile([
      { site, rules: [own] },
      { site: "other.ts#f#X", rules: ["non-business: storage"] },
    ]);
    const r = await c.run(["baseline", "map", c.leafA, "--sites-file", file]);
    expect(r.exitCode, r.stdout + r.stderr).toBe(4);
    expect(r.stderr).toContain("non-business: storage");
    expect(await leafVersion(c, c.leafA)).toBe(before);
  }, 120_000);

  it("HAPPY: a site mapped to an unretired rule of the leaf exits 0 and is stored as that BR-n", async () => {
    const c = await mini();
    const [site] = await c.sitesOf("alpha");
    const own = await ruleOf(c, c.leafA);
    const r = await c.run(["baseline", "map", c.leafA, "--site", site as string, "--rule", own, "--json"]);
    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
    const data = (JSON.parse(r.stdout) as { data: { site_map: Record<string, string[]> } }).data;
    expect(data.site_map[site as string]).toEqual([own]);
  }, 120_000);
});

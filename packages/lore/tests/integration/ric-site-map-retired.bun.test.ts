// @reads packages/**
// @reads scripts/**
// @reads assets/**
/**
 * @spec_ref spec-refusal-sites-declare-their-rule-in-code-baseline-leaf  AC-RIC-5 (BR-1344)
 *
 * Throwaway corpus (never the repo's own `.lore/`):
 *   - `lore baseline map L --site x --rule BR-a`, `--sites-file p` and `--remove-site x` each exit 2 with the CLI's generic
 *     `Unknown option: --<flag>`; no dedicated message exists.
 *   - With BR-a declared at a code site S and a leaf L whose stored extra (seeded straight into the fixture store) still holds a
 *     `site_map` row mapping S to ANOTHER rule BR-z, `lore baseline sites` and `lore baseline coverage --json` report S as BR-a
 *     and never name BR-z.
 *   - No product source file (packages/*\/src, scripts/, assets/) contains the string `site_map`.
 *
 * SIMPLEST GREEN-BUT-BROKEN CASE (asserted): hiding the options from help while coverage still reads the corpus row; the seeded
 * stale row must not change either report.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildMiniCorpus, type MiniCorpus } from "../helpers/coverage-mini-corpus.js";
import { seedSiteMapValue } from "../helpers/seed-site-map-value.js";

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const SITE_MAP = ["site", "map"].join("_");

let c: MiniCorpus;
let siteKey = "";
let ruleA = "";
let ruleZ = "";

beforeAll(async () => {
  c = await buildMiniCorpus();
  ruleA = c.ruleOf.get(c.leafA) as string;
  ruleZ = c.ruleOf.get(c.leafB) as string;
  const [first] = await c.sitesOf("alpha");
  siteKey = first as string;
  await c.mapSite(c.leafA, siteKey);
  seedSiteMapValue(c, c.leafA, siteKey, ruleZ);
});

afterAll(() => c?.dispose());

describe("AC-RIC-5 — the corpus site map is retired", () => {
  it.each([
    ["--site", ["--site", "x", "--rule", "BR-1"]],
    ["--sites-file", ["--sites-file", "rows.json"]],
    ["--remove-site", ["--remove-site", "x"]],
  ])("(1) `lore baseline map` %s fails through the generic unknown-option handling (exit 2)", async (flag, extra) => {
    const r = await c.run(["baseline", "map", c.leafA, ...extra]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain(`Unknown option: ${flag}`);
    expect(r.stderr).not.toContain(SITE_MAP);
  });

  it("(2) `lore baseline sites` reports S as the rule it declares, and never names the seeded row's rule", async () => {
    const r = await c.run(["baseline", "sites", "alpha", "--json"]);
    expect(r.exitCode).toBe(0);
    const sites = (JSON.parse(r.stdout) as { data: { sites: { key: string; rule: string | null }[] } }).data.sites;
    expect(sites.find((s) => s.key === siteKey)?.rule).toBe(ruleA);
    expect(r.stdout).not.toContain(ruleZ);
  });

  it("(3) `lore baseline coverage --json` maps S to BR-a for leaf A and never names the seeded row's rule", async () => {
    const r = await c.run(["baseline", "coverage", c.root, "--json"]);
    expect(r.exitCode).toBe(0);
    const leaves = (JSON.parse(r.stdout) as { data: { leaves: { slug: string; mapped_sites: { key: string; rule: string }[]; gaps: string[] }[] } }).data.leaves;
    const leafA = leaves.find((l) => l.slug === c.leafA);
    expect(leafA?.mapped_sites).toEqual([expect.objectContaining({ key: siteKey, rule: ruleA })]);
    expect(leafA?.gaps).toEqual([]);
    expect(r.stdout).not.toContain(ruleZ);
    expect(r.stdout).not.toContain(SITE_MAP);
  });

  it("(4) no product source file (packages/*/src, scripts/, assets/) contains the string site_map", () => {
    const roots = [
      ...readdirSync(join(REPO_ROOT, "packages")).map((p) => join(REPO_ROOT, "packages", p, "src")),
      join(REPO_ROOT, "scripts"),
      join(REPO_ROOT, "assets"),
    ].filter((p) => {
      try {
        return statSync(p).isDirectory();
      } catch {
        return false;
      }
    });
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) walk(abs);
        else if (readFileSync(abs).includes(SITE_MAP)) hits.push(relative(REPO_ROOT, abs));
      }
    };
    for (const root of roots) walk(root);
    expect(hits).toEqual([]);
  });
});

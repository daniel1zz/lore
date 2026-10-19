// @reads packages/lore/src/adapters/cli/**
/**
 * Task task-removing-a-site-mapping-is-refused-while-main-still: the corpus is shared and un-branched, so a write that
 * REDUCES accountability from an unlanded branch breaks every other tree. `lore baseline map --remove-site`,
 * `--remove-command` and `lore rule set --lifecycle retired | --move-to` are refused (exit 4, nothing written) while MAIN's
 * tree (the checkout holding the corpus) still reaches what they stop accounting for, and accepted once it does not.
 * `lore baseline coverage` lists mappings the analysed tree no longer reaches as removable, with the fix.
 *
 * Fixture: tests/helpers/coverage-mini-corpus.ts (throwaway checkout + corpus; never the repo's .lore/).
 * Dimensions: NEGATIVE (each refusal exit 4, nothing written), HAPPY (accepted once main drops it), STATE (version unchanged
 * on refusal), BOUNDARY (owned-by citation), REGRESSION (the three real incidents of 2026-10-19).
 */
import { afterEach, describe, expect, it } from "vitest";
import { MINI_CLI, buildMiniCorpus, type MiniCorpus } from "../../helpers/coverage-mini-corpus";

const corpora: MiniCorpus[] = [];
afterEach(() => {
  for (const c of corpora.splice(0)) c.dispose();
});

const REGISTRY_B = `export const COMMAND_LOADERS = {
  beta: () => import("./commands/beta.js"),
};
`;
/** alpha no longer reaches any failure site (main dropped the behaviour). */
const ALPHA_NO_SITES = `export default { run() { return 0; } };\n`;

async function fresh(): Promise<MiniCorpus> {
  const c = await buildMiniCorpus();
  corpora.push(c);
  await c.mapAllSites(c.leafA, "alpha");
  await c.mapAllSites(c.leafB, "beta");
  return c;
}

async function leafVersion(c: MiniCorpus, leaf: string): Promise<number> {
  const r = await c.run(["get", leaf, "--json"]);
  return (JSON.parse(r.stdout) as { data: { doc: { version: number } } }).data.doc.version;
}

async function addRule(c: MiniCorpus, leaf: string): Promise<string> {
  const r = await c.run(["rule", "add", leaf, "--statement", "A fixture rule holds", "--confidence", "established", "--enforced-by", "guaranteed", "--example", "e"]);
  expect(r.exitCode, r.stdout + r.stderr).toBe(0);
  const id = (r.stdout + r.stderr).match(/BR-\d+/)?.[0];
  if (id === undefined) throw new Error(`no rule id in ${r.stdout}`);
  return id;
}

describe("removing a site mapping is refused while main still reaches it (task-removing-a-site-mapping-is-refused-while-main-still)", () => {
  it("--remove-site: refused (exit 4) naming the site while main reaches it, nothing written; accepted once main drops it", async () => {
    const c = await fresh();
    const [site] = await c.sitesOf("alpha");
    const before = await leafVersion(c, c.leafA);
    const refused = await c.run(["baseline", "map", c.leafA, "--remove-site", site as string]);
    expect(refused.exitCode, refused.stdout + refused.stderr).toBe(4);
    expect(refused.stderr).toContain(site as string);
    expect(refused.stderr).toContain("landed");
    expect(await leafVersion(c, c.leafA)).toBe(before);
    c.writeSource(`${MINI_CLI}/commands/alpha.ts`, ALPHA_NO_SITES);
    const ok = await c.run(["baseline", "map", c.leafA, "--remove-site", site as string]);
    expect(ok.exitCode, ok.stdout + ok.stderr).toBe(0);
  }, 120_000);

  it("--remove-command: refused while main's registry has the command, nothing written; accepted once it is gone", async () => {
    const c = await fresh();
    const before = await leafVersion(c, c.leafA);
    const refused = await c.run(["baseline", "map", c.leafA, "--remove-command", "alpha"]);
    expect(refused.exitCode, refused.stdout + refused.stderr).toBe(4);
    expect(refused.stderr).toContain("alpha");
    expect(refused.stderr).toContain("landed");
    expect(await leafVersion(c, c.leafA)).toBe(before);
    c.writeSource(`${MINI_CLI}/index.ts`, REGISTRY_B);
    const ok = await c.run(["baseline", "map", c.leafA, "--remove-command", "alpha"]);
    expect(ok.exitCode, ok.stdout + ok.stderr).toBe(0);
  }, 120_000);

  it("rule set --lifecycle retired: refused naming the site and leaf citing it while main reaches it; accepted after", async () => {
    const c = await fresh();
    const rule = await addRule(c, c.leafA);
    const [site] = await c.sitesOf("alpha");
    expect((await c.run(["baseline", "map", c.leafA, "--site", site as string, "--rule", rule])).exitCode).toBe(0);
    const before = await leafVersion(c, c.leafA);
    const refused = await c.run(["rule", "set", rule, "--lifecycle", "retired", "--note", "gone"]);
    expect(refused.exitCode, refused.stdout + refused.stderr).toBe(4);
    expect(refused.stderr).toContain(site as string);
    expect(refused.stderr).toContain(c.leafA);
    expect(await leafVersion(c, c.leafA)).toBe(before);
    c.writeSource(`${MINI_CLI}/commands/alpha.ts`, ALPHA_NO_SITES);
    const ok = await c.run(["rule", "set", rule, "--lifecycle", "retired", "--note", "gone"]);
    expect(ok.exitCode, ok.stdout + ok.stderr).toBe(0);
  }, 120_000);

  it("rule set --move-to is refused the same way while a mapping on a reached site cites the rule", async () => {
    const c = await fresh();
    const rule = await addRule(c, c.leafA);
    const [site] = await c.sitesOf("alpha");
    expect((await c.run(["baseline", "map", c.leafA, "--site", site as string, "--rule", rule])).exitCode).toBe(0);
    const refused = await c.run(["rule", "set", rule, "--move-to", c.leafB]);
    expect(refused.exitCode, refused.stdout + refused.stderr).toBe(4);
    expect(refused.stderr).toContain(site as string);
  }, 120_000);

  it("retiring a rule cited only through another leaf's owned-by mapping is refused, naming that leaf and site", async () => {
    const c = await fresh();
    const rule = await addRule(c, c.leafA);
    const [betaSite] = await c.sitesOf("beta");
    const entry = `non-business:owned-by ${c.leafA} ${rule} — fixture hand-off`;
    expect((await c.run(["baseline", "map", c.leafB, "--site", betaSite as string, "--non-business", entry.slice("non-business:".length)])).exitCode).toBe(0);
    const refused = await c.run(["rule", "set", rule, "--lifecycle", "retired", "--note", "gone"]);
    expect(refused.exitCode, refused.stdout + refused.stderr).toBe(4);
    expect(refused.stderr).toContain(betaSite as string);
    expect(refused.stderr).toContain(c.leafB);
  }, 120_000);

  it("a rule no mapping cites retires freely", async () => {
    const c = await fresh();
    const rule = await addRule(c, c.leafA);
    const ok = await c.run(["rule", "set", rule, "--lifecycle", "retired", "--note", "gone"]);
    expect(ok.exitCode, ok.stdout + ok.stderr).toBe(0);
  }, 120_000);

  it("coverage lists a mapping the tree no longer reaches as removable, with the fix", async () => {
    const c = await fresh();
    const stale = "packages/lore/src/adapters/cli/lib/gone.ts#vanished#GONE_CODE";
    const rule = await addRule(c, c.leafA);
    expect((await c.run(["baseline", "map", c.leafA, "--site", stale, "--rule", rule])).exitCode).toBe(0);
    const r = await c.run(["baseline", "coverage", c.root]);
    expect(r.stdout).toContain(stale);
    expect(r.stdout).toContain(`lore baseline map ${c.leafA} --remove-site ${stale}`);
    const json = JSON.parse((await c.run(["baseline", "coverage", c.root, "--json"])).stdout) as {
      data: { leaves: { slug: string; stale_site_maps: { site: string; fix: string }[] }[] };
    };
    const a = json.data.leaves.find((l) => l.slug === c.leafA);
    expect(a?.stale_site_maps.map((s) => s.site)).toEqual([stale]);
    const b = json.data.leaves.find((l) => l.slug === c.leafB);
    expect(b?.stale_site_maps).toEqual([]);
  }, 120_000);
});

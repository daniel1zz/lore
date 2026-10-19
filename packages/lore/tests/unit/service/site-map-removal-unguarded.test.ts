// @reads packages/lore/src/adapters/cli/**
// @reads assets/governance/write-spec-rule.md
// @reads assets/project/lore-config-template.yaml
/**
 * AC-BCG-6 (spec-baseline-coverage-refuses-only-undeclared-commands-a-site): the completeness guards are gone, the command
 * guards stay. With main's tree still reaching a mapped site, removing the mapping, retiring a rule a mapping cites and
 * moving that rule to another leaf each exit exactly 0 (a mapping is traceability, ADR decision 5), and coverage then lists
 * the mapping as stale with exit 0 (BR-1320). Dropping a command declaration main still has stays refused (BR-1316), and
 * with an unanalysable main a command drop is refused too (BR-1317): exit exactly 4, nothing written.
 *
 * Fixture: tests/helpers/coverage-mini-corpus.ts (throwaway checkout + corpus; never the repo's .lore/).
 * Dimensions: HAPPY (each removal exit 0), NEGATIVE (command drops exit 4), STATE (version unchanged on refusal, stale
 * listing after the change), BOUNDARY (stale never moves coverage's exit code), REGRESSION (the pre-change guards refused
 * all three removals while main reached the site).
 *
 * @spec_ref spec-baseline-coverage-refuses-only-undeclared-commands-a-site#AC-BCG-6
 */
import { afterEach, describe, expect, it } from "vitest";
import { MINI_CLI, buildMiniCorpus, type MiniCorpus } from "../../helpers/coverage-mini-corpus";

const corpora: MiniCorpus[] = [];
afterEach(() => {
  for (const c of corpora.splice(0)) c.dispose();
});

/** Leaf A and B each map every site of their command to their own rule, and main (the checkout) still reaches all of them. */
async function mapped(): Promise<MiniCorpus> {
  const c = await buildMiniCorpus();
  corpora.push(c);
  await c.mapAllSites(c.leafA, "alpha");
  await c.mapAllSites(c.leafB, "beta");
  return c;
}

async function leafDoc(c: MiniCorpus, leaf: string): Promise<{ version: number; extra: { rules: { id: string }[]; site_map?: Record<string, string[]> } }> {
  const r = await c.run(["get", leaf, "--json"]);
  return (JSON.parse(r.stdout) as { data: { doc: { version: number; extra: { rules: { id: string }[]; site_map?: Record<string, string[]> } } } }).data.doc;
}

async function ruleOf(c: MiniCorpus, leaf: string): Promise<string> {
  return ((await leafDoc(c, leaf)).extra.rules[0] as { id: string }).id;
}

interface StaleReport {
  data: { leaves: { slug: string; stale_site_maps: { site: string; fix: string }[] }[] };
}

async function staleOf(c: MiniCorpus, leaf: string): Promise<{ exitCode: number; stale: { site: string; fix: string }[]; text: string }> {
  const json = await c.run(["baseline", "coverage", c.root, "--json"]);
  const report = JSON.parse(json.stdout) as StaleReport;
  const text = await c.run(["baseline", "coverage", c.root]);
  expect(text.exitCode, text.stdout + text.stderr).toBe(json.exitCode);
  return { exitCode: json.exitCode, stale: report.data.leaves.find((l) => l.slug === leaf)?.stale_site_maps ?? [], text: text.stdout };
}

describe("AC-BCG-6 a site mapping is never guarded, a command declaration still is", () => {
  it("removing a mapping main still reaches exits exactly 0 and removes it", async () => {
    const c = await mapped();
    const [site] = await c.sitesOf("alpha");
    const r = await c.run(["baseline", "map", c.leafA, "--remove-site", site as string]);
    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
    expect((await leafDoc(c, c.leafA)).extra.site_map?.[site as string]).toBeUndefined();
  }, 120_000);

  it("retiring a rule a mapping cites exits exactly 0; coverage lists the mapping as stale and exits 0", async () => {
    const c = await mapped();
    const [site] = await c.sitesOf("alpha");
    const rule = await ruleOf(c, c.leafA);
    expect((await staleOf(c, c.leafA)).stale).toEqual([]);
    const r = await c.run(["rule", "set", rule, "--lifecycle", "retired", "--note", "gone"]);
    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
    const after = await staleOf(c, c.leafA);
    expect(after.exitCode).toBe(0);
    expect(after.stale.map((s) => s.site)).toEqual([site]);
    expect(after.text).toContain(`lore baseline map ${c.leafA} --remove-site ${site as string}`);
  }, 120_000);

  it("moving a cited rule to another leaf exits exactly 0; coverage lists the mapping as stale and exits 0", async () => {
    const c = await mapped();
    const [site] = await c.sitesOf("alpha");
    const rule = await ruleOf(c, c.leafA);
    const r = await c.run(["rule", "set", rule, "--move-to", c.leafB]);
    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
    const after = await staleOf(c, c.leafA);
    expect(after.exitCode).toBe(0);
    expect(after.stale.map((s) => s.site)).toEqual([site]);
    expect((await staleOf(c, c.leafB)).stale).toEqual([]);
  }, 120_000);

  it("dropping a declared command main still has exits exactly 4 (BR-1316), nothing written", async () => {
    const c = await mapped();
    const before = (await leafDoc(c, c.leafA)).version;
    const r = await c.run(["baseline", "map", c.leafA, "--remove-command", "alpha"]);
    expect(r.exitCode, r.stdout + r.stderr).toBe(4);
    expect(r.stderr).toContain("alpha");
    expect((await leafDoc(c, c.leafA)).version).toBe(before);
  }, 120_000);

  it("with an unanalysable main, dropping a command exits exactly 4 (BR-1317), nothing written", async () => {
    const c = await mapped();
    const before = (await leafDoc(c, c.leafA)).version;
    // reason: a registry that is not a static object literal cannot be analysed; it must never read as "main no longer has the command".
    c.writeSource(`${MINI_CLI}/index.ts`, `export const COMMAND_LOADERS = buildLoaders();\n`);
    const r = await c.run(["baseline", "map", c.leafA, "--remove-command", "alpha"]);
    expect(r.exitCode, r.stdout + r.stderr).toBe(4);
    expect(r.stderr).toContain("cannot measure main's tree");
    expect((await leafDoc(c, c.leafA)).version).toBe(before);
  }, 120_000);
});

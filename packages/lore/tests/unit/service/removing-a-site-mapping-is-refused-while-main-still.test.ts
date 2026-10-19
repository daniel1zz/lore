// @reads packages/lore/src/adapters/cli/**
/**
 * Task task-removing-a-site-mapping-is-refused-while-main-still, as narrowed by
 * spec-baseline-coverage-refuses-only-undeclared-commands-a-site: the corpus is shared and un-branched, so ONLY a command
 * declaration drop from an unlanded branch is guarded. `lore baseline map --remove-command` is refused (exit 4, nothing
 * written) while MAIN's tree (the checkout holding the corpus) still has the command, and accepted once it does not. Site
 * mappings and rules are never guarded (see site-map-removal-unguarded.test.ts); `lore baseline coverage` lists mappings the
 * analysed tree no longer reaches as removable, with the fix.
 *
 * Fixture: tests/helpers/coverage-mini-corpus.ts (throwaway checkout + corpus; never the repo's .lore/).
 * Dimensions: NEGATIVE (refusal exit 4, nothing written), HAPPY (accepted once main drops it; a rule no mapping cites retires
 * freely), STATE (version unchanged on refusal), BOUNDARY (stale listing of an unreachable site).
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

describe("only a command declaration drop is refused while main still has it (task-removing-a-site-mapping-is-refused-while-main-still)", () => {
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

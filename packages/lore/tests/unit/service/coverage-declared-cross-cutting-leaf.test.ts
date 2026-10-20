// @reads packages/lore/src/adapters/cli/**
// @reads assets/governance/write-spec-rule.md
// @reads assets/project/lore-config-template.yaml
/**
 * BL-D1 under BR-1344: the coverage census measures a cross-cutting leaf (one that declares no command of its own) by the sites
 * whose CODE declares one of its rules, so it needs no proxy command and no corpus mapping. A command-less leaf whose rules are
 * declared nowhere is reported UNMEASURED (never silently ok), as report output: coverage refuses only an undeclared command.
 *
 * Fixture: tests/helpers/coverage-mini-corpus.ts (throwaway checkout + corpus; never the repo's .lore/).
 * Dimensions: HAPPY (a site declaring the leaf's rule -> fully mapped, owned_sites), NEGATIVE (rule declared nowhere -> UNMEASURED,
 * exit 0), REGRESSION (a leaf WITH commands is measured by its command census), STATE (the other leaf stays accounted: a site
 * declaring ANOTHER leaf's rule is not its gap).
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildMiniCorpus, type MiniCorpus } from "../../helpers/coverage-mini-corpus";

const corpora: MiniCorpus[] = [];
afterEach(() => {
  for (const c of corpora.splice(0)) c.dispose();
});

interface Fx {
  readonly c: MiniCorpus;
  readonly leafC: string;
  readonly rule: string;
  readonly betaSite: string;
}

async function must(c: MiniCorpus, args: string[]): Promise<string> {
  const r = await c.run(args);
  if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r.stdout;
}

/** Leaf A: alpha, fully accounted. Leaf B: beta. Leaf C: NO command, one live rule. */
async function build(): Promise<Fx> {
  const c = await buildMiniCorpus();
  corpora.push(c);
  await c.mapAllSites(c.leafA, "alpha");
  const out = await must(c, ["baseline", "add", c.branch, "--node", "leaf", "--label", "lc", "--title", "BCR Leaf C"]);
  const leafC = (out.match(/Slug:\s+(\S+)/) ?? out.match(/Created baseline \w+ (\S+) \(/))?.[1] as string;
  const ruleOut = await must(c, ["rule", "add", leafC, "--statement", "Cross-cutting guard refuses.", "--example", "a refusal", "--confidence", "observed", "--enforced-by", "guaranteed"]);
  const rule = ruleOut.match(/BR-\d+/)?.[0] as string;
  await c.approve(leafC); // the rule is a pending add until its leaf is approved
  const betaSite = (await c.sitesOf("beta"))[0] as string;
  return { c, leafC, rule, betaSite };
}

type Leaf = { slug: string; ok: boolean; sites: number; measured_by: string; gaps: string[]; commands: string[]; mapped_sites: { rule: string }[] };
async function coverageJson(c: MiniCorpus, target: string): Promise<{ exitCode: number; leaves: Leaf[]; stdout: string }> {
  const r = await c.run(["baseline", "coverage", target, "--json"]);
  const data = (JSON.parse(r.stdout) as { data: { leaves: Leaf[] } }).data;
  return { exitCode: r.exitCode, leaves: data.leaves, stdout: r.stdout };
}

describe("BL-D1 a command-less leaf is measured by the sites that declare its rules", () => {
  it("a site declaring the command-less leaf's live rule makes it fully mapped: 1 site, measured_by owned_sites", async () => {
    const fx = await build();
    const [file] = fx.betaSite.split("#");
    const before = readFileSync(join(fx.c.dir, file as string), "utf8");
    fx.c.writeSource(file as string, before.replace(`{ code: "BETA_BAD" }`, `{ code: "BETA_BAD", rule: "${fx.rule}" }`));
    const r = await coverageJson(fx.c, fx.leafC);
    expect(r.exitCode, r.stdout).toBe(0);
    expect(r.leaves).toHaveLength(1);
    expect(r.leaves[0]).toMatchObject({ slug: fx.leafC, ok: true, sites: 1, measured_by: "owned_sites", commands: [] });
    expect(r.leaves[0]?.mapped_sites).toEqual([expect.objectContaining({ rule: fx.rule })]);
    const human = await fx.c.run(["baseline", "coverage", fx.leafC]);
    expect(human.stdout).toContain(`${fx.leafC}: fully mapped - 1 site(s)`);
    expect(human.stdout).not.toContain("UNMEASURED");
  }, 120_000);

  it("the leaf that reaches that site through its command does not see it as its own gap", async () => {
    const fx = await build();
    const [file] = fx.betaSite.split("#");
    const before = readFileSync(join(fx.c.dir, file as string), "utf8");
    fx.c.writeSource(file as string, before.replace(`{ code: "BETA_BAD" }`, `{ code: "BETA_BAD", rule: "${fx.rule}" }`));
    const r = await coverageJson(fx.c, fx.c.leafB);
    expect(r.exitCode, r.stdout).toBe(0);
    expect(r.leaves[0]).toMatchObject({ measured_by: "commands", gaps: [], mapped_sites: [] });
  }, 120_000);

  it("a command-less leaf whose rule is declared nowhere is reported UNMEASURED (exit 0, report only), never silently ok", async () => {
    const fx = await build();
    const r = await coverageJson(fx.c, fx.leafC);
    expect(r.exitCode, r.stdout).toBe(0);
    expect(r.leaves[0]).toMatchObject({ ok: false, sites: 0, measured_by: "none" });
    const human = await fx.c.run(["baseline", "coverage", fx.leafC]);
    expect(human.stdout).toContain("UNMEASURED");
  }, 120_000);

  it("regression: a leaf with a declared command is measured by the command census", async () => {
    const fx = await build();
    await fx.c.mapAllSites(fx.c.leafB, "beta");
    const r = await coverageJson(fx.c, fx.c.leafB);
    expect(r.exitCode, r.stdout).toBe(0);
    expect(r.leaves[0]).toMatchObject({ ok: true, sites: 1, measured_by: "commands", commands: ["beta"] });
  }, 120_000);
});

// @reads packages/lore/src/adapters/cli/**
/**
 * Task task-skill-fix-bl-d1-coverage-census-measures-a-cross-cutting (BL-D1): the coverage census measures a cross-cutting leaf (one that declares no command of its own) by the sites it
 * OWNS, so it needs no proxy command. The sites a command-less leaf owns are its own `site_map` keys plus every site
 * another leaf's `site_map` hands to it with `non-business:owned-by <this leaf> BR-n`. Each owned site must be
 * accounted for on the owner (live rule or justified non-business); a command-less leaf that owns no site at all is
 * reported UNMEASURED (never silently ok).
 *
 * Fixture: tests/helpers/coverage-mini-corpus.ts (throwaway checkout + corpus; never the repo's .lore/).
 * Dimensions: HAPPY (owned sites accounted -> complete), NEGATIVE (inbound site not mapped on the owner -> gap, exit 1),
 * BOUNDARY (own keys only / no owned site at all -> UNMEASURED), REGRESSION (a leaf WITH commands is measured exactly
 * as before), STATE (JSON `measured_by`).
 *
 */
import { afterEach, describe, expect, it } from "vitest";
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
  const betaSite = (await c.sitesOf("beta"))[0] as string;
  return { c, leafC, rule, betaSite };
}

/** Leaf B hands its beta site to leaf C. */
async function handBetaSiteToC(fx: Fx): Promise<void> {
  const { c } = fx;
  await must(c, ["baseline", "map", c.leafB, "--site", fx.betaSite, "--non-business", `owned-by ${fx.leafC} ${fx.rule} — the cross-cutting guard owns this refusal`]);
}

type Leaf = { slug: string; ok: boolean; sites: number; measured_by: string; gaps: string[]; commands: string[] };
async function coverageJson(c: MiniCorpus, target: string): Promise<{ exitCode: number; leaves: Leaf[]; stdout: string }> {
  const r = await c.run(["baseline", "coverage", target, "--json"]);
  const data = (JSON.parse(r.stdout) as { data: { leaves: Leaf[] } }).data;
  return { exitCode: r.exitCode, leaves: data.leaves, stdout: r.stdout };
}

describe("BL-D1 a command-less leaf is measured by the sites it owns", () => {
  it("inbound owned-by site mapped to a live rule on the owner -> complete, 1 site, measured_by owned_sites", async () => {
    const fx = await build();
    await handBetaSiteToC(fx);
    await must(fx.c, ["baseline", "map", fx.leafC, "--site", fx.betaSite, "--rule", fx.rule]);
    const r = await coverageJson(fx.c, fx.leafC);
    expect(r.exitCode, r.stdout).toBe(0);
    expect(r.leaves).toHaveLength(1);
    expect(r.leaves[0]).toMatchObject({ slug: fx.leafC, ok: true, sites: 1, measured_by: "owned_sites", commands: [] });
    const human = await fx.c.run(["baseline", "coverage", fx.leafC]);
    expect(human.stdout).toContain(`${fx.leafC}: complete - 1 site(s)`);
    expect(human.stdout).not.toContain("UNMEASURED");
  }, 120_000);

  it("inbound owned-by site the owner never mapped -> gap with the owner's fix, exit exactly 1", async () => {
    const fx = await build();
    await handBetaSiteToC(fx);
    const r = await coverageJson(fx.c, fx.leafC);
    expect(r.exitCode, r.stdout).toBe(1);
    expect(r.leaves[0]).toMatchObject({ ok: false, sites: 1, measured_by: "owned_sites", gaps: [fx.betaSite] });
    const human = await fx.c.run(["baseline", "coverage", fx.leafC]);
    expect(human.stdout).toContain(`gap          ${fx.betaSite}`);
    expect(human.stdout).toContain(`lore baseline map ${fx.leafC} --site ${fx.betaSite}`);
  }, 120_000);

  it("a command-less leaf owning only its own mapped site is measured by it (own keys count)", async () => {
    const fx = await build();
    await must(fx.c, ["baseline", "map", fx.leafC, "--site", fx.betaSite, "--rule", fx.rule]);
    const r = await coverageJson(fx.c, fx.leafC);
    expect(r.exitCode, r.stdout).toBe(0);
    expect(r.leaves[0]).toMatchObject({ ok: true, sites: 1, measured_by: "owned_sites" });
  }, 120_000);

  it("a command-less leaf that owns no site at all is UNMEASURED, exit 1, never silently ok", async () => {
    const fx = await build();
    const r = await coverageJson(fx.c, fx.leafC);
    expect(r.exitCode, r.stdout).toBe(1);
    expect(r.leaves[0]).toMatchObject({ ok: false, sites: 0, measured_by: "none" });
    const human = await fx.c.run(["baseline", "coverage", fx.leafC]);
    expect(human.stdout).toContain("UNMEASURED");
  }, 120_000);

  it("regression: a leaf with a declared command is measured by the command census exactly as before", async () => {
    const fx = await build();
    await fx.c.mapAllSites(fx.c.leafB, "beta");
    const r = await coverageJson(fx.c, fx.c.leafB);
    expect(r.exitCode, r.stdout).toBe(0);
    expect(r.leaves[0]).toMatchObject({ ok: true, sites: 1, measured_by: "commands", commands: ["beta"] });
  }, 120_000);
});

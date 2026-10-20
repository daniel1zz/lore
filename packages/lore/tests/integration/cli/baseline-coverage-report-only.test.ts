// @reads packages/lore/src/adapters/cli/**
/**
 * AC-BCG-1 (spec-baseline-coverage-refuses-only-undeclared-commands-a-site): `lore baseline coverage <root>` refuses ONLY a
 * runnable command no leaf declares. Unmapped census sites are report output (exit 0, with their count); a declaration naming
 * a dead rule is reported too (see coverage-invalid-declaration.test.ts).
 *
 * Fixture: the throwaway mini lore checkout of coverage-mini-corpus (two registry commands, each declared by one leaf, NO site
 * mapped). Never touches the repo's .lore/. Dimensions: HAPPY (control, exit 0 with the count), NEGATIVE (undeclared command
 * -> 1; unmapped alone -> 0), BOUNDARY (unmapped alone is never exit 1), STATE (declaring the command clears the 1),
 * REGRESSION (the pre-change verdict was exit 1 for the unmapped sites).
 *
 * @spec_ref spec-baseline-coverage-refuses-only-undeclared-commands-a-site#AC-BCG-1
 */
import { afterEach, describe, expect, it } from "vitest";
import { MINI_CLI, buildMiniCorpus, type MiniCorpus } from "../../helpers/coverage-mini-corpus";

const corpora: MiniCorpus[] = [];
afterEach(() => {
  for (const c of corpora.splice(0)) c.dispose();
});

async function unmappedCorpus(): Promise<MiniCorpus> {
  const c = await buildMiniCorpus();
  corpora.push(c);
  return c;
}

/** A third registry command (a group whose only runnable command is `gamma add`) that no leaf declares. */
function registerGamma(c: MiniCorpus): void {
  c.writeSource(
    `${MINI_CLI}/index.ts`,
    `export const COMMAND_LOADERS = {
  alpha: () => import("./commands/alpha.js"),
  beta: () => import("./commands/beta.js"),
  gamma: () => import("./commands/gamma.js"),
};
`,
  );
  c.writeSource(`${MINI_CLI}/commands/gamma.ts`, `export default { subCommands: { add: { run() { return 0; } } } };\n`);
}

describe("AC-BCG-1 coverage is report-only for sites", () => {
  it("simplest failing case: unmapped sites alone exit exactly 0 and print the unmapped-site count", async () => {
    const c = await unmappedCorpus();
    expect((await c.sitesOf("alpha")).length).toBeGreaterThan(0);
    const r = await c.run(["baseline", "coverage", c.root]);
    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/unmapped sites: [1-9]\d* across 2 leaf\(s\)/);
    expect(r.stdout).not.toContain("undeclared");
  }, 120_000);

  it("--json: complete is true with unmapped sites still listed per leaf", async () => {
    const c = await unmappedCorpus();
    const r = await c.run(["baseline", "coverage", c.root, "--json"]);
    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
    const data = (JSON.parse(r.stdout) as { data: { complete: boolean; leaves: { gaps: string[] }[]; undeclared_commands: unknown[] } }).data;
    expect(data.complete).toBe(true);
    expect(data.leaves.some((l) => l.gaps.length > 0)).toBe(true);
    expect(data.undeclared_commands).toEqual([]);
  }, 120_000);

  it("a runnable command no leaf declares exits exactly 1 naming it; declaring it clears the exit", async () => {
    const c = await unmappedCorpus();
    registerGamma(c);
    const refused = await c.run(["baseline", "coverage", c.root]);
    expect(refused.exitCode, refused.stdout + refused.stderr).toBe(1);
    expect(refused.stdout).toContain("undeclared   gamma add");
    expect((await c.run(["baseline", "map", c.leafA, "--command", "gamma-add"])).exitCode).toBe(0);
    const cleared = await c.run(["baseline", "coverage", c.root]);
    expect(cleared.exitCode, cleared.stdout + cleared.stderr).toBe(0);
  }, 120_000);

  it("--commands-only exits 1 for an undeclared command and 0 otherwise, without a per-leaf census report", async () => {
    const c = await unmappedCorpus();
    const clean = await c.run(["baseline", "coverage", c.root, "--commands-only"]);
    expect(clean.exitCode, clean.stdout + clean.stderr).toBe(0);
    expect(clean.stdout).not.toContain("unmapped sites");
    registerGamma(c);
    const refused = await c.run(["baseline", "coverage", c.root, "--commands-only"]);
    expect(refused.exitCode, refused.stdout + refused.stderr).toBe(1);
    expect(refused.stdout).toContain("undeclared   gamma add");
  }, 120_000);
});

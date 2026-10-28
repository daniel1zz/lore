// @reads packages/lore/src/adapters/cli/**
// @reads assets/governance/write-spec-rule.md
// @reads assets/project/lore-config-template.yaml
/**
 * AC-BCR-4: a runnable subcommand registered in the CLI command registry but declared by no leaf leaves root
 * coverage incomplete: `lore baseline coverage <root>` exits exactly 1, names the command and the fix command
 * `lore baseline map <leaf> --command <cmd>`.
 *
 * Fixture: a throwaway mini lore checkout (packages/lore/src/adapters/cli/index.ts with COMMAND_LOADERS) plus a
 * baseline corpus over it (tests/helpers/coverage-mini-corpus.ts). Never touches the repo's .lore/.
 * Not vacuous: the control corpus where EVERY registry command is declared and every site accounted for exits 0, so
 * the red cases fail only because of the undeclared command.
 *
 * @spec_ref spec-baseline-coverage-cannot-silently-regress-one-program#AC-BCR-4
 */
import { afterEach, describe, expect, it } from "vitest";
import { DECIDED_FLAGS } from "../../helpers/decision-flags";
import { MINI_CLI, buildMiniCorpus, type MiniCorpus } from "../../helpers/coverage-mini-corpus";

const corpora: MiniCorpus[] = [];
afterEach(() => {
  for (const c of corpora.splice(0)) c.dispose();
});

async function fullyCovered(): Promise<MiniCorpus> {
  const c = await buildMiniCorpus();
  corpora.push(c);
  await c.mapAllSites(c.leafA, "alpha");
  await c.mapAllSites(c.leafB, "beta");
  return c;
}

/** Registry with a third top-level command that is a group: only its `add` subcommand is runnable. */
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

describe("AC-BCR-4 root coverage and undeclared commands", () => {
  it("control: every registry command declared and every site accounted for -> exit 0", async () => {
    const c = await fullyCovered();
    const r = await c.run(["baseline", "coverage", c.root]);
    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).not.toContain("undeclared");
  }, 120_000);

  it("a runnable subcommand declared by no leaf -> exit exactly 1, names it and the --command fix", async () => {
    const c = await fullyCovered();
    registerGamma(c);
    const r = await c.run(["baseline", "coverage", c.root]);
    expect(r.exitCode, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toContain("undeclared   gamma add");
    expect(r.stdout).toContain('lore baseline map <leaf> --command "gamma add"');
    // the group `gamma` itself has no run: it is not a runnable command and is not named on its own line.
    expect(r.stdout).not.toMatch(/undeclared\s+gamma\n/);
  }, 120_000);

  it("--json carries the undeclared command and its fix, and complete=false", async () => {
    const c = await fullyCovered();
    registerGamma(c);
    const r = await c.run(["baseline", "coverage", c.root, "--json"]);
    expect(r.exitCode).toBe(1);
    const data = (JSON.parse(r.stdout) as { data: { complete: boolean; undeclared_commands: { command: string; fix: string }[] } }).data;
    expect(data.complete).toBe(false);
    expect(data.undeclared_commands).toEqual([{ command: "gamma add", fix: 'lore baseline map <leaf> --command "gamma add"' }]);
  }, 120_000);

  it("declaring the command on a leaf (hyphen spelling accepted) clears it: exit 0 again", async () => {
    const c = await fullyCovered();
    registerGamma(c);
    expect((await c.run(["baseline", "map", c.leafA, "--command", "gamma-add", ...DECIDED_FLAGS])).exitCode).toBe(0);
    const r = await c.run(["baseline", "coverage", c.root]);
    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
  }, 120_000);

  it("a leaf-level coverage run does not ask for undeclared commands (only the root does)", async () => {
    const c = await fullyCovered();
    registerGamma(c);
    const r = await c.run(["baseline", "coverage", c.leafA]);
    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
  }, 120_000);
});

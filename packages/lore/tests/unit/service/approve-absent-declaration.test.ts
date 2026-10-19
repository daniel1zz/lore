// @reads packages/lore/src/adapters/cli/**
// @reads scripts/check-unclaimed-oracle.ts
/**
 * Task task-approving-a-baseline-leaf-refuses-while-it-declares-a: a declared command that main's tree lacks is
 * reported by coverage but never fails it (so a branch can pre-declare a command), which leaves stale declarations to be
 * refused where a leaf is vouched for. `lore approve <leaf>` (and the branch/root holding it) refuses with exit 4 while a
 * leaf under it declares an absent command, naming each one with the fix `lore baseline map <leaf> --remove-command "<cmd>"`;
 * `lore status --json` carries the leaves with absent declarations (`absent_declared_commands`) and the text report shows
 * the count and the names.
 *
 * Fixture: tests/helpers/coverage-mini-corpus.ts (throwaway checkout + corpus; never the repo's .lore/).
 * Dimensions: HAPPY (live declarations approve; removal unblocks), NEGATIVE (leaf and branch refuse, exit 4),
 * BOUNDARY (a leaf declaring only live commands is untouched), REGRESSION (status silent today).
 */
import { afterEach, describe, expect, it } from "vitest";
import { MINI_CLI, buildMiniCorpus, type MiniCorpus } from "../../helpers/coverage-mini-corpus";

const corpora: MiniCorpus[] = [];
afterEach(() => {
  for (const c of corpora.splice(0)) c.dispose();
});

const REGISTRY_ABG = `export const COMMAND_LOADERS = {
  alpha: () => import("./commands/alpha.js"),
  beta: () => import("./commands/beta.js"),
  gamma: () => import("./commands/gamma.js"),
};
`;
const REGISTRY_AB = REGISTRY_ABG.replace('  gamma: () => import("./commands/gamma.js"),\n', "");

/** Leaf A declares alpha and gamma; the registry then drops gamma, so gamma is a stale declaration. */
async function withStaleGamma(): Promise<MiniCorpus> {
  const c = await buildMiniCorpus();
  corpora.push(c);
  c.writeSource(`${MINI_CLI}/index.ts`, REGISTRY_ABG);
  c.writeSource(`${MINI_CLI}/commands/gamma.ts`, `export default { run() { return 0; } };\n`);
  expect((await c.run(["baseline", "map", c.leafA, "--command", "gamma"])).exitCode).toBe(0);
  c.writeSource(`${MINI_CLI}/index.ts`, REGISTRY_AB);
  return c;
}

describe("approving a baseline leaf refuses while it declares a command absent from main (task-approving-a-baseline-leaf-refuses-while-it-declares-a)", () => {
  it("leaf approval refuses with exit 4, names gamma and the fix; after removal it approves", async () => {
    const c = await withStaleGamma();
    const refused = await c.run(["approve", c.leafA]);
    expect(refused.exitCode, refused.stdout + refused.stderr).toBe(4);
    expect(refused.stderr).toContain(`"gamma"`);
    expect(refused.stderr).toContain(`lore baseline map ${c.leafA} --remove-command "gamma"`);
    expect(refused.stderr).not.toContain(`"alpha"`);
    expect((await c.run(["baseline", "map", c.leafA, "--remove-command", "gamma"])).exitCode).toBe(0);
    const ok = await c.run(["approve", c.leafA]);
    expect(ok.exitCode, ok.stdout + ok.stderr).toBe(0);
  }, 120_000);

  it("approving the branch holding the stale leaf refuses too, naming the leaf", async () => {
    const c = await withStaleGamma();
    const refused = await c.run(["approve", c.branch]);
    expect(refused.exitCode, refused.stdout + refused.stderr).toBe(4);
    expect(refused.stderr).toContain(`lore baseline map ${c.leafA} --remove-command "gamma"`);
  }, 120_000);

  it("`set --status approved` is refused the same way (the service gates every road), and approves after removal", async () => {
    const c = await withStaleGamma();
    const refused = await c.run(["set", c.leafA, "--status", "approved"]);
    expect(refused.exitCode, refused.stdout + refused.stderr).toBe(4);
    expect(refused.stderr).toContain(`lore baseline map ${c.leafA} --remove-command "gamma"`);
    expect((await c.run(["baseline", "map", c.leafA, "--remove-command", "gamma"])).exitCode).toBe(0);
    const ok = await c.run(["set", c.leafA, "--status", "approved"]);
    expect(ok.exitCode, ok.stdout + ok.stderr).toBe(0);
  }, 120_000);

  it("a leaf declaring only live commands approves untouched", async () => {
    const c = await withStaleGamma();
    const ok = await c.run(["approve", c.leafB]);
    expect(ok.exitCode, ok.stdout + ok.stderr).toBe(0);
  }, 120_000);

  it("status --json carries the leaf and command; the text report shows the count and the names", async () => {
    const c = await withStaleGamma();
    const json = await c.run(["status", "--json"]);
    expect(json.exitCode, json.stdout + json.stderr).toBe(0);
    const data = (JSON.parse(json.stdout) as { data: { absent_declared_commands: { leaf: string; commands: { command: string; fix: string }[] }[] | null } }).data;
    expect(data.absent_declared_commands).toEqual([
      { leaf: c.leafA, commands: [{ command: "gamma", fix: `lore baseline map ${c.leafA} --remove-command "gamma"` }] },
    ]);
    const text = await c.run(["status"]);
    expect(text.stdout).toContain("Leaves declaring a command absent from main's tree: 1");
    expect(text.stdout).toContain(`${c.leafA}: gamma`);
  }, 120_000);

  it("status reports an empty list once the stale declaration is removed", async () => {
    const c = await withStaleGamma();
    await c.run(["baseline", "map", c.leafA, "--remove-command", "gamma"]);
    const json = await c.run(["status", "--json"]);
    const data = (JSON.parse(json.stdout) as { data: { absent_declared_commands: unknown[] } }).data;
    expect(data.absent_declared_commands).toEqual([]);
    expect((await c.run(["status"])).stdout).not.toContain("absent from main's tree");
  }, 120_000);
});

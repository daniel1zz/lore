// @reads packages/lore/src/adapters/cli/**
// @reads scripts/check-unclaimed-oracle.ts
// @reads assets/governance/write-spec-rule.md
// @reads assets/project/lore-config-template.yaml
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
import { DECIDED_FLAGS } from "../../helpers/decision-flags";
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

/**
 * Leaf A declares alpha and gamma; the registry then drops gamma, so gamma is a stale declaration.
 *
 * @param approved - true: gamma was APPROVED while the registry still had it (the legacy stale shape `status` reports); false:
 *   gamma is a PENDING revision of the leaf (a command declaration is pending until approved, BR-628)
 */
async function withStaleGamma(approved: boolean): Promise<MiniCorpus> {
  const c = await buildMiniCorpus({ autoApprove: approved });
  corpora.push(c);
  c.writeSource(`${MINI_CLI}/index.ts`, REGISTRY_ABG);
  c.writeSource(`${MINI_CLI}/commands/gamma.ts`, `export default { run() { return 0; } };\n`);
  expect((await c.run(["baseline", "map", c.leafA, "--command", "gamma", ...DECIDED_FLAGS])).exitCode).toBe(0);
  c.writeSource(`${MINI_CLI}/index.ts`, REGISTRY_AB);
  return c;
}

/** The status the tree prints for a node. */
async function statusLineOf(c: MiniCorpus, slug: string): Promise<string> {
  const tree = await c.run(["baseline", "tree"]);
  return tree.stdout.split("\n").find((l) => l.includes(`(${slug},`)) ?? "";
}

describe("approving a baseline leaf refuses while it declares a command absent from main (task-approving-a-baseline-leaf-refuses-while-it-declares-a)", () => {
  it("leaf approval refuses with exit 4, names gamma and the fix; after removal nothing is pending and the leaf is approved", async () => {
    const c = await withStaleGamma(false);
    expect((await c.run(["review", c.leafA])).exitCode).toBe(0);
    const refused = await c.run(["approve", c.leafA]);
    expect(refused.exitCode, refused.stdout + refused.stderr).toBe(4);
    expect(refused.stderr).toContain(`"gamma"`);
    expect(refused.stderr).toContain(`lore baseline map ${c.leafA} --remove-command "gamma"`);
    expect(refused.stderr).not.toContain(`"alpha"`);
    expect((await c.run(["baseline", "map", c.leafA, "--remove-command", "gamma", ...DECIDED_FLAGS])).exitCode).toBe(0);
    // removing the declaration drops the pending revision: the leaf reads as its approved self again
    expect(await statusLineOf(c, c.leafA)).toContain(`(${c.leafA}, approved)`);
  }, 120_000);

  it("approving the branch holding an approved stale leaf refuses too, naming the leaf", async () => {
    const c = await withStaleGamma(true);
    expect((await c.runRaw(["baseline", "set-label", c.branch, "A new branch label", ...DECIDED_FLAGS])).exitCode).toBe(0);
    expect((await c.run(["review", c.branch])).exitCode).toBe(0);
    const refused = await c.run(["approve", c.branch]);
    expect(refused.exitCode, refused.stdout + refused.stderr).toBe(4);
    expect(refused.stderr).toContain(`lore baseline map ${c.leafA} --remove-command "gamma"`);
  }, 120_000);

  it("`set --status approved` is refused on a baseline node (its status is derived); the leaf stays draft", async () => {
    const c = await withStaleGamma(false);
    const refused = await c.run(["set", c.leafA, "--status", "approved"]);
    expect(refused.exitCode, refused.stdout + refused.stderr).toBe(4);
    expect(refused.stderr).toContain("derived");
    expect(await statusLineOf(c, c.leafA)).toContain("draft (1 pending)");
  }, 120_000);

  it("a leaf declaring only live commands approves untouched", async () => {
    const c = await withStaleGamma(false);
    expect((await c.run(["baseline", "map", c.leafB, "--command", "alpha", ...DECIDED_FLAGS])).exitCode).toBe(0);
    expect((await c.run(["review", c.leafB])).exitCode).toBe(0);
    const ok = await c.run(["approve", c.leafB]);
    expect(ok.exitCode, ok.stdout + ok.stderr).toBe(0);
  }, 120_000);

  it("status --json carries the leaf and command; the text report shows the count and the names", async () => {
    const c = await withStaleGamma(true);
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
    const c = await withStaleGamma(true);
    await c.run(["baseline", "map", c.leafA, "--remove-command", "gamma", ...DECIDED_FLAGS]);
    const json = await c.run(["status", "--json"]);
    const data = (JSON.parse(json.stdout) as { data: { absent_declared_commands: unknown[] } }).data;
    expect(data.absent_declared_commands).toEqual([]);
    expect((await c.run(["status"])).stdout).not.toContain("absent from main's tree");
  }, 120_000);
});

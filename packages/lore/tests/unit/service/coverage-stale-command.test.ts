// @reads packages/lore/src/adapters/cli/**
/**
 * Task task-root-coverage-reports-a-declared-command-that-no-longer: a leaf-declared command the registry no longer has is a coverage DEFECT, not a census error.
 * `lore baseline coverage <root>` (and the leaf-level run) exits exactly 1 naming `stale command <cmd>` on the leaf
 * with the fix `lore baseline map <leaf> --remove-command "<cmd>"`; it never exits 4 with a `command-unresolved`
 * census error. Census errors stay for genuinely unanalysable trees (see compiled-root-coverage.bun.test.ts).
 *
 * Fixture: tests/helpers/coverage-mini-corpus.ts (throwaway checkout + corpus; never the repo's .lore/).
 * Dimensions: HAPPY (control exit 0), NEGATIVE (registry dropped it / its file is gone -> exit 1), REGRESSION
 * (never exit 4, never `command-unresolved`), BOUNDARY (JSON shape; the other leaf stays measured).
 *
 */
import { afterEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
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

/** Leaf A declares alpha AND gamma; everything is accounted for and the registry lists gamma: the exit-0 baseline. */
async function withGammaDeclared(): Promise<MiniCorpus> {
  const c = await buildMiniCorpus();
  corpora.push(c);
  c.writeSource(`${MINI_CLI}/index.ts`, REGISTRY_ABG);
  c.writeSource(`${MINI_CLI}/commands/gamma.ts`, `export default { run() { return 0; } };\n`);
  await c.mapAllSites(c.leafA, "alpha");
  await c.mapAllSites(c.leafB, "beta");
  expect((await c.run(["baseline", "map", c.leafA, "--command", "gamma"])).exitCode).toBe(0);
  await c.mapAllSites(c.leafA, "gamma");
  return c;
}

describe("stale declared command is a coverage defect (task-root-coverage-reports-a-declared-command-that-no-longer)", () => {
  it("control: gamma still in the registry -> exit 0", async () => {
    const c = await withGammaDeclared();
    const r = await c.run(["baseline", "coverage", c.root]);
    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).not.toContain("stale command");
  }, 120_000);

  it("registry dropped gamma (file remains) -> root exit exactly 1 naming stale command gamma with the fix", async () => {
    const c = await withGammaDeclared();
    c.writeSource(`${MINI_CLI}/index.ts`, REGISTRY_AB);
    const r = await c.run(["baseline", "coverage", c.root]);
    expect(r.stdout + r.stderr).not.toContain("command-unresolved");
    expect(r.exitCode, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toContain("stale command gamma");
    expect(r.stdout).toContain(`lore baseline map ${c.leafA} --remove-command "gamma"`);
    expect(r.stdout).not.toContain("stale command alpha");
  }, 120_000);

  it("gamma's source file deleted too -> still exit 1 (never the exit-4 census error)", async () => {
    const c = await withGammaDeclared();
    c.writeSource(`${MINI_CLI}/index.ts`, REGISTRY_AB);
    rmSync(join(c.dir, MINI_CLI, "commands", "gamma.ts"));
    const r = await c.run(["baseline", "coverage", c.root]);
    expect(r.stdout + r.stderr).not.toContain("command-unresolved");
    expect(r.exitCode, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toContain("stale command gamma");
  }, 120_000);

  it("a leaf-level run on A reports the same stale command", async () => {
    const c = await withGammaDeclared();
    c.writeSource(`${MINI_CLI}/index.ts`, REGISTRY_AB);
    const r = await c.run(["baseline", "coverage", c.leafA]);
    expect(r.exitCode, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toContain("stale command gamma");
    expect(r.stdout).toContain(`lore baseline map ${c.leafA} --remove-command "gamma"`);
  }, 120_000);

  it("--json carries stale_commands per leaf with its fix; the other leaf stays complete", async () => {
    const c = await withGammaDeclared();
    c.writeSource(`${MINI_CLI}/index.ts`, REGISTRY_AB);
    const r = await c.run(["baseline", "coverage", c.root, "--json"]);
    expect(r.exitCode).toBe(1);
    const data = (JSON.parse(r.stdout) as { data: { complete: boolean; leaves: { slug: string; ok: boolean; stale_commands: { command: string; fix: string }[] }[] } }).data;
    expect(data.complete).toBe(false);
    const a = data.leaves.find((l) => l.slug === c.leafA);
    const b = data.leaves.find((l) => l.slug === c.leafB);
    expect(a?.ok).toBe(false);
    expect(a?.stale_commands).toEqual([{ command: "gamma", fix: `lore baseline map ${c.leafA} --remove-command "gamma"` }]);
    expect(b?.ok).toBe(true);
    expect(b?.stale_commands).toEqual([]);
  }, 120_000);

  it("removing the stale declaration (the printed fix) clears it: exit 0", async () => {
    const c = await withGammaDeclared();
    c.writeSource(`${MINI_CLI}/index.ts`, REGISTRY_AB);
    expect((await c.run(["baseline", "map", c.leafA, "--remove-command", "gamma"])).exitCode).toBe(0);
    const r = await c.run(["baseline", "coverage", c.root]);
    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
  }, 120_000);
});

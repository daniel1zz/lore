// @reads packages/lore/src/adapters/cli/**
// @reads assets/governance/write-spec-rule.md
// @reads assets/project/lore-config-template.yaml
/**
 * Task task-root-coverage-reports-a-declared-command-that-no-longer: a leaf-declared command the analysed tree does not
 * have is REPORTED, never a census error and never a coverage defect. A branch that adds a command must declare it in the
 * shared corpus before it lands, so every other branch's tree lacks it until then; refusing it would block every other
 * integrate. `lore baseline coverage <root>` (and the leaf-level run) prints `declared command not in this tree: <cmd>` with
 * the fix `lore baseline map <leaf> --remove-command "<cmd>"` (right if stale) and keeps its exit code and `complete` as if
 * the declaration were not there. A leaf whose declared commands are ALL absent is measured as if command-less (by the
 * sites it owns). Census errors stay for genuinely unanalysable trees (see compiled-root-coverage.bun.test.ts).
 *
 * Fixture: tests/helpers/coverage-mini-corpus.ts (throwaway checkout + corpus; never the repo's .lore/).
 * Dimensions: HAPPY (control; absent declaration -> exit 0 with the line), NEGATIVE (absent declaration PLUS an unmapped site -> exit 0,
 * the site listed), REGRESSION (never exit 4, never `command-unresolved`), BOUNDARY (JSON shape; all-absent leaf measured by owned sites).
 *
 */
import { afterEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
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

/** Leaf A declares alpha AND gamma; everything is accounted for and the registry lists gamma: the exit-0 baseline. */
async function withGammaDeclared(): Promise<MiniCorpus> {
  const c = await buildMiniCorpus();
  corpora.push(c);
  c.writeSource(`${MINI_CLI}/index.ts`, REGISTRY_ABG);
  c.writeSource(`${MINI_CLI}/commands/gamma.ts`, `export default { run() { return 0; } };\n`);
  await c.mapAllSites(c.leafA, "alpha");
  await c.mapAllSites(c.leafB, "beta");
  expect((await c.run(["baseline", "map", c.leafA, "--command", "gamma", ...DECIDED_FLAGS])).exitCode).toBe(0);
  await c.mapAllSites(c.leafA, "gamma");
  return c;
}

describe("declared command not in this tree is reported, not a defect (task-root-coverage-reports-a-declared-command-that-no-longer)", () => {
  it("control: gamma still in the registry -> exit 0, nothing reported", async () => {
    const c = await withGammaDeclared();
    const r = await c.run(["baseline", "coverage", c.root]);
    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).not.toContain("declared command not in this tree");
  }, 120_000);

  it("registry dropped gamma (file remains) -> exit 0, names it with the --remove-command fix", async () => {
    const c = await withGammaDeclared();
    c.writeSource(`${MINI_CLI}/index.ts`, REGISTRY_AB);
    const r = await c.run(["baseline", "coverage", c.root]);
    expect(r.stdout + r.stderr).not.toContain("command-unresolved");
    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain("declared command not in this tree: gamma");
    expect(r.stdout).toContain(`lore baseline map ${c.leafA} --remove-command "gamma"`);
    expect(r.stdout).not.toContain("declared command not in this tree: alpha");
  }, 120_000);

  it("gamma's source file deleted too -> still exit 0 (never the exit-4 census error)", async () => {
    const c = await withGammaDeclared();
    c.writeSource(`${MINI_CLI}/index.ts`, REGISTRY_AB);
    rmSync(join(c.dir, MINI_CLI, "commands", "gamma.ts"));
    const r = await c.run(["baseline", "coverage", c.root]);
    expect(r.stdout + r.stderr).not.toContain("command-unresolved");
    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain("declared command not in this tree: gamma");
  }, 120_000);

  it("a leaf-level run on A reports the same and stays exit 0", async () => {
    const c = await withGammaDeclared();
    c.writeSource(`${MINI_CLI}/index.ts`, REGISTRY_AB);
    const r = await c.run(["baseline", "coverage", c.leafA]);
    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain("declared command not in this tree: gamma");
  }, 120_000);

  it("--json keeps absent_commands per leaf with its fix; complete stays true", async () => {
    const c = await withGammaDeclared();
    c.writeSource(`${MINI_CLI}/index.ts`, REGISTRY_AB);
    const r = await c.run(["baseline", "coverage", c.root, "--json"]);
    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
    const data = (JSON.parse(r.stdout) as { data: { complete: boolean; leaves: { slug: string; ok: boolean; measured_by: string; absent_commands: { command: string; fix: string }[] }[] } }).data;
    expect(data.complete).toBe(true);
    const a = data.leaves.find((l) => l.slug === c.leafA);
    const b = data.leaves.find((l) => l.slug === c.leafB);
    expect(a).toMatchObject({ ok: true, measured_by: "commands" });
    expect(a?.absent_commands).toEqual([{ command: "gamma", fix: `lore baseline map ${c.leafA} --remove-command "gamma"` }]);
    expect(b?.absent_commands).toEqual([]);
  }, 120_000);

  it("an absent declaration PLUS an unmapped site still exits 0 and lists the site as a gap (report only)", async () => {
    const c = await buildMiniCorpus();
    corpora.push(c);
    // leaf A declares alpha and gamma; alpha's site is never mapped (a real gap); gamma is absent from the registry.
    expect((await c.run(["baseline", "map", c.leafA, "--command", "gamma", ...DECIDED_FLAGS])).exitCode).toBe(0);
    await c.mapAllSites(c.leafB, "beta");
    const r = await c.run(["baseline", "coverage", c.root, "--json"]);
    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
    const data = (JSON.parse(r.stdout) as { data: { complete: boolean; leaves: { slug: string; ok: boolean; gaps: string[]; absent_commands: { command: string }[] }[] } }).data;
    expect(data.complete).toBe(true);
    const a = data.leaves.find((l) => l.slug === c.leafA);
    expect(a?.ok).toBe(false);
    expect(a?.gaps.length).toBeGreaterThan(0);
    expect(a?.absent_commands.map((x) => x.command)).toEqual(["gamma"]);
    const human = await c.run(["baseline", "coverage", c.root]);
    expect(human.stdout).toContain("declared command not in this tree: gamma");
    expect(human.stdout).toContain("gap ");
  }, 120_000);

  it("a leaf whose ONLY declared command is absent is pending, not failed: no live command reaches the site that declares its rule", async () => {
    const c = await withGammaDeclared();
    // beta leaves the registry: leaf B declares only beta, so it is all-absent; the code site declaring its rule is no longer reached (BR-1344).
    c.writeSource(`${MINI_CLI}/index.ts`, REGISTRY_AB.replace('  beta: () => import("./commands/beta.js"),\n', '  gamma: () => import("./commands/gamma.js"),\n'));
    const r = await c.run(["baseline", "coverage", c.root, "--json"]);
    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
    const data = (JSON.parse(r.stdout) as { data: { leaves: { slug: string; ok: boolean; sites: number; measured_by: string; absent_commands: { command: string }[] }[] } }).data;
    const b = data.leaves.find((l) => l.slug === c.leafB);
    expect(b).toMatchObject({ ok: true, sites: 0, measured_by: "absent" });
    expect(b?.absent_commands.map((x) => x.command)).toEqual(["beta"]);
  }, 120_000);

  it("a leaf declaring ONLY absent commands and owning no site is pending, not unmeasured: exit 0, measured_by absent", async () => {
    const c = await buildMiniCorpus();
    corpora.push(c);
    await c.mapAllSites(c.leafA, "alpha");
    await c.mapAllSites(c.leafB, "beta");
    const added = await c.run(["baseline", "add", c.branch, "--node", "leaf", "--label", "lp", "--title", "BCR Leaf Pending"]);
    const pending = (added.stdout.match(/Slug:\s+(\S+)/) ?? added.stdout.match(/Created baseline \w+ (\S+) \(/))?.[1] as string;
    expect((await c.run(["baseline", "map", pending, "--command", "delta", ...DECIDED_FLAGS])).exitCode).toBe(0);
    const r = await c.run(["baseline", "coverage", c.root, "--json"]);
    expect(r.stdout + r.stderr).not.toContain("command-unresolved");
    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
    const data = (JSON.parse(r.stdout) as { data: { complete: boolean; leaves: { slug: string; ok: boolean; sites: number; measured_by: string; absent_commands: { command: string }[] }[] } }).data;
    expect(data.complete).toBe(true);
    expect(data.leaves.find((l) => l.slug === pending)).toMatchObject({ ok: true, sites: 0, measured_by: "absent" });
    const human = await c.run(["baseline", "coverage", c.root]);
    expect(human.stdout).toContain("all declared commands absent from this tree (pending or stale): delta");
    expect(human.stdout).not.toContain("UNMEASURED");
  }, 120_000);

  it("removing the declaration (the printed fix) clears the line: exit 0", async () => {
    const c = await withGammaDeclared();
    c.writeSource(`${MINI_CLI}/index.ts`, REGISTRY_AB);
    expect((await c.run(["baseline", "map", c.leafA, "--remove-command", "gamma", ...DECIDED_FLAGS])).exitCode).toBe(0);
    const r = await c.run(["baseline", "coverage", c.root]);
    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).not.toContain("declared command not in this tree");
  }, 120_000);
});

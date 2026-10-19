// @spawns scripts/check-baseline-coverage.ts
// @spawns packages/lore/src/index.ts
/**
 * AC-BCG-2 (spec-baseline-coverage-refuses-only-undeclared-commands-a-site): the integrate floor step
 * `scripts/check-baseline-coverage.ts` refuses ONLY a runnable command no leaf declares, and never runs the site census.
 *
 * Fixture: the throwaway mini lore checkout of coverage-mini-corpus (two registry commands, each declared, NO site mapped).
 * The step runs as a real process with cwd = the fixture. A bun preload (helpers/census-recorder-preload.ts) wraps the census
 * entry points `listSites` / `listSitesMany` of the lore code the step spawns and logs each call, so "never invokes the census"
 * is measured, not assumed; a control run of `lore baseline coverage` (the full verb) under the same preload must record calls,
 * or the recorder is not live.
 * Dimensions: HAPPY (unmapped only -> 0, zero census calls), NEGATIVE (undeclared -> 1 naming it, zero calls), STATE (control
 * records calls), REGRESSION (the pre-change step exited 1 for the unmapped sites).
 *
 * @spec_ref spec-baseline-coverage-refuses-only-undeclared-commands-a-site#AC-BCG-2
 */
import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MINI_CLI, buildMiniCorpus, type MiniCorpus } from "../../packages/lore/tests/helpers/coverage-mini-corpus";
import { sessionEnvFor } from "../../packages/lore/tests/helpers/session-actor";

const REPO_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const STEP = join(REPO_ROOT, "scripts", "check-baseline-coverage.ts");
const LORE_ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const PRELOAD = join(REPO_ROOT, "scripts", "tests", "helpers", "census-recorder-preload.ts");

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});

async function mini(): Promise<MiniCorpus> {
  const c = await buildMiniCorpus();
  cleanup.push(() => c.dispose());
  return c;
}

function registerGamma(c: MiniCorpus): void {
  c.writeSource(
    `${MINI_CLI}/index.ts`,
    `export const COMMAND_LOADERS = {\n  alpha: () => import("./commands/alpha.js"),\n  beta: () => import("./commands/beta.js"),\n  gamma: () => import("./commands/gamma.js"),\n};\n`,
  );
  c.writeSource(`${MINI_CLI}/commands/gamma.ts`, `export default { run() { return 0; } };\n`);
}

/** Run `bun <args>` in the fixture under the census recorder; returns the exit status, output and the recorded census calls. */
function runRecorded(c: MiniCorpus, args: string[]): { status: number; out: string; censusCalls: string[] } {
  const logDir = mkdtempSync(join(tmpdir(), "bcg-census-log-"));
  cleanup.push(() => rmSync(logDir, { recursive: true, force: true }));
  const log = join(logDir, "calls.log");
  const env = { ...process.env, HOME: join(c.dir, ".home"), CLAUDECODE: "1", ...sessionEnvFor("bcg"), BUN_OPTIONS: `--preload=${PRELOAD}`, CENSUS_CALL_LOG: log };
  const r = spawnSync("bun", args, { cwd: c.dir, env, encoding: "utf8" });
  const censusCalls = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter((l) => l.length > 0) : [];
  return { status: r.status ?? -1, out: `${r.stdout}${r.stderr}`, censusCalls };
}

/**
 * Store `value` as the only site_map entry of `site` on `leaf`, straight into the throwaway corpus (the write verb refuses free
 * text once its own task lands, so the fixture never goes through it). A bun subprocess, because bun:sqlite is not loadable here.
 */
function seedSiteMapValue(c: MiniCorpus, leaf: string, site: string, value: string): void {
  const code = `
    import { Database } from "bun:sqlite";
    const [dbPath, slug, site, value] = process.argv.slice(1);
    const db = new Database(dbPath);
    const row = db.query("SELECT extra FROM docs WHERE slug = ?").get(slug);
    if (!row) throw new Error("no doc " + slug);
    const extra = JSON.parse(row.extra);
    extra.site_map = { ...(extra.site_map ?? {}), [site]: [value] };
    db.query("UPDATE docs SET extra = ? WHERE slug = ?").run(JSON.stringify(extra), slug);
    db.close();
  `;
  const r = spawnSync("bun", ["-e", code, join(c.dir, ".lore", "lore.db"), leaf, site, value], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`seeding failed: ${r.stderr}${r.stdout}`);
}

describe("AC-BCG-2 the floor step gates undeclared commands only", () => {
  it("control: the full coverage verb runs the census under the recorder (so zero calls below means something)", async () => {
    const c = await mini();
    const r = runRecorded(c, ["run", LORE_ENTRY, "baseline", "coverage", c.root]);
    expect(r.status, r.out).toBe(0);
    expect(r.censusCalls.length, r.out).toBeGreaterThan(0);
  }, 180_000);

  it("simplest failing case: only unmapped sites -> exit exactly 0 and the census is never invoked", async () => {
    const c = await mini();
    expect((await c.sitesOf("alpha")).length).toBeGreaterThan(0);
    const r = runRecorded(c, [STEP]);
    expect(r.status, r.out).toBe(0);
    expect(r.censusCalls).toEqual([]);
    expect(r.out).toContain("0 undeclared command(s)");
  }, 180_000);

  it("one runnable command no leaf declares -> exit exactly 1 naming it, and the census is never invoked", async () => {
    const c = await mini();
    registerGamma(c);
    const r = runRecorded(c, [STEP]);
    expect(r.status, r.out).toBe(1);
    expect(r.censusCalls).toEqual([]);
    expect(r.out).toMatch(/undeclared\s+gamma/);
    expect(r.out).toContain("fix: lore baseline map <leaf> --command gamma");
  }, 180_000);

  it("a leaf storing a non-BR site_map value does not fail the step: exit exactly 0 when every command is declared, census never run", async () => {
    const c = await mini();
    const [site] = await c.sitesOf("alpha");
    seedSiteMapValue(c, c.leafA, site as string, "non-business: seeded excuse");
    // the full report still exits 2 (corrupt data), proving the seed is really stored and read
    const full = runRecorded(c, ["run", LORE_ENTRY, "baseline", "coverage", c.root]);
    expect(full.status, full.out).toBe(2);
    const r = runRecorded(c, [STEP]);
    expect(r.status, r.out).toBe(0);
    expect(r.censusCalls).toEqual([]);
    expect(r.out).not.toContain("seeded excuse");
  }, 180_000);

  it("with that non-BR value stored, an undeclared command still exits exactly 1 naming it", async () => {
    const c = await mini();
    const [site] = await c.sitesOf("alpha");
    seedSiteMapValue(c, c.leafA, site as string, "non-business: seeded excuse");
    registerGamma(c);
    const r = runRecorded(c, [STEP]);
    expect(r.status, r.out).toBe(1);
    expect(r.censusCalls).toEqual([]);
    expect(r.out).toMatch(/undeclared\s+gamma/);
  }, 180_000);
});

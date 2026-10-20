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

/** Declare a rule id that no baseline node holds at alpha's refusal site, in the tree itself (BR-1344). */
function declareUnknownRuleAtAlpha(c: MiniCorpus): void {
  c.writeSource(`${MINI_CLI}/lib/shared.ts`, `import { err } from "./result.js";\nexport function checkShared() {\n  return err({ code: "ALPHA_BAD", rule: "BR-99999" });\n}\n`);
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

  it("a site declaring an unknown rule does not fail the step: exit exactly 0 when every command is declared, census never run", async () => {
    const c = await mini();
    declareUnknownRuleAtAlpha(c);
    // the full report names the invalid declaration and stays report-only, proving the declaration is really read
    const full = runRecorded(c, ["run", LORE_ENTRY, "baseline", "coverage", c.root]);
    expect(full.status, full.out).toBe(0);
    expect(full.out).toContain("BR-99999");
    const r = runRecorded(c, [STEP]);
    expect(r.status, r.out).toBe(0);
    expect(r.censusCalls).toEqual([]);
    expect(r.out).not.toContain("BR-99999");
  }, 180_000);

  it("with that unknown declaration in the tree, an undeclared command still exits exactly 1 naming it", async () => {
    const c = await mini();
    declareUnknownRuleAtAlpha(c);
    registerGamma(c);
    const r = runRecorded(c, [STEP]);
    expect(r.status, r.out).toBe(1);
    expect(r.censusCalls).toEqual([]);
    expect(r.out).toMatch(/undeclared\s+gamma/);
  }, 180_000);
});

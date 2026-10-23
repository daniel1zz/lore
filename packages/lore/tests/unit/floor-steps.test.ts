// @reads scripts/run-chain.ts -- the floor / plan-close declaration is imported in-process
// @spawns scripts/run-chain.ts -- the --list cases run the real runner as a child process
// @reads package.json -- the coverage case reads every check: script
// @reads packages/lore/src/service/integrate-service.ts -- the own-diff-before-floor ordering is pinned on the source
// @layer script-unit AC-LG-5
/**
 * Lean integrate floor (AC-LG-5, BR-1368): the floor is install + build + typecheck; every other `check:*` script
 * runs at plan close. One declaration (scripts/run-chain.ts) feeds `--floor`, `--plan-close` and `--list`.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveFloorSteps, derivePlanCloseSteps, FLOOR_STEPS, PLAN_CLOSE_STEPS, unlistedChecks } from "../../../../scripts/run-chain";

const ROOT = join(__dirname, "..", "..", "..", "..");
const scripts = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;

function list(flag: string): { status: number | null; lines: string[] } {
  const r = spawnSync("bun", ["scripts/run-chain.ts", flag, "--list"], { cwd: ROOT, encoding: "utf8" });
  return { status: r.status, lines: r.stdout.split("\n").filter((l) => l !== "") };
}

describe("lean floor (AC-LG-5)", () => {
  it("lean floor: --floor --list prints exactly install, build, typecheck, one per line (real spawn)", () => {
    const r = list("--floor");
    expect(r.status).toBe(0);
    expect(r.lines).toEqual(["install", "build", "typecheck"]);
    expect([...FLOOR_STEPS]).toEqual(["install", "build", "typecheck"]);
  });

  it("lean floor: the floor runs only install/build/typecheck commands, no check: script", () => {
    expect(deriveFloorSteps(scripts)).toEqual(["bun install --frozen-lockfile", "bun run build", "bun run typecheck"]);
  });

  it("lean floor: plan-close lists every other check: script, including the two corpus judges, and --plan-close --list prints them", () => {
    expect(PLAN_CLOSE_STEPS).toContain("check:baseline-coverage");
    expect(PLAN_CLOSE_STEPS).toContain("check:ac-oracle-ownership");
    const r = list("--plan-close");
    expect(r.status).toBe(0);
    expect(r.lines).toEqual([...PLAN_CLOSE_STEPS]);
    expect(derivePlanCloseSteps(scripts)).toEqual(PLAN_CLOSE_STEPS.map((n) => `bun run ${n}`));
  });

  it("lean floor: every check: script in package.json is in exactly one of the two lists (none unlisted, none dual)", () => {
    expect(unlistedChecks(scripts)).toEqual([]);
    expect(PLAN_CLOSE_STEPS.filter((n) => (FLOOR_STEPS as readonly string[]).includes(n))).toEqual([]);
    expect(scripts["check:plan-close"]).toBe("bun scripts/run-chain.ts --plan-close");
  });

  it("lean floor: a check: script in neither list is reported (negative control)", () => {
    expect(unlistedChecks({ ...scripts, "check:brand-new": "x" })).toEqual(["check:brand-new"]);
    const { "check:baseline-coverage": _dropped, ...without } = scripts;
    expect(() => derivePlanCloseSteps(without)).toThrow(/check:baseline-coverage/);
  });

  it("lean floor: lore integrate judges the own diff before the floor command and refuses on it independently", () => {
    const src = readFileSync(join(ROOT, "packages/lore/src/service/integrate-service.ts"), "utf8");
    const judged = src.indexOf("await this.judgeOwnDiff(request.branch, tip)");
    const refused = src.indexOf("if (!footprint.ok) return footprint;");
    const floorRun = src.indexOf("this.landOn(request, request.floorCommand");
    expect(judged).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(judged);
    expect(floorRun).toBeGreaterThan(refused);
  });
});

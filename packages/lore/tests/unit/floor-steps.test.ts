// @reads scripts/run-chain.ts -- the floor / plan-close declaration is imported in-process
// @spawns scripts/run-chain.ts -- the --list cases run the real runner as a child process
// @reads package.json -- the coverage case reads every check: script
// @reads packages/lore/src/service/integrate-service.ts -- the own-diff-before-floor ordering is pinned on the source
// @spawns scripts/check-baseline-coverage.ts -- the unrelated-diff case runs the real :changed step in a throwaway git repo
// @spawns scripts/check-ac-oracle-ownership.ts -- the unrelated-diff case runs the real :changed step in a throwaway git repo
// @reads scripts/changed-files.ts -- name-status parsing and base resolution
// @reads scripts/check-test-budgets.ts -- pinned absent (the retired check)
// @reads scripts/test-budget-ledger.json -- pinned absent (the retired ledger)
// @reads scripts/tests/check-test-budgets.test.ts -- pinned absent (the retired check's test)
// @reads vitest.shared.ts -- testTimeout 30000 is pinned on the source
// @layer script-unit AC-LG-5
/**
 * Lean integrate floor (AC-LG-5, BR-1368): the floor is install + build + typecheck + the two :changed checks that caught real
 * defects; every other `check:*` script runs at plan close. One declaration (scripts/run-chain.ts) feeds `--floor`,
 * `--plan-close` and `--list`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { addedCommands, coverageArgs, mainChanged as baselineChanged, mainFull, registryChanged, type CoverageData } from "../../../../scripts/check-baseline-coverage";
import { mainChanged as ownershipChanged, type ScriptAc } from "../../../../scripts/check-ac-oracle-ownership";
import { changedFiles, parseNameStatus, resolveBase, type ChangedFile } from "../../../../scripts/changed-files";
import { deriveFloorSteps, derivePlanCloseSteps, FLOOR_STEPS, PLAN_CLOSE_STEPS, unlistedChecks } from "../../../../scripts/run-chain";

const ROOT = join(__dirname, "..", "..", "..", "..");
const scripts = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
const FLOOR = ["install", "build", "typecheck", "baseline-coverage:changed", "ac-oracle-ownership:changed", "test-spawns:changed"];

function list(flag: string): { status: number | null; lines: string[] } {
  const r = spawnSync("bun", ["scripts/run-chain.ts", flag, "--list"], { cwd: ROOT, encoding: "utf8" });
  return { status: r.status, lines: r.stdout.split("\n").filter((l) => l !== "") };
}

const scratch: string[] = [];
afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

function sh(cwd: string, cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed: ${r.stderr}`);
}

/** A throwaway repo on `main` holding one base commit, then a feature branch carrying `edit`, committed. */
function fixtureRepo(edit: (dir: string) => void): string {
  const dir = mkdtempSync(join(tmpdir(), "lean-floor-"));
  scratch.push(dir);
  sh(dir, "git", ["init", "-q", "-b", "main"]);
  sh(dir, "git", ["config", "user.email", "t@example.com"]);
  sh(dir, "git", ["config", "user.name", "t"]);
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "docs", "readme.md"), "base\n");
  sh(dir, "git", ["add", "-A"]);
  sh(dir, "git", ["commit", "-q", "-m", "base"]);
  sh(dir, "git", ["checkout", "-q", "-b", "feature"]);
  edit(dir);
  sh(dir, "git", ["add", "-A"]);
  sh(dir, "git", ["commit", "-q", "-m", "change"]);
  return dir;
}

function runStep(script: string, cwd: string): { status: number | null; seconds: number; out: string } {
  const t0 = Date.now();
  const r = spawnSync("bun", [join(ROOT, "scripts", script), "--changed"], { cwd, encoding: "utf8" });
  return { status: r.status, seconds: (Date.now() - t0) / 1000, out: `${r.stdout}${r.stderr}` };
}

const cov = (...commands: string[]): CoverageData[] => [{ target: "root", complete: commands.length === 0, undeclared_commands: commands.map((command) => ({ command, fix: `fix ${command}` })) }];
const CMD_DIR = "packages/lore/src/adapters/cli/commands";
const REG = "packages/lore/src/adapters/cli/index.ts";

describe("lean floor (AC-LG-5)", () => {
  it("lean floor: --floor --list prints exactly install, build, typecheck and the two :changed steps, one per line (real spawn)", () => {
    const r = list("--floor");
    expect(r.status).toBe(0);
    expect(r.lines).toEqual(FLOOR);
    expect([...FLOOR_STEPS]).toEqual(FLOOR);
  });

  it("lean floor: the floor runs install/build/typecheck and the two :changed scripts, no other check: script", () => {
    expect(deriveFloorSteps(scripts)).toEqual(["bun install --frozen-lockfile", "bun run build", "bun run typecheck", "bun run check:baseline-coverage:changed", "bun run check:ac-oracle-ownership:changed", "bun run check:test-spawns:changed"]);
    const { "check:ac-oracle-ownership:changed": _dropped, ...without } = scripts;
    expect(() => deriveFloorSteps(without)).toThrow(/check:ac-oracle-ownership:changed/);
  });

  it("lean floor: plan-close lists every other check: script, including the full corpus judges, and --plan-close --list prints them", () => {
    expect(PLAN_CLOSE_STEPS).toContain("check:baseline-coverage");
    expect(PLAN_CLOSE_STEPS).toContain("check:ac-oracle-ownership");
    const r = list("--plan-close");
    expect(r.status).toBe(0);
    expect(r.lines).toEqual([...PLAN_CLOSE_STEPS]);
    expect(derivePlanCloseSteps(scripts)).toEqual(PLAN_CLOSE_STEPS.map((n) => `bun run ${n}`));
  });

  it("lean floor: every check: script in package.json is in exactly one of the two lists (none unlisted, none dual)", () => {
    expect(unlistedChecks(scripts)).toEqual([]);
    expect(PLAN_CLOSE_STEPS.filter((n) => (FLOOR_STEPS as readonly string[]).includes(n.replace(/^check:/, "")))).toEqual([]);
    expect(scripts["check:plan-close"]).toBe("bun scripts/run-chain.ts --plan-close");
  });

  it("lean floor: a check: script in neither list is reported (negative control)", () => {
    expect(unlistedChecks({ ...scripts, "check:brand-new": "x" })).toEqual(["check:brand-new"]);
    const { "check:baseline-coverage": _dropped, ...without } = scripts;
    expect(() => derivePlanCloseSteps(without)).toThrow(/check:baseline-coverage/);
  });

  it("lean floor: check:test-budgets, its ledger, its checker and its test no longer exist; vitest sets testTimeout 30000", () => {
    expect(scripts["check:test-budgets"]).toBeUndefined();
    expect(PLAN_CLOSE_STEPS).not.toContain("check:test-budgets");
    for (const gone of ["scripts/check-test-budgets.ts", "scripts/test-budget-ledger.json", "scripts/tests/check-test-budgets.test.ts"]) {
      expect(existsSync(join(ROOT, gone)), gone).toBe(false);
    }
    expect(readFileSync(join(ROOT, "vitest.shared.ts"), "utf8")).toMatch(/testTimeout:\s*30000/);
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

  it("lean floor: name-status parsing expands a rename to a deletion of the old path plus an addition of the new", () => {
    expect(parseNameStatus("A\ta.ts\nM\tb.ts\nD\tc.ts\nR100\told.test.ts\tnew.test.ts\n")).toEqual([
      { status: "A", path: "a.ts" },
      { status: "M", path: "b.ts" },
      { status: "D", path: "c.ts" },
      { status: "D", path: "old.test.ts" },
      { status: "A", path: "new.test.ts" },
    ]);
    expect(() => parseNameStatus("Z\tx\n")).toThrow(/unknown status/);
  });

  it("lean floor: the diff base is merge-base with main, and an unresolvable base throws instead of reporting no change", () => {
    const dir = fixtureRepo((d) => writeFileSync(join(d, "docs", "new.md"), "x\n"));
    const base = resolveBase(dir, {});
    expect(changedFiles(dir, base)).toEqual([{ status: "A", path: "docs/new.md" }]);
    const bare = mkdtempSync(join(tmpdir(), "lean-floor-bare-"));
    scratch.push(bare);
    sh(bare, "git", ["init", "-q", "-b", "trunk"]);
    expect(() => resolveBase(bare, {})).toThrow(/cannot resolve the diff base/);
  });

  describe("baseline-coverage:changed", () => {
    const touchesCommand: ChangedFile[] = [{ status: "M", path: `${CMD_DIR}/ac.ts` }];

    it("lean floor: a branch adding an undeclared command fails baseline-coverage:changed, naming it", () => {
      const lines: string[] = [];
      const exit = baselineChanged({ changed: () => touchesCommand, registryAddedLines: () => "", coverage: () => cov("ac brand-new") }, (l) => lines.push(l));
      expect(exit).toBe(1);
      expect(lines.join("\n")).toContain("ac brand-new");
    });

    it("lean floor: a command added at the registry index fails too; an undeclared command in an untouched module does not (older debt)", () => {
      const registry: ChangedFile[] = [{ status: "M", path: REG }];
      expect(baselineChanged({ changed: () => registry, registryAddedLines: () => '+  newcmd: () => import("./commands/newcmd.js"),\n+  "newcmd"', coverage: () => cov("newcmd") }, () => {})).toBe(1);
      expect(baselineChanged({ changed: () => touchesCommand, registryAddedLines: () => "", coverage: () => cov("stash drop") }, () => {})).toBe(0);
      expect(addedCommands(["ac add", "stash drop"], touchesCommand, "")).toEqual(["ac add"]);
    });

    // A fake of `lore baseline coverage --commands-only` over one leaf: it reads the CLI arguments the script built, so the verdict
    // depends on whether the script asked for pending declarations (AC-LG-5, BR-1368).
    const coverageFake = (added: string, approved: string[], pending: string[]) => (includePending: boolean): CoverageData[] => {
      const declared = includePending ? [...approved, ...pending] : approved;
      return cov(...(declared.includes(added) ? [] : [added]));
    };
    const asChangedCoverage = (fake: (p: boolean) => CoverageData[]) => (): CoverageData[] => fake(coverageArgs("root", true).includes("--include-pending"));

    it("lean floor: a command the branch adds, declared only in a leaf's pending revision, passes baseline-coverage:changed (exit 0)", () => {
      const fake = coverageFake("ac brand-new", [], ["ac brand-new"]);
      expect(coverageArgs("root", true)).toContain("--include-pending");
      expect(baselineChanged({ changed: () => touchesCommand, registryAddedLines: () => "", coverage: asChangedCoverage(fake) }, () => {})).toBe(0);
    });

    it("lean floor: a command the branch adds with no declaration anywhere fails baseline-coverage:changed, naming it (exit 1)", () => {
      const lines: string[] = [];
      const fake = coverageFake("ac brand-new", [], []);
      expect(baselineChanged({ changed: () => touchesCommand, registryAddedLines: () => "", coverage: asChangedCoverage(fake) }, (l) => lines.push(l))).toBe(1);
      expect(lines.join("\n")).toContain("ac brand-new");
    });

    it("lean floor: the full plan-close coverage run counts approved declarations only, so a pending-only declaration fails it (exit 1)", () => {
      expect(coverageArgs("root", false)).not.toContain("--include-pending");
      const asked: boolean[] = [];
      const fake = coverageFake("ac brand-new", [], ["ac brand-new"]);
      const lines: string[] = [];
      expect(mainFull((p) => (asked.push(p), fake(p)), (l) => lines.push(l))).toBe(1);
      expect(asked).toEqual([false]);
      expect(lines.join("\n")).toContain("ac brand-new");
    });

    it("lean floor: a declared-everything branch passes even when it touched the registry", () => {
      expect(baselineChanged({ changed: () => touchesCommand, registryAddedLines: () => "", coverage: () => cov() }, () => {})).toBe(0);
    });

    it("lean floor: a diff touching no registry file never reads coverage, exits 0 in under 5 s (real spawn, throwaway repo)", () => {
      expect(registryChanged([{ status: "M", path: "docs/readme.md" }])).toBe(false);
      expect(registryChanged([{ status: "A", path: `${CMD_DIR}/x.ts` }])).toBe(true);
      const dir = fixtureRepo((d) => writeFileSync(join(d, "docs", "readme.md"), "changed\n"));
      const r = runStep("check-baseline-coverage.ts", dir);
      expect(r.out).toContain("nothing to declare");
      expect(r.status).toBe(0);
      expect(r.seconds).toBeLessThan(5);
    });
  });

  describe("ac-oracle-ownership:changed", () => {
    const ac = (id: string, file: string): ScriptAc => ({ spec: "spec-x", id, command: `bun run test:file ${file} -t '${id}'` });
    const OWNER = "packages/lore/tests/unit/owned.test.ts";

    it("lean floor: a branch deleting an AC's owner test fails ac-oracle-ownership:changed, naming the AC", () => {
      const lines: string[] = [];
      const exit = ownershipChanged({ changed: () => [{ status: "D", path: OWNER }], scriptAcs: () => [ac("AC-X-1", OWNER)], readTestFile: () => undefined }, (l) => lines.push(l));
      expect(exit).toBe(1);
      expect(lines.join("\n")).toMatch(/rule=missing-owner-file spec=spec-x ac=AC-X-1/);
    });

    it("lean floor: renaming the owner away fails; editing an owner that still exists and references only its own AC passes", () => {
      const renamed: ChangedFile[] = [{ status: "D", path: OWNER }, { status: "A", path: "packages/lore/tests/unit/renamed.test.ts" }];
      expect(ownershipChanged({ changed: () => renamed, scriptAcs: () => [ac("AC-X-1", OWNER)], readTestFile: (p) => (p === OWNER ? undefined : "it('AC-X-9 other', () => {})") }, () => {})).toBe(1);
      expect(ownershipChanged({ changed: () => [{ status: "M", path: OWNER }], scriptAcs: () => [ac("AC-X-1", OWNER)], readTestFile: () => "it('AC-X-1 holds', () => {})" }, () => {})).toBe(0);
    });

    it("lean floor: an edited test referencing an AC id it does not own fails (unowned-ac-reference); a missing owner of an untouched file is ignored", () => {
      const other = "packages/lore/tests/unit/other.test.ts";
      expect(
        ownershipChanged({ changed: () => [{ status: "M", path: other }], scriptAcs: () => [ac("AC-X-1", OWNER)], readTestFile: () => "it('AC-X-1 stolen', () => {})" }, () => {}),
      ).toBe(1);
      expect(
        ownershipChanged({ changed: () => [{ status: "M", path: other }], scriptAcs: () => [ac("AC-X-2", "packages/lore/tests/unit/never-existed.test.ts")], readTestFile: () => "it('plain', () => {})" }, () => {}),
      ).toBe(0);
    });

    it("lean floor: zero visible script ACs over a touched test file is a failure, never a pass", () => {
      expect(ownershipChanged({ changed: () => [{ status: "M", path: OWNER }], scriptAcs: () => [], readTestFile: () => "" }, () => {})).toBe(1);
    });

    it("lean floor: a diff touching no test file never reads the corpus, exits 0 in under 5 s (real spawn, throwaway repo)", () => {
      const dir = fixtureRepo((d) => writeFileSync(join(d, "docs", "readme.md"), "changed\n"));
      const r = runStep("check-ac-oracle-ownership.ts", dir);
      expect(r.out).toContain("nothing to judge");
      expect(r.status).toBe(0);
      expect(r.seconds).toBeLessThan(5);
    });
  });
});

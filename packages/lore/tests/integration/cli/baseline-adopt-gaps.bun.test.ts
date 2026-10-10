/**
 * Gap cases of Baseline slice 3a group E that the RED files left open, decided by the orchestrator:
 *   G1. A no-op adopt (state unchanged) writes no audit row, prints `no change`, exits 0.
 *   G2. No stored mode: with baseline docs `lore status --json` reports data.ac_cite = { mode: <effective default>, provenance: "default" }; with no baseline docs it omits ac_cite (AC-BLS2-11).
 *   G3. `--arm X --disarm X` in one call exits 2 and writes nothing.
 *   G4. `lore setup --project --uninstall` removes the installed lore-baseline skill files (ledger-driven).
 *
 * Every case runs in a `mkdtemp` repo + corpus; the repo's own `.lore/` is never touched.
 *
 * @spec_ref AC-BLS3-7
 * @spec_ref AC-BLS3-8
 */

import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

setDefaultTimeout(300_000);

const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const ACTOR = "agent:adopt-gaps-test";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLore(args: string[], cwd: string): RunResult {
  const env = { ...process.env, HOME: cwd, CLAUDECODE: "1", LORE_ACTOR: ACTOR };
  const proc = Bun.spawnSync(["bun", "run", ENTRY, ...args], { cwd, env });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function mustRun(args: string[], cwd: string): RunResult {
  const r = runLore(args, cwd);
  if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r;
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
}

function slugOf(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/) ?? stdout.match(/Created baseline \w+ (\S+) \(/);
  if (!m?.[1]) throw new Error(`no slug in: ${stdout}`);
  return m[1];
}

const scratch: string[] = [];

function makeRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "bag-repo-")));
  scratch.push(dir);
  if (dir.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "bag@example.invalid"]);
  git(dir, ["config", "user.name", "bag test"]);
  writeFileSync(join(dir, "README.md"), "fixture\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "init"]);
  mustRun(["init"], dir);
  return dir;
}

const configText = (repo: string): string => readFileSync(join(repo, ".lore", "config.yaml"), "utf8");

function adoptRowCount(repo: string): number {
  const parsed = JSON.parse(mustRun(["audit", "--json", "--limit", "1000"], repo).stdout) as { data: { entries: { action: string }[] } };
  return parsed.data.entries.filter((e) => e.action === "baseline_adopt").length;
}

function acCite(repo: string): { mode?: string; provenance?: string } | undefined {
  const parsed = JSON.parse(mustRun(["status", "--json"], repo).stdout) as { data: { ac_cite?: { mode?: string; provenance?: string } } };
  return parsed.data.ac_cite;
}

let withBaseline = "";
let branchA = "";

beforeAll(() => {
  withBaseline = makeRepo();
  const prd = slugOf(mustRun(["create", "prd", "--title", "BAG PRD", "--content", "root", "--no-ai"], withBaseline).stdout);
  const root = slugOf(mustRun(["baseline", "add", prd, "--node", "root", "--label", "root", "--title", "BAG Root"], withBaseline).stdout);
  branchA = slugOf(mustRun(["baseline", "add", root, "--node", "branch", "--label", "ba", "--title", "BAG Branch A"], withBaseline).stdout);
});

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

describe("baseline adopt gaps (BL-8)", () => {
  it("G2: no stored mode, baseline docs present -> status reports the effective default (report) with provenance default", () => {
    expect(acCite(withBaseline)).toEqual({ mode: "report", provenance: "default" });
  });

  it("G2: no stored mode, no baseline docs -> ac_cite is absent (AC-BLS2-11: slice-1 status output, byte for byte)", () => {
    const bare = makeRepo();
    expect(acCite(bare)).toBeUndefined();
  });

  it("G1: a no-op adopt exits 0, prints `no change`, leaves the config byte-identical and writes no extra row", () => {
    expect(runLore(["baseline", "adopt", "--mode", "enforce", "--arm", branchA], withBaseline).exitCode).toBe(0);
    const rows = adoptRowCount(withBaseline);
    const config = configText(withBaseline);
    const again = runLore(["baseline", "adopt", "--mode", "enforce", "--arm", branchA], withBaseline);
    expect(again.exitCode).toBe(0);
    expect(again.stdout).toContain("no change");
    expect(adoptRowCount(withBaseline)).toBe(rows);
    expect(configText(withBaseline)).toBe(config);
  });

  it("G3: --arm X --disarm X in one call exits 2 and writes nothing", () => {
    const rows = adoptRowCount(withBaseline);
    const config = configText(withBaseline);
    const r = runLore(["baseline", "adopt", "--arm", branchA, "--disarm", branchA], withBaseline);
    expect(r.exitCode).toBe(2);
    expect(adoptRowCount(withBaseline)).toBe(rows);
    expect(configText(withBaseline)).toBe(config);
  });
});

describe("setup --project --uninstall removes the baseline skill (BL-8)", () => {
  it("G4: after setup the skill is installed; after --uninstall every installed skill file and the ledger are gone", () => {
    const repo = makeRepo();
    expect(runLore(["setup", "--project", "--yes"], repo).exitCode).toBe(0);
    const ledgerPath = join(repo, ".lore", ".lore-project-manifest.json");
    const skillPaths = (JSON.parse(readFileSync(ledgerPath, "utf8")) as { entries: { path: string }[] }).entries
      .map((e) => e.path)
      .filter((p) => p.startsWith(".claude/skills/lore-baseline/"));
    expect(skillPaths.length).toBeGreaterThanOrEqual(2);
    for (const p of skillPaths) expect(existsSync(join(repo, p))).toBe(true);

    const removed = runLore(["setup", "--project", "--uninstall", "--yes"], repo);
    expect(removed.exitCode).toBe(0);
    for (const p of skillPaths) expect(existsSync(join(repo, p))).toBe(false);
    expect(existsSync(ledgerPath)).toBe(false);
  });
});

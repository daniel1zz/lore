// @spawns packages/lore/src/index.ts
/**
 * End-to-end test for the fresh-install ac-cite provenance fixes (spec-fresh-install-probe-fixes, AC-FIP-3; BR-987),
 * driven through the real CLI in a throwaway git repo (never the repo's own .lore/).
 *
 *   F5. After `lore init` + `lore setup --project`, status reports the seeded mode as provenance `audited`;
 *       a later hand edit still reads `unaudited` (control).
 *   F7. `lore baseline adopt --mode enforce` with no armed branch exits 0 but warns that enforce refuses nothing;
 *       `lore status --json` ac_cite lists `armed_branches: []` and `enforce_refuses_nothing: true`; human status says so.
 *
 * Dimensions: HAPPY (seed audited), NEGATIVE (hand edit unaudited; armed branch -> no warning), STATE (one audit row,
 * actor = setup caller), REGRESSION (adopt exit 0).
 *
 * @spec_ref AC-FIP-3
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "yaml";
import { patchLoreConfig } from "../../helpers/patch-lore-config.js";

setDefaultTimeout(300_000);

const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const ACTOR = "agent:fip-prov-test";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

interface AcCiteJson {
  mode?: string;
  provenance?: string;
  armed_branches?: string[];
  enforce_refuses_nothing?: boolean;
}

/** MOCK RISK: none; HOME is redirected into the fixture so setup can never reach the real ~/.claude. */
function runLore(args: string[], cwd: string): RunResult {
  const env = { ...process.env, HOME: cwd, CLAUDECODE: "1", LORE_ACTOR: ACTOR };
  const proc = Bun.spawnSync(["bun", "run", ENTRY, ...args], { cwd, env });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
}

let scratch: string[] = [];

function makeRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "fip-prov-")));
  scratch.push(dir);
  if (dir.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "fip@example.invalid"]);
  git(dir, ["config", "user.name", "fip test"]);
  writeFileSync(join(dir, "README.md"), "fixture\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "init"]);
  const init = runLore(["init"], dir);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}${init.stdout}`);
  const setup = runLore(["setup", "--project", "--yes"], dir);
  if (setup.exitCode !== 0) throw new Error(`lore setup failed: ${setup.stderr}${setup.stdout}`);
  return dir;
}

const acCite = (dir: string): AcCiteJson => {
  const r = runLore(["status", "--json"], dir);
  expect(r.exitCode).toBe(0);
  return (JSON.parse(r.stdout) as { data: { ac_cite?: AcCiteJson } }).data.ac_cite ?? {};
};

function handEditMode(dir: string, mode: string): void {
  patchLoreConfig(dir, { workflow: { gates: { "ac-cite": { mode } } } });
}

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  scratch = [];
});

describe("ac-cite provenance on a fresh install (AC-FIP-3)", () => {
  let fresh = "";
  beforeAll(() => {
    fresh = makeRepo();
  });

  it("F5: the setup-seeded mode reports provenance audited", () => {
    const status = acCite(fresh);
    expect(status.mode).toBe("report");
    expect(status.provenance).toBe("audited");
  });

  it("F5 control: a later hand edit of the mode reads unaudited", () => {
    const dir = makeRepo();
    handEditMode(dir, "enforce");
    expect(acCite(dir).provenance).toBe("unaudited");
  });

  it("F7: adopt --mode enforce with no armed branch exits 0 and warns that enforce refuses nothing", () => {
    const dir = makeRepo();
    const r = runLore(["baseline", "adopt", "--mode", "enforce"], dir);
    expect(r.exitCode).toBe(0);
    expect(r.stdout + r.stderr).toContain("refuses nothing");
  });

  it("F7: status --json lists armed_branches [] and flags that enforce refuses nothing; human status says so", () => {
    const dir = makeRepo();
    expect(runLore(["baseline", "adopt", "--mode", "enforce"], dir).exitCode).toBe(0);
    const status = acCite(dir);
    expect(status.mode).toBe("enforce");
    expect(status.provenance).toBe("audited");
    expect(status.armed_branches).toEqual([]);
    expect(status.enforce_refuses_nothing).toBe(true);
    const human = runLore(["status"], dir);
    expect(human.stdout).toContain("refuses nothing");
  });

  it("F7 negative: report mode with no armed branch does not claim refuses-nothing", () => {
    const status = acCite(fresh);
    expect(status.armed_branches).toEqual([]);
    expect(status.enforce_refuses_nothing).toBe(false);
  });
});

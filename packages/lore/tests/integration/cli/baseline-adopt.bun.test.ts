/**
 * End-to-end test of `lore baseline adopt` and the `lore status` ac-cite provenance flag
 * (Baseline slice 3a, BL-8, AC-BLS3-8), driven through the real CLI against a throwaway corpus.
 *
 * Spec: spec-baseline-slice-3a-architecture-tree-baseline-root, Design "Distribution (BL-8)":
 *   `lore baseline adopt [--mode report|enforce] [--arm <branch>...] [--disarm ...]` writes config + ONE audit
 *   row; `lore status` flags a mode not produced by adopt as unaudited.
 *
 * CONTRACT (the spec leaves these open; the simplest reading consistent with the Design text is pinned here, and
 * the implementation must match it or the contract must be amended in the spec):
 *   C1. adopt writes `.lore/config.yaml` at `workflow.gates."ac-cite"` = { mode?, armed_branches? } (the existing
 *       CiteGateConfigSchema). A flag that is not given leaves that key as it was; every other config key is untouched.
 *   C2. `--arm <branch>` / `--disarm <branch>` take the baseline BRANCH doc's slug (CiteGateConfig.armed_branches holds
 *       slugs). Both are repeatable. Arming an already-armed slug / disarming an unarmed one is not an error and never
 *       duplicates an entry. armed_branches keeps first-arm order.
 *   C3. One adopt call that changes something writes EXACTLY ONE audit row: action `baseline_adopt`, actor = the
 *       resolved actor (session tier), details = { old: { mode, armed_branches }, new: { mode, armed_branches } } where
 *       `old`/`new` are the RAW stored settings (mode is null when the key is absent; armed_branches [] when absent).
 *       Read back through `lore audit --json` (entries[].action / .actor / .details).
 *   C4. Failures write NOTHING (config byte-identical, zero audit rows) and exit: unknown flag value for --mode -> 2;
 *       adopt with none of --mode/--arm/--disarm -> 2; --arm of a slug that resolves to no doc -> 3; --arm of a doc
 *       that exists but is not a baseline branch -> 4.
 *   C5. `lore status --json` exposes `data.ac_cite = { mode, provenance }` where mode is the stored mode and
 *       provenance is "audited" iff the stored mode equals the `new.mode` of the LAST `baseline_adopt` audit row,
 *       "unaudited" otherwise (no adopt row, or the config was changed by hand after it).
 *
 * The repo's own `.lore/` is never touched: every case runs in a `mkdtemp` corpus (`lore init`, cwd inside it).
 *
 * Dimensions: HAPPY (arm/disarm/mode), NEGATIVE (bad flag value, unknown/non-branch slug, no flags),
 * STATE (sequence of adopts: old reflects the previous new), BOUNDARY (re-arm idempotent), REGRESSION
 * (unrelated config keys preserved; hand-edit flips provenance back), ERROR (failed adopt writes nothing).
 *
 * @spec_ref AC-BLS3-8
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "yaml";

setDefaultTimeout(300_000);

// tests/integration/cli/ -> repo root is 5 levels up.
const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
// BR-1055: LORE_ACTOR is ignored; the writer identity is injected through the session tier.
const ACTOR_SESSION_ID = "ad0b7e57-aaaa-bbbb-cccc-111111111111";
const ACTOR = "agent:session-ad0b7e57";
const SECOND_ACTOR_SESSION_ID = "ad0b7e52-aaaa-bbbb-cccc-111111111111";
const SECOND_ACTOR = "agent:session-ad0b7e52";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLore(args: string[], cwd: string, sessionId: string = ACTOR_SESSION_ID): RunResult {
  const env = { ...process.env, HOME: cwd, CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: sessionId };
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

interface CiteSettings {
  mode?: string;
  armed_branches?: string[];
}

const configPath = (repo: string): string => join(repo, ".lore", "config.yaml");
const readConfigText = (repo: string): string => readFileSync(configPath(repo), "utf8");
const readConfig = (repo: string): Record<string, any> => yaml.parse(readConfigText(repo)) ?? {};
const citeOf = (repo: string): CiteSettings | undefined => readConfig(repo).workflow?.gates?.["ac-cite"];

/** Hand-edit the config the way a person with an editor would (no adopt, no audit row). */
function handEdit(repo: string, mutate: (cfg: Record<string, any>) => void): void {
  const cfg = readConfig(repo);
  mutate(cfg);
  writeFileSync(configPath(repo), yaml.stringify(cfg));
}

interface AuditEntry {
  readonly action: string;
  readonly actor: string;
  readonly details: { old?: { mode: string | null; armed_branches: string[] }; new?: { mode: string | null; armed_branches: string[] } };
}

function adoptRows(repo: string): AuditEntry[] {
  const r = mustRun(["audit", "--json", "--limit", "1000"], repo);
  const parsed = JSON.parse(r.stdout) as { data: { entries: AuditEntry[] } };
  // audit lists newest first or oldest first depending on the surface; order by position is normalised below.
  return parsed.data.entries.filter((e) => e.action === "baseline_adopt");
}

function acCiteStatus(repo: string): { mode?: string; provenance?: string } {
  const r = mustRun(["status", "--json"], repo);
  const parsed = JSON.parse(r.stdout) as { data: { ac_cite?: { mode?: string; provenance?: string } } };
  return parsed.data.ac_cite ?? {};
}

let scratch: string[] = [];
let repo = "";
let branchA = "";
let branchB = "";
let leafSlug = "";

beforeAll(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), "bla-repo-")));
  scratch.push(repo);
  if (repo.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "bla@example.invalid"]);
  git(repo, ["config", "user.name", "bla test"]);
  writeFileSync(join(repo, "README.md"), "fixture\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "init"]);
  mustRun(["init"], repo);

  const prd = slugOf(mustRun(["create", "prd", "--title", "BLA PRD", "--content", "root", "--no-ai"], repo).stdout);
  const root = slugOf(mustRun(["baseline", "add", prd, "--node", "root", "--label", "root", "--title", "BLA Root"], repo).stdout);
  branchA = slugOf(mustRun(["baseline", "add", root, "--node", "branch", "--label", "ba", "--title", "BLA Branch A"], repo).stdout);
  branchB = slugOf(mustRun(["baseline", "add", root, "--node", "branch", "--label", "bb", "--title", "BLA Branch B"], repo).stdout);
  leafSlug = slugOf(mustRun(["baseline", "add", branchA, "--node", "leaf", "--label", "lf", "--title", "BLA Leaf"], repo).stdout);

  // Unrelated config the adopt writer must carry through untouched.
  handEdit(repo, (cfg) => {
    cfg.workflow = { ...(cfg.workflow ?? {}), claim_ttl_minutes: 77, gates: { "task-claim": { enabled: false } } };
  });
});

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  scratch = [];
});

describe("baseline adopt (BL-8)", () => {
  it("fixture: no adopt has run, no ac-cite key stored, zero adopt audit rows", () => {
    expect(citeOf(repo)).toBeUndefined();
    expect(adoptRows(repo)).toHaveLength(0);
  });

  it("status on a corpus where nobody ran adopt reports no ac-cite provenance of 'audited'", () => {
    // negative control for the provenance flag: absent adopt, 'audited' is never claimed.
    expect(acCiteStatus(repo).provenance).not.toBe("audited");
  });

  it("--mode enforce --arm <branch> exits 0, writes mode+armed_branches, and exactly ONE audit row with actor/old/new", () => {
    const before = readConfig(repo);
    const r = runLore(["baseline", "adopt", "--mode", "enforce", "--arm", branchA], repo);
    expect(r.exitCode).toBe(0);
    expect(citeOf(repo)).toEqual({ mode: "enforce", armed_branches: [branchA] });
    // unrelated keys carried through (negative control: the writer does not clobber the file)
    const after = readConfig(repo);
    expect(after.workflow.claim_ttl_minutes).toBe(77);
    expect(after.workflow.gates["task-claim"]).toEqual({ enabled: false });
    expect(after.project).toEqual(before.project);

    const rows = adoptRows(repo);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor).toBe(ACTOR);
    expect(rows[0]!.details.old).toEqual({ mode: null, armed_branches: [] });
    expect(rows[0]!.details.new).toEqual({ mode: "enforce", armed_branches: [branchA] });
  });

  it("status reports the adopt-set mode as audited", () => {
    expect(acCiteStatus(repo)).toMatchObject({ mode: "enforce", provenance: "audited" });
  });

  it("a second adopt (--arm another branch, no --mode) keeps the mode, appends the branch, and writes one more row whose old is the previous new", () => {
    const r = runLore(["baseline", "adopt", "--arm", branchB], repo, SECOND_ACTOR_SESSION_ID);
    expect(r.exitCode).toBe(0);
    expect(citeOf(repo)).toEqual({ mode: "enforce", armed_branches: [branchA, branchB] });
    const rows = adoptRows(repo);
    expect(rows).toHaveLength(2);
    const second = rows.find((row) => row.actor === SECOND_ACTOR);
    expect(second).toBeDefined();
    expect(second!.details.old).toEqual({ mode: "enforce", armed_branches: [branchA] });
    expect(second!.details.new).toEqual({ mode: "enforce", armed_branches: [branchA, branchB] });
  });

  it("re-arming an already-armed branch never duplicates the entry", () => {
    const r = runLore(["baseline", "adopt", "--arm", branchA], repo);
    expect(r.exitCode).toBe(0);
    expect(citeOf(repo)?.armed_branches).toEqual([branchA, branchB]);
  });

  it("--disarm removes exactly that branch and writes one row (old has both, new has the other)", () => {
    const rowsBefore = adoptRows(repo).length;
    const r = runLore(["baseline", "adopt", "--disarm", branchA], repo);
    expect(r.exitCode).toBe(0);
    expect(citeOf(repo)).toEqual({ mode: "enforce", armed_branches: [branchB] });
    const rows = adoptRows(repo);
    expect(rows).toHaveLength(rowsBefore + 1);
    expect(rows.some((row) => row.details.new?.armed_branches?.length === 1 && row.details.old?.armed_branches?.includes(branchA))).toBe(true);
  });

  it("--mode report changes only the mode, leaves armed_branches, and writes one row old enforce -> new report", () => {
    const rowsBefore = adoptRows(repo).length;
    const r = runLore(["baseline", "adopt", "--mode", "report"], repo);
    expect(r.exitCode).toBe(0);
    expect(citeOf(repo)).toEqual({ mode: "report", armed_branches: [branchB] });
    const rows = adoptRows(repo);
    expect(rows).toHaveLength(rowsBefore + 1);
    expect(
      rows.some((row) => row.details.old?.mode === "enforce" && row.details.new?.mode === "report" && row.details.new.armed_branches.join() === branchB),
    ).toBe(true);
  });

  it("status reports the mode set by the latest adopt (report) as audited", () => {
    expect(acCiteStatus(repo)).toMatchObject({ mode: "report", provenance: "audited" });
  });

  it("a mode changed by hand-editing the config is reported unaudited, and the mode is the hand-edited one", () => {
    handEdit(repo, (cfg) => {
      cfg.workflow.gates["ac-cite"] = { ...(cfg.workflow.gates["ac-cite"] ?? {}), mode: "enforce" };
    });
    expect(acCiteStatus(repo)).toMatchObject({ mode: "enforce", provenance: "unaudited" });
  });

  it("running adopt again makes the status audited again (provenance follows the latest audited setting)", () => {
    const r = runLore(["baseline", "adopt", "--mode", "enforce"], repo);
    expect(r.exitCode).toBe(0);
    expect(acCiteStatus(repo)).toMatchObject({ mode: "enforce", provenance: "audited" });
  });
});

describe("baseline adopt (BL-8) refusals write nothing", () => {
  const rowsAndConfig = (): { rows: number; config: string } => ({ rows: adoptRows(repo).length, config: readConfigText(repo) });

  it("--mode with an unknown value exits 2 and changes neither config nor audit", () => {
    const before = rowsAndConfig();
    const r = runLore(["baseline", "adopt", "--mode", "strict"], repo);
    expect(r.exitCode).toBe(2);
    expect(rowsAndConfig()).toEqual(before);
  });

  it("--mode off is not an adopt mode (only report|enforce) and exits 2", () => {
    const before = rowsAndConfig();
    const r = runLore(["baseline", "adopt", "--mode", "off"], repo);
    expect(r.exitCode).toBe(2);
    expect(rowsAndConfig()).toEqual(before);
  });

  it("adopt with none of --mode/--arm/--disarm exits 2 and writes no audit row", () => {
    const before = rowsAndConfig();
    const r = runLore(["baseline", "adopt"], repo);
    expect(r.exitCode).toBe(2);
    expect(rowsAndConfig()).toEqual(before);
  });

  it("--arm of a slug that resolves to no doc exits 3 and writes nothing", () => {
    const before = rowsAndConfig();
    const r = runLore(["baseline", "adopt", "--arm", "no-such-branch-slug"], repo);
    expect(r.exitCode).toBe(3);
    expect(rowsAndConfig()).toEqual(before);
  });

  it("--arm of an existing baseline LEAF (not a branch) exits 4 and writes nothing", () => {
    const before = rowsAndConfig();
    const r = runLore(["baseline", "adopt", "--arm", leafSlug], repo);
    expect(r.exitCode).toBe(4);
    expect(rowsAndConfig()).toEqual(before);
  });

  it("a valid --mode plus an invalid --arm is all-or-nothing: the mode is NOT written", () => {
    const before = rowsAndConfig();
    const r = runLore(["baseline", "adopt", "--mode", "report", "--arm", "no-such-branch-slug"], repo);
    expect(r.exitCode).toBe(3);
    expect(rowsAndConfig()).toEqual(before);
    expect(citeOf(repo)?.mode).toBe("enforce");
  });
});

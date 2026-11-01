// @spawns packages/lore/src/index.ts
/**
 * @spec_ref spec-defect-clusters-round-2-part-a-sessions-seats-setup-init D5 (items a-c, AC-DC2-5)
 *           spec-the-write-spec-rule-ships-with-the-binary-lore-init-writes#AC-WSR-1
 *
 * `lore init` is one atomic scaffold: built in a sibling temp directory, renamed into place, and it seeds
 * the settings template and writes no corpus document (BR-807, BR-810, BR-587).
 *
 * Every case runs PLAIN `lore init` (never `setup --project`, which already seeded the template and would
 * make (c) green by accident) in a throwaway git repo (HOME/XDG in temp dirs; never the repo's `.lore/`).
 * The failure in (a) is injected at the FIRST write via `ulimit -f 0` — a failure after the database exists
 * self-heals today and would prove nothing.
 *
 * Coverage:
 *   ERROR:      (a) failed init exits 1, leaves no `.lore` (and no staging directory); a retry exits 0
 *   REGRESSION: (b) the ignore list is exactly the four entries; after setup --project --check the cache
 *               file exists on disk yet git does not list it
 *   HAPPY:      (c) config.yaml carries workflow.verification_profiles; status does not say "not configured"
 *   STATE:      (d) after init: exactly the seeded approved templates (BR-807 as modified, AC-DC2-5), no other document or
 *               doc-scoped audit entry, `lore status --check-tree` exits 0
 */

import { afterAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readShippedTemplateSeeds } from "../../src/adapters/cli/template-seeds.js";

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const SEED_COUNT = (() => {
  const seeds = readShippedTemplateSeeds();
  if (!seeds.ok) throw new Error(JSON.stringify(seeds.error));
  return seeds.value.length;
})();

const SPEC = "spec-the-write-spec-rule-ships-with-the-binary-lore-init-writes";
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

const scratch: string[] = [];

function envFor(home: string): Record<string, string> {
  return { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), CLAUDECODE: "1" } as Record<string, string>;
}

function runLore(args: string[], cwd: string, home: string): RunResult {
  const proc = Bun.spawnSync(["bun", "run", ENTRY, ...args], { cwd, env: envFor(home) });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

/** Runs `lore init` with the file-size limit at zero, so the very first write fails. */
function runInitWithZeroFileLimit(cwd: string, home: string): RunResult {
  const proc = Bun.spawnSync(["sh", "-c", `ulimit -f 0; exec bun run '${ENTRY}' init`], { cwd, env: envFor(home) });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
}

interface Fixture {
  readonly repo: string;
  readonly home: string;
}

/** A throwaway git repo with NO `.lore` yet, plus an isolated HOME. */
function makeRepo(): Fixture {
  const repo = mkdtempSync(join(tmpdir(), "dc2-init-repo-"));
  const home = mkdtempSync(join(tmpdir(), "dc2-init-home-"));
  scratch.push(repo, home);
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.email", "t@example.com"]);
  git(repo, ["config", "user.name", "T"]);
  return { repo, home };
}

/** A repo that has been through a successful plain `lore init`. */
function makeInitialisedRepo(): Fixture {
  const fixture = makeRepo();
  const init = runLore(["init"], fixture.repo, fixture.home);
  expect(init.exitCode, `init failed: ${init.stdout}${init.stderr}`).toBe(0);
  return fixture;
}

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

describe(`${SPEC}#AC-WSR-1 lore init is one atomic scaffold`, () => {
  it(`${SPEC}#AC-WSR-1 (a) a failed init leaves no .lore and a second plain init succeeds`, () => {
    const { repo, home } = makeRepo();

    const failed = runInitWithZeroFileLimit(repo, home);
    expect(failed.exitCode, `stdout=${failed.stdout} stderr=${failed.stderr}`).toBe(1);
    expect(failed.stderr).toContain("EFBIG");
    expect(existsSync(join(repo, ".lore"))).toBe(false);
    // The staging directory is part of "nothing behind": only git's own directory may remain.
    expect(readdirSync(repo).filter((entry) => entry !== ".git")).toEqual([]);

    const retry = runLore(["init"], repo, home);
    expect(retry.exitCode, `stdout=${retry.stdout} stderr=${retry.stderr}`).toBe(0);
    expect(existsSync(join(repo, ".lore", "lore.db"))).toBe(true);
  });

  it(`${SPEC}#AC-WSR-1 (a) a second init in an initialised directory is still refused with exit 1`, () => {
    const { repo, home } = makeInitialisedRepo();
    const again = runLore(["init"], repo, home);
    expect(again.exitCode).toBe(1);
    expect(again.stderr).toContain("already initialised");
  });

  it(`${SPEC}#AC-WSR-1 (b) the ignore list is exactly the db files plus the check cache, and git never lists the cache`, { timeout: 120_000 }, () => {
    const { repo, home } = makeInitialisedRepo();

    const lines = readFileSync(join(repo, ".lore", ".gitignore"), "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "");
    expect(new Set(lines)).toEqual(new Set(["lore.db", "lore.db-wal", "lore.db-shm", ".lore-project-check.json"]));
    expect(lines).toHaveLength(4);

    // reason: `lore setup --project` refuses a repo whose main has no commit yet (the guard would refuse the first checkout)
    git(repo, ["commit", "--allow-empty", "-q", "-m", "init"]);
    const setup = runLore(["setup", "--project", "--yes"], repo, home);
    expect(setup.exitCode, `setup: ${setup.stdout}${setup.stderr}`).toBe(0);
    runLore(["setup", "--project", "--check"], repo, home);
    // The cache must really exist, or "git does not list it" would hold vacuously.
    expect(existsSync(join(repo, ".lore", ".lore-project-check.json"))).toBe(true);

    // -uall lists untracked files one by one (a collapsed `?? .lore/` line would hide the cache either way).
    const porcelain = git(repo, ["status", "--porcelain", "-uall"]);
    expect(porcelain).not.toContain(".lore-project-check.json");
    expect(porcelain).toContain(".lore/config.yaml");
  });

  it(`${SPEC}#AC-WSR-1 (c) plain init seeds the settings template`, () => {
    const { repo, home } = makeInitialisedRepo();
    const config = readFileSync(join(repo, ".lore", "config.yaml"), "utf8");
    expect(config).toContain("verification_profiles");
    expect(config).toContain("project:");

    const status = runLore(["status"], repo, home);
    expect(status.exitCode).toBe(0);
    expect(status.stdout).toContain("Verification profiles: configured");
    expect(status.stdout).not.toContain("Verification profiles: not configured");
  });

  it(`${SPEC}#AC-WSR-1 (d) right after init the corpus holds exactly the seeded templates, no other document, and the tree check passes`, { timeout: 120_000 }, () => {
    const { repo, home } = makeInitialisedRepo();

    const list = runLore(["list", "--json"], repo, home);
    expect(list.exitCode, list.stderr).toBe(0);
    const listed = (JSON.parse(list.stdout) as { data: { docs: Array<{ id: string; type: string; status: string }>; total?: number } }).data;
    // BR-807 as modified: the only documents init writes are one approved template per shipped seed.
    expect(listed.docs).toHaveLength(SEED_COUNT);
    expect(listed.docs.every((doc) => doc.type === "template" && doc.status === "approved")).toBe(true);

    const audit = runLore(["audit", "--json"], repo, home);
    expect(audit.exitCode, audit.stdout + audit.stderr).toBe(0);
    const trail = (JSON.parse(audit.stdout) as { data: { entries?: Array<{ action: string; doc_id?: string }> } }).data;
    // reason: inside a git repo `lore init` arms state binding (SPEC-143 AC-CT-3), which records one corpus-level
    // `state-binding-armed` entry. That entry belongs to no document; "no audit entry" here means no document's
    // creation (or any other doc-scoped action) of a document other than a seeded template was recorded.
    const docEntries = (trail.entries ?? []).filter((entry) => entry.action !== "state-binding-armed" || entry.doc_id !== undefined);
    const templateIds = new Set(listed.docs.map((doc) => doc.id));
    expect(docEntries.length).toBeGreaterThanOrEqual(SEED_COUNT);
    expect(docEntries.filter((entry) => entry.doc_id === undefined || !templateIds.has(entry.doc_id))).toEqual([]);

    // reason: the tree check needs the project's blueprint and its root PRD to run clean (exit 4 without a blueprint;
    // "expected at least 1 prd" without the root). Both belong to the project, not to init, so the test supplies the
    // minimal pair: the corpus then holds exactly one document, and anything init had written would be an orphan beside it.
    const prd = runLore(["create", "prd", "--title", "Fixture Root", "--content", "Root PRD for the tree check.", "--no-ai"], repo, home);
    expect(prd.exitCode, prd.stdout + prd.stderr).toBe(0);
    writeFileSync(join(repo, "lore.tree.yaml"), "version: 1\nroot:\n  type: prd\n  children: []\n");
    const tree = runLore(["status", "--check-tree"], repo, home);
    expect(tree.exitCode, tree.stdout + tree.stderr).toBe(0);
  });
});

// @spawns packages/lore/src/index.ts
/**
 * @spec_ref spec-defect-clusters-round-2-part-a-sessions-seats-setup-init
 *           D5, spec-defect-clusters-round-2-part-a-sessions-seats-setup-init#AC-DC2-5
 *
 * `lore init` is one atomic scaffold: built in a sibling temp directory, renamed into place, and it seeds
 * the settings template and the write-spec rule document (BR-807, BR-810, BR-587).
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
 *   HAPPY:      (d) exactly one approved skill doc, one version, one audit entry; the refused gate pack has a
 *               non-empty `## Rule` section and never names a dev-repo script
 */

import { afterAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const SPEC = "spec-defect-clusters-round-2-part-a-sessions-seats-setup-init";
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

describe(`${SPEC}#AC-DC2-5 lore init is one atomic scaffold`, () => {
  it(`${SPEC}#AC-DC2-5 (a) a failed init leaves no .lore and a second plain init succeeds`, () => {
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

  it(`${SPEC}#AC-DC2-5 (a) a second init in an initialised directory is still refused with exit 1`, () => {
    const { repo, home } = makeInitialisedRepo();
    const again = runLore(["init"], repo, home);
    expect(again.exitCode).toBe(1);
    expect(again.stderr).toContain("already initialised");
  });

  it(`${SPEC}#AC-DC2-5 (b) the ignore list is exactly the db files plus the check cache, and git never lists the cache`, () => {
    const { repo, home } = makeInitialisedRepo();

    const lines = readFileSync(join(repo, ".lore", ".gitignore"), "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "");
    expect(new Set(lines)).toEqual(new Set(["lore.db", "lore.db-wal", "lore.db-shm", ".lore-project-check.json"]));
    expect(lines).toHaveLength(4);

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

  it(`${SPEC}#AC-DC2-5 (c) plain init seeds the settings template`, () => {
    const { repo, home } = makeInitialisedRepo();
    const config = readFileSync(join(repo, ".lore", "config.yaml"), "utf8");
    expect(config).toContain("verification_profiles");
    expect(config).toContain("project:");

    const status = runLore(["status"], repo, home);
    expect(status.exitCode).toBe(0);
    expect(status.stdout).toContain("Verification profiles: configured");
    expect(status.stdout).not.toContain("Verification profiles: not configured");
  });

  it(`${SPEC}#AC-DC2-5 (d) plain init seeds exactly one approved write-spec rule document`, () => {
    const { repo, home } = makeInitialisedRepo();

    const list = runLore(["list", "--type", "knowledge", "--json"], repo, home);
    expect(list.exitCode).toBe(0);
    const docs = (JSON.parse(list.stdout) as { data: { docs: Array<{ slug: string; status: string }> } }).data.docs;
    expect(docs).toHaveLength(1);
    const slug = docs[0]!.slug;
    expect(docs[0]!.status).toBe("approved");

    const got = runLore(["get", slug, "--json"], repo, home);
    const doc = (JSON.parse(got.stdout) as { data: { doc: { extra: { sub_type?: string; skill?: { applies_to?: string } }; version: number } } }).data.doc;
    expect(doc.extra.sub_type).toBe("skill");
    expect(doc.extra.skill?.applies_to).toBe("spec");
    expect(doc.version).toBe(1);

    const log = runLore(["log", slug, "--json"], repo, home);
    expect((JSON.parse(log.stdout) as { data: { entries: unknown[] } }).data.entries).toHaveLength(1);

    const audit = runLore(["audit", slug, "--json"], repo, home);
    expect(audit.exitCode, audit.stderr).toBe(0);
    const trail = JSON.parse(audit.stdout) as { data: { entries?: unknown[] } };
    expect(trail.data.entries).toHaveLength(1);
  });

  it(`${SPEC}#AC-DC2-5 (d) a refused spec-create pack carries the rule text and never a dev-repo script`, () => {
    const { repo, home } = makeInitialisedRepo();
    // A spec with a parent is refused by the gate's parent rule.
    const candidate = JSON.stringify({ type: "spec", title: "Candidate", parent_id: "01HZZZZZZZZZZZZZZZZZZZZZZZ", content: "no skeleton" });
    const gate = runLore(["gate", "spec-create", "--input-json", candidate], repo, home);
    const output = gate.stdout + gate.stderr;
    expect(gate.exitCode, output).not.toBe(0);
    const ruleSection = output.split("## Rule")[1];
    expect(ruleSection, output).toBeDefined();
    expect(ruleSection!.trim().length).toBeGreaterThan(0);
    expect(ruleSection).toContain("Overview");
    expect(output).not.toContain("bun scripts/");
  });

  it(`${SPEC}#AC-DC2-5 (d) with no rule document the pack names only product commands`, () => {
    const { repo, home } = makeInitialisedRepo();
    const list = runLore(["list", "--type", "knowledge", "--json"], repo, home);
    const slug = (JSON.parse(list.stdout) as { data: { docs: Array<{ slug: string }> } }).data.docs[0]!.slug;
    const archived = runLore(["set", slug, "--status", "archived"], repo, home);
    expect(archived.exitCode, archived.stdout + archived.stderr).toBe(0);

    const candidate = JSON.stringify({ type: "spec", title: "Candidate", parent_id: "01HZZZZZZZZZZZZZZZZZZZZZZZ", content: "no skeleton" });
    const gate = runLore(["gate", "spec-create", "--input-json", candidate], repo, home);
    const output = gate.stdout + gate.stderr;
    expect(output).toContain("## Rule");
    expect(output).toContain("No approved rule doc found");
    expect(output).toContain("lore init");
    expect(output).not.toContain("bun scripts/");
  });
});

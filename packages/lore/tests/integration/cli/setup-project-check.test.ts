// @spawns packages/lore/src/index.ts
/**
 * Integration tests for `lore setup --project --check` (spec-one-upgrade-reminder-at-session-start-
 * covers-the-global, BR-1085 / BR-849, AC-UR-1). Runs the real CLI via subprocess in throwaway
 * `mkdtemp` repos — never the real `~/.claude`, never this repo's `.lore/`.
 *
 * Isolation: HOME, LORE_CONFIG_HOME, XDG_CONFIG_HOME and CLAUDE_CONFIG_DIR all point into the
 * scratch tree, so no user-layer fragment or global config can leak into the classification.
 *
 * Coverage:
 *   HAPPY:      a fresh `lore setup --project` then `--check` -> exit 0, every list empty
 *   NEGATIVE:   older render -> outdated; hand edit -> diverged (bytes untouched); deleted hook ->
 *               missing; ledger-listed file no longer shipped -> orphaned; removed settings entry ->
 *               missing; each exits 3 and names only its own state
 *   BOUNDARY:   a hand edit that keeps a valid fingerprint line is still diverged, never outdated
 *   ERROR:      no project ledger -> exit 4; `--uninstall` / `--dry-run` / `--force-diverged` -> exit 2 naming it
 *   STATE:      the tree hash before and after is identical except the project check cache
 *   REGRESSION: the cache carries the shared shape (scope, binary version, per-state files, reasons)
 *               and a second check over an unchanged tree is idempotent
 *
 * @spec_ref AC-UR-1
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, execSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HOOK_ASSET_NAMES } from "../../../src/flows/setup-project-flow.js";

/** A project hook the current binary ships — derived from the SSOT so a hook retirement cannot break this suite again. */
const SHIPPED_HOOK: string = HOOK_ASSET_NAMES[0];

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const BUN_BIN = execSync("command -v bun", { encoding: "utf8" }).trim();

const CACHE_RELATIVE_PATH = ".lore/.lore-project-check.json";
const MANIFEST_RELATIVE_PATH = ".lore/.lore-project-manifest.json";
const RULES_DIR = ".claude/rules";
const SETTINGS_RELATIVE_PATH = ".claude/settings.local.json";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

interface CheckFiles {
  outdated: string[];
  diverged: string[];
  missing: string[];
  orphaned: string[];
}

interface CheckData {
  summary: "sync" | "stale";
  binary_version: string;
  files: CheckFiles;
}

let sandbox: string;
let templateRepo: string;

function envFor(repoDir: string): NodeJS.ProcessEnv {
  const home = join(sandbox, "home");
  return {
    ...process.env,
    PATH: "",
    HOME: home,
    LORE_CONFIG_HOME: join(home, "lore-config"),
    XDG_CONFIG_HOME: join(home, "xdg"),
    CLAUDE_CONFIG_DIR: join(repoDir, ".fake-claude-dir"),
  };
}

function runSetup(args: string[], cwd: string): RunResult {
  // reason: spawn bun by absolute path — PATH is emptied above so the child can never reach a real `claude` CLI.
  const result = spawnSync(BUN_BIN, ["run", INDEX_TS, "setup", ...args], { cwd, env: envFor(cwd), encoding: "utf8" });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? 1 };
}

function runCheck(repoDir: string, extra: string[] = []): { run: RunResult; data: CheckData | null } {
  const run = runSetup(["--project", "--check", "--json", ...extra], repoDir);
  if (run.exitCode !== 0 && run.exitCode !== 3) return { run, data: null };
  const parsed = JSON.parse(run.stdout) as { ok: boolean; data: CheckData };
  return { run, data: parsed.data };
}

/** sha256 of every regular file under `dir` except `.git/`, as repo-relative path -> hash. */
function snapshotTree(dir: string, base: string = dir): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(out, snapshotTree(full, base));
    else if (entry.isFile()) out[full.slice(base.length + 1)] = createHash("sha256").update(readFileSync(full)).digest("hex");
  }
  return out;
}

/** A fresh copy of the scaffolded template repo (its own git dir, so each test mutates in isolation). */
function freshRepo(): string {
  const dir = mkdtempSync(join(sandbox, "repo-"));
  cpSync(templateRepo, dir, { recursive: true });
  return dir;
}

function rulesFiles(repoDir: string): string[] {
  return readdirSync(join(repoDir, RULES_DIR)).filter((name) => name.startsWith("lore-") && name.endsWith(".md")).sort();
}

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), "lore-project-check-"));
  mkdirSync(join(sandbox, "home"), { recursive: true });
  templateRepo = join(sandbox, "template");
  mkdirSync(templateRepo, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: templateRepo });
  // `lore init` first so context.language can be set BEFORE the scaffold projects it into the settings file.
  const init = spawnSync(BUN_BIN, ["run", INDEX_TS, "init"], { cwd: templateRepo, env: envFor(templateRepo), encoding: "utf8" });
  if (init.status !== 0) throw new Error(`lore init failed: ${init.stderr}`);
  const configPath = join(templateRepo, ".lore", "config.yaml");
  const config = readFileSync(configPath, "utf8");
  const withLanguage = /^context:\s*$/m.test(config)
    ? config.replace(/^context:\s*$/m, "context:\n  language: zh")
    : `${config}\ncontext:\n  language: zh\n`;
  writeFileSync(configPath, withLanguage, "utf8");
  const scaffold = runSetup(["--project", "--yes"], templateRepo);
  if (scaffold.exitCode !== 0) throw new Error(`scaffold failed (${scaffold.exitCode}): ${scaffold.stderr}\n${scaffold.stdout}`);
}, 120_000);

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("lore setup --project --check (AC-UR-1)", () => {
  it("AC-UR-1.H1: a fresh scaffold checks in sync (exit 0, no file in any list) and writes the project cache", () => {
    const repo = freshRepo();
    const { run, data } = runCheck(repo);
    expect(run.exitCode).toBe(0);
    expect(data?.summary).toBe("sync");
    expect(data?.files).toEqual({ outdated: [], diverged: [], missing: [], orphaned: [] });
    expect(existsSync(join(repo, CACHE_RELATIVE_PATH))).toBe(true);
  }, 60_000);

  it("AC-UR-1.N1: a rules file replaced by an older (intact) render is outdated, exit 3", () => {
    const repo = freshRepo();
    const name = rulesFiles(repo)[0] as string;
    const path = join(repo, RULES_DIR, name);
    const current = readFileSync(path, "utf8");
    const newline = current.indexOf("\n");
    const fragmentId = /fragment=(\S+)/.exec(current.slice(0, newline))?.[1] as string;
    const olderRest = `${current.slice(newline + 1)}\n- An older shipped line that this binary no longer renders.\n`;
    const olderHash = createHash("sha256").update(olderRest, "utf8").digest("hex").slice(0, 8);
    writeFileSync(path, `<!-- lore:managed fragment=${fragmentId} hash=${olderHash} -->\n${olderRest}`, "utf8");

    const { run, data } = runCheck(repo);
    expect(run.exitCode).toBe(3);
    expect(data?.files.outdated).toEqual([`${RULES_DIR}/${name}`]);
    expect(data?.files.diverged).toEqual([]);
    expect(data?.files.missing).toEqual([]);
    expect(data?.files.orphaned).toEqual([]);
  }, 60_000);

  it("AC-UR-1.N2: a hand-edited rules file is diverged, exit 3, and its bytes are left unchanged", () => {
    const repo = freshRepo();
    const name = rulesFiles(repo)[0] as string;
    const path = join(repo, RULES_DIR, name);
    // reason: edit the body but keep the stale fingerprint line, so the hash no longer matches (a real hand edit).
    writeFileSync(path, `${readFileSync(path, "utf8")}\nMy own team note.\n`, "utf8");
    const before = readFileSync(path);

    const { run, data } = runCheck(repo);
    expect(run.exitCode).toBe(3);
    expect(data?.files.diverged).toEqual([`${RULES_DIR}/${name}`]);
    expect(data?.files.outdated).toEqual([]);
    expect(readFileSync(path).equals(before)).toBe(true);
  }, 60_000);

  it("AC-UR-1.N3: a deleted project-scope hook is missing, exit 3", () => {
    const repo = freshRepo();
    rmSync(join(repo, "hooks", SHIPPED_HOOK));
    const { run, data } = runCheck(repo);
    expect(run.exitCode).toBe(3);
    expect(data?.files.missing).toEqual([`hooks/${SHIPPED_HOOK}`]);
    expect(data?.files.outdated).toEqual([]);
    expect(data?.files.diverged).toEqual([]);
    expect(data?.files.orphaned).toEqual([]);
  }, 60_000);

  it("AC-UR-1.N4: a ledger-listed file that is no longer shipped is orphaned, exit 3", () => {
    const repo = freshRepo();
    const manifestPath = join(repo, MANIFEST_RELATIVE_PATH);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { entries: Array<Record<string, string>> };
    writeFileSync(join(repo, "hooks", "g0-retired.sh"), "#!/bin/sh\nexit 0\n", "utf8");
    manifest.entries.push({
      path: "hooks/g0-retired.sh",
      kind: "hook",
      sha256: createHash("sha256").update("#!/bin/sh\nexit 0\n").digest("hex"),
      written_at: "2026-01-01T00:00:00.000Z",
    });
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    const { run, data } = runCheck(repo);
    expect(run.exitCode).toBe(3);
    expect(data?.files.orphaned).toEqual(["hooks/g0-retired.sh"]);
    expect(data?.files.missing).toEqual([]);
    expect(data?.files.outdated).toEqual([]);
  }, 60_000);

  it("AC-UR-1.N5: a removed lore entry in the project settings file is missing, exit 3", () => {
    const repo = freshRepo();
    const settingsPath = join(repo, SETTINGS_RELATIVE_PATH);
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
    expect(settings["language"]).toBe("Chinese"); // control: the scaffold really wrote the entry
    delete settings["language"];
    writeFileSync(settingsPath, `${JSON.stringify({ ...settings, theme: "dark" }, null, 2)}\n`, "utf8");

    const { run, data } = runCheck(repo);
    expect(run.exitCode).toBe(3);
    expect(data?.files.missing).toEqual([`${SETTINGS_RELATIVE_PATH}#language`]);
    expect(data?.files.diverged).toEqual([]);
    expect(data?.files.outdated).toEqual([]);
  }, 60_000);

  it("AC-UR-1.S1: the tree is byte-identical before and after a check except the project check cache", () => {
    const repo = freshRepo();
    rmSync(join(repo, "hooks", SHIPPED_HOOK)); // a stale tree, so the run takes the full non-sync path
    const before = snapshotTree(repo);
    const { run } = runCheck(repo);
    expect(run.exitCode).toBe(3);
    const after = snapshotTree(repo);
    const changed = Object.keys({ ...before, ...after }).filter((path) => before[path] !== after[path]);
    expect(changed).toEqual([CACHE_RELATIVE_PATH]);
  }, 60_000);

  it("AC-UR-1.R1: the cache carries the shared shape (scope, binary version, per-state files, reasons) and a re-check is idempotent", () => {
    const repo = freshRepo();
    rmSync(join(repo, "hooks", SHIPPED_HOOK));
    const name = rulesFiles(repo)[0] as string;
    writeFileSync(join(repo, RULES_DIR, name), `${readFileSync(join(repo, RULES_DIR, name), "utf8")}\nhand edit\n`, "utf8");
    const first = runCheck(repo);
    const cache = JSON.parse(readFileSync(join(repo, CACHE_RELATIVE_PATH), "utf8")) as Record<string, unknown>;
    expect(cache["scope"]).toBe("project");
    expect(cache["status"]).toBe("stale");
    expect(cache["binary_version"]).toBe(first.data?.binary_version);
    expect(cache["files"]).toEqual(first.data?.files);
    expect(cache["reasons"]).toEqual(["binary_version_changed", "hand_edited"]);

    const second = runCheck(repo);
    expect(second.run.exitCode).toBe(3);
    expect(second.data?.files).toEqual(first.data?.files);
  }, 90_000);

  it("AC-UR-1.E1: --project --check --uninstall exits 2 naming --uninstall (also --dry-run and --force-diverged)", () => {
    const repo = freshRepo();
    const before = snapshotTree(repo);
    for (const flag of ["--uninstall", "--dry-run", "--force-diverged"]) {
      const result = runSetup(["--project", "--check", flag], repo);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain(flag);
    }
    expect(snapshotTree(repo)).toEqual(before); // refused before anything is read or written
  }, 60_000);

  it("AC-UR-1.E2: a repo with no project install ledger exits 4 (nothing to check), never a silent in-sync", () => {
    const bare = mkdtempSync(join(sandbox, "bare-"));
    execFileSync("git", ["init", "-q"], { cwd: bare });
    const result = runSetup(["--project", "--check"], bare);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("lore setup --project");
  }, 60_000);
});

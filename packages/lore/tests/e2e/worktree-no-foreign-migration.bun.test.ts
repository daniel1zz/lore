/**
 * @spec_ref AC-CRIT-7
 *
 * F5: a linked git worktree never migrates the main checkout's corpus
 * (spec-close-the-eight-verified-critical-defects-no-judge-listing §Design F5).
 *
 * The fixture is a throwaway `mkdtemp` git repo + `lore init` + `git worktree add`;
 * the main corpus's `PRAGMA user_version` is then lowered by one so opening it
 * WOULD migrate. The CLI is spawned FROM SOURCE (`bun run src/index.ts`), so no
 * `dist/lore` build is involved. Never touches the repo's own `.lore/`.
 *
 * Coverage:
 *   (a) CLI from the worktree: exit exactly 4, VALIDATION_ERROR naming the schema mismatch.
 *   (b) in-process createApp(findLoreDbPath()) with a worktree cwd throws before open.
 *   (c) `lore gate spec-create` (LORE_GATE_BYPASS=1 -> the audit-open path, which opens a
 *       bare SQLiteStore) exits exactly 0 with ONE warning naming the mismatch.
 *       main's user_version is unchanged after (a)-(c).
 *   (d) the same CLI command from the main checkout migrates (user_version == latest).
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../../src/app";
import { findLoreDbPath } from "../../src/adapters/cli/corpus-resolution";
import { LATEST_SCHEMA_VERSION } from "../../src/store/schema-version";

const PKG_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const CLI_ENTRY = join(PKG_ROOT, "src", "index.ts");
const TEST_TIMEOUT_MS = 60_000;

let sandbox = "";
let mainDir = "";
let worktreeDir = "";
let mainDbPath = "";

function runLore(args: string[], cwd: string, extraEnv: Record<string, string> = {}) {
  const proc = Bun.spawnSync(["bun", "run", CLI_ENTRY, ...args], {
    cwd,
    env: { ...process.env, HOME: sandbox, CLAUDECODE: "1", EDITOR: "true", ...extraEnv },
  });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? -1 };
}

function git(args: string[], cwd: string): void {
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, stdio: "pipe" });
}

function readUserVersion(dbPath: string): number {
  const db = new Database(dbPath, { readonly: true });
  try {
    return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
  } finally {
    db.close();
  }
}

function setUserVersion(dbPath: string, version: number): void {
  const db = new Database(dbPath);
  try {
    db.run(`PRAGMA user_version = ${version}`);
  } finally {
    db.close();
  }
}

beforeAll(() => {
  sandbox = realpathSync(mkdtempSync(join(tmpdir(), "lore-f5-")));
  mainDir = join(sandbox, "main");
  worktreeDir = join(sandbox, "wt");
  execFileSync("mkdir", [mainDir]);
  git(["init", "-q", "-b", "main"], mainDir);
  const init = runLore(["init"], mainDir);
  expect(init.exitCode).toBe(0);
  mainDbPath = join(mainDir, ".lore", "lore.db");
  git(["commit", "-q", "--allow-empty", "-m", "base"], mainDir);
  git(["worktree", "add", "-q", worktreeDir], mainDir);
  // Fixture self-check: the worktree must not carry its own corpus, and the
  // sandbox must be outside the repo's own tree.
  expect(sandbox.startsWith(PKG_ROOT)).toBe(false);
  setUserVersion(mainDbPath, LATEST_SCHEMA_VERSION - 1);
}, TEST_TIMEOUT_MS);

afterAll(() => {
  if (sandbox !== "") rmSync(sandbox, { recursive: true, force: true });
});

describe("AC-CRIT-7: a linked worktree never migrates the main checkout's corpus", () => {
  it("(a) CLI from the worktree exits exactly 4 with VALIDATION_ERROR naming the schema mismatch", () => {
    const res = runLore(["list"], worktreeDir);
    expect(res.exitCode).toBe(4);
    expect(res.stderr + res.stdout).toContain("VALIDATION_ERROR");
    expect(res.stderr + res.stdout).toContain("schema mismatch");
    expect(readUserVersion(mainDbPath)).toBe(LATEST_SCHEMA_VERSION - 1);
  }, TEST_TIMEOUT_MS);

  it("(b) in-process createApp(findLoreDbPath()) from the worktree throws before opening the store", () => {
    const previousCwd = process.cwd();
    process.chdir(worktreeDir);
    try {
      expect(() => createApp(findLoreDbPath())).toThrow(/schema mismatch/);
    } finally {
      process.chdir(previousCwd);
    }
    expect(readUserVersion(mainDbPath)).toBe(LATEST_SCHEMA_VERSION - 1);
  }, TEST_TIMEOUT_MS);

  it("(c) lore gate spec-create from the worktree exits exactly 0 with one schema-mismatch warning", () => {
    const res = runLore(["gate", "spec-create", "--input-json", "{}"], worktreeDir, { LORE_GATE_BYPASS: "1" });
    expect(res.exitCode).toBe(0);
    const warnings = res.stderr.split("\n").filter((line) => line.includes("schema mismatch"));
    expect(warnings.length).toBe(1);
    expect(readUserVersion(mainDbPath)).toBe(LATEST_SCHEMA_VERSION - 1);
  }, TEST_TIMEOUT_MS);

  it("(d) the same command from the main checkout migrates the corpus", () => {
    const res = runLore(["list"], mainDir);
    expect(res.exitCode).toBe(0);
    expect(readUserVersion(mainDbPath)).toBe(LATEST_SCHEMA_VERSION);
  }, TEST_TIMEOUT_MS);
});

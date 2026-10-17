/**
 * The COMPILED `dist/lore` runs the completeness census (issue #58; AS-16 "every shipped command
 * works from the compiled binary").
 *
 * Before the fix the census loaded `typescript` at runtime from the embedded /$bunfs root and every
 * `lore baseline sites|coverage|map` died with `census:typescript-unavailable`, so consumers (who only
 * get the binary) could not run the completeness step at all.
 *
 * The binary runs against this repo's CLI sources read-only (a throwaway corpus outside the repo
 * symlinks `packages/` and `node_modules/`; the repo's own `.lore/` is never touched). The census
 * verbs read source files and the throwaway corpus only.
 *
 * Dimensions: HAPPY (sites listed; coverage of a fully mapped specification-branch leaf -> 0),
 * NEGATIVE (an unmapped leaf -> 1 and names a site, never a typescript-unavailable error),
 * REGRESSION (no output ever contains `typescript-unavailable`).
 *
 * @spec_ref AC-BLC-4
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertFreshBinary } from "../helpers/assert-fresh-binary";

setDefaultTimeout(300_000);

// tests/integration/cli/ -> repo root is 5 levels up.
const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");
// BR-1055: LORE_ACTOR is ignored; the writer identity is injected through the session tier.
const SESSION_ID = "c0a7ed05-aaaa-bbbb-cccc-111111111111";
const ACTOR = "agent:session-c0a7ed05";
const COMMAND = "ac add";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLore(args: string[], cwd: string): RunResult {
  const env = { ...process.env, HOME: cwd, CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: SESSION_ID };
  const proc = Bun.spawnSync([LORE_BIN, ...args], { cwd, env });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function mustRun(args: string[], cwd: string): RunResult {
  const r = runLore(args, cwd);
  if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r;
}

function runGit(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
}

function slugOf(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/) ?? stdout.match(/Created baseline \w+ (\S+) \(/);
  if (!m?.[1]) throw new Error(`no slug in: ${stdout}`);
  return m[1];
}

interface CensusSite {
  readonly key: string;
  readonly dynamic: boolean;
}

let scratch: string[] = [];
let repo = "";
let leaf = "";
let sites: CensusSite[] = [];

beforeAll(() => {
  assertFreshBinary(LORE_BIN, [join(REPO_ROOT, "packages", "lore", "src"), join(REPO_ROOT, "packages", "core", "src")]);
  repo = realpathSync(mkdtempSync(join(tmpdir(), "blc-compiled-census-")));
  scratch.push(repo);
  if (repo.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  runGit(repo, ["init", "-q", "-b", "main"]);
  runGit(repo, ["config", "user.email", "blc@example.invalid"]);
  runGit(repo, ["config", "user.name", "blc test"]);
  writeFileSync(join(repo, "README.md"), "fixture\n");
  runGit(repo, ["add", "."]);
  runGit(repo, ["commit", "-q", "-m", "init"]);
  // The census reads the repo's CLI sources (found upward from cwd) and must resolve their imports like a real checkout.
  symlinkSync(join(REPO_ROOT, "packages"), join(repo, "packages"));
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "blc-fixture", private: true, workspaces: ["packages/*"] }));
  symlinkSync(join(REPO_ROOT, "node_modules"), join(repo, "node_modules"));
  mustRun(["init"], repo);

  const prd = slugOf(mustRun(["create", "prd", "--title", "BLC PRD", "--content", "root", "--no-ai"], repo).stdout);
  const root = slugOf(mustRun(["baseline", "add", prd, "--node", "root", "--label", "root", "--title", "BLC Root"], repo).stdout);
  const branch = slugOf(
    mustRun(["baseline", "add", root, "--node", "branch", "--label", "spec", "--title", "Specification and acceptance"], repo).stdout,
  );
  leaf = slugOf(mustRun(["baseline", "add", branch, "--node", "leaf", "--label", "lf", "--title", "Declare an acceptance criterion"], repo).stdout);
  mustRun(
    ["rule", "add", leaf, "--statement", "an AC id is unique within its spec", "--confidence", "established", "--enforced-by", "guaranteed", "--example", "duplicate id refused"],
    repo,
  );
});

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  scratch = [];
});

describe("compiled dist/lore: lore baseline sites", () => {
  it("lists at least one refusal site for a command and never reports typescript-unavailable", () => {
    const r = runLore(["baseline", "sites", COMMAND, "--json"], repo);
    expect(r.stderr + r.stdout).not.toContain("typescript-unavailable");
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout) as { ok: boolean; data: { sites: CensusSite[] } };
    sites = parsed.data.sites;
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.every((s) => typeof s.key === "string" && s.key.length > 0 && typeof s.dynamic === "boolean")).toBe(true);
  });
});

describe("compiled dist/lore: lore baseline coverage (specification branch leaf)", () => {
  it("an unmapped leaf is INCOMPLETE (exit 1) and names a census site, not a typescript error", () => {
    mustRun(["baseline", "map", leaf, "--command", COMMAND], repo);
    const r = runLore(["baseline", "coverage", leaf], repo);
    expect(r.stderr + r.stdout).not.toContain("typescript-unavailable");
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain(sites[0]!.key);
  });

  it("every census site mapped -> coverage exits 0 with at least one site counted", () => {
    mustRun(["baseline", "map", leaf, "--site", sites[0]!.key, "--rule", "BR-1"], repo);
    for (const s of sites.slice(1)) {
      mustRun(["baseline", "map", leaf, "--site", s.key, "--non-business", "plumbing, not business behaviour"], repo);
    }
    const r = runLore(["baseline", "coverage", leaf], repo);
    expect(r.stderr + r.stdout).not.toContain("typescript-unavailable");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/complete - [1-9]\d* site\(s\)/);
  });
});

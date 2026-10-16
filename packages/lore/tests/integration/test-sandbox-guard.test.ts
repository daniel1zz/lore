/**
 * AC-TG-2: with LORE_TEST_SANDBOX=1, resolving a corpus whose lore.db lies inside this
 * repository fails with exit 4 naming LORE_TEST_SANDBOX and the refused path (read and
 * write); a throwaway mkdtemp corpus resolves normally; the vitest setup file armed the
 * variable. The "repository" is a fake mkdtemp tree handed in via LORE_TEST_SANDBOX_REPO,
 * so this suite never touches the real `.lore/`.
 *
 * Six dimensions: HAPPY (throwaway resolves) / NEGATIVE (read+write refused) /
 * BOUNDARY (linked worktree refuses the main checkout's db) / ERROR (missing repo var
 * fails loud) / STATE (unarmed guard is inert) / REGRESSION (runner arms the variable).
 *
 * @spec_ref spec-test-governance-guards-that-refuse-bad-tests-declared AC-TG-2
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = resolve(fileURLToPath(new URL("../../src/index.ts", import.meta.url)));
const REPO_ROOT = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
const made: string[] = [];

function tmp(label: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `lore-sandbox-${label}-`)));
  made.push(dir);
  return dir;
}

/** A fake "repository": an empty `.lore/lore.db` placeholder (resolution only probes existence). */
function fakeRepoWithDb(): { root: string; db: string } {
  const root = tmp("repo");
  mkdirSync(join(root, ".lore"));
  const db = join(root, ".lore", "lore.db");
  writeFileSync(db, "");
  return { root, db };
}

function runCli(args: string[], cwd: string, env: Record<string, string | undefined>) {
  const base: NodeJS.ProcessEnv = { ...process.env };
  delete base["LORE_TEST_SANDBOX"];
  delete base["LORE_TEST_SANDBOX_REPO"];
  const r = spawnSync("bun", ["run", CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...base, ...env } as NodeJS.ProcessEnv,
    timeout: 25000,
  });
  return { status: r.status, stderr: r.stderr ?? "", stdout: r.stdout ?? "" };
}

function runVcs(args: string[], cwd: string) {
  return spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" });
}

afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

describe("AC-TG-2 LORE_TEST_SANDBOX refuses this repository's corpus", () => {
  it("AC-TG-2 REGRESSION: the vitest setup file armed the marker and recorded this checkout", () => {
    expect(process.env["LORE_TEST_SANDBOX"]).toBe("1");
    expect(realpathSync(process.env["LORE_TEST_SANDBOX_REPO"]!)).toBe(realpathSync(REPO_ROOT));
  });

  it("AC-TG-2 NEGATIVE: a read resolving the repo's own db exits 4 naming the variable and the path", () => {
    const { root, db } = fakeRepoWithDb();
    const r = runCli(["list"], root, { LORE_TEST_SANDBOX: "1", LORE_TEST_SANDBOX_REPO: root });
    expect(r.status).toBe(4);
    expect(r.stderr).toContain("LORE_TEST_SANDBOX");
    expect(r.stderr).toContain(db);
  });

  it("AC-TG-2 NEGATIVE: a write resolving the repo's own db exits 4 naming the variable and the path", () => {
    const { root, db } = fakeRepoWithDb();
    const r = runCli(["delete", "no-such-slug"], root, { LORE_TEST_SANDBOX: "1", LORE_TEST_SANDBOX_REPO: root });
    expect(r.status).toBe(4);
    expect(r.stderr).toContain("LORE_TEST_SANDBOX");
    expect(r.stderr).toContain(db);
  });

  it("AC-TG-2 BOUNDARY: a db found from a nested directory of the repo is refused too", () => {
    const { root } = fakeRepoWithDb();
    const nested = join(root, "sub", "deeper");
    mkdirSync(nested, { recursive: true });
    const r = runCli(["list"], nested, { LORE_TEST_SANDBOX: "1", LORE_TEST_SANDBOX_REPO: root });
    expect(r.status).toBe(4);
  });

  it("AC-TG-2 BOUNDARY: from a linked worktree the main checkout's db is refused", () => {
    const main = tmp("main");
    expect(runVcs(["init", "-q"], main).status).toBe(0);
    mkdirSync(join(main, ".lore"));
    writeFileSync(join(main, ".lore", "lore.db"), "");
    expect(runVcs(["commit", "-q", "--allow-empty", "-m", "x"], main).status).toBe(0);
    const wt = join(tmp("wtparent"), "wt");
    expect(runVcs(["worktree", "add", "-q", wt], main).status).toBe(0);
    const r = runCli(["list"], wt, { LORE_TEST_SANDBOX: "1", LORE_TEST_SANDBOX_REPO: wt });
    expect(r.status).toBe(4);
    expect(r.stderr).toContain(join(main, ".lore", "lore.db"));
  });

  it("AC-TG-2 HAPPY: a throwaway mkdtemp corpus resolves normally", () => {
    const { root: otherRepo } = fakeRepoWithDb();
    const corpus = tmp("corpus");
    const env = { LORE_TEST_SANDBOX: "1", LORE_TEST_SANDBOX_REPO: otherRepo };
    expect(runCli(["init"], corpus, env).status).toBe(0);
    const r = runCli(["list"], corpus, env);
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain("LORE_TEST_SANDBOX");
  });

  it("AC-TG-2 ERROR: marker set without LORE_TEST_SANDBOX_REPO fails loud with exit 4", () => {
    const { root } = fakeRepoWithDb();
    const r = runCli(["list"], root, { LORE_TEST_SANDBOX: "1" });
    expect(r.status).toBe(4);
    expect(r.stderr).toContain("LORE_TEST_SANDBOX_REPO");
  });

  it("AC-TG-2 STATE: without the marker the guard is inert", () => {
    const { root } = fakeRepoWithDb();
    const r = runCli(["list"], root, {});
    expect(r.stderr).not.toContain("LORE_TEST_SANDBOX");
  });
});

// @spawns packages/lore/src/index.ts
/**
 * AC-MG-3 oracle — `lore setup --project` detaches every working copy that has main checked out, and refuses what it
 * cannot do safely (spec-no-working-copy-can-check-out-main-the-main-ref-guard, BR-1343).
 *
 * Throwaway repo + corpus, REAL `lore setup --project`:
 *   - the shared checkout and one linked worktree each on main with a tracked edit and an untracked file: setup exits 0,
 *     both end detached at main's commit, every edited and untracked file is byte-identical, the receipt names both;
 *   - git reported as 2.45.2 (a `git` shim answering `--version`): exit exactly 4 naming '2.45.2' and 'git 2.46';
 *   - a repository with no commit (unborn main): exit exactly 4 naming the first commit;
 *   - in both refused cases no file under the repository changed.
 *
 * @spec_ref AC-MG-3
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { GuardRepo, makeTempRoot, oldGitShim } from "./support/main-guard-repo.js";

let root = "";

beforeAll(() => {
  root = makeTempRoot("lore-mg3-");
});

afterAll(() => {
  if (root.includes("lore-mg3-")) rmSync(root, { recursive: true, force: true });
});

/** Every file under `dir` (skipping .git) as `relative path -> sha256`, so "no file changed" is a comparison. */
function fileDigests(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (statSync(full).isFile()) out[relative(dir, full)] = createHash("sha256").update(readFileSync(full)).digest("hex");
    }
  };
  walk(dir);
  return out;
}

describe("AC-MG-3 setup detaches every checkout of main", () => {
  it("AC-MG-3 shared checkout and linked worktree on main end detached at the same commit, edits byte-identical, receipt names both", () => {
    const fx = new GuardRepo(root);
    const linked = join(root, "linked-on-main");
    fx.git(["worktree", "add", "-q", "-f", linked, "main"]);
    const mainSha = fx.main();
    for (const cwd of [fx.repo, linked]) {
      writeFileSync(join(cwd, "base.txt"), `edited in ${cwd}\n`);
      writeFileSync(join(cwd, "untracked.txt"), `untracked in ${cwd}\n`);
    }
    const editedBefore = new Map([fx.repo, linked].map((cwd) => [cwd, [readFileSync(join(cwd, "base.txt")), readFileSync(join(cwd, "untracked.txt"))] as const]));
    expect(fx.headState(fx.repo).branch).toBe("refs/heads/main");
    expect(fx.headState(linked).branch).toBe("refs/heads/main");

    const setup = fx.setupProject();

    expect(setup.exitCode, setup.out).toBe(0);
    for (const cwd of [fx.repo, linked]) {
      const head = fx.headState(cwd);
      expect(head.branch, cwd).toBe("");
      expect(head.sha, cwd).toBe(mainSha);
      const [edit, untracked] = editedBefore.get(cwd) ?? [];
      expect(readFileSync(join(cwd, "base.txt")).equals(edit ?? Buffer.alloc(0)), `${cwd} base.txt`).toBe(true);
      expect(readFileSync(join(cwd, "untracked.txt")).equals(untracked ?? Buffer.alloc(0)), `${cwd} untracked.txt`).toBe(true);
      expect(fx.git(["status", "--porcelain", "--", "base.txt"], cwd)).toBe("M base.txt");
      // receipt names this working copy
      expect(setup.out).toContain(realpathSync(cwd));
    }
    expect(fx.main()).toBe(mainSha);
  }, 180_000);

  it("AC-MG-3 a second setup run finds nothing on main and reports it skipped", () => {
    const fx = new GuardRepo(root, { detached: true });
    const first = fx.setupProject();
    expect(first.exitCode, first.out).toBe(0);
    const second = fx.setupProject();
    expect(second.exitCode, second.out).toBe(0);
    expect(second.out).toMatch(/Main checkouts: skipped/);
  }, 180_000);
});

describe("AC-MG-3 setup refuses with nothing changed", () => {
  it("AC-MG-3 git reported as 2.45.2: exit 4 naming '2.45.2' and 'git 2.46', no file changed", () => {
    const fx = new GuardRepo(root);
    const before = fileDigests(fx.repo);
    const head = fx.headState();
    const shim = oldGitShim(root, "2.45.2");

    const setup = fx.setupProject({ PATH: `${shim}:${process.env.PATH ?? ""}` });

    expect(setup.exitCode, setup.out).toBe(4);
    expect(setup.out).toContain("2.45.2");
    expect(setup.out).toContain("git 2.46");
    expect(setup.out).toContain("Upgrade git to 2.46+");
    expect(fileDigests(fx.repo)).toEqual(before);
    expect(fx.headState()).toEqual(head);
  }, 120_000);

  it("AC-MG-3 a repository with no commit: exit 4 naming the first commit, no file changed", () => {
    const fx = new GuardRepo(root, { unborn: true });
    writeFileSync(join(fx.repo, "wip.txt"), "work in progress\n");
    const before = fileDigests(fx.repo);

    const setup = fx.setupProject();

    expect(setup.exitCode, setup.out).toBe(4);
    expect(setup.out).toContain("first commit");
    expect(fileDigests(fx.repo)).toEqual(before);
  }, 120_000);
});

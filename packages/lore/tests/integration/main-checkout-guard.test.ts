// @spawns packages/lore/src/index.ts
// @reads assets/project/reference-transaction
/**
 * AC-MG-1 oracle — no working copy can check out main: the shipped reference-transaction hook, installed by
 * `lore setup --project`, refuses every way of pointing HEAD at refs/heads/main
 * (spec-no-working-copy-can-check-out-main-the-main-ref-guard, BR-1342).
 *
 * Throwaway repo + corpus; REAL git (>= 2.46) and the REAL `lore setup --project`. The repo has its shared checkout and one
 * linked worktree both on main BEFORE setup, so setup's detach step is part of the arrangement; afterwards both sit
 * detached and every attempt to get back onto main is made from each of them.
 *
 * Asserted per refused command: exit exactly 128, stderr 'ref updates aborted by hook' and the hook's detach hint,
 * HEAD (sha and branch) unchanged, and for `git worktree add <p> main` no new `git worktree list` entry and no directory.
 * Not refused: `git worktree add --detach <p> main`, `git checkout --detach main`, another branch, and with
 * LORE_INTEGRATE=1 `git checkout main`.
 *
 * @spec_ref AC-MG-1
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { GuardRepo, makeTempRoot } from "./support/main-guard-repo.js";

let root = "";
let fx: GuardRepo;
let linked = "";

beforeAll(() => {
  root = makeTempRoot("lore-mg1-");
  fx = new GuardRepo(root);
  linked = join(root, "linked-on-main");
  // main is checked out in both working copies, as it is in a repository that predates the guard (-f: git's own lock)
  fx.git(["worktree", "add", "-q", "-f", linked, "main"]);
  fx.git(["branch", "other", "main"]);
  const setup = fx.setupProject();
  expect(setup.exitCode, setup.out).toBe(0);
}, 120_000);

afterAll(() => {
  if (root.includes("lore-mg1-")) rmSync(root, { recursive: true, force: true });
});

const REFUSED: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["git checkout main", ["checkout", "main"]],
  ["git switch main", ["switch", "main"]],
  ["git symbolic-ref HEAD refs/heads/main", ["symbolic-ref", "HEAD", "refs/heads/main"]],
  ["git checkout -B main", ["checkout", "-B", "main"]],
];

describe("AC-MG-1 setup leaves both working copies detached", () => {
  it("AC-MG-1 the shared checkout and the linked worktree are detached at main's commit", () => {
    for (const cwd of [fx.repo, linked]) {
      const head = fx.headState(cwd);
      expect(head.branch, cwd).toBe("");
      expect(head.sha, cwd).toBe(fx.main());
    }
  });
});

describe("AC-MG-1 every way of checking out main is refused", () => {
  for (const [label, args] of REFUSED) {
    for (const [where, getCwd] of [["shared checkout", () => fx.repo], ["linked worktree", () => linked]] as const) {
      it(`AC-MG-1 ${label} in the ${where} exits 128 with the hook's refusal and changes nothing`, () => {
        const cwd = getCwd();
        const before = fx.headState(cwd);
        const mainBefore = fx.main();
        const r = fx.gitRaw([...args], cwd);
        expect(r.status, r.out).toBe(128);
        expect(r.stderr).toContain("ref updates aborted by hook");
        expect(r.stderr).toContain("git checkout --detach main");
        expect(fx.headState(cwd)).toEqual(before);
        expect(fx.main()).toBe(mainBefore);
      });
    }
  }

  it("AC-MG-1 git worktree add <path> main exits 128, creates no worktree and no directory", () => {
    const target = join(root, "wanted-on-main");
    const listedBefore = fx.worktreePaths();
    const r = fx.gitRaw(["worktree", "add", target, "main"]);
    expect(r.status, r.out).toBe(128);
    expect(r.stderr).toContain("ref updates aborted by hook");
    expect(r.stderr).toContain("git worktree add --detach");
    expect(fx.worktreePaths()).toEqual(listedBefore);
    expect(existsSync(target)).toBe(false);
  });
});

describe("AC-MG-1 what is not refused", () => {
  it("AC-MG-1 --detach forms and other branches exit 0", () => {
    const target = join(root, "detached-reader");
    expect(fx.gitRaw(["worktree", "add", "--detach", target, "main"]).status).toBe(0);
    expect(fx.headState(target).branch).toBe("");
    expect(fx.git(["worktree", "remove", "--force", target])).toBe("");

    expect(fx.gitRaw(["checkout", "--detach", "main"], linked).status).toBe(0);
    expect(fx.gitRaw(["checkout", "other"], linked).status).toBe(0);
    expect(fx.headState(linked).branch).toBe("refs/heads/other");
    expect(fx.gitRaw(["checkout", "--detach", "main"], linked).status).toBe(0);
    expect(fx.gitRaw(["switch", "--detach", "main"], fx.repo).status).toBe(0);
  });

  it("AC-MG-1 with LORE_INTEGRATE=1 git checkout main exits 0 (the marker is the bypass)", () => {
    const r = fx.gitRaw(["checkout", "main"], linked, { LORE_INTEGRATE: "1" });
    expect(r.status, r.out).toBe(0);
    expect(fx.headState(linked).branch).toBe("refs/heads/main");
    fx.git(["checkout", "-q", "--detach", "main"], linked);
  });
});

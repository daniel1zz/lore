// @spawns packages/lore/src/index.ts
// @reads assets/project/reference-transaction
/**
 * AC-MG-2 oracle — `lore integrate` requires the main-ref guard
 * (spec-no-working-copy-can-check-out-main-the-main-ref-guard, BR-1273 as modified).
 *
 * Throwaway repo + corpus, REAL `lore` processes. Per refusal: exit exactly 4, the message names what to run or what was
 * found, and refs/heads/main is unchanged (and no integration worktree was created: nothing moved before the refusal).
 *   - no hook in the active hooks directory: names 'lore setup --project';
 *   - the hook differing from the shipped asset by one byte: the same;
 *   - git reported as 2.45.2 (a `git` shim answering `--version`; the real git does the rest): names '2.45.2';
 *   - the shipped hook and git >= 2.46: the same branch lands (exit 0).
 *
 * @spec_ref AC-MG-2
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { claimBranchTask } from "../helpers/claim-branch-task.js";
import { GuardRepo, SHIPPED_HOOK_PATH, installShippedGuard, makeTempRoot, oldGitShim } from "./support/main-guard-repo.js";

const INDEX_TS = join(new URL("../../", import.meta.url).pathname.replace(/\/$/, ""), "src", "index.ts");

let root = "";

beforeAll(() => {
  root = makeTempRoot("lore-mg2-");
});

afterAll(() => {
  if (root.includes("lore-mg2-")) rmSync(root, { recursive: true, force: true });
});

function fixture(): { fx: GuardRepo; branch: string } {
  const fx = new GuardRepo(root, { detached: true });
  fx.setFloor("true");
  return { fx, branch: fx.makeBranch("guarded") };
}

function expectRefused(fx: GuardRepo, result: { exitCode: number; out: string }, mainBefore: string): void {
  expect(result.exitCode, result.out).toBe(4);
  expect(fx.main()).toBe(mainBefore);
  expect(existsSync(join(fx.repo, ".claude", "worktrees"))).toBe(false);
}

describe("AC-MG-2 integrate refuses a missing or stale guard", () => {
  it("AC-MG-2 no hook in the active hooks directory: exit 4 naming 'lore setup --project', main unchanged", async () => {
    const { fx, branch } = fixture();
    const before = fx.main();
    const r = await fx.integrate(branch, "mg2-missing");
    expectRefused(fx, r, before);
    expect(r.out).toContain("lore setup --project");
  }, 120_000);

  it("AC-MG-2 a hook one byte different from the shipped one: exit 4 naming 'lore setup --project', main unchanged", async () => {
    const { fx, branch } = fixture();
    installShippedGuard(fx.repo);
    appendFileSync(join(fx.repo, "hooks", "reference-transaction"), "#");
    expect(readFileSync(join(fx.repo, "hooks", "reference-transaction")).length).toBe(readFileSync(SHIPPED_HOOK_PATH).length + 1);
    const before = fx.main();
    const r = await fx.integrate(branch, "mg2-stale");
    expectRefused(fx, r, before);
    expect(r.out).toContain("lore setup --project");
  }, 120_000);

  it("AC-MG-2 git reported as 2.45.2: exit 4 naming '2.45.2', main unchanged, even with the shipped hook installed", async () => {
    const { fx, branch } = fixture();
    installShippedGuard(fx.repo);
    const before = fx.main();
    const shim = oldGitShim(root, "2.45.2");
    const r = await fx.integrate(branch, "mg2-oldgit", { PATH: `${shim}:${process.env.PATH ?? ""}` });
    expectRefused(fx, r, before);
    expect(r.out).toContain("2.45.2");
    expect(r.out).toContain("git 2.46");
    expect(r.out).toContain("Upgrade git to 2.46+");
  }, 120_000);
});

describe("AC-MG-2 a refused integrate has changed no ref, not even a remote-tracking one", () => {
  it("AC-MG-2 integrate of origin/main with no guard exits 4 and refs/remotes is byte-identical before and after", async () => {
    const { fx } = fixture();
    const bare = join(root, "origin-nofetch.git");
    fx.git(["init", "-q", "--bare", "-b", "main", bare]);
    fx.git(["remote", "add", "origin", bare]);
    fx.git(["push", "-q", "origin", "main"]);
    // a peer pushes a new commit to the remote: a fetch WOULD move refs/remotes/origin/main
    const peer = join(root, "origin-nofetch-peer");
    fx.git(["clone", "-q", bare, peer]);
    fx.git(["-c", "user.email=p@example.com", "-c", "user.name=p", "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "peer commit"], peer);
    fx.git(["push", "-q", "origin", "main"], peer);
    const refsBefore = fx.git(["for-each-ref", "refs/remotes"]);
    const mainBefore = fx.main();
    expect(refsBefore).not.toBe("");

    const r = await fx.integrate("origin/main", "mg2-nofetch");

    expectRefused(fx, r, mainBefore);
    expect(r.out).toContain("lore setup --project");
    expect(fx.git(["for-each-ref", "refs/remotes"])).toBe(refsBefore);
  }, 120_000);
});

describe("AC-MG-2 integrate lands with the guard in force", () => {
  it("AC-MG-2 the shipped hook on git >= 2.46: the branch lands (exit 0) and main holds it", async () => {
    const { fx, branch } = fixture();
    installShippedGuard(fx.repo);
    // BR-1348: the branch needs a task claimed on it for integrate to judge it
    claimBranchTask((args) => {
      const run = spawnSync("bun", ["run", INDEX_TS, ...args], { cwd: fx.repo, env: fx.env("claim"), encoding: "utf8" });
      return { status: run.status ?? 1, out: `${run.stdout}${run.stderr}` };
    }, fx.repo, branch, "code");
    const before = fx.main();
    const tip = fx.git(["rev-parse", branch]);
    const r = await fx.integrate(branch, "mg2-lands");
    expect(r.exitCode, r.out).toBe(0);
    expect(fx.main()).not.toBe(before);
    expect(fx.git(["merge-base", "--is-ancestor", tip, "main"])).toBe("");
  }, 120_000);
});

// @spawns packages/lore/src/index.ts
// @reads assets/project/reference-transaction
/**
 * AC-LB-1 (spec-landing-does-the-bookkeeping-claims-start-from-main-parked, BR-1353): a task's FIRST claim from a
 * linked worktree is refused when the worktree's HEAD carries commits not on main; a later claim of the same task on
 * the branch its claim already records is not.
 *
 * Fixture: a throwaway git repo + corpus (OwnDiffFixture: mkdtemp, `lore init`, the shipped main-ref guard installed
 * after `git checkout -q --detach main`, floor_command "true"). Every claim runs under its OWN
 * CLAUDE_CODE_SESSION_ID and the fixture strips the ambient one. Real linked worktrees (`git worktree add`), never
 * branch names, because the rule is about a working copy.
 *
 * SIMPLEST GREEN-BUT-BROKEN CASE (asserted by step 3): a check that only compares HEAD to main's tip refuses the
 * implementer's own second claim of the same task on its own branch; step 3 requires that claim to pass.
 * Made red once by dropping the recorded-branch exemption.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OwnDiffFixture } from "../helpers/own-diff-fixture.js";

const TEST_TIMEOUT_MS = 180_000;

let fx: OwnDiffFixture;
let wtRoot = "";
let taskA = "";
let taskB = "";

const session = (label: string): Record<string, string> => ({ CLAUDE_CODE_SESSION_ID: `lbs${label}-0000-4000-8000-000000000000` });

function gitIn(cwd: string, args: readonly string[]): string {
  return execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
  }).trim();
}

function commitIn(cwd: string, file: string): void {
  writeFileSync(join(cwd, file), `${file}\n`);
  gitIn(cwd, ["add", "-A"]);
  gitIn(cwd, ["commit", "-q", "-m", `add ${file}`]);
}

function addWorktree(name: string, from: string): string {
  const path = join(wtRoot, name);
  fx.git(["worktree", "add", "-q", "-b", name, path, from]);
  return path;
}

beforeAll(() => {
  fx = new OwnDiffFixture();
  wtRoot = mkdtempSync(join(tmpdir(), "lore-lb-claim-wt-"));
  taskA = fx.createTask("task A", ["src/a.ts"]);
  taskB = fx.createTask("task B", ["src/b.ts"]);
}, TEST_TIMEOUT_MS);

afterAll(() => {
  fx.dispose();
  rmSync(wtRoot, { recursive: true, force: true });
});

describe("AC-LB-1 a first claim starts from main", () => {
  it(
    "(1) refuses a first claim from a worktree cut from an unlanded branch, naming BR-1353, the commit count and the branch",
    () => {
      const wtA = addWorktree("branch-a", "main");
      const claimA = fx.lore(["claim", taskA, "--worktree", wtA], session("a"));
      expect(claimA.exitCode, claimA.text).toBe(0);
      commitIn(wtA, "a1.txt");
      commitIn(wtA, "a2.txt");

      const wtFromA = addWorktree("branch-from-a", "branch-a");
      const refused = fx.lore(["claim", taskB, "--worktree", wtFromA], session("b"));
      expect(refused.exitCode, refused.text).toBe(4);
      expect(refused.stderr).toContain("BR-1353");
      expect(refused.stderr).toMatch(/\b2 commits?\b/);
      expect(refused.stderr).toContain("branch-a");
      // the refused claim persisted nothing
      expect(fx.extraOf(taskB)["claim"]).toBeUndefined();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "(2) accepts a first claim from a worktree cut from main, and (3) the implementer's later claim on its own branch",
    () => {
      const wtC = addWorktree("branch-c", "main");
      const first = fx.lore(["claim", taskB, "--worktree", wtC], session("c"));
      expect(first.exitCode, first.text).toBe(0);

      commitIn(wtC, "c1.txt");
      const released = fx.lore(["release", taskB], session("c"));
      expect(released.exitCode, released.text).toBe(0);

      // the worktree now carries one commit not on main, on the branch the claim record names
      expect(gitIn(wtC, ["rev-list", "--count", "main..HEAD"])).toBe("1");
      const again = fx.lore(["claim", taskB, "--worktree", wtC], session("c"));
      expect(again.exitCode, again.text).toBe(0);
      expect(again.stderr).not.toContain("BR-1353");
    },
    TEST_TIMEOUT_MS,
  );
});

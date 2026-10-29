/**
 * landing-start-of.test.ts: `createGitFacts(cwd).landingStartOf` over real throwaway git repositories.
 *
 * A branch whose head reached main through ANOTHER branch's merge (X merged into Y, Y landed) is not on main's
 * first-parent chain; its landing start is still the first parent of the merge that brought it onto main.
 *
 * Coverage: HAPPY (plain merge), STATE (X reached main through Y), NEGATIVE (fast-forward refused, not below main),
 * BOUNDARY (main moved before Y landed: the start is the commit main stood at, not the fork point).
 *
 * @spec_ref spec-a-plan-s-tests-and-criteria-are-measured-once-at-its (BR-1379)
 */

import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGitFacts } from "../../src/adapters/real-git-port.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function commitFile(cwd: string, file: string): string {
  writeFileSync(join(cwd, file), `${file}\n`);
  git(cwd, ["add", file]);
  git(cwd, ["commit", "-q", "-m", file]);
  return git(cwd, ["rev-parse", "HEAD"]);
}

function repo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "landing-start-")));
  dirs.push(dir);
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "t@example.invalid"]);
  git(dir, ["config", "user.name", "T"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  return dir;
}

describe("landingStartOf", () => {
  it("HAPPY: a branch merged with a merge commit starts at main's first parent of that merge", () => {
    const cwd = repo();
    const base = commitFile(cwd, "base");
    git(cwd, ["checkout", "-q", "-b", "y"]);
    const y1 = commitFile(cwd, "y1");
    git(cwd, ["checkout", "-q", "main"]);
    git(cwd, ["merge", "-q", "--no-ff", "-m", "land y", "y"]);
    expect(createGitFacts(cwd).landingStartOf(y1)).toEqual({ ok: true, value: base });
  });

  it("STATE: a branch X merged into branch Y, with Y landed, starts at the first parent of Y's landing merge", () => {
    const cwd = repo();
    commitFile(cwd, "base");
    git(cwd, ["checkout", "-q", "-b", "x"]);
    const x1 = commitFile(cwd, "x1");
    git(cwd, ["checkout", "-q", "main"]);
    git(cwd, ["checkout", "-q", "-b", "y"]);
    commitFile(cwd, "y1");
    git(cwd, ["merge", "-q", "--no-ff", "-m", "x into y", "x"]);
    git(cwd, ["checkout", "-q", "main"]);
    const beforeLanding = commitFile(cwd, "main-moved");
    git(cwd, ["merge", "-q", "--no-ff", "-m", "land y", "y"]);
    const landingMerge = git(cwd, ["rev-parse", "HEAD"]);
    commitFile(cwd, "later");
    expect(git(cwd, ["rev-parse", `${landingMerge}^1`])).toBe(beforeLanding);
    expect(createGitFacts(cwd).landingStartOf(x1)).toEqual({ ok: true, value: beforeLanding });
  });

  it("NEGATIVE: a fast-forwarded branch has no merge marking its start", () => {
    const cwd = repo();
    commitFile(cwd, "base");
    git(cwd, ["checkout", "-q", "-b", "y"]);
    const y1 = commitFile(cwd, "y1");
    git(cwd, ["checkout", "-q", "main"]);
    git(cwd, ["merge", "-q", "--ff-only", "y"]);
    commitFile(cwd, "later");
    const start = createGitFacts(cwd).landingStartOf(y1);
    expect(start.ok).toBe(false);
    if (!start.ok) expect(start.reason).toContain("without a merge");
  });

  it("NEGATIVE: a commit not below main's head is refused", () => {
    const cwd = repo();
    commitFile(cwd, "base");
    git(cwd, ["checkout", "-q", "-b", "stray"]);
    const stray = commitFile(cwd, "stray");
    git(cwd, ["checkout", "-q", "main"]);
    const start = createGitFacts(cwd).landingStartOf(stray);
    expect(start.ok).toBe(false);
    if (!start.ok) expect(start.reason).toContain("not below the head of main");
  });
});

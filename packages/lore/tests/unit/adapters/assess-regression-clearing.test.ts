/**
 * @spec_ref spec-the-milestone-review-measures-its-facts-per-landing-and (AC-AF-1, BR-1496)
 * @layer service AC-AF-1
 *
 * The git-backed clearing lookup over a throwaway repo: the newest measured result at or after the last landing wins by
 * first-parent order; earlier commits, unrunnable results and unknown commits never clear; a landing off main is an err.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ok } from "@lore/core";
import { createGitClearingSourceFinder } from "../../../src/adapters/cli/assess-regression-clearing.js";
import type { SuiteResultRecord } from "../../../src/store/store-interface.js";

let repo = "";
const commits: string[] = [];
const git = (...args: string[]): string => execFileSync("git", args, { cwd: repo, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } }).trim();

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "lore-clearing-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  for (let i = 0; i < 4; i += 1) {
    writeFileSync(join(repo, "f.txt"), String(i));
    git("add", "f.txt");
    git("commit", "-q", "-m", `c${String(i)}`);
    commits.push(git("rev-parse", "HEAD"));
  }
});
afterAll(() => rmSync(repo, { recursive: true, force: true }));

const result = (commit: string, status: "measured" | "unrunnable" = "measured"): SuiteResultRecord => ({
  id: `r-${commit.slice(0, 6)}-${status}`,
  commit_sha: commit,
  tree_sha: "t",
  status,
  cause: status === "unrunnable" ? "boom" : null,
  attempt: 1,
  commands: [],
  skipped: [],
  failing_test_files: [],
  duration_ms: 1,
  measured_at: "2026-10-28T00:00:00.000Z",
});

describe("git clearing source finder", () => {
  it("AC-AF-1 picks the newest measured main result at or after the last landing, in first-parent order", async () => {
    const [c0, c1, c2, c3] = commits as [string, string, string, string];
    const find = createGitClearingSourceFinder(repo, process.env, async () => ok([result(c3), result(c0), result(c2), result(c1)]));
    const found = await find([c1, c2]);
    expect(found.ok && found.value?.commit).toBe(c3);
  });

  it("AC-AF-1 results before the last landing and unrunnable results never clear", async () => {
    const [c0, c1, c2, c3] = commits as [string, string, string, string];
    const find = createGitClearingSourceFinder(repo, process.env, async () => ok([result(c0), result(c1), result(c3, "unrunnable")]));
    const found = await find([c2]);
    expect(found).toEqual(ok(null));
  });

  it("AC-AF-1 the landing's own result clears against itself (at or after)", async () => {
    const [, c1, c2] = commits as [string, string, string];
    const find = createGitClearingSourceFinder(repo, process.env, async () => ok([result(c2), result(c1)]));
    const found = await find([c2]);
    expect(found.ok && found.value?.commit).toBe(c2);
  });

  it("AC-AF-1 a landing that is not on main's first-parent history is an error, not 'nothing cleared'", async () => {
    const find = createGitClearingSourceFinder(repo, process.env, async () => ok([]));
    const found = await find(["f".repeat(40)]);
    expect(found.ok).toBe(false);
  });
});

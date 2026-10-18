// @reads scripts/test-read-log.ts
/**
 * TG-51: the declared-input recorder classifies an undeclared read as "git-ignored" from `git check-ignore`.
 * Bun spawnSync can return status 0 with EMPTY stdout (TG-49, ~1 in 6000 under load). `check-ignore` exit 0
 * means "at least one path is ignored", so exit 0 with an empty answer is a contradiction: it is NOT MEASURED
 * and must fail loud, never be read as "nothing is ignored" (which would blame a test for an undeclared read
 * of an ignored file). Exit 1 with empty stdout is the genuine "none ignored" answer and stays empty.
 *
 * Coverage: REGRESSION (status 0 + empty stdout), HAPPY (real answer), BOUNDARY (exit 1 empty), ERROR (exit 128).
 */
import { describe, expect, it } from "vitest";
import { findGitIgnoredPaths, GitIgnoreQueryError, type GitSpawn } from "../test-read-log";

function stub(result: { status: number | null; stdout: string; stderr?: string }): GitSpawn {
  return () => ({ status: result.status, stdout: result.stdout, stderr: result.stderr ?? "" });
}

describe("TG-51 findGitIgnoredPaths takes its verdict from git's exit status and fails loud on a lost answer", () => {
  it("TG-51 REGRESSION: exit 0 with stdout LOST throws GitIgnoreQueryError instead of reporting nothing ignored", () => {
    expect(() => findGitIgnoredPaths(["a.log"], stub({ status: 0, stdout: "" }))).toThrow(GitIgnoreQueryError);
    expect(() => findGitIgnoredPaths(["a.log"], stub({ status: 0, stdout: "" }))).toThrow(/status 0 with empty stdout/);
  });

  it("TG-51 HAPPY: exit 0 with an answer returns the ignored paths", () => {
    expect([...findGitIgnoredPaths(["a.log", "b.ts"], stub({ status: 0, stdout: "a.log\0" }))]).toEqual(["a.log"]);
  });

  it("TG-51 BOUNDARY: exit 1 with empty stdout is the genuine 'none ignored' answer", () => {
    expect([...findGitIgnoredPaths(["b.ts"], stub({ status: 1, stdout: "" }))]).toEqual([]);
  });

  it("TG-51 ERROR: any other exit still throws", () => {
    expect(() => findGitIgnoredPaths(["b.ts"], stub({ status: 128, stdout: "", stderr: "fatal" }))).toThrow(/exit 128/);
  });
});

// @spawns-external git the module under test's default git runner (the test injects fakes for the lost-answer cases)
// @spawns-external bun the module under test's default build and test runners (never started here)
/**
 * TG-53: changed-tests.ts must not read a lost git answer (exit 0, empty stdout) as a real result.
 * Spawn is injected; no real git child runs.
 */
import { describe, expect, it } from "vitest";
import { ChangedTestsError, getChangedFiles, getRepoRoot, resolveBaseRef, type GitSpawn } from "../changed-tests";

const ok = (stdout: string, status = 0): ReturnType<GitSpawn> => ({ status, stdout, stderr: "" });

describe("TG-53 changed-tests git answers fail loud when stdout is lost", () => {
  it("TG-53 NEGATIVE: rev-parse --show-toplevel with status 0 + empty stdout throws", () => {
    expect(() => getRepoRoot("/x", () => ok(""))).toThrow(ChangedTestsError);
  });

  it("TG-53 NEGATIVE: merge-base with status 0 + empty stdout throws", () => {
    expect(() => resolveBaseRef("/x", undefined, () => ok(""))).toThrow(ChangedTestsError);
  });

  it("TG-53 NEGATIVE: diff --name-only empty while diff --quiet exits 1 throws", () => {
    const spawn: GitSpawn = (_c, args) => (args.includes("--quiet") ? ok("", 1) : ok(""));
    expect(() => getChangedFiles("/x", "abc", spawn)).toThrow(/lost stdout/);
  });

  it("TG-53 HAPPY: real answers pass through; empty diff with --quiet exit 0 is a true empty", () => {
    expect(getRepoRoot("/x", () => ok("/repo\n"))).toBe("/repo");
    expect(resolveBaseRef("/x", undefined, () => ok("abc123\n"))).toBe("abc123");
    expect(resolveBaseRef("/x", "given", () => ok(""))).toBe("given");
    const spawn: GitSpawn = (_c, args) =>
      args[0] === "diff" && !args.includes("--quiet") ? ok("a.ts\n") : args[0] === "status" ? ok(" M b.ts\n") : ok("");
    expect(getChangedFiles("/x", "abc", spawn).sort()).toEqual(["a.ts", "b.ts"]);
    expect(getChangedFiles("/x", "abc", () => ok(""))).toEqual([]);
  });
});

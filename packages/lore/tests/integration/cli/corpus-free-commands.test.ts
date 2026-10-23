// @spawns packages/lore/src/index.ts
/**
 * Regression: replica priming runs for every command, so under LORE_TEST_SANDBOX=1 a corpus-free command spawned at
 * the repository root must not be refused (exit 4), while a command that opens the corpus still is.
 *
 * Coverage: HAPPY (--help, governance, setup --check not exit 4), NEGATIVE (corpus-opening command exits 4 with the
 * sandbox refusal text), REGRESSION (the refusal message names the repository's own corpus).
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");

function runLoreAtRepoRoot(args: readonly string[]): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync("bun", [ENTRY, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, LORE_TEST_SANDBOX: "1", LORE_TEST_SANDBOX_REPO: REPO_ROOT },
  });
  return { exitCode: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

describe("corpus-free commands under the test sandbox", () => {
  it.each([["--help"], ["governance", "--seat-briefing"], ["setup", "--check"]])(
    "lore %s at the repo root is not refused by the sandbox",
    (...args) => {
      const run = runLoreAtRepoRoot(args);
      expect(run.stderr).not.toContain("refuses the repository's own corpus");
      expect(run.exitCode).not.toBe(4);
    },
  );

  it("a corpus-opening command at the repo root is still refused (exit 4)", () => {
    const run = runLoreAtRepoRoot(["status"]);
    expect(run.exitCode).toBe(4);
    expect(run.stderr).toContain("refuses the repository's own corpus");
  });
});

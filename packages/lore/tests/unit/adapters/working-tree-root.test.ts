// @spawns-external git builds a throwaway git repository the test runs against
/**
 * INT-T5 unit coverage of `resolveWorkingTreeRoot` / `resolveTrackedWriteRoot` (adapters/cli/working-tree-root.ts).
 *
 * Coverage: HAPPY (a git working tree resolves to its toplevel from a subdirectory), BOUNDARY (a directory outside
 * any git working tree yields the caller's fallback), ERROR (an unmeasurable cwd is a refusal naming it, never the
 * fallback).
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { resolveTrackedWriteRoot, resolveWorkingTreeRoot } from "../../../src/adapters/cli/working-tree-root";

const scratch: string[] = [];

afterEach(() => {
  while (scratch.length > 0) {
    const dir = scratch.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function makeDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lore-int-t5-unit-")));
  scratch.push(dir);
  return dir;
}

describe("INT-T5 working-tree root resolution", () => {
  it("INT-T5 resolves the toplevel of a git working tree from a nested directory", () => {
    const dir = makeDir();
    expect(spawnSync("git", ["init", "-q", dir]).status).toBe(0);
    const nested = join(dir, "a", "b");
    mkdirSync(nested, { recursive: true });
    const result = resolveWorkingTreeRoot(nested);
    expect(result).toEqual({ ok: true, value: dir });
  });

  it("INT-T5 a directory outside any git working tree resolves to the caller fallback", () => {
    const dir = makeDir();
    expect(resolveWorkingTreeRoot(dir)).toEqual({ ok: true, value: undefined });
    expect(resolveTrackedWriteRoot(dir, "/corpus/root")).toEqual({ ok: true, value: "/corpus/root" });
  });

  it("INT-T5 an unmeasurable cwd is refused naming it, never replaced by the fallback", () => {
    const missing = join(makeDir(), "does-not-exist");
    const result = resolveTrackedWriteRoot(missing, "/corpus/root");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      expect(JSON.stringify(result.error)).toContain(missing);
    }
  });
});

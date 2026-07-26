/**
 * AC-083-1 — compiled-binary e2e oracle for `lore governance` (SPEC-083 D1):
 * spawning the COMPILED `dist/lore governance` binary exits 0 and its stdout
 * is BYTE-IDENTICAL to `assets/governance/corpus-workflow.md` on disk.
 * Modeled on `tests/integration/cli/slugify-compiled.bun.test.ts` — this
 * command is deliberately bootstrap-stage (no corpus, no `loadLoreApp`), so
 * it needs no throwaway corpus fixture at all, only a fresh compiled binary.
 *
 * `assertFreshBinary` (shared with `gate-hooks.bun.test.ts` /
 * `p2-e2e-closed-loop.bun.test.ts`) fails loud BEFORE any test body runs if
 * `dist/lore` is missing or older than the newest `.ts` source under
 * `packages/{lore,core}/src` — this file itself spawns `dist/lore`, so it
 * falls under the SPEC-061 build-freshness attestation precheck when run via
 * `lore verify`.
 *
 * Coverage:
 *   HAPPY:      `dist/lore governance` exits 0 and its stdout is
 *               byte-identical to `assets/governance/corpus-workflow.md`
 *               (proves D1's "resolves the SAME assets root `lore setup`
 *               uses, prints verbatim" contract end-to-end, not just against
 *               source-mode unit fixtures)
 *   NEGATIVE:   `dist/lore governance --bogus-flag` is rejected exit 2 (the
 *               SPEC-051 strict-flag seam wraps this command automatically —
 *               proves the `index.ts` registration actually routes through
 *               `wrapDefault`, not a bare unwrapped `defineCommand`)
 *   BOUNDARY:   stdout is non-empty and ends with exactly the same trailing
 *               newline the source file itself carries (a truncated or
 *               newline-appended print would silently fail the byte-parity
 *               assertion above too, but this pins the specific boundary
 *               byte independently so a future regression's failure message
 *               is unambiguous)
 *   REGRESSION: the printed content still contains the `<corpus-workflow>`
 *               open tag and one of the FEED/PRODUCE/EXECUTE/CLOSE section
 *               headers `assets-ssot.test.ts` already pins on the SOURCE
 *               file — cross-checks that the COMPILED runtime path reads the
 *               real governance asset, not a stale or empty placeholder
 *
 * @spec_ref SPEC-083 §Acceptance Criteria AC-083-1
 */

import { describe, expect, it, beforeAll } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { assertFreshBinary } from "./helpers/assert-fresh-binary";

// tests/integration/governance-compiled.bun.test.ts -> repo root is 4 levels up.
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");
const GOVERNANCE_ASSET_PATH = join(REPO_ROOT, "assets", "governance", "corpus-workflow.md");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawns the compiled `dist/lore` binary with the repo root as cwd (this command needs no `.lore/` corpus). */
function runLore(args: string[]): RunResult {
  const proc = Bun.spawnSync([LORE_BIN, ...args], { cwd: REPO_ROOT });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

beforeAll(() => {
  assertFreshBinary(LORE_BIN, [
    join(REPO_ROOT, "packages", "lore", "src"),
    join(REPO_ROOT, "packages", "core", "src"),
  ]);
});

describe("AC-083-1: compiled dist/lore governance (SPEC-083 D1)", () => {
  it("HAPPY: exits 0 with stdout byte-identical to assets/governance/corpus-workflow.md", () => {
    const expected = readFileSync(GOVERNANCE_ASSET_PATH, "utf8");
    const result = runLore(["governance"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(expected);
  });

  it("NEGATIVE: an unknown flag is rejected exit 2 (SPEC-051 strict-flag seam wraps this command)", () => {
    const result = runLore(["governance", "--bogus-flag"]);
    expect(result.exitCode).toBe(2);
  });

  it("BOUNDARY: stdout is non-empty and its last byte matches the source file's own trailing newline", () => {
    const expected = readFileSync(GOVERNANCE_ASSET_PATH, "utf8");
    const result = runLore(["governance"]);

    expect(result.stdout.length).toBeGreaterThan(0);
    expect(expected.endsWith("\n")).toBe(true);
    expect(result.stdout.endsWith("\n")).toBe(true);
  });

  it("REGRESSION: printed content still carries the <corpus-workflow> tag and a FEED section header", () => {
    const result = runLore(["governance"]);
    expect(result.stdout).toContain("<corpus-workflow>");
    expect(result.stdout).toContain("## FEED");
  });
});

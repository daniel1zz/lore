/** @spec_ref AC-TC-3 */
/**
 * Contract test for the `typecheck:dashboard-tests` root script
 * (`spec-typecheck-coverage-two-named-blind-spots-and-the-stale`, C2 /
 * AC-TC-3).
 *
 * Why this test exists: `packages/dashboard/src/routeTree.gen.ts` is
 * git-ignored and, before this task, was generated ONLY by the sibling
 * `typecheck:dashboard` script (`bunx @tanstack/router-cli generate && tsc
 * --noEmit`). `typecheck:dashboard-tests` ran `tsc --noEmit -p
 * packages/dashboard/tsconfig.tests.json` alone — no generation step. The
 * full `bun run typecheck` chain happens to run `typecheck:dashboard` first,
 * so the aggregate script exits 0, but `typecheck:dashboard-tests` was a
 * documented public entry point that LIED on a fresh clone: run standalone
 * with the generated file absent, it exits 2 with 24 misleading type errors
 * (21 x TS2345, 2 x TS7006, 1 x TS2307) that have nothing to do with any real
 * dashboard-test defect — measured 2026-08-10 by moving the file aside,
 * running, restoring, and diffing byte-for-byte.
 *
 * This test reproduces exactly that measurement as a real subprocess (never
 * a mocked fs — the whole point is to exercise the ACTUAL script string in
 * package.json against the ACTUAL generator), and asserts the fixed script
 * either regenerates the file itself (the option this task chose: the fixed
 * script is `bun --cwd=packages/dashboard run prebuild && tsc --noEmit -p
 * packages/dashboard/tsconfig.tests.json`, idempotent because router-cli
 * `generate` always overwrites deterministically from the same route
 * sources) or fails loud naming a recovery command — never the silent
 * 24-error misdirection.
 *
 * ⛔ Never leaves the tree mutated: the generated file is moved to a system
 * temp dir (survives even a crash mid-test), and a `finally` block restores
 * it — or removes the regenerated copy if it did not exist beforehand —
 * before the byte-identical assertion runs.
 *
 * Six-dimension coverage:
 *   HAPPY:      routeTree.gen.ts absent -> `typecheck:dashboard-tests` exits
 *               0 and leaves a real (non-empty) file behind — a green exit
 *               that left it absent would be a silent no-op, not a fix.
 *   NEGATIVE:   the subprocess's combined stdout+stderr contains ZERO
 *               occurrences of the three misleading error codes (TS2345,
 *               TS7006, TS2307) that made up all 24 of the old failure.
 *   BOUNDARY:   the "fail loud" branch (if ever chosen) is exercised by the
 *               same assertion block — either exit 0 with the file restored,
 *               or a non-zero exit whose message names the recovery command;
 *               there is no third, silent-24-error outcome.
 *   ERROR:      a `finally` block restores state even if an assertion above
 *               it throws, so a failing run of THIS test never leaves
 *               routeTree.gen.ts in the wrong state for the next run.
 *   STATE:      the restored file is asserted BYTE-IDENTICAL (Buffer.compare
 *               === 0) to what was on disk before the test ran, and the
 *               ABSENT case is symmetric — if it did not exist before, it
 *               must not exist after either.
 *   REGRESSION: the exact pre-fix shape (exit 2, 24 errors, that precise
 *               code-count breakdown) is asserted NOT to reproduce.
 */

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const ROUTE_TREE_PATH = join(REPO_ROOT, "packages", "dashboard", "src", "routeTree.gen.ts");

/** Counts occurrences of the three TS error codes that made up all 24 of the pre-fix failure. */
function countMisleadingErrors(text: string): number {
  return (text.match(/error TS(?:2345|7006|2307)\b/g) ?? []).length;
}

describe("typecheck:dashboard-tests script contract (AC-TC-3)", () => {
  it(
    "routetree-prerequisite: with routeTree.gen.ts absent, typecheck:dashboard-tests does not emit the 24 misleading errors and restores the file byte-identical afterwards",
    () => {
      const existedBefore = existsSync(ROUTE_TREE_PATH);
      const originalBytes = existedBefore ? readFileSync(ROUTE_TREE_PATH) : null;

      // Move the generated file ASIDE to a system temp dir (never delete it
      // outright) — survives even if this test process crashes mid-run.
      const backupDir = mkdtempSync(join(tmpdir(), "routetree-gen-backup-"));
      const backupPath = join(backupDir, "routeTree.gen.ts");
      if (existedBefore) {
        renameSync(ROUTE_TREE_PATH, backupPath);
      }

      let result: ReturnType<typeof spawnSync>;
      try {
        expect(existsSync(ROUTE_TREE_PATH)).toBe(false);

        result = spawnSync("bun", ["run", "typecheck:dashboard-tests"], {
          cwd: REPO_ROOT,
          encoding: "utf8",
          // Explicit maxBuffer per this repo's spawnSync-truncation discipline.
          maxBuffer: 20 * 1024 * 1024,
        });

        const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
        const misleadingErrorCount = countMisleadingErrors(combined);

        // REGRESSION: never the exact pre-fix shape again.
        expect(misleadingErrorCount).toBe(0);

        if (result.status === 0) {
          // Chosen fix: idempotent self-generation. A green exit that left
          // the file absent would be a silent no-op, not a fix.
          expect(existsSync(ROUTE_TREE_PATH)).toBe(true);
          expect(readFileSync(ROUTE_TREE_PATH, "utf8").length).toBeGreaterThan(0);
        } else {
          // Alternative allowed fix: fail loud naming the recovery command.
          expect(combined).toMatch(/prebuild|router-cli generate|typecheck:dashboard\b/);
        }
      } finally {
        // Restore to exactly the pre-test state, whatever the outcome above.
        if (existsSync(ROUTE_TREE_PATH)) {
          unlinkSync(ROUTE_TREE_PATH);
        }
        if (existedBefore && originalBytes) {
          writeFileSync(ROUTE_TREE_PATH, originalBytes);
        }
        rmSync(backupDir, { recursive: true, force: true });
      }

      // STATE: byte-identical restoration, symmetric for the absent case.
      if (existedBefore) {
        expect(existsSync(ROUTE_TREE_PATH)).toBe(true);
        const restoredBytes = readFileSync(ROUTE_TREE_PATH);
        expect(Buffer.compare(restoredBytes, originalBytes as Buffer)).toBe(0);
      } else {
        expect(existsSync(ROUTE_TREE_PATH)).toBe(false);
      }
    },
    120_000,
  );

  it("CONTROL: the pre-fix error-code pattern is detectable by this test's own counter (proves NEGATIVE/REGRESSION assertions above are not vacuous)", () => {
    const fabricatedPreFixOutput = [
      ...Array.from({ length: 21 }, (_, i) => `src/foo${i}.tsx(1,1): error TS2345: bogus`),
      "src/bar.tsx(2,2): error TS7006: implicit any",
      "src/baz.tsx(3,3): error TS7006: implicit any",
      "src/qux.tsx(4,4): error TS2307: cannot find module",
    ].join("\n");
    expect(countMisleadingErrors(fabricatedPreFixOutput)).toBe(24);
    expect(countMisleadingErrors("exit 0, no errors")).toBe(0);
  });
});

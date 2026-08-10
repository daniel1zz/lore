/** @spec_ref AC-TC-1 */
/**
 * Contract test proving `typecheck:dashboard-e2e` is LIVE-WIRED into the root
 * `typecheck` chain (`spec-typecheck-coverage-two-named-blind-spots-and-the-stale`,
 * C1 / AC-TC-1) — not merely that `packages/dashboard/tsconfig.e2e.json` exists
 * and resolves files.
 *
 * Why this test exists: the AC-TC-1 oracle that first shipped
 * (`task-add-an-e2e-tsconfig-project-covering-all-27-test-tree`) ran
 * `bunx tsc -p packages/dashboard/tsconfig.e2e.json --listFilesOnly` piped to a
 * `grep -c` directly against the tsconfig file. That oracle is STRUCTURALLY
 * BLIND to whether the project is ever invoked by `bun run typecheck` — it
 * never reads root `package.json` at all, so deleting
 * `"typecheck:dashboard-e2e"` from `scripts.typecheck`'s chain would leave it
 * exactly as green as before, while the blind spot this task closed reopened
 * (`lore assess` rated this a MAJOR outcome gap, 2026-08-10, and re-baselined
 * AC-TC-1 to require the assertion below). This test asserts BOTH halves in
 * the SAME case:
 *   (a) root `package.json`'s `scripts.typecheck` chain references the whole
 *       script name `typecheck:dashboard-e2e` (chain membership — proves
 *       WIRED, not just present), AND that script itself invokes `tsc` against
 *       the expected tsconfig path (not just any script sharing the name); AND
 *   (b) running that project's OWN tsc program with `--listFilesOnly` still
 *       resolves >= 27 files under `tests/e2e/` — the measured census floor
 *       from C1 (8 `.pw.ts` + 6 `.spec.ts` + 13 other `.ts` = 27).
 *
 * Six-dimension coverage:
 *   HAPPY:      both (a) and (b) hold against the real, current repo state.
 *   NEGATIVE:   the chain matcher does NOT match on the same-prefix sibling
 *               script name `typecheck:dashboard-tests` alone — a naive
 *               substring `.includes("typecheck:dashboard")` would false-match
 *               there, so the CONTROL case below proves the real matcher
 *               requires the exact, whole script token.
 *   BOUNDARY:   (b) asserts the exact measured floor (>= 27), not merely
 *               "> 0" — resolving even 1 of 27 files would pass a laxer bound
 *               while the blind spot mostly persisted.
 *   ERROR:      the tsc subprocess's exit code is asserted to be exactly 0 —
 *               a config error (e.g. a broken `include`) also produces zero or
 *               few resolved lines but must be surfaced as a distinct failure,
 *               not silently folded into "0 resolved files, still technically
 *               fine".
 *   STATE:      package.json and the tsconfig are both read FRESH from disk on
 *               every run (no cached parse), so an edit made between runs
 *               (e.g. the RED probes recorded for this task) is always
 *               observed by the next run.
 *   REGRESSION: the CONTROL case proves the chain matcher rejects the exact
 *               edit (`typecheck:dashboard-e2e` removed from the chain
 *               string) that `lore assess`'s finding warned would leave the
 *               OLD, file-only oracle green.
 *
 * RED evidence for this case (recorded by hand against a real edit + restore,
 * `lore evidence <task> --oracle test --result expected-fail` — the dispatch
 * bundle for `task-assert-the-e2e-typecheck-project-s-live-wiring-record-the`
 * requires each red to be observed live, not reproduced automatically here):
 *   (a) remove `&& bun run typecheck:dashboard-e2e` from package.json's
 *       `scripts.typecheck` chain string -> this test's `e2e-project-wired`
 *       case fails on the chain-membership assertion.
 *   (b) point `packages/dashboard/tsconfig.e2e.json`'s `include` at a
 *       directory with zero `tests/e2e/**` files -> fails on the
 *       resolved-file-count assertion.
 */

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const ROOT_PACKAGE_JSON = join(REPO_ROOT, "package.json");
const E2E_TSCONFIG = join(REPO_ROOT, "packages", "dashboard", "tsconfig.e2e.json");
const TSC_BIN = join(REPO_ROOT, "node_modules", ".bin", "tsc");
const E2E_TEST_DIR_PREFIX = join(REPO_ROOT, "packages", "dashboard", "tests", "e2e") + "/";

/** C1 census (spec-typecheck-coverage-two-named-blind-spots-and-the-stale): 8 .pw.ts + 6 .spec.ts + 13 other .ts. */
const MEASURED_E2E_FILE_FLOOR = 27;

interface RootPackageJson {
  scripts?: Record<string, string>;
}

function readRootPackageJson(): RootPackageJson {
  // Read fresh every call -- no module-level cache -- so an edit made between
  // test runs (e.g. a RED probe) is always observed (STATE coverage).
  return JSON.parse(readFileSync(ROOT_PACKAGE_JSON, "utf8")) as RootPackageJson;
}

/**
 * Whole-token match on a script name inside a `&&`-joined chain string.
 * Anchored on non-word/non-`:`/non-`-` boundaries so a same-prefix sibling
 * script name (`typecheck:dashboard-tests`, `typecheck:dashboard`) can never
 * false-match a search for `typecheck:dashboard-e2e` or vice versa.
 */
function chainReferencesScript(chain: string, scriptName: string): boolean {
  const escaped = scriptName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w:-])${escaped}(?![\\w:-])`).test(chain);
}

describe("typecheck chain contract (AC-TC-1)", () => {
  it(
    "e2e-project-wired: root package.json's typecheck chain invokes typecheck:dashboard-e2e AND its tsc program resolves >= 27 e2e files",
    () => {
      // (a) chain membership -- proves the project is WIRED into the
      // production `bun run typecheck` entry point, not merely present as a
      // standalone script nobody calls.
      const pkg = readRootPackageJson();
      const chain = pkg.scripts?.typecheck;
      expect(typeof chain).toBe("string");
      expect(chainReferencesScript(chain as string, "typecheck:dashboard-e2e")).toBe(true);

      // The wired script must itself point at the expected tsconfig -- a
      // same-named script wired to the wrong project would pass the chain
      // check above while still leaving tests/e2e/ blind.
      const wiredScript = pkg.scripts?.["typecheck:dashboard-e2e"];
      expect(wiredScript).toMatch(/\btsc\b/);
      expect(wiredScript).toMatch(/-p\s+packages\/dashboard\/tsconfig\.e2e\.json\b/);

      // (b) live resolved-file floor -- runs the ACTUAL tsc program against
      // the ACTUAL tsconfig on disk, never a stub or a direct read of the
      // config's `include` array (that would only prove intent, not
      // resolution).
      const result = spawnSync(TSC_BIN, ["-p", E2E_TSCONFIG, "--listFilesOnly"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        maxBuffer: 20 * 1024 * 1024,
      });
      expect(result.status).toBe(0);

      const resolvedFiles = (result.stdout ?? "")
        .split("\n")
        .filter((line) => line.startsWith(E2E_TEST_DIR_PREFIX));
      expect(resolvedFiles.length).toBeGreaterThanOrEqual(MEASURED_E2E_FILE_FLOOR);
    },
    60_000,
  );

  it("CONTROL: the chain matcher rejects the exact edit that would leave the OLD (file-only) oracle green, and never false-matches a same-prefix sibling script", () => {
    const chainWithScriptRemoved =
      "bun run typecheck:core && bun run typecheck:lore && bun run typecheck:dashboard && bun run typecheck:dashboard-tests";
    // Proves NEGATIVE/REGRESSION are not vacuous: this is the exact edit
    // `lore assess`'s finding warned would leave a package.json-blind oracle
    // green. This matcher correctly reports it as absent.
    expect(chainReferencesScript(chainWithScriptRemoved, "typecheck:dashboard-e2e")).toBe(false);

    // Same-prefix sibling script names must not false-match in either
    // direction.
    expect(chainReferencesScript("bun run typecheck:dashboard-tests", "typecheck:dashboard-e2e")).toBe(false);
    expect(chainReferencesScript("bun run typecheck:dashboard-e2e", "typecheck:dashboard-tests")).toBe(false);

    // And the real chain, unmodified, does contain it (sanity check that the
    // matcher isn't just always-false).
    const realChain = readRootPackageJson().scripts?.typecheck ?? "";
    expect(chainReferencesScript(realChain, "typecheck:dashboard-e2e")).toBe(true);
  });
});

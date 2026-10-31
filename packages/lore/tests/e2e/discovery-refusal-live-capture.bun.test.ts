// @spawns-external bun runs `bun test` on a file that does not exist, to capture the live refusal output
// @reads playwright.config.cjs
// @reads playwright.config.js
// @reads playwright.config.mjs
// @reads playwright.config.ts
// @reads test-results
/**
 * Live-runner capture oracle for `findDiscoveryRefusal` (`@lore/core`,
 * `packages/core/src/attestation-completeness.ts`) — SPEC
 * spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a §M6.1,
 * AC-OX-5.
 *
 * `packages/core/tests/attestation-completeness.test.ts`'s
 * `findDiscoveryRefusal (discovery-refusal)` suite (AC-OX-1) pins the three
 * phrases as HAND-COPIED fixture strings. That is exactly the failure mode
 * this file exists to guard against: a hand-copied string survives only
 * until a runner changes its wording, silently. This suite instead SPAWNS
 * each real runner binary against a path that does not exist and asserts
 * `findDiscoveryRefusal` matches the runner's REAL, freshly-produced stdout —
 * so a future runner-version wording change fails THIS test, not silently
 * degrades production behavior back to the pre-fix "indistinguishable fail"
 * defect the governing spec describes.
 *
 * Dimension mapping:
 *   HAPPY:      each of the three runners (vitest, bun test, playwright),
 *               spawned live against a nonexistent path, is recognised by
 *               `findDiscoveryRefusal` and labelled with the correct `runner`
 *   NEGATIVE:   n/a here — the fixture-string negative case (a genuine
 *               failure tail never mistaken for a refusal) is already pinned
 *               in attestation-completeness.test.ts (AC-OX-1); this file's
 *               job is exclusively the live-capture side of AC-OX-5
 *   BOUNDARY:   every spawn's exit code is asserted to be EXACTLY 1, never
 *               merely "truthy"/non-zero (root CLAUDE.md's exit-code
 *               discipline) — a runner that started returning 0 for a
 *               discovery refusal would be a real behavior change, not
 *               something this guard should paper over
 *   ERROR:      each spawn's `result.error` is asserted `undefined` — the
 *               binary itself must have actually launched (an ENOENT/spawn
 *               failure must never be misread as "the runner refused
 *               discovery")
 *   STATE:      n/a — `findDiscoveryRefusal` is a pure function of the
 *               captured stdout string; there is no persistent/mutable state
 *               for this file to exercise (see attestation-completeness.ts's
 *               own STATE: n/a note)
 *   REGRESSION: the three live verdicts are pairwise distinct runners (a
 *               future pattern merge that widens one runner's regex to
 *               swallow another's phrase would collapse this); each
 *               `evidence` field is asserted to be a verbatim substring of
 *               the actual captured output, never a paraphrase; separately,
 *               this suite's own playwright spawn is asserted to leave
 *               `REPO_ROOT` free of a `test-results/` directory — see
 *               `PLAYWRIGHT_OUTPUT_DIR`'s doc comment for the reverse-control
 *               probe (this exact assertion, run with `--output=` dropped)
 *               that proves the guard is live, not merely a green run
 *
 * Playwright is deliberately spawned from the REPO ROOT, never from
 * `packages/dashboard` — that package's `playwright.config.ts` declares a
 * `globalSetup` that boots a whole throwaway Lore corpus + HTTP server + Vite
 * dev server on fixed ports (8787/5173) BEFORE Playwright even checks
 * whether any test file matched, which would make this probe slow, racy
 * against concurrent worktree agents sharing those fixed ports, and liable
 * to report a DIFFERENT failure (a port conflict) instead of the discovery
 * refusal under test. Playwright's own config resolution walks UP from cwd
 * looking for the nearest `playwright.config.*` — it never descends into
 * child directories — so running from the repo root (which has no config of
 * its own) deterministically hits Playwright's own zero-setup defaults.
 * `assertNoRepoRootPlaywrightConfig` below turns "a config file quietly
 * appears at the repo root some day" into a loud, named failure here rather
 * than a silently much-slower/flakier suite.
 *
 * @spec_ref spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a
 *   §M6.1, AC-OX-5; sibling fixture-string suite:
 *   packages/core/tests/attestation-completeness.test.ts (AC-OX-1)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { findDiscoveryRefusal } from "@lore/core";

// packages/lore/tests/e2e/ -> repo root is four levels up.
const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const LORE_PACKAGE_ROOT = join(REPO_ROOT, "packages", "lore");
const VITEST_BIN = join(REPO_ROOT, "node_modules", ".bin", "vitest");
const PLAYWRIGHT_BIN = join(REPO_ROOT, "node_modules", ".bin", "playwright");

/**
 * Playwright's `--last-failed-file` default is `<outputDir>/.last-run.json`
 * (`playwright test --help`), and `--output <dir>` IS what sets `outputDir` —
 * VERIFIED by direct inspection, not assumed: with `--output=<X>` passed,
 * `<X>/.last-run.json` is written and nothing appears at `cwd`; with the flag
 * removed (a deliberate reverse-control probe run while hardening this
 * file), a literal `test-results/.last-run.json` appears at `cwd` instead —
 * exactly `{"status":"failed","failedTests":[]}`, the discovery-refusal
 * signature. Playwright resolves `outputDir` from ITS OWN config/CLI-flag
 * layer, never from Node's `process.cwd()` alone — the `--output` override
 * below is therefore both necessary (omitting it lets `outputDir` default to
 * `test-results` under whatever `cwd` was passed to `runAndCapture`, i.e.
 * `REPO_ROOT`) and sufficient (redirecting `outputDir` redirects
 * `.last-run.json` with it, confirmed above). Isolated to a throwaway tmpdir
 * (removed in `afterAll`) so this suite never leaves untracked artifacts
 * behind; the "REGRESSION: playwright's live spawn leaves the repo tree
 * clean" scenario below pins this mechanically rather than relying on manual
 * re-verification.
 */
const PLAYWRIGHT_OUTPUT_DIR = mkdtempSync(join(tmpdir(), "lore-e2e-discovery-refusal-pw-output-"));

/** `outputDir`'s default basename (Playwright's own `--help`) — the exact
 * directory name that would appear at `REPO_ROOT` if {@link PLAYWRIGHT_OUTPUT_DIR}'s
 * `--output` override were ever dropped. Colocated with the regression
 * scenario that asserts its absence, so the two can never drift apart. */
const PLAYWRIGHT_DEFAULT_OUTPUT_DIR_NAME = "test-results";

/**
 * A path that does not exist under any of the three runners' search roots.
 * Deliberately distinct across runners is unnecessary (none of them shares a
 * search root with another in this suite's invocations), but the name itself
 * is unique enough that a concurrently-running peer worktree agent creating
 * an unrelated fixture file could never collide with it by accident.
 */
const NONEXISTENT_BASENAME = "does-not-exist-discovery-refusal-probe-ac-ox-5";

interface CapturedRun {
  readonly exitCode: number | null;
  readonly spawnError: Error | undefined;
  readonly combinedOutput: string;
}

function runAndCapture(command: string, args: string[], cwd: string): CapturedRun {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 30_000 });
  return {
    exitCode: result.status,
    spawnError: result.error,
    combinedOutput: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

/**
 * Refuses to proceed if a `playwright.config.*` has appeared at the repo
 * root — see this module's header for why a config there would silently
 * change what "spawn playwright from the repo root" actually does (picking
 * up a globalSetup/webServer instead of hitting Playwright's zero-setup
 * defaults).
 */
function assertNoRepoRootPlaywrightConfig(): void {
  const candidateExtensions = ["ts", "js", "mjs", "cjs"];
  const found = candidateExtensions.find((ext) => existsSync(join(REPO_ROOT, `playwright.config.${ext}`)));
  if (found !== undefined) {
    throw new Error(
      `A playwright.config.${found} now exists at the repo root — this suite's ` +
        "assumption that spawning playwright from REPO_ROOT hits zero-setup " +
        "defaults (see this file's module header) no longer holds. Re-point the " +
        "spawn at an isolated cwd/config before this AC can pass again.",
    );
  }
}

describe("findDiscoveryRefusal — live runner capture (AC-OX-5)", () => {
  let vitestRun: CapturedRun;
  let bunTestRun: CapturedRun;
  let playwrightRun: CapturedRun;

  beforeAll(() => {
    assertNoRepoRootPlaywrightConfig();

    vitestRun = runAndCapture(
      VITEST_BIN,
      ["run", `packages/core/tests/${NONEXISTENT_BASENAME}.test.ts`],
      REPO_ROOT,
    );
    bunTestRun = runAndCapture("bun", ["test", `tests/unit/${NONEXISTENT_BASENAME}.test.ts`], LORE_PACKAGE_ROOT);
    playwrightRun = runAndCapture(
      PLAYWRIGHT_BIN,
      ["test", `${NONEXISTENT_BASENAME}.spec.ts`, `--output=${PLAYWRIGHT_OUTPUT_DIR}`],
      REPO_ROOT,
    );
  }, 90_000); // three sequential spawns, each with its own 30s spawnSync timeout — bun test's 5s
  // default hook timeout was observed to fire under this repo's documented concurrent-worktree
  // load (measured load average 77 while authoring this fix), well before any individual spawn
  // hung — a false timeout, not a real regression (root CLAUDE.md: "load average is the wrong
  // instrument for is-this-red").

  afterAll(() => {
    rmSync(PLAYWRIGHT_OUTPUT_DIR, { recursive: true, force: true });
  });

  it("ERROR: all three runner binaries actually launched (no spawn-level failure)", () => {
    expect(vitestRun.spawnError).toBeUndefined();
    expect(bunTestRun.spawnError).toBeUndefined();
    expect(playwrightRun.spawnError).toBeUndefined();
  });

  it("BOUNDARY: all three runners exit EXACTLY 1 on discovery refusal, never merely non-zero", () => {
    expect(vitestRun.exitCode).toBe(1);
    expect(bunTestRun.exitCode).toBe(1);
    expect(playwrightRun.exitCode).toBe(1);
  });

  it("HAPPY: vitest's LIVE discovery-refusal output is recognised and labelled 'vitest'", () => {
    expect(vitestRun.combinedOutput).toContain("No test files found, exiting with code 1");
    const verdict = findDiscoveryRefusal(vitestRun.combinedOutput);
    expect(verdict).not.toBeNull();
    expect(verdict?.runner).toBe("vitest");
    expect(vitestRun.combinedOutput).toContain(verdict?.evidence ?? "\0unreachable-sentinel");
  });

  it("HAPPY: bun test's LIVE discovery-refusal output is recognised and labelled 'bun'", () => {
    expect(bunTestRun.combinedOutput).toContain("did not match any test files");
    const verdict = findDiscoveryRefusal(bunTestRun.combinedOutput);
    expect(verdict).not.toBeNull();
    expect(verdict?.runner).toBe("bun");
    expect(bunTestRun.combinedOutput).toContain(verdict?.evidence ?? "\0unreachable-sentinel");
  });

  it("HAPPY: playwright's LIVE discovery-refusal output is recognised and labelled 'playwright'", () => {
    expect(playwrightRun.combinedOutput).toContain("Error: No tests found.");
    const verdict = findDiscoveryRefusal(playwrightRun.combinedOutput);
    expect(verdict).not.toBeNull();
    expect(verdict?.runner).toBe("playwright");
    expect(playwrightRun.combinedOutput).toContain(verdict?.evidence ?? "\0unreachable-sentinel");
  });

  it("REGRESSION: the three live verdicts are pairwise distinct runners — no pattern swallows another's phrase", () => {
    const vitestVerdict = findDiscoveryRefusal(vitestRun.combinedOutput);
    const bunVerdict = findDiscoveryRefusal(bunTestRun.combinedOutput);
    const playwrightVerdict = findDiscoveryRefusal(playwrightRun.combinedOutput);
    const runners = [vitestVerdict?.runner, bunVerdict?.runner, playwrightVerdict?.runner];
    expect(new Set(runners).size).toBe(3);
    expect(runners).toEqual(["vitest", "bun", "playwright"]);
  });

  it("REGRESSION: playwright's live spawn leaves the repo tree clean — no test-results/ (or .last-run.json) landed at REPO_ROOT", () => {
    // Mechanises the reverse-control finding documented on PLAYWRIGHT_OUTPUT_DIR
    // above: dropping `--output=` makes Playwright default `outputDir` to
    // `test-results` UNDER THE CWD THIS SUITE PASSES IT (REPO_ROOT), which
    // would dirty the shared checkout on every run, by anyone. Asserting
    // non-existence here (rather than only the manual check performed while
    // authoring this fix) means a future edit that drops or misspells
    // `--output=` fails THIS test the next time the suite runs, instead of
    // silently reintroducing the leak.
    expect(existsSync(join(REPO_ROOT, PLAYWRIGHT_DEFAULT_OUTPUT_DIR_NAME))).toBe(false);
  });
});

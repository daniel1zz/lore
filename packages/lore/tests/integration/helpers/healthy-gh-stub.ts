/**
 * Deterministic, always-succeeding `gh` CLI stub for `lore setup --check`
 * integration/e2e suites.
 *
 * Context: `--check` now ALSO runs a read-only GitHub-channel health probe
 * (`setup-github-health.ts::runGitHubHealthCheck`, task
 * task-skill-implement-lore-setup-check-read-only-health-probe) alongside
 * its pre-existing asset-freshness check, and that probe can OVERRIDE a
 * clean exit `0` to `8` when it can't find/authenticate a real `gh` binary
 * (see `commands/setup.ts::runGitHubChannelHealthCheck`'s own doc for the
 * "never downgrades a nonzero exit, may only override a clean 0" contract —
 * a real, by-design behavior this stub must NOT defeat, only make
 * deterministic).
 *
 * `setup-check.bun.test.ts` / `setup-freshness-cycle.bun.test.ts` spawn
 * `lore setup ...` with the child's `PATH` forced to `""` (their own file
 * headers: "never let a subprocess reach the real `claude` CLI on PATH" —
 * a convention for the MUTATING install path, which registers/removes an
 * MCP server via the `claude` binary). `--check` never touches `claude`/MCP
 * at all, so that convention buys it nothing — but it DOES collaterally
 * break `gh` lookup for the new health probe, which resolves `gh` via the
 * SAME inherited `process.env.PATH` (see `GhRunner`'s constructor default).
 * The result: a `--check` run against a fully synced target (which should
 * exit 0) gets its exit code overridden to 8 purely because the test
 * harness emptied PATH — a host-independent, but harness-INTRODUCED,
 * false read on a scenario this suite never intended to exercise.
 *
 * The fix is this stub, not a change to the override behavior itself: none
 * of `runGitHubHealthCheck`'s three probes (`gh --version` / `gh auth
 * status` / `gh api repos/...`) inspect stdout content, only whether the
 * invocation exits zero (`setup-github-health.ts`) — so a single
 * always-succeeding script satisfies "healthy" for every probe call,
 * without asserting anything false about the HOST machine's real `gh`
 * state (which these suites must never depend on for determinism).
 */

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let cachedDir: string | undefined;

/**
 * Returns an absolute directory containing an executable `gh` that always
 * exits 0 — memoized per test-file process (repeated calls return the same
 * directory without re-creating it). Callers pass this directory as the
 * spawned child's `PATH` for any `--check` invocation, in place of `""`.
 *
 * The caller MUST register cleanup itself (e.g. `afterAll(() =>
 * cleanupHealthyGhStubDir())`) — this module holds no `bun:test` lifecycle
 * hooks of its own, mirroring `assert-fresh-binary.ts`'s plain-function
 * shape in this same directory.
 *
 * @throws Never — `mkdtempSync`/`writeFileSync`/`chmodSync` failures (e.g.
 *   an unwritable system temp dir) are real environment faults that SHOULD
 *   propagate loudly rather than be swallowed here.
 */
export function healthyGhStubDir(): string {
  if (cachedDir !== undefined) return cachedDir;
  const dir = mkdtempSync(join(tmpdir(), "lore-healthy-gh-stub-"));
  const ghPath = join(dir, "gh");
  writeFileSync(ghPath, "#!/bin/sh\nexit 0\n");
  chmodSync(ghPath, 0o755);
  cachedDir = dir;
  return dir;
}

/** Removes the memoized stub directory (call from the test file's own `afterAll`). */
export function cleanupHealthyGhStubDir(): void {
  if (cachedDir === undefined) return;
  try {
    rmSync(cachedDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup — mirrors every other scratch-dir cleanup in this suite family */
  }
  cachedDir = undefined;
}

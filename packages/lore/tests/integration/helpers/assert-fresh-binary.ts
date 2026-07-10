/**
 * Freshness guard for e2e tests that spawn the COMPILED `dist/lore` binary instead of
 * running from source.
 *
 * Rationale: `dist/lore` is a build artifact (`bun run build`, see repo-root `package.json`
 * → `scripts/build.ts`). If a test spawns it directly (real e2e, not `bun run src/index.ts`)
 * and the binary is missing — or older than the TypeScript sources that compile into it — the
 * test silently validates STALE compiled logic against CURRENT source, giving false green
 * confidence. This guard fails loud instead: it throws before any test body runs, so a stale
 * or absent binary can never be mistaken for a passing suite.
 *
 * Used by both `p2-e2e-closed-loop.bun.test.ts` and `gate-hooks.bun.test.ts` — the two
 * `.bun.test.ts` files in this directory that spawn `dist/lore` directly (as opposed to
 * `bun run src/index.ts`, which is source-fresh by construction and needs no guard).
 */

import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";

/** Recursively finds the newest mtimeMs among `.ts` files under `dir`. Returns 0 if none found. */
function newestTsMtimeMs(dir: string): number {
  if (!existsSync(dir)) {
    return 0;
  }
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const childNewest = newestTsMtimeMs(fullPath);
      if (childNewest > newest) {
        newest = childNewest;
      }
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      const mtimeMs = statSync(fullPath).mtimeMs;
      if (mtimeMs > newest) {
        newest = mtimeMs;
      }
    }
  }
  return newest;
}

/**
 * Throws loudly if `binPath` is missing, or if any `.ts` file under any of `srcDirs` (searched
 * recursively) is newer than `binPath`. Call once (e.g. from `beforeAll`) before any test that
 * spawns the compiled binary runs.
 */
export function assertFreshBinary(binPath: string, srcDirs: readonly string[]): void {
  if (!existsSync(binPath)) {
    throw new Error(
      `stale-binary guard: ${binPath} does not exist — run 'bun run build' first (from repo root) ` +
        `before running this e2e suite.`,
    );
  }

  const binMtimeMs = statSync(binPath).mtimeMs;
  let newestSrcMtimeMs = 0;
  let newestSrcDir = "";
  for (const dir of srcDirs) {
    const dirNewest = newestTsMtimeMs(dir);
    if (dirNewest > newestSrcMtimeMs) {
      newestSrcMtimeMs = dirNewest;
      newestSrcDir = dir;
    }
  }

  if (newestSrcMtimeMs > binMtimeMs) {
    throw new Error(
      `stale-binary guard: ${binPath} is stale (source changed since last build — newest .ts ` +
        `mtime under ${newestSrcDir} is newer than the binary); run 'bun run build' first ` +
        `(from repo root) before running this e2e suite.`,
    );
  }
}

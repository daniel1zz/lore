/**
 * Shared `.lore/` bootstrap logic — mirrors the exact steps `lore init`
 * (`adapters/cli/commands/init.ts`) runs against `process.cwd()`, generalized
 * to an arbitrary target directory so `lore setup --project`'s `InitCorpus`
 * thunk (`flows/setup-project-flow.ts`) can reuse them without
 * `commands/setup.ts` importing `commands/init.ts` (command→command imports
 * are forbidden — SPEC-046 task boundary note) and without
 * `setup-project-flow.ts` itself constructing a `CorpusService`/`App`.
 *
 * Public surface:
 *   initCorpusAt(repoDir, opts?) — directory + `.gitignore` + `config.yaml`
 *     (via `saveConfig`) + a migrated SQLite DB (via `createApp`, immediately
 *     closed).
 *
 * Invariants:
 *   - Does NOT check whether `.lore` already exists — that idempotency check
 *     is the CALLER's responsibility (`commands/init.ts` checks it directly;
 *     `setup-project-flow.ts::runInitStep` checks it before ever calling the
 *     injected `InitCorpus` thunk this function backs) — mirrors
 *     `scaffoldProject`'s own "each step's existence check happens in the
 *     flow, not in the step's own implementation" split.
 *   - Never throws — every fs/config/DB failure is caught and returned as
 *     `err(STORE_ERROR)`, so a caller holding an `InitCorpus`-typed thunk
 *     never needs its own defensive try/catch around this call (SPEC-046's
 *     `InitCorpus` type is `Promise<Result<void, LoreError>>` — a thrown
 *     exception here would violate that contract even though
 *     `setup-project-flow.ts::runInitStep` happens to also wrap its call in
 *     try/catch as defense-in-depth).
 *   - `createApp(dbPath)` (the ONE-ARGUMENT overload) always returns `App`
 *     directly, never `Result<App>` — the `Result`-returning overload only
 *     triggers when a second `config` argument names an unknown `ai.provider`,
 *     which never applies to a fresh `.lore/` directory with no config beyond
 *     what `saveConfig` just wrote (mirrors `commands/init.ts`'s own
 *     one-argument `createApp(dbPath)` call).
 *
 * Side-effect class: IO (fs writes + SQLite migration run)
 * Source: SPEC-046 §Design ("the SAME logic commands/init.ts runs"), task
 *   AC-046-E.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { err, ok } from "@lore/core";
import type { LoreError, Result } from "@lore/core";
// reason: saveConfig writes .lore/config.yaml via Node fs — only reachable via
// the @lore/core/node subpath (browser-safety split, packages/core/src/CLAUDE.md).
import { saveConfig } from "@lore/core/node";
import { createApp } from "../app.js";

/** Optional overrides for {@link initCorpusAt} — both default to `commands/init.ts`'s own defaults. */
export interface InitCorpusOptions {
  /** Project display name recorded in `config.yaml`; defaults to `repoDir`'s basename. */
  name?: string;
  /** Default author identity recorded in `config.yaml`. */
  author?: string;
}

/** Renders a thrown value as a diagnostic string. Never re-throws. Mirrors `setup-service.ts`'s `describeCaught`. */
function describeCaught(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

/**
 * Bootstraps a `.lore/` corpus at `repoDir` — directory + `.gitignore` +
 * `config.yaml` (via `saveConfig`) + a migrated SQLite DB (via `createApp`,
 * immediately closed). Mirrors `commands/init.ts`'s body exactly, generalized
 * off `process.cwd()` onto a caller-supplied `repoDir`.
 *
 * @param repoDir - Absolute path to the target repository root.
 * @param opts - Optional `{name, author}` overrides.
 * @returns `ok(undefined)` on success, `err(STORE_ERROR)` naming the failing
 *   step on any fs/config/DB failure.
 * @throws Never.
 * @example
 * const result = await initCorpusAt("/path/to/repo");
 * if (!result.ok) console.error(result.error.message);
 */
export async function initCorpusAt(
  repoDir: string,
  opts: InitCorpusOptions = {},
): Promise<Result<void, LoreError>> {
  const loreDir = join(repoDir, ".lore");

  try {
    mkdirSync(loreDir, { recursive: true });
    writeFileSync(join(loreDir, ".gitignore"), "lore.db\nlore.db-wal\nlore.db-shm\n");
  } catch (cause) {
    return err({
      code: "STORE_ERROR",
      message: `initCorpusAt: failed to create "${loreDir}" or its .gitignore: ${describeCaught(cause)}`,
      ...(cause instanceof Error ? { cause } : {}),
    });
  }

  const projectName = opts.name ?? repoDir.split("/").filter(Boolean).pop() ?? "lore";
  const author = opts.author ?? "owner";

  const saveResult = saveConfig(repoDir, { project: { name: projectName, author } });
  if (!saveResult.ok) return saveResult;

  try {
    const dbPath = join(loreDir, "lore.db");
    const app = createApp(dbPath);
    app.close();
  } catch (cause) {
    return err({
      code: "STORE_ERROR",
      message: `initCorpusAt: failed to initialize the SQLite DB at "${join(loreDir, "lore.db")}": ${describeCaught(cause)}`,
      ...(cause instanceof Error ? { cause } : {}),
    });
  }

  return ok(undefined);
}

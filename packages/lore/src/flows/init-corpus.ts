/**
 * Shared `.lore/` bootstrap logic — the ONE atomic scaffold behind both `lore init`
 * (`adapters/cli/commands/init.ts`) and `lore setup --project`'s `InitCorpus` thunk
 * (`flows/setup-project-flow.ts`), generalized to an arbitrary target directory so
 * neither command imports the other (command→command imports are forbidden — SPEC-046
 * task boundary note) and `setup-project-flow.ts` never constructs a `CorpusService`/`App`.
 *
 * Public surface:
 *   initCorpusAt(repoDir, ambient, opts) — ONE atomic scaffold (BR-807/BR-810,
 *     spec-defect-clusters-round-2-part-a-sessions-seats-setup-init D5): the whole
 *     corpus (`.gitignore` from {@link LORE_DIR_GITIGNORE_ENTRIES}, `config.yaml` via
 *     `saveConfig` merged with the shipped config template, a migrated SQLite DB, and the
 *     caller's `onDatabaseReady` step; NO corpus document, version or audit entry, BR-807) is
 *     built in a sibling temp directory and renamed into place only when complete. A
 *     failure at any step removes the temp directory and leaves NO `.lore`, so the next
 *     attempt runs as on a fresh directory.
 *   LORE_DIR_GITIGNORE_ENTRIES — the SSOT ignore list for `.lore/.gitignore`.
 *
 * Invariants:
 *   - Does NOT check whether `.lore` already exists — that idempotency check is the
 *     CALLER's responsibility (`commands/init.ts` checks it directly;
 *     `setup-project-flow.ts::runInitStep` checks it before ever calling the injected
 *     `InitCorpus` thunk this function backs).
 *   - Never throws — every fs/config/DB failure is caught and returned as
 *     `err(STORE_ERROR)`, so a caller holding an `InitCorpus`-typed thunk never needs its
 *     own defensive try/catch (SPEC-046's `InitCorpus` type is
 *     `Promise<Result<void, LoreError>>`).
 *   - The temp directory is `<repoDir>/.lore-init-<random>`; the corpus is built at
 *     `<temp>/.lore` (so `saveConfig(<temp>)` and `createApp` need no path rewrite) and
 *     that `.lore` is renamed to `<repoDir>/.lore` (same filesystem, atomic). The temp
 *     directory is removed in a `finally` on every outcome.
 *   - `createApp(dbPath)` (the ONE-ARGUMENT overload) always returns `App` directly,
 *     never `Result<App>` — the `Result`-returning overload only triggers when a second
 *     `config` argument names an unknown `ai.provider`, which never applies to a fresh
 *     corpus.
 *   - `opts.configTemplateYaml` is OPTIONAL — this module never reads `assets/` itself
 *     (asset-root resolution is an ADAPTER concern, per `setup-args.ts`'s own module
 *     doc); the caller passes the raw text. A malformed
 *     (but present) config overlay is a LOUD stderr warning, never a fatal failure (D1's
 *     "a corrupted shipped asset must not brick corpus creation").
 *
 * Side-effect class: IO (fs writes + SQLite migration run)
 * Source: SPEC-046 §Design, task AC-046-E; SPEC-058 §Design Decisions D6; BR-807, BR-810,
 *   BR-587 (spec-defect-clusters-round-2-part-a-sessions-seats-setup-init D5).
 */

import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { err, ok } from "@lore/core";
import type { LoreConfig, LoreError, Result } from "@lore/core";
// reason: saveConfig writes .lore/config.yaml via Node fs — only reachable via
// the @lore/core/node subpath (browser-safety split, packages/core/src/CLAUDE.md).
import { saveConfig } from "@lore/core/node";
import { createApp, type App, type AppAmbient } from "../app.js";
import { describeConfigTemplateError, mergeConfigWithOverlay, parseConfigTemplateOverlay } from "./config-template.js";

/**
 * The lines of `.lore/.gitignore` (BR-807): the database files and the machine-local project check
 * cache (`.lore/.lore-project-check.json`, written by `lore setup --project --check`; its path constant is
 * `adapters/cli/setup-check.ts::PROJECT_CHECK_CACHE_RELATIVE_PATH`). Written by the one scaffold, so there is
 * exactly one place to edit it.
 */
export const LORE_DIR_GITIGNORE_ENTRIES: readonly string[] = [
  "lore.db",
  "lore.db-wal",
  "lore.db-shm",
  ".lore-project-check.json",
];

/** Optional overrides for {@link initCorpusAt}. */
export interface InitCorpusOptions {
  /** Project display name recorded in `config.yaml`; defaults to `repoDir`'s basename. */
  name?: string;
  /** Default author identity recorded in `config.yaml`. */
  author?: string;
  /**
   * Raw YAML content of `assets/project/lore-config-template.yaml`, when the
   * caller has already read it — merged into the freshly-written `config.yaml` as a
   * recommended starting point (SPEC-058 §Design Decisions D6). Omitted, or
   * present-but-malformed, both leave `config.yaml` as the bare `project:` block.
   */
  configTemplateYaml?: string;
  /**
   * Runs against the finished-but-still-temporary corpus (an `App` over the temp database) BEFORE it is
   * moved into place; an `err` aborts the scaffold exactly like any other step (nothing is left behind).
   * `lore init` arms state binding here.
   */
  onDatabaseReady?: (app: App) => Promise<Result<void, LoreError>>;
}

/** Renders a thrown value as a diagnostic string. Never re-throws. Mirrors `setup-service.ts`'s `describeCaught`. */
function describeCaught(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

/** Wraps a caught value as a `STORE_ERROR` naming the failing step. */
function storeFailure(message: string, cause: unknown): LoreError {
  return {
    code: "STORE_ERROR",
    message: `${message}: ${describeCaught(cause)}`,
    ...(cause instanceof Error ? { cause } : {}),
  };
}

/**
 * Bootstraps a `.lore/` corpus at `repoDir` as one atomic scaffold: everything is built in a
 * sibling temp directory and renamed into place only when complete (BR-810).
 *
 * @param repoDir - Absolute path to the target repository root.
 * @param ambient - The entry's composition values (`ambientOfInvocation(inv)`).
 * @param opts - Optional overrides, seeds and the pre-move hook; see {@link InitCorpusOptions}.
 * @returns `ok(undefined)` on success, `err` naming the failing step on any fs/config/DB failure;
 *   on `err` no `.lore` and no temp directory remain.
 * @throws Never.
 * @example
 * const result = await initCorpusAt("/path/to/repo", ambient);
 * if (!result.ok) console.error(result.error.message);
 */
export async function initCorpusAt(
  repoDir: string,
  ambient: AppAmbient,
  opts: InitCorpusOptions = {},
): Promise<Result<void, LoreError>> {
  const finalLoreDir = join(repoDir, ".lore");

  let stagingRoot: string;
  try {
    // reason: the pre-atomic scaffold created `repoDir` implicitly (recursive mkdir of `.lore`); keep accepting
    // a not-yet-existing target directory. Only `.lore` itself is the "leaves nothing behind" contract.
    mkdirSync(repoDir, { recursive: true });
    stagingRoot = mkdtempSync(join(repoDir, ".lore-init-"));
  } catch (cause) {
    return err(storeFailure(`initCorpusAt: failed to create a staging directory in "${repoDir}"`, cause));
  }

  try {
    const built = await buildCorpus(stagingRoot, repoDir, ambient, opts);
    if (!built.ok) return built;
    try {
      // reason: BR-810 — the corpus appears at its final path only when complete. renameSync onto an
      // existing non-empty directory fails (ENOTEMPTY), which also keeps a racing second init loud.
      renameSync(join(stagingRoot, ".lore"), finalLoreDir);
    } catch (cause) {
      return err(storeFailure(`initCorpusAt: failed to move the corpus into "${finalLoreDir}"`, cause));
    }
    return ok(undefined);
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
}

/** Builds the complete corpus at `<stagingRoot>/.lore`. Never throws. */
async function buildCorpus(
  stagingRoot: string,
  repoDir: string,
  ambient: AppAmbient,
  opts: InitCorpusOptions,
): Promise<Result<void, LoreError>> {
  const loreDir = join(stagingRoot, ".lore");
  const dbPath = join(loreDir, "lore.db");

  try {
    mkdirSync(loreDir, { recursive: true });
    writeFileSync(join(loreDir, ".gitignore"), `${LORE_DIR_GITIGNORE_ENTRIES.join("\n")}\n`);
  } catch (cause) {
    return err(storeFailure(`initCorpusAt: failed to create "${loreDir}" or its .gitignore`, cause));
  }

  const projectName = opts.name ?? repoDir.split("/").filter(Boolean).pop() ?? "lore";
  const author = opts.author ?? "owner";

  const baseConfig = { project: { name: projectName, author } };
  let configToSave: unknown = baseConfig;
  if (opts.configTemplateYaml !== undefined) {
    const overlayResult = parseConfigTemplateOverlay(opts.configTemplateYaml);
    if (overlayResult.ok) {
      configToSave = mergeConfigWithOverlay(baseConfig, overlayResult.value);
    } else {
      // reason: a malformed shipped template is a packaging defect, not a reason to
      // fail `lore init`/`lore setup --project` outright (see this module's own
      // invariants above, SPEC-058 D1's "non-breaking" ethos).
      ambient.io.stderr.write(
        `Warning: ignoring malformed config template overlay: ${describeConfigTemplateError(overlayResult.error)}\n`,
      );
    }
  }

  const saveResult = saveConfig(stagingRoot, configToSave as LoreConfig);
  if (!saveResult.ok) return saveResult;

  try {
    createApp(dbPath, undefined, ambient).close();
  } catch (cause) {
    return err(storeFailure(`initCorpusAt: failed to initialize the SQLite DB at "${dbPath}"`, cause));
  }

  if (opts.onDatabaseReady !== undefined) {
    let app: App;
    try {
      app = createApp(dbPath, undefined, ambient);
    } catch (cause) {
      return err(storeFailure(`initCorpusAt: failed to reopen the SQLite DB at "${dbPath}"`, cause));
    }
    try {
      return await opts.onDatabaseReady(app);
    } finally {
      app.close();
    }
  }

  return ok(undefined);
}

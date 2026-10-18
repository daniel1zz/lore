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
 *     (via `saveConfig`, optionally merged with the recommended
 *     `assets/project/lore-config-template.yaml` overlay — SPEC-058
 *     §Design Decisions D6) + a migrated SQLite DB (via `createApp`,
 *     immediately closed).
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
 *   - `opts.configTemplateYaml` is entirely OPTIONAL — this module never reads
 *     `assets/project/lore-config-template.yaml` itself (asset-root
 *     resolution is an ADAPTER concern, per `setup-args.ts`'s own module
 *     doc); a caller that has already read the shipped template passes its
 *     raw text here, merged via `./config-template.js::mergeConfigWithOverlay`
 *     BEFORE `saveConfig` is called. Omitted → byte-identical to
 *     pre-SPEC-058 behaviour (REGRESSION-safe). A malformed (but present)
 *     overlay is a LOUD stderr warning, never a fatal `initCorpusAt` failure
 *     — the corpus still gets a valid `config.yaml`, just without the
 *     recommended block (D1's "non-breaking" ethos extends to "a corrupted
 *     shipped asset must not brick corpus creation").
 *
 * Side-effect class: IO (fs writes + SQLite migration run)
 * Source: SPEC-046 §Design ("the SAME logic commands/init.ts runs"), task
 *   AC-046-E; SPEC-058 §Design Decisions D6 (`configTemplateYaml` seeding).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { err, ok } from "@lore/core";
import type { LoreConfig, LoreError, Result } from "@lore/core";
// reason: saveConfig writes .lore/config.yaml via Node fs — only reachable via
// the @lore/core/node subpath (browser-safety split, packages/core/src/CLAUDE.md).
import { saveConfig } from "@lore/core/node";
import { createApp, type AppAmbient } from "../app.js";
import { describeConfigTemplateError, mergeConfigWithOverlay, parseConfigTemplateOverlay } from "./config-template.js";

/** Optional overrides for {@link initCorpusAt} — both default to `commands/init.ts`'s own defaults. */
export interface InitCorpusOptions {
  /** Project display name recorded in `config.yaml`; defaults to `repoDir`'s basename. */
  name?: string;
  /** Default author identity recorded in `config.yaml`. */
  author?: string;
  /**
   * Raw YAML content of `assets/project/lore-config-template.yaml`, when the
   * caller has already read it — merged into the freshly-written
   * `config.yaml` as a recommended starting point (SPEC-058 §Design
   * Decisions D6). Omitted, or present-but-malformed, both leave
   * `config.yaml` exactly as it would have been written before this option
   * existed — see this module's invariants above.
   */
  configTemplateYaml?: string;
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
 * @param ambient - The entry's composition values (`ambientOfInvocation(inv)`).
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
  ambient: AppAmbient,
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
      process.stderr.write(
        `Warning: ignoring malformed config template overlay: ${describeConfigTemplateError(overlayResult.error)}\n`,
      );
    }
  }

  const saveResult = saveConfig(repoDir, configToSave as LoreConfig);
  if (!saveResult.ok) return saveResult;

  try {
    const dbPath = join(loreDir, "lore.db");
    const app = createApp(dbPath, undefined, ambient);
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

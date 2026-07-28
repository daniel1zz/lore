/**
 * Committed loader for the embedded dashboard assets manifest (spec
 * spec-dashboard-production-packaging-one-command-lore-dashboard, DD-1).
 *
 * Public surface: `loadDashboardAssets(modulePath?)`.
 *
 * The manifest module it loads — `packages/lore/src/generated/dashboard-
 * assets.ts` — is GIT-IGNORED and produced only by `bun run build`
 * (scripts/build.ts's dashboard step). On a fresh clone it does not exist,
 * so this loader must NEVER statically `import` it: a static import would
 * fail `bun run typecheck` outright (TS2307 "Cannot find module") rather
 * than fail at runtime, breaking the fresh-clone typecheck contract
 * (AC-F5A-6) that never builds the dashboard first.
 *
 * Two access paths, both funnelled through the same guarded try/catch:
 *
 *   - Default (`modulePath` omitted) — the REAL production path used by
 *     packaged-mode startup. Uses a DIRECT STRING LITERAL argument to
 *     `import()`. This is required, not stylistic: `bun build --compile`
 *     only follows and embeds a dynamic `import()` target when its
 *     argument is a literal — a variable or computed specifier (e.g.
 *     `pathToFileURL(x).href` assigned to a local) is invisible to the
 *     bundler's static analysis and is NEVER embedded, confirmed by a
 *     build+run spike (probe compiled with a literal-argument dynamic
 *     import successfully read its `with { type: "file" }` payload after
 *     being copied to a directory with no source files; the identical probe
 *     with a variable specifier failed at runtime with "Cannot find
 *     module", even when the target was also listed as a second `Bun.build`
 *     entrypoint). The accompanying `@ts-ignore` (never `@ts-expect-error`)
 *     suppresses tsc's TS2307 when the module is absent (fresh clone)
 *     without ever flagging "unused" once the module DOES exist
 *     post-build — that asymmetry (`@ts-ignore` is silent either way;
 *     `@ts-expect-error` errors when there is nothing to suppress) is
 *     exactly what makes it safe across both pre-build and post-build
 *     `bun run typecheck` runs.
 *   - Test seam (`modulePath` supplied) — a variable-specifier dynamic
 *     import via `pathToFileURL(modulePath).href`, used only by the paired
 *     test suite against real on-disk fixture files
 *     (tests/unit/dashboard-assets-loader.bun.test.ts). This path is never
 *     embeddable by `bun build --compile` and is never exercised by the
 *     real default call in `lore dashboard` / `lore serve` startup.
 *
 * The imported module's `DASHBOARD_ASSETS_MANIFEST` export is untrusted
 * boundary data (a dynamically loaded module can be absent, stale, or
 * corrupt) — validated with `DashboardAssetsManifestSchema.safeParse`
 * rather than a hand-rolled structural guard, per this codebase's
 * Zod-at-boundaries convention.
 *
 * Never throws: every failure mode (module absent, malformed export, any
 * import error) collapses to `{ available: false, reason }` naming the fix
 * — the caller fails loud, never a silent fallback to dev topology (spec
 * Failure Modes table: "Source-run packaged mode without built assets").
 *
 * Side-effect class: IO (dynamic module import against the filesystem).
 */

import { pathToFileURL } from "node:url";
import { z } from "zod";

/** One embedded/served dashboard asset (DD-1 manifest `entries` value shape). */
const DashboardAssetsManifestEntrySchema = z.object({
  /** Opaque embedded-file handle from a `with { type: "file" }` import (a path string at runtime). */
  embedded: z.unknown(),
  contentType: z.string(),
  immutable: z.boolean(),
});

/** The generated manifest's exported shape — DD-1 "Map shape" + build stamp. */
const DashboardAssetsManifestSchema = z.object({
  stamp: z.object({
    digest: z.string(),
    builtAt: z.string(),
    skipped: z.boolean().optional(),
  }),
  /** Keyed by urlPath, e.g. `"/index.html"`. */
  entries: z.record(z.string(), DashboardAssetsManifestEntrySchema),
});

/** Inferred from {@link DashboardAssetsManifestEntrySchema} — see that schema's JSDoc for field semantics. */
export type DashboardAssetsManifestEntry = z.infer<typeof DashboardAssetsManifestEntrySchema>;
/** Inferred from {@link DashboardAssetsManifestSchema} — see that schema's JSDoc for field semantics. */
export type DashboardAssetsManifest = z.infer<typeof DashboardAssetsManifestSchema>;

/** Outcome of {@link loadDashboardAssets} — never a thrown error, see module doc comment. */
export type LoadDashboardAssetsResult =
  | { available: true; manifest: DashboardAssetsManifest }
  | { available: false; reason: string };

/**
 * Loads the dashboard assets manifest.
 *
 * @param modulePath TEST SEAM: when supplied, performs the guarded dynamic
 *   import against this plain absolute filesystem path instead of the real
 *   generated module — see module doc comment for why the two branches use
 *   different specifier forms. Omit in production call sites.
 * @returns `{ available: true, manifest }` on success; `{ available: false,
 *   reason }` naming `bun run build` (or `lore dashboard --dev`) on any
 *   failure. Never rejects.
 */
export async function loadDashboardAssets(modulePath?: string): Promise<LoadDashboardAssetsResult> {
  const source = modulePath ?? "packages/lore/src/generated/dashboard-assets.ts";
  try {
    const mod: unknown = modulePath
      ? await import(/* @vite-ignore */ pathToFileURL(modulePath).href)
      : // @ts-ignore -- packages/lore/src/generated/dashboard-assets.ts is
        // git-ignored and produced only by `bun run build`; absent on a
        // fresh clone. MUST stay a literal specifier — see module doc
        // comment above for the bundler-embedding rationale.
        await import("../../generated/dashboard-assets.js");

    const candidate = (mod as { DASHBOARD_ASSETS_MANIFEST?: unknown }).DASHBOARD_ASSETS_MANIFEST;
    const parsed = DashboardAssetsManifestSchema.safeParse(candidate);
    if (!parsed.success) {
      return {
        available: false,
        reason: `${source} does not export a valid DASHBOARD_ASSETS_MANIFEST (${parsed.error.message}). Run 'bun run build' to generate it.`,
      };
    }
    return { available: true, manifest: parsed.data };
  } catch (e) {
    const cause = e instanceof Error ? e.message : String(e);
    return {
      available: false,
      reason: `Dashboard assets manifest not found or failed to load from ${source} (${cause}). Run 'bun run build' to generate it, or use 'lore dashboard --dev'.`,
    };
  }
}

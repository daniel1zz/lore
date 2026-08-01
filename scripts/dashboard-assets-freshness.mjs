#!/usr/bin/env bun
/**
 * Dashboard asset-manifest freshness logic (task-a-stale-untracked-dashboard-
 * assets-ts-breaks-every, spec-dashboard-production-packaging-one-command-
 * lore-dashboard DD-1).
 *
 * Extracted out of scripts/build.ts (same "committed, importable, pure
 * functions" pattern as scripts/embed-assets-manifest.mjs — see that file's
 * doc comment) so the short-circuit DECISION can be unit-tested directly,
 * without spawning a real `bun run --filter '@lore/dashboard' build`.
 *
 * ─── The defect this closes ──────────────────────────────────────────────
 *
 * The git-ignored generated module `packages/lore/src/generated/
 * dashboard-assets.ts` imports every `packages/dashboard/dist/**` file with
 * a LITERAL specifier (`with { type: "file" }`, required for `bun build
 * --compile` to embed it). Vite emits content-hashed filenames, so that
 * generated module is only valid as long as it was written AFTER the exact
 * `dist/` contents it references.
 *
 * The pre-fix short-circuit (skip re-running vite when the dashboard SOURCE
 * digest is unchanged) used `dashboardDistIsPresent()` — "does dist/ have
 * ANY files" — as its only guard against a stale manifest. That is not
 * sufficient: `vite build` always empties + rewrites `dist/` with FRESH
 * content-hashed filenames on every invocation, including one that later
 * aborts for a reason unrelated to the dashboard source (observed: a
 * `bunx @tanstack/router-cli` prebuild step failing on an incomplete
 * downloaded dependency, AFTER vite's own build step had already emptied
 * and rewritten `dist/` with new hashes). The overall `bun run --filter
 * '@lore/dashboard' build` invocation then exits non-zero, so
 * `scripts/build.ts` throws BEFORE ever regenerating the manifest — but
 * `dist/` is left holding brand-new hashed filenames the OLD (stale)
 * manifest never mentions. Since nothing hand-written changed, the very
 * next `bun run build` recomputes the SAME source digest, matches the
 * stale manifest's embedded digest, sees a non-empty `dist/`, and takes the
 * short-circuit — permanently skipping the one thing that would fix it
 * (regenerating the manifest), because a digest match is not evidence that
 * the manifest's OWN file references still resolve.
 *
 * The fix ("cannot happen", not "fails legibly" — see shouldShortCircuitDashboardBuild
 * doc comment): the short-circuit gate additionally verifies, via plain
 * `existsSync` (no bundler involved), that every file the EXISTING manifest
 * references is still present on disk. A digest match alone is downgraded
 * from "sufficient" to "necessary-but-not-sufficient" — staleness is
 * detected directly against ground truth (does the referenced file exist),
 * never inferred from a proxy that can drift (source digest) independently
 * of the thing that actually matters (dist/ contents). Whenever that
 * verification fails, the short-circuit is skipped and a rebuild runs,
 * which ALWAYS ends by regenerating the manifest from dist/'s CURRENT
 * listing — so the very next build after an interruption self-heals with
 * no manual `rm` required.
 *
 * Public surface (importable — used by scripts/build.ts and this package's
 * tests; no CLI entrypoint — this module has no side effects on import):
 *   - sha256Hex (re-exported from embed-assets-manifest.mjs, SSOT)
 *   - walkFilesRelative(dir) -> string[] (LOCAL — deliberately NOT re-exported
 *     from embed-assets-manifest.mjs; see that function's own doc comment for
 *     the missing-directory guard divergence that makes reuse unsafe here)
 *   - computeDashboardSourceDigest(srcDir, viteConfigPath, pkgJsonPath) -> string
 *   - extractEmbeddedDashboardDigest(source) -> string | undefined
 *   - dashboardDistIsPresent(distDir) -> boolean
 *   - contentTypeForDistPath(relPath) -> string
 *   - renderDashboardAssetsModule(distFiles, stamp, paths) -> string
 *   - writeDashboardAssetsModule(stamp, paths) -> { distFileCount }
 *   - extractManifestSpecifiers(source) -> string[]
 *   - manifestReferencesResolvable(generatedFilePath) -> { resolvable, reason, missing }
 *   - shouldShortCircuitDashboardBuild({ existingDigest, freshDigest, dashboardDistDir, generatedFilePath }) -> { shortCircuit, reason }
 *   - runDashboardAssetsStep({ ...paths, skipDashboardBuild, runVite, now? }) -> { action, reason }
 *   - DASHBOARD_SHORT_CIRCUIT_MARKER, DASHBOARD_BUILD_START_MARKER (literal,
 *     grep-assertable console markers — do not reword without updating the
 *     paired oracle, task-skill-implement-f5a-build-step-embed-manifest-and)
 *   - DashboardAssetsFreshnessError
 *
 * Side-effect class: IO (synchronous `node:fs` reads always; a write to
 * `generatedFilePath` only inside `writeDashboardAssetsModule`, called from
 * `runDashboardAssetsStep`, never at import time).
 */

import { basename, dirname, join, relative, sep } from "node:path";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

import { sha256Hex } from "./embed-assets-manifest.mjs";

/** Re-exported unchanged from embed-assets-manifest.mjs (SSOT) — hex-encoded sha256 of raw bytes. */
export { sha256Hex };

/**
 * Recursively collects every regular file under `dir`, as POSIX-relative
 * paths (sorted). Returns `[]` if `dir` is absent — deliberately NOT
 * re-exported from `embed-assets-manifest.mjs`'s same-named helper: that
 * copy has no such guard (safe there only because `buildManifest` already
 * checked `existsSync` on every directory it walks). Here, an absent
 * `packages/dashboard/dist` is an expected, common state (fresh checkout,
 * no build yet) that callers must be able to distinguish from "present but
 * empty" without a thrown ENOENT.
 */
export function walkFilesRelative(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (current, prefix) => {
    const dirents = readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of dirents) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(join(current, entry.name), rel);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  };
  walk(dir, "");
  return out;
}

/** Thrown for domain-specific dashboard-asset-freshness failures (never a silent fallback). */
export class DashboardAssetsFreshnessError extends Error {
  constructor(message) {
    super(message);
    this.name = "DashboardAssetsFreshnessError";
  }
}

/** Literal, grep-assertable per the task AC — do not reword without updating the paired oracle. */
export const DASHBOARD_SHORT_CIRCUIT_MARKER = "dashboard: unchanged (digest match), skipping vite build";
/** Literal, grep-assertable per the task AC — do not reword without updating the paired oracle. */
export const DASHBOARD_BUILD_START_MARKER =
  "dashboard: build starting (digest changed or no prior build), running vite build via package lifecycle";

// ─── Source digest ──────────────────────────────────────────────────────────

/**
 * Content digest over `packages/dashboard/src/**` + `vite.config.ts` +
 * `package.json` — the dashboard build's freshness identity. sha256 per file
 * over raw bytes, sorted-pair whole-tree digest (mirrors
 * `embed-assets-manifest.mjs`'s `computeTreeDigest` — walk order must never
 * leak into the digest).
 * @throws whatever `node:fs` throws (ENOENT etc.) if a required path is
 *   missing — never a silent zero-length digest.
 */
export function computeDashboardSourceDigest(dashboardSrcDir, dashboardViteConfigPath, dashboardPkgJsonPath) {
  const entries = [];
  for (const rel of walkFilesRelative(dashboardSrcDir)) {
    entries.push({ path: `src/${rel}`, sha256: sha256Hex(readFileSync(join(dashboardSrcDir, rel))) });
  }
  entries.push({ path: "vite.config.ts", sha256: sha256Hex(readFileSync(dashboardViteConfigPath)) });
  entries.push({ path: "package.json", sha256: sha256Hex(readFileSync(dashboardPkgJsonPath)) });
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const joined = entries.map((e) => `${e.path} ${e.sha256}`).join("\n");
  return sha256Hex(Buffer.from(joined, "utf8"));
}

/** Extracts a previously-generated dashboard-assets.ts source's embedded `stamp.digest`, or `undefined` if absent/corrupt. */
export function extractEmbeddedDashboardDigest(source) {
  const match = source.match(/digest:\s*"([0-9a-f]{64})"/);
  return match ? match[1] : undefined;
}

/** `true` iff `distDir` exists and contains at least one file. */
export function dashboardDistIsPresent(distDir) {
  return walkFilesRelative(distDir).length > 0;
}

// ─── Content-type mapping ───────────────────────────────────────────────────

/** Best-effort file-extension -> HTTP Content-Type map for serving embedded dist assets; unknown extensions fall back in {@link contentTypeForDistPath}. */
export const DASHBOARD_CONTENT_TYPE_BY_EXT = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".txt": "text/plain",
  ".wasm": "application/wasm",
};

/** Maps a dist-relative path's extension to an HTTP Content-Type via {@link DASHBOARD_CONTENT_TYPE_BY_EXT}, defaulting to `application/octet-stream` for anything unlisted. */
export function contentTypeForDistPath(relPath) {
  const dot = relPath.lastIndexOf(".");
  const ext = dot === -1 ? "" : relPath.slice(dot).toLowerCase();
  return DASHBOARD_CONTENT_TYPE_BY_EXT[ext] ?? "application/octet-stream";
}

// ─── Rendering + writing ────────────────────────────────────────────────────

/**
 * Renders the generated dashboard-assets.ts module source: one `with {
 * type: "file" }` import per `dashboardDistDir/**` file, using a LITERAL
 * relative specifier per entry (required for `bun build --compile` to embed
 * each one — see dashboard-assets-loader.ts's doc comment), plus the
 * `DASHBOARD_ASSETS_MANIFEST` export the loader's contract requires.
 * `distFiles` are POSIX-relative paths under `paths.dashboardDistDir`.
 */
export function renderDashboardAssetsModule(distFiles, stamp, paths) {
  const { dashboardDistDir, generatedFilePath } = paths;
  const generatedDir = dirname(generatedFilePath);
  const importLines = [];
  const entryLines = [];
  distFiles.forEach((rel, i) => {
    const abs = join(dashboardDistDir, rel);
    const relSpecifier = relative(generatedDir, abs).split(sep).join("/");
    const specifier = relSpecifier.startsWith(".") ? relSpecifier : `./${relSpecifier}`;
    const varName = `asset_${i}`;
    // bun-types only ships ambient `with { type: "file" }` module
    // declarations for a handful of extensions — see scripts/build.ts's
    // original doc comment for the full rationale. `@ts-ignore` suppresses
    // the resulting TS2307/TS7016 per-line without ever erroring "unused"
    // for extensions bun-types DOES cover (e.g. .html).
    importLines.push(`// @ts-ignore -- see scripts/dashboard-assets-freshness.mjs's renderDashboardAssetsModule doc comment`);
    importLines.push(`import ${varName} from ${JSON.stringify(specifier)} with { type: "file" };`);
    const urlPath = `/${rel}`;
    const contentType = contentTypeForDistPath(rel);
    const immutable = rel.startsWith("assets/");
    entryLines.push(
      `  ${JSON.stringify(urlPath)}: { embedded: ${varName}, contentType: ${JSON.stringify(contentType)}, immutable: ${immutable} },`,
    );
  });

  const stampSrc =
    stamp.skipped === true
      ? `{ digest: ${JSON.stringify(stamp.digest)}, builtAt: ${JSON.stringify(stamp.builtAt)}, skipped: true }`
      : `{ digest: ${JSON.stringify(stamp.digest)}, builtAt: ${JSON.stringify(stamp.builtAt)} }`;

  return `/**
 * AUTO-GENERATED by scripts/build.ts — DO NOT HAND-EDIT, DO NOT COMMIT.
 * Git-ignored (spec-dashboard-production-packaging-one-command-lore-dashboard,
 * DD-1 git contract): content churns with every hashed vite build filename.
 * Regenerate: \`bun run build\` (or \`bun run build --skip-dashboard\` to reuse
 * an existing packages/dashboard/dist without re-running vite — marks the
 * stamp \`skipped: true\`, loud in \`/api/health\`).
 *
 * Consumed EXCLUSIVELY via the guarded dynamic import in the COMMITTED
 * loader packages/lore/src/adapters/http/dashboard-assets-loader.ts — never
 * import this module directly (breaks fresh-clone \`bun run typecheck\`).
 */
${importLines.join("\n")}

export const DASHBOARD_ASSETS_MANIFEST = {
  stamp: ${stampSrc},
  entries: {
${entryLines.join("\n")}
  },
};
`;
}

/** Regenerates + writes `paths.generatedFilePath` from the CURRENT `paths.dashboardDistDir` listing, with a post-write digest self-check. */
export function writeDashboardAssetsModule(stamp, paths) {
  const { dashboardDistDir, generatedFilePath } = paths;
  const distFiles = walkFilesRelative(dashboardDistDir);
  const moduleSrc = renderDashboardAssetsModule(distFiles, stamp, paths);
  mkdirSync(dirname(generatedFilePath), { recursive: true });
  writeFileSync(generatedFilePath, moduleSrc, "utf8");

  const verifyDigest = extractEmbeddedDashboardDigest(readFileSync(generatedFilePath, "utf8"));
  if (verifyDigest !== stamp.digest) {
    throw new DashboardAssetsFreshnessError(
      `Post-write verification failed: ${generatedFilePath} embeds digest "${String(verifyDigest)}" ` +
        `but the intended stamp digest is "${stamp.digest}". This must never happen — investigate ` +
        `renderDashboardAssetsModule/extractEmbeddedDashboardDigest for a round-trip bug.`,
    );
  }
  return { distFileCount: distFiles.length };
}

// ─── Manifest ↔ dist congruence (the mechanism-root fix) ───────────────────

/**
 * Extracts the literal file-embed specifiers from a generated dashboard-
 * assets.ts source (the `with { type: "file" }` import lines), JSON-decoded
 * so escaped paths (Windows backslashes) round-trip correctly. Returns an
 * empty array for a source with no such imports (empty dist, or corrupt file).
 */
export function extractManifestSpecifiers(source) {
  const out = [];
  const re = /from\s+("(?:[^"\\]|\\.)*")\s+with\s*\{\s*type:\s*"file"\s*\}/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    try {
      out.push(JSON.parse(m[1]));
    } catch {
      // Malformed literal — the caller treats a manifest that fails to
      // yield any usable specifiers as unresolvable, never as a crash.
    }
  }
  return out;
}

/**
 * Verifies that every dist file the EXISTING generated manifest at
 * `generatedFilePath` references is still present on disk, resolved exactly
 * the way `bun build --compile` would resolve each import specifier
 * (relative to the manifest's OWN directory — see renderDashboardAssetsModule).
 *
 * This is ground truth, not a proxy: unlike a source-digest comparison, it
 * cannot be fooled by a `dist/` directory that was silently rewritten (by an
 * interrupted or concurrent vite build) without the manifest being told.
 *
 * @returns `{ resolvable: true, reason: "ok", missing: [] }` when the file
 *   exists, declares at least one entry, and every entry resolves; otherwise
 *   `{ resolvable: false, reason, missing }` — `reason` is one of
 *   `"no-manifest"` (file absent), `"no-entries"` (file exists but declares
 *   zero embedded files — corrupt or stale-empty), or `"missing-dist-files"`
 *   (one or more referenced files no longer exist; `missing` lists them).
 */
export function manifestReferencesResolvable(generatedFilePath) {
  if (!existsSync(generatedFilePath)) {
    return { resolvable: false, reason: "no-manifest", missing: [] };
  }
  const source = readFileSync(generatedFilePath, "utf8");
  const specifiers = extractManifestSpecifiers(source);
  if (specifiers.length === 0) {
    return { resolvable: false, reason: "no-entries", missing: [] };
  }
  const generatedDir = dirname(generatedFilePath);
  const missing = specifiers.filter((spec) => !existsSync(join(generatedDir, spec)));
  if (missing.length > 0) {
    return { resolvable: false, reason: "missing-dist-files", missing };
  }
  return { resolvable: true, reason: "ok", missing: [] };
}

/**
 * The short-circuit gate. A digest match is NECESSARY but never SUFFICIENT
 * on its own — `dashboardDistIsPresent` (non-empty) and
 * `manifestReferencesResolvable` (every referenced file still exists) must
 * BOTH also hold. Whichever check fails first names the reason, so a caller
 * printing `decision.reason` always explains WHY a rebuild was forced —
 * including the "stale-manifest" case (digest matched, but a prior
 * interrupted/concurrent build rewrote dist/ without regenerating the
 * manifest), which the pre-fix logic could not distinguish from an ordinary
 * "nothing changed" run.
 */
export function shouldShortCircuitDashboardBuild({ existingDigest, freshDigest, dashboardDistDir, generatedFilePath }) {
  if (existingDigest === undefined || existingDigest !== freshDigest) {
    return { shortCircuit: false, reason: "digest-mismatch-or-no-prior-manifest" };
  }
  if (!dashboardDistIsPresent(dashboardDistDir)) {
    return { shortCircuit: false, reason: "dist-missing-or-empty" };
  }
  const check = manifestReferencesResolvable(generatedFilePath);
  if (!check.resolvable) {
    const fileName = basename(generatedFilePath);
    const detail = check.missing.length > 0 ? check.missing.join(", ") : check.reason;
    return {
      shortCircuit: false,
      reason:
        `stale-manifest: ${fileName} references dist file(s) that no longer exist (${detail}) ` +
        `even though the dashboard source digest is unchanged — an earlier interrupted or ` +
        `concurrent build likely rewrote packages/dashboard/dist/ with new content-hashed ` +
        `filenames without regenerating ${fileName}. Forcing a rebuild to regenerate it ` +
        `automatically (no manual rm needed).`,
    };
  }
  return { shortCircuit: true, reason: "digest-match-and-dist-verified" };
}

// ─── Orchestration (injectable — real caller passes a spawnSync runner, tests inject a fake one) ───

/**
 * Runs the full dashboard-assets build step: `--skip-dashboard` fast path,
 * else the short-circuit decision, else a rebuild via the injected
 * `runVite()` that ALWAYS ends by regenerating the manifest from dist's
 * CURRENT listing post-build — so a rebuild forced by a stale manifest
 * (`shouldShortCircuitDashboardBuild`'s "stale-manifest" reason) heals in
 * exactly the same way an ordinary "source changed" rebuild does.
 *
 * @param args.runVite - `() => { status: number | null }`. The real caller
 *   passes a `spawnSync` wrapper; tests inject a fake that mutates a fixture
 *   `dashboardDistDir` to simulate vite's own dist rewrite, without spawning
 *   a real process.
 * @param args.onBeforeRebuild - optional `(decision) => void`, invoked
 *   synchronously right before `runVite()` — the caller's only chance to log
 *   "why" (`decision.reason`) BEFORE a stdio-inherited child's own output
 *   starts interleaving with this process's stdout.
 * @param args.now - clock override for deterministic `builtAt` in tests.
 * @throws {DashboardAssetsFreshnessError} on `--skip-dashboard` with no
 *   existing dist, a non-zero `runVite` status, or a post-build empty dist.
 */
export function runDashboardAssetsStep({
  dashboardSrcDir,
  dashboardViteConfigPath,
  dashboardPkgJsonPath,
  dashboardDistDir,
  generatedFilePath,
  skipDashboardBuild,
  runVite,
  onBeforeRebuild,
  now = () => new Date().toISOString(),
}) {
  const paths = { dashboardDistDir, generatedFilePath };
  const freshDigest = computeDashboardSourceDigest(dashboardSrcDir, dashboardViteConfigPath, dashboardPkgJsonPath);
  const existingDigest = existsSync(generatedFilePath)
    ? extractEmbeddedDashboardDigest(readFileSync(generatedFilePath, "utf8"))
    : undefined;

  if (skipDashboardBuild) {
    if (!dashboardDistIsPresent(dashboardDistDir)) {
      throw new DashboardAssetsFreshnessError(
        `--skip-dashboard requires an existing packages/dashboard/dist build (none found at ` +
          `${dashboardDistDir}). Run 'bun run build' once without --skip-dashboard first.`,
      );
    }
    const written = writeDashboardAssetsModule({ digest: freshDigest, builtAt: now(), skipped: true }, paths);
    return { action: "skipped", reason: "--skip-dashboard set", distFileCount: written.distFileCount, digest: freshDigest };
  }

  const decision = shouldShortCircuitDashboardBuild({
    existingDigest,
    freshDigest,
    dashboardDistDir,
    generatedFilePath,
  });
  if (decision.shortCircuit) {
    return { action: "short-circuited", reason: decision.reason };
  }

  // Fires synchronously right before the (possibly stdio-inherited, log-
  // interleaving) vite invocation — the only point at which "why a rebuild
  // is about to run" can be announced BEFORE that child's own output starts
  // streaming. Announcing it only after `runVite()` returns (i.e. from the
  // caller reading this function's return value) would print a "build
  // starting" line AFTER the build's own log lines — nonsensical ordering.
  if (onBeforeRebuild) onBeforeRebuild(decision);

  const result = runVite();
  if (result.status !== 0) {
    throw new DashboardAssetsFreshnessError(
      `dashboard build failed (bun run --filter '@lore/dashboard' build exited ${String(result.status)}). ` +
        `See output above.`,
    );
  }
  if (!dashboardDistIsPresent(dashboardDistDir)) {
    throw new DashboardAssetsFreshnessError(
      `dashboard build reported success but ${dashboardDistDir} is missing or empty. Check ` +
        `packages/dashboard/vite.config.ts's build.outDir.`,
    );
  }
  // Recompute AFTER the build, not before: `prebuild` regenerates the
  // git-ignored packages/dashboard/src/routeTree.gen.ts on every invocation
  // (TanStack Router codegen), so the pre-build snapshot in `freshDigest`
  // never matches what's actually on disk once this build's own prebuild
  // step has run. The post-build digest is what the NEXT run's pre-build
  // snapshot will actually reproduce, so it's the correct freshness identity
  // to persist.
  const postBuildDigest = computeDashboardSourceDigest(dashboardSrcDir, dashboardViteConfigPath, dashboardPkgJsonPath);
  const written = writeDashboardAssetsModule({ digest: postBuildDigest, builtAt: now() }, paths);
  return { action: "rebuilt", reason: decision.reason, distFileCount: written.distFileCount, digest: postBuildDigest };
}
